import { z } from "zod"

import type { CascadeJob, Prisma } from "@/generated/prisma/client"
import { buildNovelSections } from "@/lib/ai/context"
import { generateJSON } from "@/lib/ai/generate"
import { prisma } from "@/lib/db"
import { renderPrompt } from "@/lib/prompts/render"
import { updateChapterContent } from "@/lib/services/chapter"
import { updateChapterOutline } from "@/lib/services/outline"
import { ContentError } from "@/lib/content-errors"
import { getContentReceipt, ownedChapter } from "./content-commit"
import { runWithTaskDefaults, taskDefaults } from "@desktop/service/task-defaults"

/** 级联修订目标类型：章大纲 / 章正文 */
export type CascadeTargetType = "CHAPTER_OUTLINE" | "CHAPTER_CONTENT"

/** 单个修订项的处理状态 */
export type CascadeItemStatus = "PENDING" | "APPLIED" | "SKIPPED" | "ERROR"

/** detectAffected 输出的待修订项（含原文全文，仅供修订流程内部使用） */
export interface CascadeAffectedItem {
  targetType: CascadeTargetType
  targetId: string
  title: string
  volumeTitle: string
  currentText: string
}

/** CascadeJob.affectedItems 中存的我条目元信息（不含原文全文） */
export interface CascadeAffectedItemMeta {
  targetType: CascadeTargetType
  targetId: string
  title: string
  volumeTitle: string
}

/** CascadeJob.result 中的单条修订结果 */
export interface CascadeResultItem {
  targetType: CascadeTargetType
  targetId: string
  title: string
  volumeTitle: string
  /** 修订前原文 */
  before: string
  /** AI 修订后文本 */
  after: string
  /** AI 修订说明 */
  changes: string
  status: CascadeItemStatus
  error?: string
}

const resultItemSchema = z.object({
  targetType: z.enum(["CHAPTER_OUTLINE", "CHAPTER_CONTENT"]),
  targetId: z.string(),
  title: z.string(),
  volumeTitle: z.string(),
  before: z.string(),
  after: z.string(),
  changes: z.string(),
  status: z.enum(["PENDING", "APPLIED", "SKIPPED", "ERROR"]),
  error: z.string().optional(),
})

/** 把 CascadeJob.result（Json）规整为修订项数组；非法数据返回 [] */
export function parseCascadeResult(raw: unknown): CascadeResultItem[] {
  if (!Array.isArray(raw)) return []
  const items: CascadeResultItem[] = []
  for (const entry of raw) {
    const parsed = resultItemSchema.safeParse(entry)
    if (parsed.success) items.push(parsed.data)
  }
  return items
}

/**
 * 扫描该 novel 全部待修订项：所有章大纲 + 已有正文的章正文。
 * 不做语义相关性筛选——设定/角色变更后全部视为受影响，简单可靠。
 */
export async function detectAffected(novelId: string): Promise<CascadeAffectedItem[]> {
  const volumes = await prisma.volume.findMany({
    where: { novelId },
    orderBy: { index: "asc" },
    include: { chapters: { orderBy: { index: "asc" } } },
  })

  const items: CascadeAffectedItem[] = []
  for (const volume of volumes) {
    for (const chapter of volume.chapters) {
      items.push({
        targetType: "CHAPTER_OUTLINE",
        targetId: chapter.id,
        title: chapter.title,
        volumeTitle: volume.title,
        currentText: chapter.outline,
      })
      if (chapter.content.trim()) {
        items.push({
          targetType: "CHAPTER_CONTENT",
          targetId: chapter.id,
          title: chapter.title,
          volumeTitle: volume.title,
          currentText: chapter.content,
        })
      }
    }
  }
  return items
}

const reviseSchema = z.object({
  revisedText: z.string(),
  changes: z.string(),
})

const TARGET_TYPE_LABELS: Record<CascadeTargetType, string> = {
  CHAPTER_OUTLINE: "章大纲",
  CHAPTER_CONTENT: "章节正文",
}

