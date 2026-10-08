/**
 * SOP 计划服务（2026-08 graph-engineering SOP）：命中 SOP 路由后先规划再执行的结构化 ToDo List。
 *
 * - 同一会话仅一个 active 计划：createPlan 自动 supersede 旧计划（作者改方向的语义），
 *   旧计划的未决挂账问题（deferredQuestions）自动带入新计划，挂账不丢。
 * - 打勾两条路：服务层自动（runner 按 conversationId + (nodeId,targetId) 匹配任务项，
 *   见 markItemByNodeRun）与模型手动（人工类任务项调 updateSopPlan → updatePlanItems）。
 * - 全部任务项终态（done/failed/skipped）后计划自动转 done。
 */
import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { currentTaskDefaults, taskDefaults } from "@desktop/service/task-defaults"
import { legacyTaskDefaults, type TaskDefaults } from "@desktop/shared/task-defaults"

export type SopPlanItemStatus = "pending" | "active" | "done" | "failed" | "skipped"

export interface SopPlanItem {
  id: string
  label: string
  /** 图节点 id（theme/world/character/setting/outline/content/novel）或人工项 "manual" */
  nodeId: string
  /** 实例锚点（characterId/chapterId/volumeId），环节级为空 */
  targetId?: string
  status: SopPlanItemStatus
  summary?: string
  /** 完成该项的节点运行（自动打勾时回填） */
  sopNodeRunId?: string
}

export interface DeferredQuestion {
  id: string
  /** 挂账绑定的环节：执行到该环节入口时再追问 */
  nodeId: string
  question: string
  status: "deferred" | "resolved"
  answer?: string
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}

function readItems(plan: { items: Prisma.JsonValue }): SopPlanItem[] {
  return (plan.items as unknown as SopPlanItem[]) ?? []
}

function readDeferred(plan: { deferredQuestions: Prisma.JsonValue | null }): DeferredQuestion[] {
  return (plan.deferredQuestions as unknown as DeferredQuestion[] | null) ?? []
}

/** 全部任务项终态 → 计划自动完成 */
function allTerminal(items: SopPlanItem[]): boolean {
  return (
    items.length > 0 &&
    items.every((i) => i.status === "done" || i.status === "failed" || i.status === "skipped")
  )
}

export interface CreatePlanInput {
  /** Trusted service scope; never accepted from renderer/tool JSON. */
  defaultsSnapshot?: TaskDefaults
  novelId: string; conversationId: string; title: string; entryIntent?: string; replaceGoal?: boolean
  items: { label: string; nodeId: string; targetId?: string }[]
  deferredQuestions?: { nodeId: string; question: string }[]
}
export async function createPlanInTransaction(tx: Prisma.TransactionClient, input: CreatePlanInput) {
  await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${input.conversationId} FOR UPDATE`
  const conversation = await tx.conversation.findUnique({ where: { id: input.conversationId } })
  if (!conversation || conversation.novelId !== input.novelId) throw new ContentError("PLAN_SCOPE_INVALID", "计划不属于当前作品或会话", 404)
  await currentTargetLabels(tx, input.novelId, input.items.flatMap(item => item.targetId ? [item.targetId] : []), true)
  const prev = await tx.sopPlan.findFirst({ where: { conversationId: input.conversationId, status: "active" }, orderBy: { createdAt: "desc" } })
  const existing = prev && !input.replaceGoal ? readItems(prev) : []
  const items = [...existing]
  for (const item of input.items) {
    const found = existing.find(i => i.nodeId === item.nodeId && (i.targetId ?? null) === (item.targetId ?? null) && (item.targetId || i.label === item.label))
    if (found) { const index = items.findIndex(i => i.id === found.id); items[index] = { ...found, label: item.label } }
    else items.push({ ...item, id: newId("item"), status: "pending" })
  }
  const deferred = prev ? readDeferred(prev).filter(q => q.status === "deferred") : []
  for (const q of input.deferredQuestions ?? []) if (!deferred.some(d => d.nodeId === q.nodeId && d.question === q.question)) deferred.push({ ...q, id: newId("dq"), status: "deferred" })
  const data = { title: input.title, entryIntent: input.entryIntent ?? prev?.entryIntent ?? null, items: items as unknown as Prisma.InputJsonValue, deferredQuestions: deferred as unknown as Prisma.InputJsonValue }
  if (prev && !input.replaceGoal) return tx.sopPlan.update({ where: { id: prev.id }, data })
  if (prev) await tx.sopPlan.update({ where: { id: prev.id }, data: { status: "superseded" } })
  return tx.sopPlan.create({ data: { ...data, novelId: input.novelId, conversationId: input.conversationId, status: "active",
    defaultsSnapshot: input.defaultsSnapshot ?? currentTaskDefaults() ?? legacyTaskDefaults(conversation.modelId, conversation.thinkingEffort) } })
}
export async function createPlan(input: CreatePlanInput) {
  const defaultsSnapshot = input.defaultsSnapshot ?? await taskDefaults()
  return prisma.$transaction(tx => createPlanInTransaction(tx, { ...input, defaultsSnapshot }))
}

/** 所有读改写先锁会话，再读取计划，避免并发节点完成互相覆盖。 */
async function mutatePlan<T>(id: string, update: (tx: Prisma.TransactionClient, plan: NonNullable<Awaited<ReturnType<typeof getPlan>>>) => Promise<T>) {
  return prisma.$transaction(async tx => {
    const initial = await tx.sopPlan.findUnique({ where: { id } })
    if (!initial) throw new ContentError("PLAN_NOT_FOUND", "计划不存在", 404)
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${initial.conversationId} FOR UPDATE`
    const plan = await tx.sopPlan.findUniqueOrThrow({ where: { id } })
    if (plan.status === "superseded") throw new ContentError("PLAN_STALE", "此计划已作废，请读取当前计划")
    return update(tx, plan)
  })
}

