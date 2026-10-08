import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { ReviewTargetNotFoundError, submitHumanReview } from "@/lib/services/review"

import { firstIssueMessage, getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string }> }

const humanReviewSchema = z.object({
  reviewId: z.string().min(1),
  status: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().max(2000).optional(),
  expectedVersion: z.number().int().positive().optional(),
  expectedHash: z.string().optional(),
  operationId: z.string().min(1).max(140).optional(),
  confirmationHash: z.string().length(64).optional(),
})

/** 人工评审结论：APPROVED 联动章节/阶段状态机，REJECTED 记录附言 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = humanReviewSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const review = await submitHumanReview(parsed.data.reviewId, id, {
      userId: result.session.user.id,
      status: parsed.data.status,
      comment: parsed.data.comment,
      expectedVersion: parsed.data.expectedVersion,
      expectedHash: parsed.data.expectedHash,
      operationId: parsed.data.operationId,
      confirmationHash: parsed.data.confirmationHash,
    })
    return NextResponse.json({ review })
  } catch (err) {
    if (err instanceof ReviewTargetNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    return toErrorResponse(err)
  }
}
