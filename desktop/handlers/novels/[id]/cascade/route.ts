import { NextResponse } from "next/server"

import { toErrorResponse } from "@/lib/ai/errors"
import {
  countPendingJobs,
  listCascadeJobs,
  parseCascadeResult,
} from "@/lib/services/cascade"

import { getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

/** 级联任务列表（含待处理计数）；result 全文不随列表返回，只给进度计数 */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  try {
    const jobs = await listCascadeJobs(id)
    return NextResponse.json({
      jobs: jobs.map((job) => {
        const items = parseCascadeResult(job.result)
        return {
          id: job.id,
          triggerType: job.triggerType,
          triggerId: job.triggerId,
          triggerName: job.triggerName,
          status: job.status,
          totalCount: Array.isArray(job.affectedItems) ? job.affectedItems.length : 0,
          resolvedCount: items.filter((it) => it.status !== "PENDING").length,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        }
      }),
      pendingCount: countPendingJobs(jobs),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
