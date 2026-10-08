import { NextResponse } from "next/server"
import { z } from "zod"

import type { Prisma } from "@/generated/prisma/client"
import { SettingType } from "@/generated/prisma/enums"
import { prisma } from "@/lib/db"
import { toErrorResponse } from "@/lib/ai/errors"
import { mutationInput } from "../chapters/[chapterId]/history-api"
import { isWorldSettingType } from "@/lib/setting-types"
import { listSettings, SettingNameConflictError, upsertSetting } from "@/lib/services/setting"

import { firstIssueMessage, getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

const upsertSettingSchema = z
  .object({
    type: z.enum(SettingType),
    name: z.string().trim().min(1, "设定名称不能为空").max(100),
    content: z.unknown(),
    worldId: z.string().trim().min(1).nullish(),
    parentId: z.string().trim().min(1).nullish(),
  })
  .superRefine((data, ctx) => {
    // 世界级类型必须挂世界；小说级类型（金手指/文风）禁止
    if (isWorldSettingType(data.type) && !data.worldId) {
      ctx.addIssue({ code: "custom", message: "该设定分类必须属于某个世界" })
    }
    if (!isWorldSettingType(data.type) && data.worldId) {
      ctx.addIssue({ code: "custom", message: "该设定分类为小说级，不属于世界" })
    }
    // parentId 仅 MAP（子地图）可用，且必须先挂世界
    if (data.parentId && data.type !== "MAP") {
      ctx.addIssue({ code: "custom", message: "只有世界地图支持子地图嵌套" })
    }
    if (data.parentId && !data.worldId) {
      ctx.addIssue({ code: "custom", message: "子地图必须属于某个世界" })
    }
  })

export async function GET(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const searchParams = new URL(request.url).searchParams
  const typeParam = searchParams.get("type")
  const typeParsed = z.enum(SettingType).safeParse(typeParam ?? undefined)
  const worldId = searchParams.get("worldId") ?? undefined

  const settings = await listSettings(id, {
    type: typeParsed.success ? typeParsed.data : undefined,
    worldId,
  })

  return NextResponse.json({ settings })
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = upsertSettingSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  const { type, name, content, worldId, parentId } = parsed.data

  // 世界与父地图必须属于本小说；父地图须为同世界的 MAP
  if (worldId) {
    const world = await prisma.world.findUnique({ where: { id: worldId } })
    if (!world || world.novelId !== id) {
      return NextResponse.json({ error: "世界不存在" }, { status: 400 })
    }
  }
  if (parentId) {
    const parent = await prisma.setting.findUnique({ where: { id: parentId } })
    if (!parent || parent.novelId !== id || parent.type !== "MAP" || parent.worldId !== worldId) {
      return NextResponse.json({ error: "父地图不存在" }, { status: 400 })
    }
  }

  try {
    const setting = await upsertSetting({
      novelId: id,
      type,
      name,
      content: content as Prisma.InputJsonValue,
      worldId,
      parentId,
      saveOptions: body?.expectedVersion !== undefined ? { userId: result.session.user.id, ...mutationInput(body) } : undefined,
    })
    return NextResponse.json({ setting })
  } catch (err) {
    if (err instanceof SettingNameConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    return toErrorResponse(err)
  }
}
