import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import {
  getComment,
  setCommentStatus,
  updateCommentContent,
  deleteComment,
} from "@/lib/services/text-comment"

import { firstIssueMessage, getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string; commentId: string }> }

const patchSchema = z
  .object({
    status: z.enum(["OPEN", "REJECTED"]).optional(),
    content: z.string().trim().min(1, "评论内容不能为空").max(5000, "评论内容过长").optional(),
  })
  .refine((d) => d.status !== undefined || d.content !== undefined, {
    message: "没有要更新的字段",
  })

/** 更新评论状态（认同/已应用）或内容（内容仅作者本人可改） */
export async function PATCH(request: Request, ctx: RouteContext) {
  const { id, commentId } = await ctx.params
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

  const comment = await getComment(commentId)
  if (!comment || comment.novelId !== id) {
    return NextResponse.json({ error: "评论不存在" }, { status: 404 })
  }

  const { status, content } = parsed.data
  if (content !== undefined) {
    const isAuthor =
      comment.authorType === "USER" && comment.authorId === result.session.user.id
    if (!isAuthor) {
      return NextResponse.json({ error: "只能修改自己的评论" }, { status: 403 })
    }
  }

  try {
    let updated = comment
    if (status !== undefined) {
      updated = await setCommentStatus(commentId, status)
    }
    if (content !== undefined) {
      updated = await updateCommentContent(commentId, content)
    }
    return NextResponse.json({ comment: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** 删除评论；顶层评论连同回复一起删 */
export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id, commentId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const comment = await getComment(commentId)
  if (!comment || comment.novelId !== id) {
    return NextResponse.json({ error: "评论不存在" }, { status: 404 })
  }

  try {
    await deleteComment(commentId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
