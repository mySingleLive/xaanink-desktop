import { NextResponse } from "next/server"

import { organizeScenarioCards } from "@/lib/services/scenario-ai"

import { getOwnedNovel } from "../../../lib"
import { getOwnedScenarioLab, toScenarioErrorResponse } from "../../lib"

type RouteContext = { params: Promise<{ id: string; labId: string }> }

/** 整理成分镜卡：把主干情节点 AI 整理为一组分镜卡（全量替换旧卡） */
export async function POST(_request: Request, ctx: RouteContext) {
  const { id, labId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const owned = await getOwnedScenarioLab(labId, id)
  if (!owned) {
    return NextResponse.json({ error: "情景试验场不存在" }, { status: 404 })
  }

  try {
    const cards = await organizeScenarioCards({
      userId: result.session.user.id,
      novelId: id,
      labId,
    })
    return NextResponse.json({ cards })
  } catch (err) {
    return toScenarioErrorResponse(err)
  }
}
