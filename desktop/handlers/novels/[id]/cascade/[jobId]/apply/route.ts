import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { applyCascadeItem, getCascadeJob } from "@/lib/services/cascade"

import { firstIssueMessage, getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; jobId: string }> }

const applySchema = z.object({
  targetId: z.string().min(1),
  targetType: z.enum(["CHAPTER_OUTLINE", "CHAPTER_CONTENT"]).optional(),
})

/** 应用单条修订（after 落库）；不传 targetType 时该章的大纲+正文一起应用 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id, jobId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const job = await getCascadeJob(jobId)
  if (!job || job.novelId !== id) {
    return NextResponse.json({ error: "级联任务不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = applySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const updated = await applyCascadeItem(jobId, parsed.data.targetId, parsed.data.targetType, result.session.user.id)
    return NextResponse.json({ job: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
