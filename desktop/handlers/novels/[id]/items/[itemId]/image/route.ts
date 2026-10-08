import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { getItem } from "@/lib/services/item"
import { generateItemImage } from "@/lib/services/item-image"

import { firstIssueMessage, getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; itemId: string }> }

const generateSchema = z.object({
  prompt: z.string().trim().min(1, "提示词不能为空").max(4000),
  /** 指定使用的文生图模型（AIModel id），不传则用最新可用的 */
  modelId: z.string().trim().max(100).optional(),
})

const cropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.05).max(1),
  h: z.number().min(0.05).max(1),
})

const patchSchema = z
  .object({
    /** 设为当前版本的图像 url（必须属于该物品的历史版本） */
    url: z.string().max(500).optional(),
    /** 裁剪区域；null 表示重置为整图 */
    crop: cropSchema.nullable().optional(),
  })
  .refine((data) => data.url !== undefined || data.crop !== undefined, {
    message: "没有要更新的字段",
  })

async function getOwnedItem(itemId: string, novelId: string) {
  const item = await getItem(itemId)
  if (!item || item.novelId !== novelId) return null
  return item
}

/**
 * 文生图生成物品图标：
 * 调用指定的（或最新可用的）IMAGE 模型，图片落盘并写入 ItemImage 版本记录，
 * 同时把物品当前图标指向新版本（裁剪区域重置，由前端按图计算默认裁剪后回写）。
 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id, itemId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const item = await getOwnedItem(itemId, id)
  if (!item) {
    return NextResponse.json({ error: "物品不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = generateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const { prompt, modelId } = parsed.data
    // 面板里的提示词已由作者过目/编辑，原样发给模型，不再二次包装
    const { url, image } = await generateItemImage({
      novelId: id,
      itemId,
      prompt,
      modelId,
      promptIsComplete: true,
    })
    return NextResponse.json({ url, image })
  } catch (err) {
    // 上游文生图接口的业务错误（余额不足、参数不支持等）直接透出提示
    if (err instanceof Error && err.message.startsWith("文生图")) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    return toErrorResponse(err)
  }
}

/** 设置当前使用的历史版本（url）和/或裁剪区域（crop），不触发版本快照与级联 */
export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, itemId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const item = await getOwnedItem(itemId, id)
  if (!item) {
    return NextResponse.json({ error: "物品不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  const { url, crop } = parsed.data

  // 防止把当前版本指向不属于该物品的 url
  if (url !== undefined) {
    const owned = await prisma.itemImage.findFirst({
      where: { itemId, url },
      select: { id: true },
    })
    if (!owned) {
      return NextResponse.json({ error: "图像版本不存在" }, { status: 404 })
    }
  }

  await prisma.item.update({
    where: { id: itemId },
    data:
      url !== undefined
        ? { iconUrl: url, iconCrop: Prisma.DbNull }
        : { iconCrop: crop === null ? Prisma.DbNull : (crop as Prisma.InputJsonValue) },
  })

  return NextResponse.json({ ok: true })
}