export async function getPlan(id: string) {
  return prisma.sopPlan.findUnique({ where: { id } })
}

export async function getActivePlan(conversationId: string) {
  return prisma.sopPlan.findFirst({
    where: { conversationId, status: "active" },
    orderBy: { createdAt: "desc" },
  })
}

/** 会话最近的计划列表（含已完结/作废，供对话区回放） */
export async function listPlans(conversationId: string, limit = 5) {
  return prisma.sopPlan.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  })
}

async function writeItems(planId: string, items: SopPlanItem[], tx: Prisma.TransactionClient = prisma) {
  return tx.sopPlan.update({
    where: { id: planId },
    data: {
      items: items as unknown as Prisma.InputJsonValue,
      ...(allTerminal(items) ? { status: "done" } : {}),
    },
  })
}

/** 模型手动更新任务项（人工项打勾/跳过）与整计划作废 */
export async function updatePlanItems(
  planId: string,
  updates: { id: string; status?: SopPlanItemStatus; summary?: string }[]
) {
  return mutatePlan(planId, async (tx, plan) => {
  if (updates.some(update => !readItems(plan).some(item => item.id === update.id))) throw new ContentError("PLAN_ITEM_STALE", "任务项已变化，请重新读取计划")
  const items = readItems(plan).map((i) => {
    const u = updates.find((x) => x.id === i.id)
    if (!u) return i
    return {
      ...i,
      ...(u.status ? { status: u.status } : {}),
      ...(u.summary !== undefined ? { summary: u.summary } : {}),
    }
  })
  return writeItems(planId, items, tx)
  })
}

export async function setPlanStatus(planId: string, status: "active" | "done" | "superseded") {
  return mutatePlan(planId, async (tx, plan) => {
    if (status === "active") await tx.sopPlan.updateMany({ where: { conversationId: plan.conversationId, id: { not: planId }, status: "active" }, data: { status: "superseded" } })
    return tx.sopPlan.update({ where: { id: planId }, data: { status } })
  })
}

/**
 * 服务层自动打勾钩子：runner 开始/完成节点运行时调用。
 * 按会话活跃计划 + (nodeId, targetId) 匹配任务项；匹配不到就静默跳过
 * （作者没建计划的即兴操作不该报错）。
 */
