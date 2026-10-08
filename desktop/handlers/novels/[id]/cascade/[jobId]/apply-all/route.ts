import { NextResponse } from "next/server"

import { toErrorResponse } from "@/lib/ai/errors"
import { applyAllCascadeItems, getCascadeJob } from "@/lib/services/cascade"

import { getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; jobId: string }> }

/** 应用全部 PENDING 修订项；单条失败记 ERROR 继续 */
export async function POST(_request: Request, ctx: RouteContext) {
  const { id, jobId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const job = await getCascadeJob(jobId)
  if (!job || job.novelId !== id) {
    return NextResponse.json({ error: "级联任务不存在" }, { status: 404 })
  }

  try {
    const updated = await applyAllCascadeItems(jobId, result.session.user.id)
    return NextResponse.json({ job: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
