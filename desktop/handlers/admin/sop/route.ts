import { NextResponse } from "next/server"

import { forbidden, requireAdmin, serverError } from "@desktop/handlers/admin/lib"
import { prisma } from "@/lib/db"
import { INTENT_ROUTES, SOP_EDGES, SOP_NODES, SOP_ROLE_LABELS } from "@/lib/sop/graph"

export const dynamic = "force-dynamic"

/**
 * SOP 分层 DAG（/admin/sop 线框流程图的数据源）：
 * 图定义（节点/边/意图路由，src/lib/sop/graph.ts 单一事实来源）+ 每节点运行聚合统计。
 */
export async function GET() {
  const session = await requireAdmin()
  if (!session) return forbidden()

  try {
    const stats = await prisma.sopNodeRun.groupBy({
      by: ["nodeId"],
      _count: { _all: true },
      _avg: { finalScore: true, iterations: true },
    })
    const statsByNode = Object.fromEntries(
      stats.map((s) => [
        s.nodeId,
        {
          runs: s._count._all,
          avgScore: s._avg.finalScore !== null ? Math.round((s._avg.finalScore ?? 0) * 10) / 10 : null,
          avgIterations: s._avg.iterations !== null ? Math.round((s._avg.iterations ?? 0) * 10) / 10 : null,
        },
      ])
    )
    return NextResponse.json({
      nodes: SOP_NODES,
      edges: SOP_EDGES,
      intentRoutes: INTENT_ROUTES,
      roleLabels: SOP_ROLE_LABELS,
      statsByNode,
    })
  } catch (err) {
    console.error("[admin.sop] 加载 SOP 图失败：", err)
    return serverError()
  }
}
