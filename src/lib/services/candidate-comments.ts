import { z } from "zod"
import { diffChars } from "diff"
import type { Prisma, TextComment } from "@/generated/prisma/client"
import { anchorContext, resolveWriteAnchor } from "@/lib/comment-anchor"
import { ContentError } from "@/lib/content-errors"
import { contentHash, requestHash } from "./content-commit"
import type { ChapterScope } from "./chapter-history"
import type { ReviewCommentItem } from "./review-schema"

export const proposedCommentActionSchema = z.object({ commentId: z.string(), action: z.enum(["MODIFY", "AGREE", "REJECT"]), reply: z.string().trim().min(1).max(3000), appliedExcerpt: z.string().max(6000).nullish().transform(value => value ?? undefined).optional() })
export type ProposedCommentAction = z.infer<typeof proposedCommentActionSchema>
export type CommentSnapshot = Pick<TextComment, "id" | "content" | "status" | "quote" | "startOffset" | "endOffset" | "prefix" | "suffix" | "anchorHash"> & { updatedAt: string; replyHash: string; replies?: Pick<TextComment, "id" | "content" | "authorType" | "authorName">[] }
export const boundCommentActionSchema = proposedCommentActionSchema.extend({ expectedUpdatedAt: z.iso.datetime(), expectedStatus: z.literal("OPEN"), expectedReplyHash: z.string().length(64) })
export type BoundCommentAction = z.infer<typeof boundCommentActionSchema>
export function commentRepliesHash(replies: Pick<TextComment, "id" | "content" | "updatedAt" | "status">[]) {
  return requestHash(replies.map(reply => ({ id: reply.id, content: reply.content, status: reply.status, updatedAt: reply.updatedAt.toISOString() })).sort((a, b) => a.id.localeCompare(b.id)))
}

/** 只核验字节范围内确有改动；不把别处的新句或 diff 无法确定的结果当作落实证据。 */
function changedRanges(before: string, after: string) {
  const diff = diffChars(before, after, { timeout: 50, maxEditLength: 10000 })
  if (!diff) return []
  const ranges: { oldStart: number; oldEnd: number; newStart: number; newEnd: number }[] = []
  let oldOffset = 0, newOffset = 0
  let pending: typeof ranges[number] | undefined
  for (const part of diff) {
    if (!part.added && !part.removed) {
      if (pending) ranges.push(pending)
      pending = undefined; oldOffset += part.value.length; newOffset += part.value.length
    } else {
      pending ??= { oldStart: oldOffset, oldEnd: oldOffset, newStart: newOffset, newEnd: newOffset }
      if (part.removed) oldOffset += part.value.length
      if (part.added) newOffset += part.value.length
      pending.oldEnd = oldOffset; pending.newEnd = newOffset
    }
  }
  if (pending) ranges.push(pending)
  return ranges
}

/** 模型的状态意见是候选数据；必须核验评论基线与真实变化才能作为提交动作。 */
export function bindProposedCommentActions(actions: ProposedCommentAction[], comments: CommentSnapshot[], before: string, after: string) {
  const bound: BoundCommentAction[] = [], issues: string[] = [], seen = new Set<string>()
  let changes: ReturnType<typeof changedRanges> | undefined
  for (const action of actions) {
    const comment = comments.find(row => row.id === action.commentId)
    if (!comment || comment.status !== "OPEN" || seen.has(comment.id)) { issues.push("候选包含无效或已处理的评论动作"); continue }
    seen.add(comment.id)
    if (action.action === "MODIFY") {
      const excerpt = action.appliedExcerpt?.trim() ?? ""
      if (before === after || !excerpt || !after.includes(excerpt) || before.includes(excerpt)) { issues.push("评论改写尚无可验证的新稿证据"); continue }
      if (comment.quote) {
        const located = resolveWriteAnchor(before, comment, comment.anchorHash === contentHash(before))
        if (!("start" in located)) { issues.push("评论锚点失效或有歧义，不能标为已修改"); continue }
        const excerptStart = after.indexOf(excerpt), excerptEnd = excerptStart + excerpt.length
        changes ??= changedRanges(before, after)
        if (after.indexOf(excerpt, excerptStart + 1) !== -1 || !changes.some(change =>
          change.oldStart < located.end && change.oldEnd > located.start &&
          change.newStart < excerptEnd && change.newEnd > excerptStart)) {
          issues.push("评论锚定范围内尚无可验证的改动，不能用别处的新句标为已修改"); continue
        }
      }
    }
    bound.push({ ...action, expectedUpdatedAt: comment.updatedAt, expectedStatus: "OPEN", expectedReplyHash: comment.replyHash })
  }
  if (comments.some(comment => comment.status === "OPEN" && !bound.some(action => action.commentId === comment.id))) issues.push("仍有未处理的评论，等待作者检查")
  return { actions: bound, issues: [...new Set(issues)] }
}