/** 用 cascade.revise 模板修订单条内容；失败时抛出由调用方记录 */
async function reviseItem(
  userId: string,
  novelId: string,
  changeDescription: string,
  sections: { settings: string; characters: string },
  item: CascadeAffectedItem
): Promise<CascadeResultItem> {
  const basePrompt = await renderPrompt("cascade.revise", {
    changeDescription,
    affectedContent: `【${item.volumeTitle} · ${item.title}】（${TARGET_TYPE_LABELS[item.targetType]}）\n${item.currentText}`,
    settings: sections.settings,
    characters: sections.characters,
  })
  // seed 模板末尾要求的"修改清单"格式与结构化输出冲突，追加一节明确最终输出结构
  const prompt = `${basePrompt}

【输出格式】
请忽略上文模板末尾关于"附上修改清单"的格式描述，改为整体输出一个 JSON 对象：
{ "revisedText": "修订后的完整文本", "changes": "修订说明（简要列出改了哪些地方、为什么）" }`

  const { data } = await generateJSON({
    userId,
    novelId,
    action: "cascade.revise",
    prompt,
    schema: reviseSchema,
  })

  return {
    targetType: item.targetType,
    targetId: item.targetId,
    title: item.title,
    volumeTitle: item.volumeTitle,
    before: item.currentText,
    after: data.revisedText,
    changes: data.changes,
    status: "PENDING",
  }
}

