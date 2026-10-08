import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { getCascadeJob, skipCascadeItem } from "@/lib/services/cascade"

import { firstIssueMessage, getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; jobId: string }> }

const skipSchema = z.object({
  targetId: z.string().min(1),
  targetType: z.enum(["CHAPTER_OUTLINE", "CHAPTER_CONTENT"]).optional(),
})

/** 跳过单条修订（PENDING/ERROR → SKIPPED） */
export async function POST(request: Request, ctx: RouteContext) {
  const { id, jobId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const job = await getCascadeJob(jobId)
  if (!job || job.novelId !== id) {
    return NextResponse.json({ error: "级联任务不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = skipSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const updated = await skipCascadeItem(jobId, parsed.data.targetId, parsed.data.targetType)
    return NextResponse.json({ job: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