/** 调用方已锁定目标并验证全文 hash；批注和该稿同事务挂载，歧义引用不强行定位。 */
export async function attachReviewInlineComments(tx: Prisma.TransactionClient, target: { novelId: string; targetType: string; targetId: string }, text: string, reviewId: string, comments: ReviewCommentItem[]) {
  for (const [index, comment] of comments.entries()) {
    if (!comment.excerpt) continue
    const anchor = resolveWriteAnchor(text, { quote: comment.excerpt }, true)
    if (!("start" in anchor)) continue
    const context = anchorContext(text, anchor.start, anchor.end)
    await tx.textComment.create({ data: { id: `review:${reviewId}:${index}`, novelId: target.novelId, targetType: target.targetType, targetId: target.targetId,
      quote: comment.excerpt, startOffset: anchor.start, endOffset: anchor.end, ...context, anchorHash: contentHash(text), authorType: "AI", authorName: "AI 评审员", reviewId,
      content: `**${comment.aspect}** ${comment.issue}\n\n建议：${comment.suggestion}` } })
  }
}

/** 章正文评审挂载的既有调用点薄封装（CHAPTER_CONTENT + chapterId） */
export function attachChapterReviewComments(tx: Prisma.TransactionClient, scope: ChapterScope, text: string, reviewId: string, comments: ReviewCommentItem[]) {
  return attachReviewInlineComments(tx, { novelId: scope.novelId, targetType: "CHAPTER_CONTENT", targetId: scope.chapterId }, text, reviewId, comments)
}

export async function commitCandidateCommentActions(tx: Prisma.TransactionClient, scope: ChapterScope, candidateId: string, actions: BoundCommentAction[]) {
  // 与 S2 采用同一锁顺序：章节在前，评论按 ID 排序。
  for (const action of [...actions].sort((a, b) => a.commentId.localeCompare(b.commentId))) {
    await tx.$queryRaw`SELECT id FROM "TextComment" WHERE id = ${action.commentId} FOR UPDATE`
    const comment = await tx.textComment.findFirst({ where: { id: action.commentId, novelId: scope.novelId, targetType: "CHAPTER_CONTENT", targetId: scope.chapterId, parentId: null } })
    if (!comment || comment.status !== "OPEN" || comment.updatedAt.toISOString() !== action.expectedUpdatedAt) throw new ContentError("COMMENT_CONFLICT", "候选准备后评论已有变化，原稿保留，请重新核对")
    const replies = await tx.textComment.findMany({ where: { parentId: comment.id } })
    if (commentRepliesHash(replies) !== action.expectedReplyHash) throw new ContentError("COMMENT_CONFLICT", "候选准备后评论有新的讨论，原稿保留，请重新核对")
    const status = action.action === "MODIFY" ? "APPLIED" : action.action === "AGREE" ? "AGREED" : "REJECTED"
    const updated = await tx.textComment.update({ where: { id: comment.id }, data: { status } })
    const reply = await tx.textComment.create({ data: { novelId: scope.novelId, targetType: "CHAPTER_CONTENT", targetId: scope.chapterId, parentId: comment.id, authorType: "AI", authorName: "AI 评审员", content: action.reply } })
    await tx.candidateCommentEffect.create({ data: { novelId: scope.novelId, candidateId, commentId: comment.id, beforeStatus: comment.status, afterStatus: status, afterUpdatedAt: updated.updatedAt, afterReplyHash: commentRepliesHash([...replies, reply]), replyId: reply.id } })
  }
}

export async function withdrawCandidateCommentActions(tx: Prisma.TransactionClient, scope: ChapterScope, candidateId: string) {
  const effects = await tx.candidateCommentEffect.findMany({ where: { novelId: scope.novelId, candidateId, afterStatus: "APPLIED", withdrawnAt: null }, orderBy: { commentId: "asc" } })
  for (const effect of effects) {
    await tx.$queryRaw`SELECT id FROM "TextComment" WHERE id = ${effect.commentId} FOR UPDATE`
    const comment = await tx.textComment.findFirst({ where: { id: effect.commentId, novelId: scope.novelId, targetType: "CHAPTER_CONTENT", targetId: scope.chapterId } })
    if (!comment || comment.status !== "APPLIED" || comment.updatedAt.getTime() !== effect.afterUpdatedAt.getTime()) throw new ContentError("COMMENT_CONFLICT", "本次采用后评论已被编辑，请先核对，未撤回正文")
    if (commentRepliesHash(await tx.textComment.findMany({ where: { parentId: comment.id } })) !== effect.afterReplyHash) throw new ContentError("COMMENT_CONFLICT", "本次采用后已有新的评论讨论，请先核对，未撤回正文")
    await tx.textComment.update({ where: { id: comment.id }, data: { status: "OPEN" } })
    await tx.candidateCommentEffect.update({ where: { id: effect.id }, data: { withdrawnAt: new Date() } })
  }
}
