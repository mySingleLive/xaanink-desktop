import { NextResponse } from "next/server"

import { toErrorResponse } from "@/lib/ai/errors"
import { getCascadeJob, parseCascadeResult } from "@/lib/services/cascade"

import { getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string; jobId: string }> }

/** 级联任务详情（含 result 修订项全文，供 before/after 对照） */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id, jobId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  try {
    const job = await getCascadeJob(jobId)
    if (!job || job.novelId !== id) {
      return NextResponse.json({ error: "级联任务不存在" }, { status: 404 })
    }
    return NextResponse.json({
      job: {
        id: job.id,
        novelId: job.novelId,
        triggerType: job.triggerType,
        triggerId: job.triggerId,
        triggerName: job.triggerName,
        status: job.status,
        affectedItems: job.affectedItems,
        result: parseCascadeResult(job.result),
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
