import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { CommentNotFoundError, replyToComment } from "@/lib/services/text-comment"

import { firstIssueMessage, getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; commentId: string }> }

const replySchema = z.object({
  content: z.string().trim().min(1, "回复内容不能为空").max(5000, "回复内容过长"),
})

/** 回复一条顶层评论（作者本人） */
export async function POST(request: Request, ctx: RouteContext) {
  const { id, commentId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = replySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  const user = result.session.user
  const authorName = user.name?.trim() || user.email?.split("@")[0] || "作者"

  try {
    const reply = await replyToComment({
      novelId: id,
      parentId: commentId,
      content: parsed.data.content,
      authorType: "USER",
      authorId: user.id,
      authorName,
    })
    return NextResponse.json({ reply })
  } catch (err) {
    if (err instanceof CommentNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    return toErrorResponse(err)
  }
}
