import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { currentChatExecution } from "@/lib/chat-execution"
import { chatActionSchema } from "@/lib/chat-parts"
import { checkGeneratedContent } from "@/lib/content-policy"
import { inferWordRequirement, wordRequirementSchema } from "@/lib/word-requirement"
import { contentHash, ownedChapter, requestHash } from "./content-commit"
import { aiReviewSchema, normalizeComments } from "./review-schema"
import type { ChapterScope } from "./chapter-history"

/** 清单只读取当前稿，hash 包含评论与评分，确认后变更任一项都必须重新查看。 */
export async function getChapterFinalizationChecklist(scope: ChapterScope, tx: Prisma.TransactionClient = prisma) {
  const chapter = await ownedChapter(tx, scope.userId, scope.novelId, scope.chapterId)
  const hash = contentHash(chapter.content)
  const [candidate, review, comments] = await Promise.all([
    tx.contentCandidate.findFirst({ where: { userId: scope.userId, chapterId: scope.chapterId, status: "accepted", contentHash: hash }, orderBy: { updatedAt: "desc" } }),
    tx.review.findFirst({ where: { novelId: scope.novelId, targetType: "CHAPTER_CONTENT", targetId: scope.chapterId, contentHash: hash, contentVersion: chapter.version, purpose: "current", aiScore: { not: null } }, orderBy: { createdAt: "desc" } }),
    tx.textComment.findMany({ where: { novelId: scope.novelId, targetType: "CHAPTER_CONTENT", targetId: scope.chapterId }, orderBy: { id: "asc" } }),
  ])
  const parsed = wordRequirementSchema.safeParse(candidate?.wordRequirement)
  const requirement = parsed.success ? parsed.data : inferWordRequirement("", chapter.outline, chapter.wordCount).requirement
  const checks = checkGeneratedContent({ content: chapter.content, previousContent: chapter.content, finishReason: "stop", wordRequirement: requirement }).checks
  const suggestions = normalizeComments(aiReviewSchema.shape.comments.parse(review?.aiComments ?? []))
  const checklist = { chapterId: chapter.id, title: chapter.title, version: chapter.version, contentHash: hash, wordCount: chapter.wordCount, wordRequirement: requirement, checks, openCommentCount: comments.filter(c => !c.parentId && c.status === "OPEN").length,
    score: review?.aiScore ?? null, reviewId: review?.id ?? null, suggestions }
  return { ...checklist, checklistHash: requestHash({ checklist, comments: comments.map(c => ({ id: c.id, updatedAt: c.updatedAt.toISOString(), status: c.status })) }) }
}

export async function assertChapterFinalizationConfirmation(scope: ChapterScope, tx: Prisma.TransactionClient, input: { expectedVersion?: number; expectedHash?: string; confirmationHash?: string }) {
  let confirmationHash = input.confirmationHash
  const execution = currentChatExecution()
  if (execution) {
    const turn = await tx.chatTurn.findFirst({ where: { id: execution.turnId, userId: scope.userId } })
    const parsed = chatActionSchema.safeParse(turn?.action)
    if (!parsed.success || parsed.data.kind !== "finalize" || parsed.data.targetId !== scope.chapterId || parsed.data.expectedVersion !== input.expectedVersion || parsed.data.expectedHash !== input.expectedHash) throw new ContentError("AUTHOR_CONFIRMATION_REQUIRED", "请先让作者在正文面板查看定稿检查并确认当前版本", 428)
    confirmationHash = parsed.data.checklistHash
  }
  if (!confirmationHash) throw new ContentError("AUTHOR_CONFIRMATION_REQUIRED", "请先查看定稿检查并确认当前版本", 428)
  const checklist = await getChapterFinalizationChecklist(scope, tx)
  if (checklist.version !== input.expectedVersion || checklist.contentHash !== input.expectedHash || checklist.checklistHash !== confirmationHash) throw new ContentError("FINALIZATION_STALE", "正文、评论或评分在确认后已有变化，请重新查看定稿检查")
  if (checklist.checks.some(check => check.hard)) throw new ContentError("FINALIZATION_INCOMPLETE", "当前稿仍有完整性问题，不能定稿", 422)
}
