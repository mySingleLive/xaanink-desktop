import { NextResponse } from "next/server"

import { toErrorResponse } from "@/lib/ai/errors"
import {
  deleteForeshadow,
  foreshadowInputSchema,
  getForeshadow,
  updateForeshadow,
} from "@/lib/services/foreshadow"

import { firstIssueMessage, getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string; fid: string }> }

/** 单条伏笔（含全触点链与目标标签） */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id, fid } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error
  try {
    return NextResponse.json({ foreshadow: await getForeshadow(id, fid) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** 更新伏笔档案/状态（PATCH 未传字段不动） */
export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, fid } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const parsed = foreshadowInputSchema.partial().safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }
  try {
    return NextResponse.json({ foreshadow: await updateForeshadow(id, fid, parsed.data) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** 删除伏笔（触点级联删除） */
export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id, fid } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error
  try {
    await deleteForeshadow(id, fid)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
