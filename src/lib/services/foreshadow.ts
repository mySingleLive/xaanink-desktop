import { z } from "zod"

import { Prisma, type Foreshadow, type ForeshadowStatus, type ForeshadowTouch, type ForeshadowTouchKind } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import type { ForeshadowReferenceDTO } from "@/lib/foreshadow-reference"
import { createDefaultReferences, referenceDTOs } from "./foreshadow-reference"
import {
  buildChapterPositionMap,
  compareForeshadows,
  deriveForeshadowStatus,
  renderChapterForeshadowPrompt,
  renderForeshadowDigest,
  renderForeshadowTouchPlans,
  selectForeshadowEvaluationTouch,
  type ForeshadowEvaluation,
  type ChapterPromptInput,
  type ForeshadowWithTouches,
  type TouchLabelMaps,
} from "@/lib/foreshadow"

/** 伏笔不存在或不属于该小说 */
export class ForeshadowNotFoundError extends Error {
  constructor(message = "伏笔不存在") {
    super(message)
    this.name = "ForeshadowNotFoundError"
  }
}

/** 触点目标不合法（二选一缺失/双挂/跨书/卡不属节点/目标不存在） */
export class ForeshadowTouchTargetError extends Error {
  constructor(message = "触点关联目标不合法") {
    super(message)
    this.name = "ForeshadowTouchTargetError"
  }
}

/** 触点不存在或不属于该伏笔 */
export class ForeshadowTouchNotFoundError extends Error {
  constructor(message = "触点不存在") {
    super(message)
    this.name = "ForeshadowTouchNotFoundError"
  }
}

export const foreshadowInputSchema = z.object({
  title: z.string().trim().min(1, "伏笔标题不能为空").max(60, "伏笔标题过长"),
  content: z.string().max(20000, "内容过长").optional(),
  note: z.string().max(5000, "备注过长").optional(),
  expectation: z.string().max(200, "预期回收位置过长").optional(),
  plannedChapter: z.number().int("回收章序号必须是整数").positive("回收章序号必须从 1 开始").nullable().optional(),
  status: z.enum(["PLANNED", "PLANTED", "RESOLVED", "DROPPED"]).optional(),
})

export const touchInputSchema = z.object({
  kind: z.enum(["PLANT", "MENTION", "PAYOFF"]),
  summary: z.string().trim().max(200, "触点摘要过长").default(""),
  chapterId: z.string().nullable().optional(),
})

export interface ForeshadowTouchDTO {
  references: ForeshadowReferenceDTO[]
  id: string
  foreshadowId: string
  kind: ForeshadowTouchKind
  summary: string
  chapterId: string | null
  /** 展示标签（章：「第 V 卷第 C 章《题》」；无锚点记录为 null） */
  targetLabel: string | null
  score: number | null
  scoreComment: string
  scoredAt: string | null
  createdAt: string
}

export interface ForeshadowDTO {
  id: string
  novelId: string
  title: string
  content: string
  note: string
  expectation: string
  plannedChapter: number | null
  status: ForeshadowStatus
  touches: ForeshadowTouchDTO[]
  mentionCount: number
  createdAt: string
  updatedAt: string
}

/** 触点目标展示标签批量解析（DTO 与 AI digest 共用） */
async function resolveTouchLabelMaps(
  touches: { chapterId: string | null }[]
): Promise<TouchLabelMaps> {
  const chapterIds = [...new Set(touches.map((t) => t.chapterId).filter((x): x is string => !!x))]
  const chapters = chapterIds.length > 0
    ? await prisma.chapter.findMany({
        where: { id: { in: chapterIds } },
        include: { volume: { select: { index: true, title: true } } },
      })
    : []
  return {
    chapters: new Map(
      chapters.map((c) => [c.id, `第 ${c.volume.index} 卷第 ${c.index} 章《${c.title}》`])
    ),
  }
}

function toTouchDTO(t: ForeshadowTouch, maps: TouchLabelMaps, refs?: Map<string, ForeshadowReferenceDTO[]>): ForeshadowTouchDTO {
  return {
    references: refs?.get(t.id) ?? [],
    id: t.id,
    foreshadowId: t.foreshadowId,
    kind: t.kind,
    summary: t.summary,
    chapterId: t.chapterId,
    targetLabel: t.chapterId ? (maps.chapters.get(t.chapterId) ?? "（章节已删除）") : null,
    score: t.score,
    scoreComment: t.scoreComment,
    scoredAt: t.scoredAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  }
}

