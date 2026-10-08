import { lockSceneTree } from "./scene"
/**
 * 情景试验场服务层：CRUD + 参演名单/场景解析 + 回合/主干节点/分镜卡落库。
 *
 * 数据模型纯标量无外键（同 TextComment 惯例），删除靠事务手动级联；
 * 节点/分镜卡排序复用 fractional-index.ts 的分数序号机制。
 * AI 推演编排（开局/逐回合/整理分镜/生成样文）在 scenario-ai.ts，本文件只负责落库与校验。
 */

import type { Prisma, ScenarioCard, ScenarioLab, ScenarioNode, ScenarioTurn } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { taskDefaults } from "@desktop/service/task-defaults"
import {
  normalizeScenarioBeats,
  normalizeScenarioCast,
  normalizeScenarioChecks,
  normalizeScenarioFlow,
  SCENARIO_CAST_MAX,
  SCENARIO_PREMISE_MAX,
  SCENARIO_SCENES_MAX,
  type ScenarioBeat,
  type ScenarioCastMember,
  type ScenarioCheckRecord,
  type ScenarioFlowItem,
} from "@/lib/scenario-lab"
import { insertWithIndex, INDEX_STEP, isUniqueViolation } from "@/lib/services/fractional-index"

/** 试验场不存在或不属于该小说 */
export class ScenarioLabNotFoundError extends Error {
  constructor(message = "情景试验场不存在") {
    super(message)
    this.name = "ScenarioLabNotFoundError"
  }
}

/** 主干情节点不存在或不属于该试验场 */
export class ScenarioNodeNotFoundError extends Error {
  constructor(message = "情节点不存在") {
    super(message)
    this.name = "ScenarioNodeNotFoundError"
  }
}

/** 分镜卡不存在或不属于该试验场 */
export class ScenarioCardNotFoundError extends Error {
  constructor(message = "分镜卡不存在") {
    super(message)
    this.name = "ScenarioCardNotFoundError"
  }
}

/** 参演名单/场景配置不合法（角色不属于本小说、user 扮演者多于一人等），路由映射 400 */
export class ScenarioCastError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ScenarioCastError"
  }
}

/** 试验场状态不允许该操作（未开局就推进、重复开局等），路由映射 400 */
export class ScenarioStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ScenarioStateError"
  }
}

// ── DTO ──────────────────────────────────────────────────────────────

export interface ScenarioLabDTO {
  id: string
  novelId: string
  title: string
  cast: ScenarioCastMember[]
  sceneIds: string[]
  premise: string
  prose: string
  proseAt: string | null
  status: string
  createdAt: string
  updatedAt: string
}

/** 侧栏列表项：附回合/情节点计数 */
export interface ScenarioLabSummaryDTO {
  id: string
  novelId: string
  title: string
  status: string
  cast: ScenarioCastMember[]
  turnCount: number
  nodeCount: number
  createdAt: string
  updatedAt: string
}

export interface ScenarioTurnDTO {
  id: string
  labId: string
  index: number
  kind: string
  narrative: string
  beats: ScenarioBeat[]
  /** 时序流水（旁白与角色言行按发生先后穿插）；空数组=旧回合，按 narrative+beats 固定顺序渲染 */
  flow: ScenarioFlowItem[]
  direction: string | null
  checks: ScenarioCheckRecord[]
  createdAt: string
}

export interface ScenarioNodeDTO {
  id: string
  labId: string
  index: number
  text: string
  turnId: string | null
  createdAt: string
  updatedAt: string
}

export interface ScenarioCardDTO {
  id: string
  labId: string
  index: number
  nodeId: string | null
  text: string
  characterIds: string[]
  sceneIds: string[]
  createdAt: string
  updatedAt: string
}

