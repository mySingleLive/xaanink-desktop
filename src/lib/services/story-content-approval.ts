import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { contentApprovalSchema } from "@/lib/chat-protocol"
import { hardContentChecks } from "@/lib/content-policy"
import { getContentCandidate, acceptContentCandidate } from "./content-candidate"
import { getChapterFinalizationChecklist } from "./chapter-finalization"
import { ownedChapter } from "./content-commit"
import type { ChapterScope } from "./chapter-history"
import { countChineseWords } from "@/lib/text"
import { removeStoryStructure } from "./story-structure"

export async function prepareStoryContentApproval(scope: ChapterScope, kind: "candidate" | "finalize", candidateId?: string) {
  const chapter = await ownedChapter(prisma, scope.userId, scope.novelId, scope.chapterId)
  const focus = { kind: "chapter-content", key: `chapter-content:${chapter.id}`, id: chapter.id, title: chapter.title }
  if (kind === "candidate") {
    if (!candidateId) throw new ContentError("CANDIDATE_REQUIRED", "先选择要比较的真实候选稿", 400)
    const candidate = await getContentCandidate(scope, candidateId)
    if (!["ready", "needs_review"].includes(candidate.status)) throw new ContentError("CANDIDATE_UNAVAILABLE", "候选未完整生成或已处理，请读取当前候选状态", 409)
    // 硬性检查未通过的候选采用必被拒：不再发起注定失败的采用问答（面板侧对应为采用按钮禁用），直接说明原因与出路
    const hard = hardContentChecks(candidate.checks)
    if (hard.length) throw new ContentError("CANDIDATE_INCOMPLETE", `《${chapter.title}》这份候选稿（${countChineseWords(candidate.content)}字）未通过完整性检查：${hard.map(c => c.message).join("；")}。不能发起采用；请补足/修订后重新提交候选，或请作者在正文面板「候选稿」中丢弃后重新生成。`, 409)
    return { focus, summary: `是否采用《${chapter.title}》的这份候选稿（${countChineseWords(candidate.content)}字）替换当前正文？采用会保存历史版本，不等于定稿。`, details: { candidateId: candidate.id, content: candidate.content, qualityDecision: candidate.qualityDecision }, approval: contentApprovalSchema.parse({ kind, chapterId: chapter.id, candidateId, expectedVersion: chapter.version, candidateHash: candidate.contentHash }) }
  }
  const checklist = await getChapterFinalizationChecklist(scope)
  if (checklist.checks.some(c => c.hard)) throw new ContentError("FINALIZATION_INCOMPLETE", "正文完整性尚未通过，先补齐后再定稿", 422)
  return { focus, summary: `是否定稿《${chapter.title}》当前版本？${checklist.wordCount}字，当前评分${checklist.score ?? "未评"}，未处理评论${checklist.openCommentCount}条。确认后仍保留历史稿。`, details: checklist,
    approval: contentApprovalSchema.parse({ kind, chapterId: chapter.id, expectedVersion: chapter.version, expectedHash: checklist.contentHash, checklistHash: checklist.checklistHash }) }
}

export async function acceptStoryContentApproval(userId: string, novelId: string, raw: unknown, messageId: string, tx: Prisma.TransactionClient) {
  const approval = contentApprovalSchema.parse(raw)
  if (approval.kind === "remove") {
    await removeStoryStructure({ userId, novelId }, { ...approval, operationId: `chat-removal:${messageId}` }, tx)
    return null
  }
  const scope = { userId, novelId, chapterId: approval.chapterId }
  await ownedChapter(tx, userId, novelId, approval.chapterId)
  if (approval.kind === "candidate") {
    await acceptContentCandidate(scope, approval.candidateId, { ...approval, operationId: `chat-approval:${messageId}` }, tx)
    return null
  }
  const checklist = await getChapterFinalizationChecklist(scope, tx)
  if (checklist.checklistHash !== approval.checklistHash || checklist.version !== approval.expectedVersion || checklist.contentHash !== approval.expectedHash) throw new ContentError("FINALIZATION_STALE", "确认期间正文、评论或评分已变化，请查看新清单后确认", 409)
  return { kind: "finalize" as const, targetType: "CHAPTER_CONTENT" as const, targetId: scope.chapterId, expectedVersion: approval.expectedVersion, expectedHash: approval.expectedHash, checklistHash: approval.checklistHash }
}