const KIND_ORDER: Record<ForeshadowTouchKind, number> = { PLANT: 0, MENTION: 1, PAYOFF: 2 }

function toDTO(row: ForeshadowWithTouches, maps: TouchLabelMaps, refs?: Map<string, ForeshadowReferenceDTO[]>): ForeshadowDTO {
  /* 触点链按 埋→提→收 排序，同类按创建时间（情节顺序的近似；跨章精确排序由作者阅读标签判断） */
  const touches = [...row.touches].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.createdAt.getTime() - b.createdAt.getTime()
  )
  return {
    id: row.id,
    novelId: row.novelId,
    title: row.title,
    content: row.content,
    note: row.note,
    expectation: row.expectation,
    plannedChapter: row.plannedChapter,
    status: row.status,
    touches: touches.map((t) => toTouchDTO(t, maps, refs)),
    mentionCount: row.touches.filter((t) => t.kind === "MENTION").length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function requireForeshadow(novelId: string, id: string): Promise<Foreshadow> {
  const row = await prisma.foreshadow.findUnique({ where: { id } })
  if (!row || row.novelId !== novelId) throw new ForeshadowNotFoundError()
  return row
}

/** 触点增删后按状态机重算（DROPPED 免疫；手动改状态走 updateForeshadow 不经过此） */
async function lockForeshadow(tx: Prisma.TransactionClient, novelId: string, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Foreshadow" WHERE "id" = ${id} AND "novelId" = ${novelId} FOR UPDATE`)
  if (rows.length === 0) throw new ForeshadowNotFoundError()
}

async function syncStatus(tx: Prisma.TransactionClient, foreshadowId: string): Promise<void> {
  const row = await tx.foreshadow.findUnique({
    where: { id: foreshadowId },
    include: { touches: { select: { kind: true } } },
  })
  if (!row) return
  const next = deriveForeshadowStatus(row.status, row.touches)
  if (next !== row.status) {
    await tx.foreshadow.update({ where: { id: foreshadowId }, data: { status: next } })
  }
}

export async function listForeshadows(
  novelId: string,
  filter?: { status?: ForeshadowStatus }
): Promise<ForeshadowDTO[]> {
  const rows = await prisma.foreshadow.findMany({
    where: { novelId, ...(filter?.status ? { status: filter.status } : {}) },
    include: { touches: { orderBy: { createdAt: "asc" } } },
  })
  rows.sort(compareForeshadows)
  const touches = rows.flatMap((r) => r.touches.map(t => ({ ...t, foreshadowTitle: r.title, foreshadowContent: r.content })))
  const [maps, refs] = await Promise.all([resolveTouchLabelMaps(touches), referenceDTOs(novelId, touches)])
  return rows.map((r) => toDTO(r, maps, refs))
}

export async function getForeshadow(novelId: string, id: string): Promise<ForeshadowDTO> {
  await requireForeshadow(novelId, id)
  const row = await prisma.foreshadow.findUnique({
    where: { id },
    include: { touches: { orderBy: { createdAt: "asc" } } },
  })
  if (!row) throw new ForeshadowNotFoundError()
  const [maps, refs] = await Promise.all([resolveTouchLabelMaps(row.touches), referenceDTOs(novelId, row.touches.map(t => ({ ...t, foreshadowTitle: row.title, foreshadowContent: row.content })))])
  return toDTO(row, maps, refs)
}

export async function createForeshadow(
  novelId: string,
  data: z.infer<typeof foreshadowInputSchema>
): Promise<ForeshadowDTO> {
  const row = await prisma.foreshadow.create({
    data: {
      novelId,
      title: data.title,
      content: data.content ?? "",
      note: data.note ?? "",
      expectation: data.expectation ?? "",
      plannedChapter: data.plannedChapter ?? null,
      ...(data.status ? { status: data.status } : {}),
    },
    include: { touches: true },
  })
  return toDTO(row, { chapters: new Map() })
}

export async function updateForeshadow(
  novelId: string,
  id: string,
  patch: Partial<z.infer<typeof foreshadowInputSchema>>
): Promise<ForeshadowDTO> {
  await requireForeshadow(novelId, id)
  await prisma.foreshadow.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.expectation !== undefined ? { expectation: patch.expectation } : {}),
      ...(patch.plannedChapter !== undefined ? { plannedChapter: patch.plannedChapter } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    },
  })
  return getForeshadow(novelId, id)
}

