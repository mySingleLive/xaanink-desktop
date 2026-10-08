import { NextResponse } from "next/server"
import { z } from "zod"

import { saveCharacterImage } from "@/lib/ai/image"
import { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { getCharacter } from "@/lib/services/character"

import { getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; characterId: string }> }

const KIND_TO_ENUM = { avatar: "AVATAR", portrait: "PORTRAIT" } as const
const kindSchema = z.enum(["avatar", "portrait"])

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

async function getOwnedCharacter(characterId: string, novelId: string) {
  const character = await getCharacter(characterId)
  if (!character || character.novelId !== novelId) return null
  return character
}

/** 角色的图像版本列表（?kind=avatar|portrait，缺省 avatar），新的在前 */
export async function GET(request: Request, ctx: RouteContext) {
  const { id, characterId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const character = await getOwnedCharacter(characterId, id)
  if (!character) {
    return NextResponse.json({ error: "角色不存在" }, { status: 404 })
  }

  const kindParsed = kindSchema.safeParse(
    new URL(request.url).searchParams.get("kind") ?? "avatar"
  )
  if (!kindParsed.success) {
    return NextResponse.json({ error: "kind 参数不合法" }, { status: 400 })
  }

  const images = await prisma.characterImage.findMany({
    where: { characterId, kind: KIND_TO_ENUM[kindParsed.data] },
    orderBy: { createdAt: "desc" },
    take: 60,
  })
  return NextResponse.json({ images })
}

/** 手动上传原始图像：落盘 + 写入版本记录 + 设为当前图像（裁剪重置） */
export async function POST(request: Request, ctx: RouteContext) {
  const { id, characterId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const character = await getOwnedCharacter(characterId, id)
  if (!character) {
    return NextResponse.json({ error: "角色不存在" }, { status: 404 })
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get("file")
  const kindParsed = kindSchema.safeParse(form?.get("kind"))
  if (!kindParsed.success) {
    return NextResponse.json({ error: "kind 参数不合法" }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择要上传的图片" }, { status: 400 })
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "只支持图片文件" }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "图片不能超过 10MB" }, { status: 400 })
  }

  const kind = kindParsed.data
  const ext = MIME_EXT[file.type] ?? "png"
  const buffer = Buffer.from(await file.arrayBuffer())
  const url = await saveCharacterImage(characterId, kind, buffer, ext)

  const image = await prisma.characterImage.create({
    data: {
      characterId,
      kind: KIND_TO_ENUM[kind],
      source: "UPLOAD",
      url,
    },
  })
  await prisma.character.update({
    where: { id: characterId },
    data:
      kind === "avatar"
        ? { avatarUrl: url, avatarCrop: Prisma.DbNull }
        : { portraitUrl: url, portraitCrop: Prisma.DbNull },
  })

  return NextResponse.json({ image, url })
}