export async function markItemByNodeRun(input: {
  conversationId?: string | null
  nodeId: string
  targetId?: string | null
  status: "active" | "done" | "failed"
  sopNodeRunId?: string
  summary?: string
}) {
  if (!input.conversationId) return
  const plan = await getActivePlan(input.conversationId)
  if (!plan) return
  return mutatePlan(plan.id, async (tx, current) => {
  const items = readItems(current)
  // 先精确匹配 (nodeId,targetId)；匹配不到时回退到同 nodeId 的环节级任务项
  // （实例级 run 如 outline:volumeId 也能勾选「大纲」环节项）
  let idx = items.findIndex(
    (i) => i.nodeId === input.nodeId && (i.targetId ?? null) === (input.targetId ?? null)
  )
  if (idx < 0 && input.targetId) {
    idx = items.findIndex(
      (i) =>
        i.nodeId === input.nodeId &&
        !i.targetId &&
        i.status !== "done" &&
        i.status !== "failed" &&
        i.status !== "skipped"
    )
  }
  if (idx < 0) return
  items[idx] = {
    ...items[idx],
    status: input.status,
    ...(input.sopNodeRunId ? { sopNodeRunId: input.sopNodeRunId } : {}),
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
  }
  await writeItems(plan.id, items, tx)
  })
}

/** 挂账：用户「还没想好」跳过的问题，绑定环节，到环节入口再追问 */
export async function deferQuestion(planId: string, input: { nodeId: string; question: string }) {
  return mutatePlan(planId, async (tx, plan) => {
  const deferred = readDeferred(plan)
  deferred.push({ id: newId("dq"), nodeId: input.nodeId, question: input.question, status: "deferred" })
  return tx.sopPlan.update({
    where: { id: planId },
    data: { deferredQuestions: deferred as unknown as Prisma.InputJsonValue },
  })
  })
}

export async function resolveQuestion(planId: string, questionId: string, answer?: string) {
  return mutatePlan(planId, async (tx, plan) => {
  const deferred = readDeferred(plan).map((q) =>
    q.id === questionId ? { ...q, status: "resolved" as const, ...(answer ? { answer } : {}) } : q
  )
  return tx.sopPlan.update({
    where: { id: planId },
    data: { deferredQuestions: deferred as unknown as Prisma.InputJsonValue },
  })
  })
}

/** 当前卡片按 ID 读最新名称；历史计划的 labels 不改写。 */
async function currentTargetLabels(tx: Prisma.TransactionClient, novelId: string, ids: string[], requireAll = false) {
  const [chapters, volumes, characters, worlds, settings] = await Promise.all([
    tx.chapter.findMany({ where: { id: { in: ids }, volume: { novelId } }, select: { id: true, title: true, index: true } }),
    tx.volume.findMany({ where: { id: { in: ids }, novelId }, select: { id: true, title: true, index: true } }),
    tx.character.findMany({ where: { id: { in: ids }, novelId }, select: { id: true, name: true } }),
    tx.world.findMany({ where: { id: { in: ids }, novelId }, select: { id: true, name: true } }),
    tx.setting.findMany({ where: { id: { in: ids }, novelId }, select: { id: true, name: true } }),
  ])
  const labels = new Map<string, string>([
    ...chapters.map(c => [c.id, `第 ${c.index} 章《${c.title}》`] as const), ...volumes.map(v => [v.id, `第 ${v.index} 卷《${v.title}》`] as const),
    ...[...characters, ...worlds, ...settings].map(row => [row.id, row.name] as const),
  ])
  if (requireAll && ids.some(id => id !== novelId && !labels.has(id))) throw new ContentError("PLAN_TARGET_INVALID", "计划对象不存在或不属于当前作品", 404)
  return labels
}
export async function projectCurrentPlan(plan: NonNullable<Awaited<ReturnType<typeof getPlan>>>) {
  const items = readItems(plan)
  const labels = await currentTargetLabels(prisma, plan.novelId, items.flatMap(item => item.targetId ? [item.targetId] : []))
  const nodeLabels: Record<string, string> = { content: "正文", outline: "大纲", character: "角色", world: "世界观", setting: "设定", theme: "主题", novel: "整书", manual: "任务" }
  return { ...plan, items: items.map(item => ({ ...item, label: item.targetId && labels.has(item.targetId) ? `${nodeLabels[item.nodeId] ?? "任务"} · ${labels.get(item.targetId)}` : item.label })) }
}
