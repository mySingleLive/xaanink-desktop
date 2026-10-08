import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { getChapter, updateChapterContent } from "@/lib/services/chapter"

import { firstIssueMessage, getOwnedNovel } from "../../lib"
import { mutationInput } from "./history-api"

type RouteContext = { params: Promise<{ id: string; chapterId: string }> }

const patchSchema = z.object({
  content: z.string().max(200000, "正文过长"),
})

/** 章节详情（含所属卷） */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id, chapterId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const chapter = await getChapter(chapterId)
  if (!chapter || chapter.volume.novelId !== id) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 })
  }
  return NextResponse.json({ chapter })
}

/** 手动修改正文：version+1 + 快照 + 字数重算 */
export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, chapterId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const chapter = await getChapter(chapterId)
  if (!chapter || chapter.volume.novelId !== id) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 })
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
    const input = mutationInput(body)
    const updated = await updateChapterContent(chapterId, parsed.data.content, { ...input, userId: result.session.user.id, novelId: id })
    return NextResponse.json({ chapter: updated, receipt: updated.receipt })
  } catch (err) {
    return toErrorResponse(err)
  }
}
