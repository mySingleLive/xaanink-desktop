import { NextResponse } from "next/server"
import { z } from "zod"

import { ReviewTargetType } from "@/generated/prisma/enums"
import { toErrorResponse } from "@/lib/ai/errors"
import { listReviews } from "@/lib/services/review"

import { getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

const querySchema = z.object({
  targetType: z.enum(ReviewTargetType).optional(),
  targetId: z.string().optional(),
})

/** 评审历史：?targetType=&targetId= 可选过滤，最新在前 */
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
    const reviews = await listReviews(id, parsed.data.targetType, parsed.data.targetId)
    return NextResponse.json({ reviews })
  } catch (err) {
    return toErrorResponse(err)
  }
}
