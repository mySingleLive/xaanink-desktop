import { NextResponse } from "next/server"

import { generateScenarioProse } from "@/lib/services/scenario-ai"

import { getOwnedNovel } from "../../../lib"
import { getOwnedScenarioLab, toScenarioErrorResponse } from "../../lib"

type RouteContext = { params: Promise<{ id: string; labId: string }> }

/** 生成样文：把推演流水改写成连贯正文（落 lab.prose，与正文列表完全隔离） */
export async function POST(_request: Request, ctx: RouteContext) {
  const { id, labId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const owned = await getOwnedScenarioLab(labId, id)
  if (!owned) {
    return NextResponse.json({ error: "情景试验场不存在" }, { status: 404 })
  }

  try {
    const scenario = await generateScenarioProse({
      userId: result.session.user.id,
      novelId: id,
      labId,
    })
    return NextResponse.json({ scenario })
  } catch (err) {
    return toScenarioErrorResponse(err)
  }
}
