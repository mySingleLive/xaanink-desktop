import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { ReviewTargetNotFoundError } from "@/lib/services/review"
import { getScoreReport, SCORE_TARGET_TYPES } from "@/lib/services/score-report"

import { getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

const querySchema = z.object({
  targetType: z.enum(SCORE_TARGET_TYPES),
  targetId: z.string().min(1),
  /** 候选稿维度：存在时强制 targetType=CHAPTER_CONTENT（候选评审的存量存储口径），targetId 即 chapterId */
  candidateId: z.string().min(1).optional(),
})

/**
 * 悬浮评分指示器·评分聚合：?targetType=&targetId= 必传。
 * 返回 { report }：综合分/多维度分/多角色评价卡/评审历史/评审中标志；
 * 从未评分为空态（score=null），目标不存在 404。
 */
export async function GET(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    targetType: searchParams.get("targetType") ?? undefined,
    targetId: searchParams.get("targetId") ?? undefined,
    candidateId: searchParams.get("candidateId") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 })
  }
  if (parsed.data.candidateId && parsed.data.targetType !== "CHAPTER_CONTENT") {
    return NextResponse.json({ error: "候选评审仅支持章正文目标" }, { status: 400 })
  }

  try {
    const report = await getScoreReport(id, parsed.data.targetType, parsed.data.targetId, parsed.data.candidateId)
    return NextResponse.json({ report })
  } catch (err) {
    if (err instanceof ReviewTargetNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    return toErrorResponse(err)
  }
}
