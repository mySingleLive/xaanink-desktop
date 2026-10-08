/**
 * SOP 图状态读路径（2026-08）：意图路由与规划的感知基础。
 * 聚合：各环节最近一次 run（状态/评分/迭代）+ 实例级近期 run + 未闭环 findings
 * + 会话活跃计划与挂账问题（deferredQuestions）。
 */
import { prisma } from "@/lib/db"
import { SOP_NODES, type SopNodeId } from "@/lib/sop/graph"
import * as planService from "@/lib/sop/plan"

export interface SopNodeStatus {
  nodeId: SopNodeId
  label: string
  /** 环节最近一次 run（null = 尚未执行过） */
  lastRun: {
    status: string
    finalScore: number | null
    iterations: number
    updatedAt: string
  } | null
  /** L0 findings 路由下来的未闭环待办 */
  openFindings: { issue: string; suggestion: string }[]
}

export interface SopStatus {
  nodes: SopNodeStatus[]
  /** 实例级近期 run（角色/章/卷），最新在前 */
  instances: {
    nodeId: string
    targetId: string
    status: string
    finalScore: number | null
    updatedAt: string
  }[]
  activePlan: {
    id: string
    title: string
    items: planService.SopPlanItem[]
    deferredQuestions: planService.DeferredQuestion[]
  } | null
  /** 挂账待澄清（未决） */
  deferredQuestions: planService.DeferredQuestion[]
}

export async function getSopStatus(input: {
  novelId: string
  conversationId?: string | null
}): Promise<SopStatus> {
  const [runs, instanceRuns] = await Promise.all([
    // 环节级 run：每节点取最新一条
    prisma.sopNodeRun.findMany({
      where: { novelId: input.novelId, targetId: null },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.sopNodeRun.findMany({
      where: { novelId: input.novelId, targetId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ])

  const latestByNode = new Map<string, (typeof runs)[number]>()
  for (const r of runs) {
    if (!latestByNode.has(r.nodeId)) latestByNode.set(r.nodeId, r)
  }
  // findings 也可能挂在实例级 run 上（按 targetNode 路由时取的是该节点最新 run）
  const findingsByNode = new Map<string, { issue: string; suggestion: string }[]>()
  for (const r of [...runs, ...instanceRuns]) {
    const open =
      (r.openFindings as unknown as { issue: string; suggestion: string }[] | null) ?? []
    if (open.length === 0) continue
    const list = findingsByNode.get(r.nodeId) ?? []
    for (const f of open) {
      if (!list.some((x) => x.issue === f.issue)) list.push({ issue: f.issue, suggestion: f.suggestion })
    }
    findingsByNode.set(r.nodeId, list)
  }

  const activePlan = input.conversationId
    ? await planService.getActivePlan(input.conversationId)
    : null

  const nodes: SopNodeStatus[] = SOP_NODES.map((n) => {
    const last = latestByNode.get(n.id)
    return {
      nodeId: n.id,
      label: n.label,
      lastRun: last
        ? {
            status: last.status,
            finalScore: last.finalScore,
            iterations: last.iterations,
            updatedAt: last.updatedAt.toISOString(),
          }
        : null,
      openFindings: findingsByNode.get(n.id) ?? [],
    }
  })

  const deferred = activePlan
    ? ((activePlan.deferredQuestions as unknown as planService.DeferredQuestion[] | null) ?? [])
    : []

  return {
    nodes,
    instances: instanceRuns.map((r) => ({
      nodeId: r.nodeId,
      targetId: r.targetId!,
      status: r.status,
      finalScore: r.finalScore,
      updatedAt: r.updatedAt.toISOString(),
    })),
    activePlan: activePlan
      ? {
          id: activePlan.id,
          title: activePlan.title,
          items: (activePlan.items as unknown as planService.SopPlanItem[]) ?? [],
          deferredQuestions: deferred,
        }
      : null,
    deferredQuestions: deferred.filter((q) => q.status === "deferred"),
  }
}
