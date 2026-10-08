import { NextResponse } from "next/server"

import { toErrorResponse } from "@/lib/ai/errors"
import { finishCascadeJob, getCascadeJob } from "@/lib/services/cascade"

import { getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; jobId: string }> }

/** 完成任务：剩余 PENDING 项全部跳过，任务 → DONE */
export async function POST(_request: Request, ctx: RouteContext) {
  const { id, jobId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const job = await getCascadeJob(jobId)
  if (!job || job.novelId !== id) {
    return NextResponse.json({ error: "级联任务不存在" }, { status: 404 })
  }

  try {
    const updated = await finishCascadeJob(jobId)
    return NextResponse.json({ job: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
