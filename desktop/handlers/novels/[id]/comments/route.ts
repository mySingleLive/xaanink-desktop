import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { readTextTarget } from "@/lib/services/target-text"
import { prisma } from "@/lib/db"
import {
  CommentAnchorNotFoundError,
  CommentTargetNotFoundError,
  createComment,
  listThreads,
} from "@/lib/services/text-comment"

import { firstIssueMessage, getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

const TARGET_TYPES = ["CHAPTER_OUTLINE", "CHAPTER_CONTENT", "WORLD", "SETTING", "SCENE", "CANDIDATE_CONTENT"] as const

const querySchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().min(1),
})

const createSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().min(1),
  /** 锚点原文（可选）：缺省 = 无锚点整体评论（评审视图「添加评论」允许只写意见） */
  quote: z.string().min(1, "引用原文不能为空").max(2000, "引用原文过长").optional(),
  anchorHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  content: z.string().trim().min(1, "评论内容不能为空").max(5000, "评论内容过长"),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
})

/** 某目标（章大纲/章正文/世界/设定/候选稿）下的评论线程列表 */
export async function GET(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    targetType: searchParams.get("targetType") ?? undefined,
    targetId: searchParams.get("targetId") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不合法" }, { status: 400 })
  }

  try {
    await readTextTarget(prisma, { novelId: id, userId: result.session.user.id, ...parsed.data })
    const threads = await listThreads(parsed.data.targetType, parsed.data.targetId)
    return NextResponse.json({ threads })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** 创建顶层评论（作者本人）；quote 锚点定位失败返回 422（quote 缺省时落无锚点整体评论） */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  const user = result.session.user
  const authorName = user.name?.trim() || user.email?.split("@")[0] || "作者"

  try {
    const comment = await createComment({
      novelId: id,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      quote: parsed.data.quote,
      anchorHash: parsed.data.anchorHash,
      content: parsed.data.content,
      startOffset: parsed.data.startOffset,
      endOffset: parsed.data.endOffset,
      authorType: "USER",
      authorId: user.id,
      authorName,
    })
    return NextResponse.json({ comment })
  } catch (err) {
    if (err instanceof CommentAnchorNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    if (err instanceof CommentTargetNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    return toErrorResponse(err)
  }
}
