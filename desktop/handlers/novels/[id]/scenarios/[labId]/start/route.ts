import { NextResponse } from "next/server"

import { runScenarioOpening } from "@/lib/services/scenario-ai"

import { getOwnedNovel } from "../../../lib"
import { getOwnedScenarioLab, toScenarioErrorResponse } from "../../lib"

type RouteContext = { params: Promise<{ id: string; labId: string }> }

/** 开局：director 依开场剧情（或自动切入）写开场叙述，落第 1 回合 + 首个主干情节点 */
export async function POST(_request: Request, ctx: RouteContext) {
  const { id, labId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const owned = await getOwnedScenarioLab(labId, id)
  if (!owned) {
    return NextResponse.json({ error: "情景试验场不存在" }, { status: 404 })
  }

  try {
    const turn = await runScenarioOpening({ userId: result.session.user.id, novelId: id, labId })
    return NextResponse.json({ turn })
  } catch (err) {
    return toScenarioErrorResponse(err)
  }
}
