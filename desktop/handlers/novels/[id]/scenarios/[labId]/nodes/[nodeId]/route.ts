import { NextResponse } from "next/server"
import { z } from "zod"

import { deleteScenarioNode, updateScenarioNodeText } from "@/lib/services/scenario-lab"

import { firstIssueMessage, getOwnedNovel } from "../../../../lib"
import { getOwnedScenarioNode, toScenarioErrorResponse } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; labId: string; nodeId: string }> }

const patchNodeSchema = z.object({
  text: z.string().trim().min(1, "情节点不能为空").max(2000),
})

/** 改主干情节点文本（只修剧情骨架，不动溯源的回合） */
export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, labId, nodeId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const node = await getOwnedScenarioNode(nodeId, labId, id)
  if (!node) {
    return NextResponse.json({ error: "情节点不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = patchNodeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const updated = await updateScenarioNodeText(nodeId, parsed.data.text)
    return NextResponse.json({ node: updated })
  } catch (err) {
    return toScenarioErrorResponse(err)
  }
}

/** 删主干情节点 */
export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id, labId, nodeId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const node = await getOwnedScenarioNode(nodeId, labId, id)
  if (!node) {
    return NextResponse.json({ error: "情节点不存在" }, { status: 404 })
  }

  try {
    await deleteScenarioNode(nodeId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toScenarioErrorResponse(err)
  }
}
