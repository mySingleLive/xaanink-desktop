import { NextResponse } from "next/server"
import { z } from "zod"

import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { toErrorResponse } from "@/lib/ai/errors"
import { mutationInput } from "../../chapters/[chapterId]/history-api"
import {
  deleteSetting,
  SettingNameConflictError,
  updateSetting,
} from "@/lib/services/setting"

import { firstIssueMessage, getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string; settingId: string }> }

const patchSettingSchema = z
  .object({
    name: z.string().trim().min(1, "设定名称不能为空").max(100).optional(),
    content: z.unknown().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "没有需要更新的字段" })

async function getOwnedSetting(settingId: string, novelId: string) {
  const setting = await prisma.setting.findUnique({ where: { id: settingId } })
  if (!setting || setting.novelId !== novelId) return null
  return setting
}

/** 单条设定读取（列表接口 worldId 默认为 null 查不到世界级设定，悬停卡等按 id 精确读取走这里） */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id, settingId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const setting = await getOwnedSetting(settingId, id)
  if (!setting) {
    return NextResponse.json({ error: "设定不存在" }, { status: 404 })
  }
  return NextResponse.json({ setting })
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, settingId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedSetting(settingId, id)
  if (!existing) {
    return NextResponse.json({ error: "设定不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = patchSettingSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  // 原地更新（可改名），version+1 并记快照；改名撞名返回 409
  // 内容实际变更且已有大纲时会触发级联修订，响应带回 cascadeJobId 供前端跳转
  try {
    const { setting, cascadeJob } = await updateSetting(settingId, {
      name: parsed.data.name,
      content: parsed.data.content as Prisma.InputJsonValue | undefined,
    }, { userId: result.session.user.id, ...mutationInput(body) })
    return NextResponse.json({
      setting,
      cascadeJobId: cascadeJob?.id ?? null,
      cascadeAffectedCount: Array.isArray(cascadeJob?.affectedItems)
        ? cascadeJob.affectedItems.length
        : 0,
    })
  } catch (err) {
    if (err instanceof SettingNameConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id, settingId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getOwnedSetting(settingId, id)
  if (!existing) {
    return NextResponse.json({ error: "设定不存在" }, { status: 404 })
  }

  await deleteSetting(settingId)
  return NextResponse.json({ ok: true })
}
