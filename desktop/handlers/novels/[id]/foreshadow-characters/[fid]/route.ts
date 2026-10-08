import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import {
  deleteForeshadowCharacter,
  ForeshadowCharacterNotFoundError,
  getForeshadowCharacter,
  updateForeshadowCharacter,
} from "@/lib/services/foreshadow-character"

import { firstIssueMessage, getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string; fid: string }> }

const patchSchema = z
  .object({
    name: z.string().trim().min(1, "伏笔角色名不能为空").max(100).optional(),
    note: z.string().trim().max(20000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "没有需要更新的字段" })

async function getOwnedForeshadow(fid: string, novelId: string) {
  const row = await getForeshadowCharacter(fid)
  if (!row || row.novelId !== novelId) return null
  return row
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, fid } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedForeshadow(fid, id)
  if (!existing) {
    return NextResponse.json({ error: "伏笔角色不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const foreshadowCharacter = await updateForeshadowCharacter(fid, parsed.data)
    return NextResponse.json({ foreshadowCharacter })
  } catch (err) {
    if (err instanceof ForeshadowCharacterNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    return toErrorResponse(err)
  }
}

/** 删除伏笔角色 */
export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id, fid } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedForeshadow(fid, id)
  if (!existing) {
    return NextResponse.json({ error: "伏笔角色不存在" }, { status: 404 })
  }

  try {
    await deleteForeshadowCharacter(fid)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
