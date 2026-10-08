import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { ReviewTargetNotFoundError } from "@/lib/services/review"
import { listImprovementItems, SCORE_TARGET_TYPES } from "@/lib/services/score-report"

import { getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string }> }

const querySchema = z.object({
  targetType: z.enum(SCORE_TARGET_TYPES),
  targetId: z.string().min(1),
})

/**
 * 正文改进对话框·改进项聚合：?targetType=&targetId= 必传（仅 CHAPTER_CONTENT）。
 * 返回 { payload }：本章规划字数档/当前字数 + 维度（含意见条数）+ AI 评审建议（已去重）+ 用户建议。
 */
export async function GET(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    targetType: searchParams.get("targetType") ?? undefined,
    targetId: searchParams.get("targetId") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 })
  }

  try {
    const payload = await listImprovementItems(id, parsed.data.targetType, parsed.data.targetId, result.session.user.id)
    return NextResponse.json({ payload })
  } catch (err) {
    if (err instanceof ReviewTargetNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    return toErrorResponse(err)
  }
}
