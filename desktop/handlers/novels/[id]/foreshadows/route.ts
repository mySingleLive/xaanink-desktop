import { NextResponse } from "next/server"

import { toErrorResponse } from "@/lib/ai/errors"
import {
  createForeshadow,
  foreshadowInputSchema,
  listForeshadows,
} from "@/lib/services/foreshadow"
import type { ForeshadowStatus } from "@/generated/prisma/client"

import { firstIssueMessage, getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

const STATUSES: ForeshadowStatus[] = ["PLANNED", "PLANTED", "RESOLVED", "DROPPED"]

/** 伏笔列表（?status= 过滤；含触点链与目标标签） */
export async function GET(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const status = new URL(request.url).searchParams.get("status")
  if (status && !STATUSES.includes(status as ForeshadowStatus)) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 })
  }
  const foreshadows = await listForeshadows(
    id,
    status ? { status: status as ForeshadowStatus } : undefined
  )
  return NextResponse.json({ foreshadows })
}

/** 新建伏笔 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const parsed = foreshadowInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }
  try {
    const foreshadow = await createForeshadow(id, parsed.data)
    return NextResponse.json({ foreshadow }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