export async function deleteForeshadow(novelId: string, id: string): Promise<void> {
  await requireForeshadow(novelId, id)
  await prisma.foreshadow.delete({ where: { id } })
}

/** 校验触点目标：触点只挂章；引用的章须属本小说 */
async function validateTouchTarget(
  novelId: string,
  target: { chapterId?: string | null }
): Promise<{ chapterId: string | null }> {
  const chapterId = target.chapterId ?? null
  if (!chapterId) {
    throw new ForeshadowTouchTargetError("触点必须关联一个章（chapterId）")
  }
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { volume: { select: { novelId: true } } },
  })
  if (!chapter || chapter.volume.novelId !== novelId) {
    throw new ForeshadowTouchTargetError("章节不存在或不属于本作品")
  }
  return { chapterId }
}

export async function addTouch(
  novelId: string,
  foreshadowId: string,
  input: z.infer<typeof touchInputSchema>
): Promise<ForeshadowTouchDTO> {
  const foreshadow = await requireForeshadow(novelId, foreshadowId)
  const target = await validateTouchTarget(novelId, input)
  const touch = await prisma.$transaction(async (tx) => {
    await lockForeshadow(tx, novelId, foreshadowId)
    const created = await tx.foreshadowTouch.create({
      data: { foreshadowId, novelId, kind: input.kind, summary: input.summary, ...target },
    })
    await createDefaultReferences(tx, created)
    await syncStatus(tx, foreshadowId)
    return created
  })
  const [maps, refs] = await Promise.all([resolveTouchLabelMaps([touch]), referenceDTOs(novelId, [{ ...touch, foreshadowTitle: foreshadow.title, foreshadowContent: foreshadow.content }])])
  return toTouchDTO(touch, maps, refs)
}

export async function removeTouch(
  novelId: string,
  foreshadowId: string,
  touchId: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockForeshadow(tx, novelId, foreshadowId)
    const touch = await tx.foreshadowTouch.findUnique({ where: { id: touchId } })
    if (!touch || touch.foreshadowId !== foreshadowId) throw new ForeshadowTouchNotFoundError()
    await tx.foreshadowTouch.delete({ where: { id: touchId } })
    await syncStatus(tx, foreshadowId)
  })
}

/** 触点评分回填（AI 评审回填与面板单点评估共用） */
export async function recordTouchScore(
  novelId: string,
  touchId: string,
  score: number,
  comment: string
): Promise<void> {
  const touch = await prisma.foreshadowTouch.findUnique({ where: { id: touchId } })
  if (!touch || touch.novelId !== novelId) throw new ForeshadowTouchNotFoundError()
  await prisma.foreshadowTouch.update({
    where: { id: touchId },
    data: { score: Math.max(0, Math.min(100, score)), scoreComment: comment, scoredAt: new Date() },
  })
}

export type { ForeshadowEvaluation } from "@/lib/foreshadow"

/**
 * AI 评审的 foreshadowEvaluations 回填：按标题（去空白）精确匹配伏笔，
 * 再严格限制到当前章范围与触点种类，歧义匹配不回填，
 * 匹配不上丢弃（评审自由文本不可全信，静默跳过）。返回回填条数。
 */
export async function applyForeshadowEvaluations(
  novelId: string,
  scopeChapterIds: string[],
  evaluations: ForeshadowEvaluation[]
): Promise<number> {
  if (evaluations.length === 0) return 0
  const rows = await prisma.foreshadow.findMany({
    where: { novelId, status: { not: "DROPPED" } },
    include: { touches: true },
  })
  const byTitle = new Map(rows.map((r) => [r.title.replace(/\s+/g, ""), r]))
  const scope = new Set(scopeChapterIds)
  let applied = 0
  for (const ev of evaluations) {
    const row = byTitle.get(ev.foreshadowTitle.replace(/\s+/g, ""))
    if (!row) continue
    const hit = selectForeshadowEvaluationTouch(row.touches, ev, scope)
    if (!hit) continue
    await recordTouchScore(novelId, hit.id, ev.score, ev.comment)
    applied += 1
  }
  return applied
}

