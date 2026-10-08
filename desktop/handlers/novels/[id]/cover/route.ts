import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { prisma } from "@/lib/db"
import { generateNovelCover, setNovelCover } from "@/lib/services/cover-image"

import { firstIssueMessage, getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

const generateSchema = z.object({
  prompt: z.string().trim().min(1, "提示词不能为空").max(4000),
  /** 指定使用的文生图模型（AIModel id），不传则用最新可用的 */
  modelId: z.string().trim().max(100).optional(),
})

const patchSchema = z.object({
  /** 设为当前封面的图像 url（必须属于该小说的历史版本） */
  url: z.string().max(500),
})

/**
 * 文生图生成小说封面：
 * 调用指定的（或最新可用的）IMAGE 模型，图片落盘并写入 NovelCoverImage 版本记录，
 * 同时把 Novel.coverUrl 指向新版本。
 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

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
    const { url, image } = await generateNovelCover({
      novelId: id,
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

/** 设置当前使用的历史版本（url），不触发版本快照与级联 */
export async function PATCH(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  // 防止把当前封面指向不属于该小说的 url
  const owned = await prisma.novelCoverImage.findFirst({
    where: { novelId: id, url: parsed.data.url },
    select: { id: true },
  })
  if (!owned) {
    return NextResponse.json({ error: "图像版本不存在" }, { status: 404 })
  }

  await setNovelCover(id, parsed.data.url)

  return NextResponse.json({ ok: true })
}
