import { NextResponse } from "next/server"

import { toErrorResponse } from "@/lib/ai/errors"
import { addTouch, touchInputSchema } from "@/lib/services/foreshadow"

import { firstIssueMessage, getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; fid: string }> }

/** 新增触点（埋入/提及/回收；目标为章 chapterId） */
export async function POST(request: Request, ctx: RouteContext) {
  const { id, fid } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const parsed = touchInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }
  try {
    const touch = await addTouch(id, fid, parsed.data)
    return NextResponse.json({ touch }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
