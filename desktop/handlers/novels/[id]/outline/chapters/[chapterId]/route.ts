import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { prisma } from "@/lib/db"
import { updateChapterOutline } from "@/lib/services/outline"

import { firstIssueMessage, getOwnedNovel } from "../../../lib"
import { mutationInput } from "../../../chapters/[chapterId]/history-api"

type RouteContext = { params: Promise<{ id: string; chapterId: string }> }

const patchSchema = z
  .object({
    title: z.string().trim().min(1, "章节名不能为空").max(100).optional(),
    outline: z.string().max(10000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "没有需要更新的字段" })

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, chapterId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { volume: { select: { novelId: true } } },
  })
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
    const updated = await updateChapterOutline(chapterId, parsed.data, { ...input, userId: result.session.user.id, novelId: id })
    return NextResponse.json({ chapter: updated, receipt: updated.receipt })
  } catch (err) {
    return toErrorResponse(err)
  }
}
