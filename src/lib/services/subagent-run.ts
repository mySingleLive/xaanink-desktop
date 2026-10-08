/**
 * 子代理运行档案（§7.3）：评委/读者子代理的隔离执行记录。
 * 主参谋经工具调用启动它们、只拿回结论摘要；transcript 供 subagent tab 只读回放；
 * tokenUsage 单列展示（拍板：子代理墨滴单列，与主参谋用量区分）。
 */
import type { Prisma } from "@/generated/prisma/client"
import { prisma, controlPrisma } from "@/lib/db"
import { currentChatExecution } from "@/lib/chat-execution"
import { taskDefaults } from "@desktop/service/task-defaults"

export type SubAgentKind =
  | "judge"
  | "reader"
  // 历史档案兼容（2026-09 角色团试读已下线）：旧 run 回放仍按此 kind 渲染
  | "character"
  | "editor"
  | "playwright"
  | "writer"
  // 情景试验场多代理（2026-08）：actor=角色扮演 / director=导演裁定与整理 / check=一致性检查 / writer=样文
  | "scenarioActor"
  | "scenarioDirector"
  | "scenarioCheck"
  | "scenarioWriter"

export interface SubAgentTokenUsage {
  input: number
  output: number
}

export async function startRun(input: {
  novelId: string
  conversationId?: string | null
  agentKind: SubAgentKind
  task: string
  /** 所属 SOP 节点运行（SopNodeRun.id），把单次调用串进 SOP 图 */
  sopNodeRunId?: string | null
  /** 评分目标关联（2026-09 悬浮评分指示器）：judge/reader 评审类 run 携带，供按内容聚合与「评审中」检测 */
  targetType?: string | null
  targetId?: string | null
  contentHash?: string | null
  contentVersion?: number | null
  candidateId?: string | null
  reviewConfigHash?: string | null
}) {
  const scope = currentChatExecution()
  const defaultsSnapshot = scope?.taskDefaults ?? await taskDefaults()
  const run = await prisma.subAgentRun.create({
    data: {
      novelId: input.novelId,
      defaultsSnapshot,
      attemptId: scope?.attemptId ?? null,
      conversationId: input.conversationId ?? null,
      agentKind: input.agentKind,
      task: input.task,
      status: "running",
      sopNodeRunId: input.sopNodeRunId ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      contentHash: input.contentHash ?? null,
      contentVersion: input.contentVersion ?? null,
      candidateId: input.candidateId ?? null,
      reviewConfigHash: input.reviewConfigHash ?? null,
    },
  })
  scope?.progress?.({ runId: run.id, agentKind: input.agentKind, task: input.task, stage: "waiting_model", startedAt: run.createdAt.toISOString() })
  return run
}

export async function completeRun(
  id: string,
  input: { transcript: unknown; result: unknown; tokenUsage?: SubAgentTokenUsage }
) {
  const run = await prisma.subAgentRun.update({
    where: { id, status: "running" },
    data: {
      status: "done",
      transcript: input.transcript as Prisma.InputJsonValue,
      result: input.result as Prisma.InputJsonValue,
      ...(input.tokenUsage
        ? { tokenUsage: input.tokenUsage as unknown as Prisma.InputJsonValue }
        : {}),
    },
  })
  currentChatExecution()?.progress?.({ runId: run.id, agentKind: run.agentKind, task: run.task, stage: "done", startedAt: run.createdAt.toISOString() })
  return run
}

export async function failRun(id: string, errorMessage: string) {
  const scope = currentChatExecution()
  if (scope) return controlPrisma.subAgentRun.updateMany({ where: { id, attemptId: scope.attemptId, status: "running" }, data: { status: "error", errorMessage: errorMessage.slice(0, 500) } })
  return prisma.subAgentRun.updateMany({
    where: { id, status: "running" },
    data: { status: "error", errorMessage: errorMessage.slice(0, 500) },
  })
}

export async function getRun(id: string) {
  return prisma.subAgentRun.findUnique({ where: { id } })
}

/** 情景试验场的四类子代理 */
const SCENARIO_RUN_KINDS: SubAgentKind[] = [
  "scenarioActor",
  "scenarioDirector",
  "scenarioCheck",
  "scenarioWriter",
]

/** 试验场运行条目 DTO（推进过程的展开面板用；label 从 task 解析，任务文案的唯一来源是 scenario-ai.ts） */
export interface ScenarioRunDTO {
  id: string
  agentKind: string
  task: string
  /** 展示名：扮演者 · 张三 / 导演裁定 / 一致性检查 等 */
  label: string
  status: string
  result: unknown
  tokenUsage: SubAgentTokenUsage | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

/** task（情景试验场·第N回合·扮演X《书》等格式）→ 展示名 */
export function describeScenarioRunTask(task: string): string {
  const play = task.match(/扮演(.+?)《/)
  if (play) return `扮演者 · ${play[1]}`
  if (task.includes("一致性检查")) return task.includes("开局") ? "开场 · 一致性检查" : "一致性检查"
  if (task.includes("开局")) return "开场导演"
  if (task.includes("生成样文")) return "样文写手"
  if (task.includes("导演")) return "导演裁定"
  return task
}

/**
 * 列出一个试验场最近的子代理运行（推演过程展开面板的数据源，2s 轮询）：
 * 按 novelId + 四类 scenario agentKind + task 里的《试验场名》过滤，since 起按创建时间升序。
 */
export async function listScenarioRuns(input: {
  novelId: string
  labTitle: string
  /** ISO 时间戳；只取该时刻之后的运行（本次推演的起点） */
  since?: string
}): Promise<ScenarioRunDTO[]> {
  const sinceDate = input.since ? new Date(input.since) : null
  const rows = await prisma.subAgentRun.findMany({
    where: {
      novelId: input.novelId,
      agentKind: { in: SCENARIO_RUN_KINDS },
      task: { contains: `《${input.labTitle}》` },
      ...(sinceDate && !Number.isNaN(sinceDate.getTime()) ? { createdAt: { gte: sinceDate } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  })
  return rows.map((r) => ({
    id: r.id,
    agentKind: r.agentKind,
    task: r.task,
    label: describeScenarioRunTask(r.task),
    status: r.status,
    result: r.result ?? null,
    tokenUsage: (r.tokenUsage as SubAgentTokenUsage | null) ?? null,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }))
}