export function toScenarioLabDTO(row: ScenarioLab): ScenarioLabDTO {
  return {
    id: row.id,
    novelId: row.novelId,
    title: row.title,
    cast: normalizeScenarioCast(row.cast),
    sceneIds: row.sceneIds,
    premise: row.premise,
    prose: row.prose,
    proseAt: row.proseAt?.toISOString() ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toScenarioTurnDTO(row: ScenarioTurn): ScenarioTurnDTO {
  return {
    id: row.id,
    labId: row.labId,
    index: row.index,
    kind: row.kind,
    narrative: row.narrative,
    beats: normalizeScenarioBeats(row.beats),
    flow: normalizeScenarioFlow(row.flow),
    direction: row.direction,
    checks: normalizeScenarioChecks(row.checks),
    createdAt: row.createdAt.toISOString(),
  }
}

export function toScenarioNodeDTO(row: ScenarioNode): ScenarioNodeDTO {
  return {
    id: row.id,
    labId: row.labId,
    index: row.index,
    text: row.text,
    turnId: row.turnId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toScenarioCardDTO(row: ScenarioCard): ScenarioCardDTO {
  return {
    id: row.id,
    labId: row.labId,
    index: row.index,
    nodeId: row.nodeId,
    text: row.text,
    characterIds: row.characterIds,
    sceneIds: row.sceneIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ── 参演名单/场景解析 ─────────────────────────────────────────────────

export interface ScenarioCastInput {
  characterId: string
  control?: "ai" | "user"
}

/**
 * 解析参演名单与场景列表：逐一校验属于本小说、快照角色名；
 * cast 允许为空（配置中），最多 SCENARIO_CAST_MAX 人、至多一个 control:"user"；
 * 场景最多 SCENARIO_SCENES_MAX 个。违反抛 ScenarioCastError（路由映射 400）。
 */
export async function resolveScenarioCast(
  novelId: string,
  cast: ScenarioCastInput[],
  sceneIds: string[],
  db: Prisma.TransactionClient = prisma
): Promise<{ cast: ScenarioCastMember[]; sceneIds: string[] }> {
  if (cast.length > SCENARIO_CAST_MAX) {
    throw new ScenarioCastError(`参演角色最多 ${SCENARIO_CAST_MAX} 人`)
  }
  const ids = cast.map((c) => c.characterId)
  if (new Set(ids).size !== ids.length) {
    throw new ScenarioCastError("参演名单里有重复的角色")
  }
  if (cast.filter((c) => c.control === "user").length > 1) {
    throw new ScenarioCastError("只能扮演其中一名角色，其余交给 AI")
  }
  if (sceneIds.length > SCENARIO_SCENES_MAX) {
    throw new ScenarioCastError(`参演场景最多 ${SCENARIO_SCENES_MAX} 个`)
  }

  const characters = ids.length
    ? await db.character.findMany({
        where: { novelId, id: { in: ids } },
        select: { id: true, name: true },
      })
    : []
  const nameById = new Map(characters.map((c) => [c.id, c.name]))
  const resolved: ScenarioCastMember[] = []
  for (const member of cast) {
    const name = nameById.get(member.characterId)
    if (!name) throw new ScenarioCastError("参演角色不存在或不属于这部作品")
    resolved.push({
      characterId: member.characterId,
      name,
      control: member.control === "user" ? "user" : "ai",
    })
  }

  const uniqueSceneIds = [...new Set(sceneIds)]
  if (uniqueSceneIds.length > 0) {
    const scenes = await db.scene.findMany({
      where: { novelId, id: { in: uniqueSceneIds } },
      select: { id: true },
    })
    if (scenes.length !== uniqueSceneIds.length) {
      throw new ScenarioCastError("参演场景不存在或不属于这部作品")
    }
  }
  return { cast: resolved, sceneIds: uniqueSceneIds }
}

// ── 试验场 CRUD ───────────────────────────────────────────────────────

export async function listScenarioLabs(novelId: string): Promise<ScenarioLabSummaryDTO[]> {
  const labs = await prisma.scenarioLab.findMany({
    where: { novelId },
    orderBy: { createdAt: "asc" },
  })
  const labIds = labs.map((l) => l.id)
  // 纯标量无外键：groupBy 按 labId 集合过滤（不能走关系条件）
  const [turnCounts, nodeCounts] = labIds.length
    ? await Promise.all([
        prisma.scenarioTurn.groupBy({
          by: ["labId"],
          where: { labId: { in: labIds } },
          _count: { _all: true },
        }),
        prisma.scenarioNode.groupBy({
          by: ["labId"],
          where: { labId: { in: labIds } },
          _count: { _all: true },
        }),
      ])
    : [[], []]
  const turnsByLab = new Map(turnCounts.map((r) => [r.labId, r._count._all]))
  const nodesByLab = new Map(nodeCounts.map((r) => [r.labId, r._count._all]))
  return labs.map((lab) => ({
    id: lab.id,
    novelId: lab.novelId,
    title: lab.title,
    status: lab.status,
    cast: normalizeScenarioCast(lab.cast),
    turnCount: turnsByLab.get(lab.id) ?? 0,
    nodeCount: nodesByLab.get(lab.id) ?? 0,
    createdAt: lab.createdAt.toISOString(),
    updatedAt: lab.updatedAt.toISOString(),
  }))
}

/** 取单个试验场（路由做归属校验用） */
export async function getScenarioLab(labId: string): Promise<ScenarioLabDTO | null> {
  const lab = await prisma.scenarioLab.findUnique({ where: { id: labId } })
  return lab ? toScenarioLabDTO(lab) : null
}

/** 详情：lab + 全部回合 + 主干节点 + 分镜卡（面板一次取齐） */
export async function getScenarioLabDetail(labId: string): Promise<{
  lab: ScenarioLabDTO
  turns: ScenarioTurnDTO[]
  nodes: ScenarioNodeDTO[]
  cards: ScenarioCardDTO[]
} | null> {
  const lab = await prisma.scenarioLab.findUnique({ where: { id: labId } })
  if (!lab) return null
  const [turns, nodes, cards] = await Promise.all([
    prisma.scenarioTurn.findMany({ where: { labId }, orderBy: { index: "asc" } }),
    prisma.scenarioNode.findMany({ where: { labId }, orderBy: { index: "asc" } }),
    prisma.scenarioCard.findMany({ where: { labId }, orderBy: { index: "asc" } }),
  ])
  return {
    lab: toScenarioLabDTO(lab),
    turns: turns.map(toScenarioTurnDTO),
    nodes: nodes.map(toScenarioNodeDTO),
    cards: cards.map(toScenarioCardDTO),
  }
}

export async function createScenarioLab(
  novelId: string,
  data: { title: string; cast?: ScenarioCastInput[]; sceneIds?: string[]; premise?: string }
): Promise<ScenarioLabDTO> {
  return prisma.$transaction(async tx => {
  await lockSceneTree(tx, novelId)
  const title = data.title.trim()
  if (!title) throw new ScenarioCastError("试验场需要起个名字")
  const premise = (data.premise ?? "").slice(0, SCENARIO_PREMISE_MAX)
  const { cast, sceneIds } = await resolveScenarioCast(
    novelId,
    data.cast ?? [],
    data.sceneIds ?? [], tx
  )
  const lab = await tx.scenarioLab.create({
    data: {
      novelId,
      title,
      cast: cast as unknown as Prisma.InputJsonValue,
      sceneIds,
      premise,
    },
  })
  return toScenarioLabDTO(lab)
  })
}

export interface UpdateScenarioLabInput {
  title?: string
  cast?: ScenarioCastInput[]
  sceneIds?: string[]
  premise?: string
  prose?: string
}

export async function updateScenarioLab(
  labId: string,
  data: UpdateScenarioLabInput
): Promise<ScenarioLabDTO> {
  return prisma.$transaction(async tx => {
  const existing = await prisma.scenarioLab.findUnique({ where: { id: labId } })
  if (!existing) throw new ScenarioLabNotFoundError()

  await lockSceneTree(tx, existing.novelId)
  const current = await tx.scenarioLab.findUniqueOrThrow({where: {id: labId}})
  const patch: Prisma.ScenarioLabUpdateInput = {}
  if (data.title !== undefined) {
    const title = data.title.trim()
    if (!title) throw new ScenarioCastError("试验场需要起个名字")
    patch.title = title
  }
  if (data.cast !== undefined || data.sceneIds !== undefined) {
    // cast 与 sceneIds 任一变更都要整体重解析（校验交叉约束），未传的一方沿用现值
    const currentCast = normalizeScenarioCast(current.cast).map((m) => ({
      characterId: m.characterId,
      control: m.control,
    }))
    const { cast, sceneIds } = await resolveScenarioCast(
      existing.novelId,
      data.cast ?? currentCast,
      data.sceneIds ?? current.sceneIds, tx
    )
    patch.cast = cast as unknown as Prisma.InputJsonValue
    patch.sceneIds = sceneIds
  }
  if (data.premise !== undefined) patch.premise = data.premise.slice(0, SCENARIO_PREMISE_MAX)
  if (data.prose !== undefined) patch.prose = data.prose

  const lab = await tx.scenarioLab.update({ where: { id: labId }, data: patch })
  return toScenarioLabDTO(lab)
  })
}

/** 删除试验场：事务内级联删回合/节点/分镜卡（纯标量无外键，手动级联） */
export async function deleteScenarioLab(labId: string): Promise<void> {
  const existing = await prisma.scenarioLab.findUnique({ where: { id: labId } })
  if (!existing) throw new ScenarioLabNotFoundError()
  await prisma.$transaction(async tx => Promise.all([
    tx.scenarioTurn.deleteMany({ where: { labId } }),
    tx.scenarioNode.deleteMany({ where: { labId } }),
    tx.scenarioCard.deleteMany({ where: { labId } }),
    tx.scenarioLab.delete({ where: { id: labId } }),
  ]))
}

/** 重置：清空全部推演记录（回合/节点/分镜卡/样文），状态回 draft，配置保留 */
export async function resetScenarioLab(labId: string): Promise<ScenarioLabDTO> {
  const existing = await prisma.scenarioLab.findUnique({ where: { id: labId } })
  if (!existing) throw new ScenarioLabNotFoundError()
  const [lab] = await prisma.$transaction(async tx => Promise.all([
    tx.scenarioLab.update({
      where: { id: labId },
      data: { status: "draft", prose: "", proseAt: null },
    }),
    tx.scenarioTurn.deleteMany({ where: { labId } }),
    tx.scenarioNode.deleteMany({ where: { labId } }),
    tx.scenarioCard.deleteMany({ where: { labId } }),
  ]))
  return toScenarioLabDTO(lab)
}

/** 开局/推进时把状态置为 active */
export async function markScenarioActive(labId: string): Promise<void> {
  await prisma.scenarioLab.update({ where: { id: labId }, data: { status: "active" } })
}

/** 写入样文（AI 生成或面板手动编辑后的保存） */
export async function setScenarioProse(labId: string, prose: string): Promise<ScenarioLabDTO> {
  const lab = await prisma.scenarioLab.update({
    where: { id: labId },
    data: { prose, proseAt: new Date() },
  })
  return toScenarioLabDTO(lab)
}

// ── 回合落库（scenario-ai 编排器调用） ────────────────────────────────

/**
 * 追加回合：index = 当前最大 + 1（开局=1）。撞 (labId,index) 唯一约束（并发推进）
 * 重读重试 ≤3 次（照 fractional-index 的 P2002 先例）。
 */
export async function appendScenarioTurn(
  labId: string,
  data: {
    kind: "opening" | "beat"
    narrative: string
    beats: ScenarioBeat[]
    /** 时序流水（导演编排的穿插顺序）；不传=旧式固定顺序回合 */
    flow?: ScenarioFlowItem[]
    direction?: string | null
    checks?: ScenarioCheckRecord[]
  }
): Promise<ScenarioTurnDTO> {
  const defaultsSnapshot = await taskDefaults()
  for (let attempt = 1; ; attempt++) {
    const max = await prisma.scenarioTurn.aggregate({
      where: { labId },
      _max: { index: true },
    })
    const index = (max._max.index ?? 0) + 1
    try {
      const turn = await prisma.scenarioTurn.create({
        data: {
          labId,
          defaultsSnapshot,
          index,
          kind: data.kind,
          narrative: data.narrative,
          beats: data.beats as unknown as Prisma.InputJsonValue,
          ...(data.flow ? { flow: data.flow as unknown as Prisma.InputJsonValue } : {}),
          direction: data.direction ?? null,
          ...(data.checks ? { checks: data.checks as unknown as Prisma.InputJsonValue } : {}),
        },
      })
      return toScenarioTurnDTO(turn)
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= 3) throw err
    }
  }
}

// ── 主干节点 ──────────────────────────────────────────────────────────

/** 追加主干情节点（回合落库时由编排器调用；锚点缺省=追加末尾） */
export async function createScenarioNode(
  labId: string,
  data: { text: string; turnId?: string | null }
): Promise<ScenarioNodeDTO> {
  const node = await insertWithIndex(
    prisma.scenarioNode,
    { labId },
    {},
    () => new ScenarioNodeNotFoundError("插入位置的锚点情节点不存在"),
    (index) =>
      prisma.scenarioNode.create({
        data: { labId, index, text: data.text, turnId: data.turnId ?? null },
      })
  )
  return toScenarioNodeDTO(node)
}

export async function updateScenarioNodeText(
  nodeId: string,
  text: string
): Promise<ScenarioNodeDTO> {
  const existing = await prisma.scenarioNode.findUnique({ where: { id: nodeId } })
  if (!existing) throw new ScenarioNodeNotFoundError()
  const node = await prisma.scenarioNode.update({ where: { id: nodeId }, data: { text } })
  return toScenarioNodeDTO(node)
}

/** 删情节点（只摘剧情骨架，不动溯源的回合本身） */
export async function deleteScenarioNode(nodeId: string): Promise<void> {
  const existing = await prisma.scenarioNode.findUnique({ where: { id: nodeId } })
  if (!existing) throw new ScenarioNodeNotFoundError()
  await prisma.scenarioNode.delete({ where: { id: nodeId } })
}

// ── 分镜卡 ────────────────────────────────────────────────────────────

/**
 * 整理成卡：事务内全量替换（先删旧卡、按 1024 步距铺新卡）。
 * 分镜卡全部由 AI 整理派生（无手工卡）。
 */
export async function replaceScenarioCards(
  labId: string,
  cards: { text: string; nodeId?: string | null; characterIds?: string[]; sceneIds?: string[] }[]
): Promise<ScenarioCardDTO[]> {
  await prisma.$transaction(async tx => {
    const lab = await tx.scenarioLab.findUnique({where: {id: labId}})
    if (!lab) throw new ScenarioLabNotFoundError()
    await lockSceneTree(tx, lab.novelId)
    const ids = [...new Set(cards.flatMap(c => c.sceneIds ?? []))]
    const valid = await tx.scene.count({where: {novelId: lab.novelId, id: {in: ids}}})
    if (valid !== ids.length) throw new ScenarioCastError("分镜引用了已删除或其他作品的场景")
    await tx.scenarioCard.deleteMany({where: {labId}})
    for (const [i, card] of cards.entries()) await tx.scenarioCard.create({data: {labId, index: (i + 1) * INDEX_STEP, text: card.text, nodeId: card.nodeId ?? null, characterIds: card.characterIds ?? [], sceneIds: card.sceneIds ?? []}})
  })
  const rows = await prisma.scenarioCard.findMany({ where: { labId }, orderBy: { index: "asc" } })
  return rows.map(toScenarioCardDTO)
}

export async function updateScenarioCard(
  cardId: string,
  data: { text?: string }
): Promise<ScenarioCardDTO> {
  const existing = await prisma.scenarioCard.findUnique({ where: { id: cardId } })
  if (!existing) throw new ScenarioCardNotFoundError()
  const card = await prisma.scenarioCard.update({
    where: { id: cardId },
    data: { ...(data.text !== undefined ? { text: data.text } : {}) },
  })
  return toScenarioCardDTO(card)
}

export async function deleteScenarioCard(cardId: string): Promise<void> {
  const existing = await prisma.scenarioCard.findUnique({ where: { id: cardId } })
  if (!existing) throw new ScenarioCardNotFoundError()
  await prisma.scenarioCard.delete({ where: { id: cardId } })
}
