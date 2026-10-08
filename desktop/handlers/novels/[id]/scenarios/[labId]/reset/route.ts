import { NextResponse } from "next/server"

import { resetScenarioLab } from "@/lib/services/scenario-lab"

import { getOwnedNovel } from "../../../lib"
import { getOwnedScenarioLab, toScenarioErrorResponse } from "../../lib"

type RouteContext = { params: Promise<{ id: string; labId: string }> }

/** 重置：清空全部推演记录（回合/节点/分镜卡/样文），状态回 draft，配置保留 */
export async function POST(_request: Request, ctx: RouteContext) {
  const { id, labId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const owned = await getOwnedScenarioLab(labId, id)
  if (!owned) {
    return NextResponse.json({ error: "情景试验场不存在" }, { status: 404 })
  }

  try {
    const scenario = await resetScenarioLab(labId)
    return NextResponse.json({ scenario })
  } catch (err) {
    return toScenarioErrorResponse(err)
  }
}