/* ------------------------------------------------------------------ */
/* AI 上下文（chapter.generate / review.* / 整书审视共用）               */
/* ------------------------------------------------------------------ */

async function loadForeshadowRows(novelId: string): Promise<ForeshadowWithTouches[]> {
  return prisma.foreshadow.findMany({
    where: { novelId, status: { not: "DROPPED" } },
    include: { touches: { orderBy: { createdAt: "asc" } } },
  })
}

/** 伏笔一览（digest）：全书压缩清单，所有生成/评审模板共用 */
export async function buildForeshadowDigest(novelId: string): Promise<string> {
  const rows = await loadForeshadowRows(novelId)
  if (rows.length === 0) return "（暂无伏笔档案）"
  const maps = await resolveTouchLabelMaps(rows.flatMap((r) => r.touches))
  return renderForeshadowDigest(rows, maps)
}

/** 本章伏笔提示（正文生成/正文评审）：本章落点 + 逾期未收 + 久未提及 */
export async function buildChapterForeshadowPrompt(
  novelId: string,
  chapterId: string
): Promise<string> {
  const [rows, chapter, chapters] = await Promise.all([
    loadForeshadowRows(novelId),
    prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { volume: { select: { index: true, novelId: true } } },
    }),
    prisma.chapter.findMany({
      where: { volume: { novelId } },
      select: { id: true, index: true, title: true, volume: { select: { index: true } } },
    }),
  ])
  if (rows.length === 0 || !chapter || chapter.volume.novelId !== novelId) return ""
  const posByChapterId = buildChapterPositionMap(chapters)
  const labelByChapterId = new Map(
    chapters.map((c) => [c.id, `第 ${c.volume.index} 卷第 ${c.index} 章《${c.title}》`])
  )
  const input: ChapterPromptInput = {
    current: posByChapterId.get(chapter.id)!,
    posByChapterId,
    labelByChapterId,
  }
  return renderChapterForeshadowPrompt(rows, input)
}

/** digest + 本章提示合并的一节文本（模板变量 foreshadows 的内容） */
export async function buildChapterForeshadowSection(
  novelId: string,
  chapterId: string
): Promise<string> {
  const [digest, prompt] = await Promise.all([
    buildForeshadowDigest(novelId),
    buildChapterForeshadowPrompt(novelId, chapterId),
  ])
  return prompt ? `${digest}\n\n${prompt}` : digest
}

/** 整卷评审保留卷内全部伏笔及其章落点，不能只看最多五条已回收摘要。 */
export async function buildVolumeForeshadowSection(novelId: string, volumeId: string): Promise<string> {
  const volume = await prisma.volume.findFirst({
    where: { id: volumeId, novelId },
    select: { chapters: { select: { id: true } } },
  })
  if (!volume) throw new ForeshadowTouchTargetError("卷不属于本作品")
  const rows = await loadForeshadowRows(novelId)
  const maps = await resolveTouchLabelMaps(rows.flatMap((row) => row.touches))
  const plans = renderForeshadowTouchPlans(rows, maps, { chapterIds: new Set(volume.chapters.map((chapter) => chapter.id)) })
  return [renderForeshadowDigest(rows, maps), plans && `本卷伏笔档案与章节触点（逐章核对实际埋入、提及、兑现，不能把计划当成已写好的内容）：\n${plans}`].filter(Boolean).join("\n\n")
}

/* ------------------------------------------------------------------ */
/* 级联清理（纯标量引用的服务层兜底）                                     */
/* ------------------------------------------------------------------ */

/** 整卷重建/删章时同事务调用：清该小说全部章触点（章 id 随卷删除失效） */
export async function deleteTouchesForNovelChapters(
  tx: Pick<typeof prisma, "chapter" | "foreshadowTouch">,
  novelId: string
): Promise<void> {
  const chapters = await tx.chapter.findMany({ where: { volume: { novelId } }, select: { id: true } })
  if (chapters.length > 0) {
    await tx.foreshadowTouch.deleteMany({ where: { chapterId: { in: chapters.map((c) => c.id) } } })
  }
}
