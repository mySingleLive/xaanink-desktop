import { NextResponse } from "next/server"

import { toErrorResponse } from "@/lib/ai/errors"
import { removeTouch } from "@/lib/services/foreshadow"

import { getOwnedNovel } from "../../../../lib"

type RouteContext = { params: Promise<{ id: string; fid: string; tid: string }> }

/** 移除触点（已回收伏笔失去回收触点会按状态机回退） */
export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id, fid, tid } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error
  try {
    await removeTouch(id, fid, tid)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
