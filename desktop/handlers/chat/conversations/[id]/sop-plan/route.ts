import { NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getActivePlan, listPlans, projectCurrentPlan } from "@/lib/sop/plan"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * 会话的 SOP 计划（对话区计划卡与吸顶进度条的数据源）：
 * active = 进行中计划（含任务项与挂账问题），recent = 最近的历史计划（作废/完结）。
 */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }
  const conversation = await prisma.conversation.findUnique({ where: { id } })
  if (!conversation || conversation.userId !== session.user.id) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 })
  }

  const [active, recent] = await Promise.all([getActivePlan(id), listPlans(id, 6)])
  return NextResponse.json({
    active: active ? await projectCurrentPlan(active) : null,
    recent: recent.filter((p) => p.id !== active?.id),
  })
}
