import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { toErrorResponse } from "@/lib/ai/errors"
import { textBaselineSchema } from "@/lib/text-baseline"
import { patchWorldSchema } from "@/lib/world-schema"
import { deleteWorld, updateWorld, WorldNameConflictError } from "@/lib/services/world"

import { firstIssueMessage, getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string; worldId: string }> }

async function getOwnedWorld(worldId: string, novelId: string) {
  const world = await prisma.world.findUnique({ where: { id: worldId } })
  if (!world || world.novelId !== novelId) return null
  return world
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, worldId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedWorld(worldId, id)
  if (!existing) {
    return NextResponse.json({ error: "世界不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = patchWorldSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    if (!body?.baseline || !body?.operationId) throw new ContentError("PRECONDITION_REQUIRED", "缺少世界观保存基线，请保留草稿并刷新", 428)
    const checked = z.object({ baseline: textBaselineSchema, operationId: z.string().min(1).max(140) }).safeParse(body)
    if (!checked.success) throw new ContentError("INVALID_INPUT", "世界观基线或保存编号无效", 400)
    const world = await updateWorld(worldId, parsed.data, { userId: result.session.user.id, ...checked.data })
    return NextResponse.json({ world })
  } catch (err) {
    if (err instanceof WorldNameConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    if (err instanceof Error && (err.message === "父世界不存在" || err.message.startsWith("不能把世界移动"))) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return toErrorResponse(err)
  }
}

/** 删除世界：子世界与其下全部设定由 DB 级联删除 */
export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id, worldId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedWorld(worldId, id)
  if (!existing) {
    return NextResponse.json({ error: "世界不存在" }, { status: 404 })
  }

  await deleteWorld(worldId)
  return NextResponse.json({ ok: true })
}
