import { NextResponse } from "next/server"

import { saveNovelCoverImage } from "@/lib/ai/image"
import { prisma } from "@/lib/db"
import { setNovelCover } from "@/lib/services/cover-image"

import { getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string }> }

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

/** 封面图像的版本列表，新的在前 */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const images = await prisma.novelCoverImage.findMany({
    where: { novelId: id },
    orderBy: { createdAt: "desc" },
    take: 60,
  })
  return NextResponse.json({ images })
}

/** 手动上传封面图：落盘 + 写入版本记录 + 设为当前封面 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

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
  const url = await saveNovelCoverImage(id, buffer, ext)

  const image = await prisma.novelCoverImage.create({
    data: { novelId: id, source: "UPLOAD", url },
  })
  await setNovelCover(id, url)

  return NextResponse.json({ image, url })
}