/** 逐条执行 AI 修订（单条失败记 ERROR 继续），完成后 job → WAITING_CONFIRM */
async function runCascadeRevision(
  jobId: string,
  userId: string,
  novelId: string,
  changeDescription: string,
  affected: CascadeAffectedItem[]
) {
  try {
    const sections = await buildNovelSections(novelId)
    const results: CascadeResultItem[] = []
    for (const item of affected) {
      try {
        results.push(await reviseItem(userId, novelId, changeDescription, sections, item))
      } catch (err) {
        console.error(`[cascade] 修订失败（${item.targetType}/${item.targetId}）：`, err)
        results.push({
          targetType: item.targetType,
          targetId: item.targetId,
          title: item.title,
          volumeTitle: item.volumeTitle,
          before: item.currentText,
          after: item.currentText,
          changes: "",
          status: "ERROR",
          error: err instanceof Error ? err.message : "AI 修订失败",
        })
      }
    }

    await prisma.cascadeJob.update({
      where: { id: jobId },
      data: {
        status: "WAITING_CONFIRM",
        result: results as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (err) {
    console.error(`[cascade] 级联任务执行失败（job=${jobId}）：`, err)
    await prisma.cascadeJob
      .update({ where: { id: jobId }, data: { status: "FAILED" } })
      .catch((e) => console.error("[cascade] 标记任务失败状态出错：", e))
  }
}

export interface TriggerCascadeInput {
  novelId: string
  triggerType: "SETTING" | "CHARACTER"
  triggerId: string
  /** 变更描述（旧内容 → 新内容），直接喂给 AI */
  changeDescription: string
}

/**
 * 触发级联修订：novel 还没有卷（未生成大纲）时返回 null 不触发。
 * 否则创建 CascadeJob（status=RUNNING，affectedItems 只存 id/title 元信息），
 * 并在后台逐条同步执行 AI 修订（不做队列；单条失败记 ERROR 继续），
 * 全部完成后 status=WAITING_CONFIRM。本函数在修订启动后立即返回 job，
 * 前端通过轮询 job 状态观察进度。
 * 任何错误都在内部消化（返回 null 或 job 置 FAILED），不影响主更新流程。
 */
export async function triggerCascade(input: TriggerCascadeInput): Promise<CascadeJob | null> {
  try {
    // 聊天创作流程用持久来源图在当前对话逐项修订；避免另起后台全书重写与模型扣费。
    if (await prisma.storyWorkflow.findUnique({ where: { novelId: input.novelId }, select: { novelId: true } })) return null
    const novel = await prisma.novel.findUnique({ where: { id: input.novelId } })
    if (!novel) return null

    const volumeCount = await prisma.volume.count({ where: { novelId: input.novelId } })
    if (volumeCount === 0) return null

    const affected = await detectAffected(input.novelId)
    if (affected.length === 0) return null

    const affectedMeta: CascadeAffectedItemMeta[] = affected.map(
      ({ targetType, targetId, title, volumeTitle }) => ({
        targetType,
        targetId,
        title,
        volumeTitle,
      })
    )
    const defaultsSnapshot = await taskDefaults()
    const job = await prisma.cascadeJob.create({
      data: {
        novelId: input.novelId,
        defaultsSnapshot,
        triggerType: input.triggerType,
        triggerId: input.triggerId,
        status: "RUNNING",
        affectedItems: affectedMeta as unknown as Prisma.InputJsonValue,
      },
    })

    // fire-and-forget：后台顺序执行修订，路由无需等待全部 AI 调用完成
    void runWithTaskDefaults(defaultsSnapshot, () => runCascadeRevision(
      job.id,
      novel.userId,
      input.novelId,
      input.changeDescription,
      affected
    ))

    return job
  } catch (err) {
    console.error("[cascade] 触发级联修订失败：", err)
    return null
  }
}

async function getJobWithItems(jobId: string) {
  const job = await prisma.cascadeJob.findUnique({ where: { id: jobId } })
  if (!job) throw new Error("级联任务不存在")
  return { job, items: parseCascadeResult(job.result) }
}

/** 写回修订项；全部不再是 PENDING 时任务自动 DONE */
async function persistItems(jobId: string, items: CascadeResultItem[]) {
  const settled = items.length > 0 && items.every((it) => it.status !== "PENDING")
  return prisma.cascadeJob.update({
    where: { id: jobId },
    data: {
      result: items as unknown as Prisma.InputJsonValue,
      ...(settled ? { status: "DONE" as const } : {}),
    },
  })
}

async function applyOne(item: CascadeResultItem, job: CascadeJob, userId: string) {
  try {
    const scope = { userId, novelId: job.novelId, chapterId: item.targetId, operationId: `cascade:${job.id}:${item.targetType}:${item.targetId}` }
    if (await getContentReceipt(scope)) { item.status = "APPLIED"; return }
    const current = await ownedChapter(prisma, userId, job.novelId, item.targetId)
    const before = item.targetType === "CHAPTER_OUTLINE" ? current.outline : current.content
    if (before !== item.before) throw new ContentError("VERSION_CONFLICT", "稿件在生成建议后已修改，修订建议已保留，请重新比较")
    const options = { ...scope, expectedVersion: current.version }
    if (item.targetType === "CHAPTER_OUTLINE") {
      await updateChapterOutline(item.targetId, { outline: item.after }, options)
    } else {
      await updateChapterContent(item.targetId, item.after, options)
    }
    item.status = "APPLIED"
  } catch (err) {
    console.error(`[cascade] 应用修订失败（${item.targetType}/${item.targetId}）：`, err)
    item.status = "ERROR"
    item.error = err instanceof Error ? err.message : "应用修订失败"
  }
}

function findTargets(
  items: CascadeResultItem[],
  targetId: string,
  targetType?: CascadeTargetType
) {
  return items.filter(
    (it) => it.targetId === targetId && (!targetType || it.targetType === targetType)
  )
}

/**
 * 应用单条修订（after 落库，走 updateChapterOutline/updateChapterContent，
 * 自动 version+1 + 快照）。同一章可能同时有大纲和正文两条修订，
 * 不传 targetType 时该章所有 PENDING 项一起应用。
 */
export async function applyCascadeItem(
  jobId: string,
  targetId: string,
  targetType: CascadeTargetType | undefined,
  userId: string
) {
  const { job, items } = await getJobWithItems(jobId)
  const targets = findTargets(items, targetId, targetType)
  if (targets.length === 0) throw new Error("修订项不存在")
  const pending = targets.filter((it) => it.status === "PENDING")
  if (pending.length === 0) throw new Error("该修订项已处理")

  for (const item of pending) {
    await applyOne(item, job, userId)
  }
  return persistItems(jobId, items)
}

/** 应用全部 PENDING 修订项；单条失败记 ERROR 继续 */
export async function applyAllCascadeItems(jobId: string, userId: string) {
  const { job, items } = await getJobWithItems(jobId)
  if (job.status === "RUNNING") throw new Error("任务仍在修订中，请稍候")

  for (const item of items) {
    if (item.status === "PENDING") {
      await applyOne(item, job, userId)
    }
  }
  return persistItems(jobId, items)
}

/** 跳过单条修订（PENDING/ERROR → SKIPPED） */
export async function skipCascadeItem(
  jobId: string,
  targetId: string,
  targetType?: CascadeTargetType
) {
  const { items } = await getJobWithItems(jobId)
  const targets = findTargets(items, targetId, targetType)
  if (targets.length === 0) throw new Error("修订项不存在")

  let changed = false
  for (const item of targets) {
    if (item.status === "PENDING" || item.status === "ERROR") {
      item.status = "SKIPPED"
      changed = true
    }
  }
  if (!changed) throw new Error("该修订项已处理")
  return persistItems(jobId, items)
}

/** 完成任务：剩余 PENDING 项全部置为 SKIPPED，任务 → DONE */
export async function finishCascadeJob(jobId: string) {
  const { job, items } = await getJobWithItems(jobId)
  if (job.status === "RUNNING") throw new Error("任务仍在修订中，请稍候")

  const next = items.map((it) =>
    it.status === "PENDING" ? { ...it, status: "SKIPPED" as const } : it
  )
  return prisma.cascadeJob.update({
    where: { id: jobId },
    data: {
      status: "DONE",
      result: next as unknown as Prisma.InputJsonValue,
    },
  })
}

export type CascadeJobWithTrigger = CascadeJob & { triggerName: string | null }

/** 批量解析触发源名称（设定名 / 角色名；已删除则为 null） */
async function resolveTriggerNames(jobs: CascadeJob[]): Promise<Map<string, string>> {
  const settingIds = jobs.filter((j) => j.triggerType === "SETTING").map((j) => j.triggerId)
  const characterIds = jobs
    .filter((j) => j.triggerType === "CHARACTER")
    .map((j) => j.triggerId)

  const [settings, characters] = await Promise.all([
    settingIds.length
      ? prisma.setting.findMany({ where: { id: { in: settingIds } }, select: { id: true, name: true } })
      : [],
    characterIds.length
      ? prisma.character.findMany({ where: { id: { in: characterIds } }, select: { id: true, name: true } })
      : [],
  ])

  const names = new Map<string, string>()
  for (const s of settings) names.set(s.id, s.name)
  for (const c of characters) names.set(c.id, c.name)
  return names
}

/** 该 novel 的级联任务列表（按创建时间倒序，附触发源名称） */
export async function listCascadeJobs(novelId: string): Promise<CascadeJobWithTrigger[]> {
  const jobs = await prisma.cascadeJob.findMany({
    where: { novelId },
    orderBy: { createdAt: "desc" },
  })
  const names = await resolveTriggerNames(jobs)
  return jobs.map((j) => ({ ...j, triggerName: names.get(j.triggerId) ?? null }))
}

export async function getCascadeJob(id: string): Promise<CascadeJobWithTrigger | null> {
  const job = await prisma.cascadeJob.findUnique({ where: { id } })
  if (!job) return null
  const names = await resolveTriggerNames([job])
  return { ...job, triggerName: names.get(job.triggerId) ?? null }
}

/** 待处理任务数（RUNNING / WAITING_CONFIRM），用于侧边栏角标 */
export function countPendingJobs(jobs: { status: CascadeJob["status"] }[]): number {
  return jobs.filter((j) => j.status === "RUNNING" || j.status === "WAITING_CONFIRM").length
}
