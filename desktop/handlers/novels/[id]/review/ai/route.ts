import { NextResponse } from "next/server"
import { z } from "zod"

import { ReviewTargetType } from "@/generated/prisma/enums"
import { toErrorResponse } from "@/lib/ai/errors"
import {
  ReviewContentEmptyError,
  ReviewTargetNotFoundError,
  requestAIReview,
} from "@/lib/services/review"

import { firstIssueMessage, getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string }> }

const aiReviewSchema = z.object({
  targetType: z.enum(ReviewTargetType),
  targetId: z.string().min(1),
})

/** 发起 AI 评审：生成 score + 逐条意见，创建 PENDING 的 Review */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = aiReviewSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const { review } = await requestAIReview({
      novelId: id,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      userId: result.session.user.id,
      abortSignal: request.signal,
    })
    return NextResponse.json({ review })
  } catch (err) {
    if (err instanceof ReviewTargetNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof ReviewContentEmptyError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return toErrorResponse(err)
  }
}
