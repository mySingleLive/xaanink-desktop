import { NextResponse } from "next/server"
import { z } from "zod"

import { deleteScenarioCard, updateScenarioCard } from "@/lib/services/scenario-lab"

import { firstIssueMessage, getOwnedNovel } from "../../../../lib"
import { getOwnedScenarioCard, toScenarioErrorResponse } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; labId: string; cardId: string }> }

const patchCardSchema = z.object({
  text: z.string().trim().min(1, "分镜卡不能为空").max(2000),
})

/** 改分镜卡文本 */
export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, labId, cardId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const card = await getOwnedScenarioCard(cardId, labId, id)
  if (!card) {
    return NextResponse.json({ error: "分镜卡不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = patchCardSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const updated = await updateScenarioCard(cardId, parsed.data)
    return NextResponse.json({ card: updated })
  } catch (err) {
    return toScenarioErrorResponse(err)
  }
}

/** 删分镜卡 */
export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id, labId, cardId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const card = await getOwnedScenarioCard(cardId, labId, id)
  if (!card) {
    return NextResponse.json({ error: "分镜卡不存在" }, { status: 404 })
  }

  try {
    await deleteScenarioCard(cardId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toScenarioErrorResponse(err)
  }
}
