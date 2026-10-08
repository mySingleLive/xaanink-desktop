import { NextResponse } from "next/server"
import { z } from "zod"

import { locateQuote } from "@/lib/comment-anchor"
import { prisma } from "@/lib/db"
import { FORESHADOW_ANCHOR_MAX, TOUCH_KIND_LABELS } from "@/lib/foreshadow"

import { getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string }> }

const querySchema = z.object({
  targetType: z.enum(["CHAPTER_CONTENT", "CHAPTER_OUTLINE"]),
  targetId: z.string().min(1),
})

/**
 * 编辑器伏笔标记：目标文本范围内有触点的伏笔 + 锚点命中结果。
 * 锚点为触点摘要（≤30 字参与定位，长摘要误命中率高直接不标）；命中失败 anchor=null 不显示。
 */
export async function GET(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const parsed = querySchema.safeParse({
    targetType: new URL(request.url).searchParams.get("targetType") ?? undefined,
    targetId: new URL(request.url).searchParams.get("targetId") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 })
  }
  const { targetType, targetId } = parsed.data

  const chapter = await prisma.chapter.findUnique({
    where: { id: targetId },
    include: { volume: { select: { novelId: true } } },
  })
  if (!chapter || chapter.volume.novelId !== id) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 })
  }
  const text = targetType === "CHAPTER_CONTENT" ? chapter.content : chapter.outline
  if (!text.trim()) return NextResponse.json({ marks: [] })

  const touches = await prisma.foreshadowTouch.findMany({
    where: { novelId: id, chapterId: chapter.id },
    include: { foreshadow: { select: { id: true, title: true, status: true } } },
    orderBy: { createdAt: "asc" },
  })

  const marks = touches
    .filter((t) => t.foreshadow.status !== "DROPPED")
    .map((t) => {
      const summary = t.summary.trim()
      const anchor =
        summary.length > 0 && summary.length <= FORESHADOW_ANCHOR_MAX
          ? locateQuote(text, summary)
          : null
      return {
        foreshadowId: t.foreshadow.id,
        foreshadowTitle: t.foreshadow.title,
        touchId: t.id,
        kind: t.kind,
        kindLabel: TOUCH_KIND_LABELS[t.kind],
        summary,
        anchor,
      }
    })
    .filter((m) => m.anchor !== null)

  return NextResponse.json({ marks })
}
