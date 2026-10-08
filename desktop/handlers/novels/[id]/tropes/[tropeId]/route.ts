import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/db"
import { deleteCustomTrope, toggleTrope } from "@/lib/services/trope"

import { firstIssueMessage, getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string; tropeId: string }> }

const toggleSchema = z.object({
  selected: z.boolean(),
})

async function getOwnedTrope(tropeId: string, novelId: string) {
  const trope = await prisma.trope.findUnique({ where: { id: tropeId } })
  if (!trope || trope.novelId !== novelId) return null
  return trope
}

/** 勾选/取消勾选本小说的记录（选中的平台副本或自定义条目） */
export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, tropeId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedTrope(tropeId, id)
  if (!existing) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = toggleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  const trope = await toggleTrope(tropeId, parsed.data.selected)
  return NextResponse.json({ trope })
}

/** 删除自定义条目（平台库条目与选中副本不可删） */
export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id, tropeId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedTrope(tropeId, id)
  if (!existing) {
    return NextResponse.json({ error: "记录不存在" }, { status: 404 })
  }

  try {
    await deleteCustomTrope(tropeId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "删除失败" },
      { status: 400 }
    )
  }
}
