import { NextResponse } from "next/server"

import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { getItem } from "@/lib/services/item"
import { saveItemImage } from "@/lib/services/item-image"

import { getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; itemId: string }> }

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

async function getOwnedItem(itemId: string, novelId: string) {
  const item = await getItem(itemId)
  if (!item || item.novelId !== novelId) return null
  return item
}

/** 物品的图标版本列表，新的在前 */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id, itemId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const item = await getOwnedItem(itemId, id)
  if (!item) {
    return NextResponse.json({ error: "物品不存在" }, { status: 404 })
  }

  const images = await prisma.itemImage.findMany({
    where: { itemId },
    orderBy: { createdAt: "desc" },
    take: 60,
  })
  return NextResponse.json({ images })
}

/** 手动上传原始图标：落盘 + 写入版本记录 + 设为当前图标（裁剪重置） */
export async function POST(request: Request, ctx: RouteContext) {
  const { id, itemId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const item = await getOwnedItem(itemId, id)
  if (!item) {
    return NextResponse.json({ error: "物品不存在" }, { status: 404 })
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择要上传的图片" }, { status: 400 })
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "只支持图片文件" }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "图片不能超过 10MB" }, { status: 400 })
  }

  const ext = MIME_EXT[file.type] ?? "png"
  const buffer = Buffer.from(await file.arrayBuffer())
  const url = await saveItemImage(itemId, buffer, ext)

  const image = await prisma.itemImage.create({
    data: { itemId, source: "UPLOAD", url },
  })
  await prisma.item.update({
    where: { id: itemId },
    data: { iconUrl: url, iconCrop: Prisma.DbNull },
  })

  return NextResponse.json({ image, url })
}
