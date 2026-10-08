import { lockSceneTree } from "./scene"
import type { ContentCandidate, Prisma } from "@/generated/prisma/client"
import { outsideChatExecution } from "@/lib/chat-execution"
import { prisma, controlPrisma } from "@/lib/db"
import { ContentError, requireVersion } from "@/lib/content-errors"
import { checkGeneratedContent, hardContentChecks, type ContentCheck } from "@/lib/content-policy"
import { countChineseWords } from "@/lib/text"
import { planningSchema } from "@/lib/planning/domain"
import { wordRequirementSchema, type WordRequirement } from "@/lib/word-requirement"
import { adjustChapterWordRange } from "./planning"
import { attachChapterReviewComments, boundCommentActionSchema, commitCandidateCommentActions, withdrawCandidateCommentActions } from "./candidate-comments"
import { aiReviewSchema, normalizeComments } from "./review-schema"
import { contentHash, requestHash, ownedChapter, lockContentOperation, commitChapterRevisionInTransaction, type ContentReceipt, type ChapterRevisionInput } from "./content-commit"
import { pageSize, type ChapterScope } from "./chapter-history"

export interface CreateCandidateInput extends ChapterScope {
  operationId: string
  expectedVersion: number
  previousContent: string
  content: string
  source: string
  sourceRunId?: string
  finishReason?: string
  targetWordCount?: number
  compressionAuthorized?: boolean
  wordRequirement?: WordRequirement
  /** 抽卡悬浮框设置的本批字数档：存在时 UNDER/OVER_TARGET 硬检查以它为档（不用 wordRequirement 顶替——改进链路的作者要求不能放宽规划档硬闸） */
  wordCheckOverride?: { min: number; max: number }
  improvementId?: string
  iteration?: number
  /** 抽卡分组与角度；非抽卡候选为 undefined */
  drawId?: string
  variant?: string
  basedOnCandidateId?: string
  /** 抽卡候选一律等作者选稿，不做空稿自动采用 */
  suppressAutoAccept?: boolean
}
function candidateMetadata(row: ContentCandidate) {
  const { content, baseContent: _baseline, ...metadata } = row
  void _baseline
  return { ...metadata, wordCount: countChineseWords(content), excerpt: content.replace(/\s+/g, " ").trim().slice(0, 160) }
}

export async function createContentCandidate(input: CreateCandidateInput) {
  requireVersion(input.expectedVersion)
  await ownedChapter(prisma, input.userId, input.novelId, input.chapterId)
  const check = checkGeneratedContent(input)
  const planning = await prisma.planningDocument.findUnique({ where: { novelId: input.novelId } })
  const plannedChapter = planning ? planningSchema.parse(planning.data).chapters.find(ch => ch.id === input.chapterId) : undefined
  // 本批覆盖档（抽卡悬浮框设置）优先；否则按章节规划档做硬检查
  const wordCheck = input.wordCheckOverride ?? (plannedChapter ? { min: plannedChapter.wordMin, max: plannedChapter.wordBudget } : null)
  const wordCheckLabel = input.wordCheckOverride ? "本批指定范围" : "章节"
  if (wordCheck && check.wordCount < wordCheck.min) {
    check.checks.push({ code: "UNDER_TARGET", hard: true, message: `实际${check.wordCount}字，低于${wordCheckLabel}下限${wordCheck.min}字；候选保留，请补足后重新提交` })
    check.status = "needs_review"
  }
  if (wordCheck?.max && check.wordCount > wordCheck.max) {
    check.checks.push({ code: "OVER_TARGET", hard: true, message: `实际${check.wordCount}字，超过${wordCheckLabel}上限${wordCheck.max}字；候选保留，请修订后重新提交` })
    check.status = "needs_review"
  }
  if (!input.operationId || input.operationId.length > 160) throw new ContentError("INVALID_OPERATION", "缺少有效候选操作编号", 400)
  const wordRequirement = input.wordRequirement ? wordRequirementSchema.parse(input.wordRequirement) : undefined
  const data = { userId: input.userId, novelId: input.novelId, chapterId: input.chapterId, operationId: input.operationId, baseVersion: input.expectedVersion, baseHash: contentHash(input.previousContent), baseContent: input.previousContent, content: input.content, contentHash: contentHash(input.content), source: input.source, sourceRunId: input.sourceRunId, status: input.improvementId && check.status !== "incomplete" ? "reviewing" : check.status, checks: check.checks as unknown as Prisma.InputJsonValue,
    wordRequirement, targetWordCount: input.targetWordCount, improvementId: input.improvementId, iteration: input.iteration, drawId: input.drawId ?? null, variant: input.variant ?? null, basedOnCandidateId: input.basedOnCandidateId ?? null }
  const read = () => prisma.contentCandidate.findUnique({ where: { userId_operationId: { userId: input.userId, operationId: input.operationId } } })
  const verify = (row: ContentCandidate) => {
    if (row.chapterId !== input.chapterId || row.novelId !== input.novelId || row.source !== input.source || row.sourceRunId !== (input.sourceRunId ?? null) || row.contentHash !== data.contentHash || row.baseHash !== data.baseHash || row.baseVersion !== input.expectedVersion || requestHash(row.checks) !== requestHash(data.checks) || row.improvementId !== (input.improvementId ?? null) || requestHash(row.wordRequirement) !== requestHash(wordRequirement ?? null) || row.drawId !== data.drawId || row.variant !== data.variant || row.basedOnCandidateId !== data.basedOnCandidateId) throw new ContentError("OPERATION_CONFLICT", "操作编号已用于不同候选稿")
    return row
  }
  const prior = await read()
  if (prior) return verify(prior)
  try { return await outsideChatExecution(() => prisma.contentCandidate.create({ data })) }
  catch (error) {
    if ((error as { code?: string }).code === "P2002") { const row = await read(); if (row) return verify(row) }
    throw error
  }
}

export async function getContentCandidate(scope: ChapterScope, candidateId: string, tx: Prisma.TransactionClient = prisma) {
  await ownedChapter(tx, scope.userId, scope.novelId, scope.chapterId)
  if (tx === prisma) await reconcileCandidateReviews(scope)
  const candidate = await tx.contentCandidate.findFirst({ where: { id: candidateId, userId: scope.userId, novelId: scope.novelId, chapterId: scope.chapterId } })
  if (!candidate) throw new ContentError("CANDIDATE_NOT_FOUND", "候选稿不存在", 404)
  return candidate
}

export async function listContentCandidates(scope: ChapterScope, options: { cursor?: string; limit?: number } = {}) {
  await ownedChapter(prisma, scope.userId, scope.novelId, scope.chapterId)
  await reconcileCandidateReviews(scope)
  const where = { userId: scope.userId, novelId: scope.novelId, chapterId: scope.chapterId }
  if (options.cursor && !await prisma.contentCandidate.findFirst({ where: { ...where, id: options.cursor } })) throw new ContentError("INVALID_CURSOR", "候选分页位置无效", 400)
  const limit = pageSize(options.limit)
  const rows = await prisma.contentCandidate.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}), take: limit + 1 })
  return { candidates: rows.slice(0, limit).map(candidateMetadata), nextCursor: rows.length > limit ? rows[limit - 1].id : null }
}

/** 进程消失后仅恢复候选的可检查状态；不重启模型，也不恢复已过期执行的写权限。 */
async function reconcileCandidateReviews(scope: ChapterScope) {
  const runs = await controlPrisma.contentImprovementRun.findMany({ where: { userId: scope.userId, novelId: scope.novelId, chapterId: scope.chapterId, status: "running" } })
  for (const run of runs) await controlPrisma.$transaction(async tx => {
    const attempt = run.attemptId ? await tx.chatAttempt.findUnique({ where: { id: run.attemptId } }) : null
    let live = !run.attemptId && Date.now() - run.updatedAt.getTime() < 10 * 60 * 1000
    if (attempt) {
      const turn = await tx.chatTurn.findUnique({ where: { id: attempt.turnId } })
      if (turn) {
        await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${turn.conversationId} FOR UPDATE`
        const conversation = await tx.conversation.findUnique({ where: { id: turn.conversationId } })
        live = !!conversation && conversation.activeAttemptId === attempt.id && !conversation.cancelRequestedAt && !!conversation.leaseExpiresAt && conversation.leaseExpiresAt.getTime() > Date.now()
      }
    }
    if (live) return
    const candidates = await tx.contentCandidate.findMany({ where: { improvementId: run.id, userId: scope.userId }, select: { id: true }, orderBy: { iteration: "asc" } })
    await tx.contentImprovementRun.updateMany({ where: { id: run.id, status: "running" }, data: { status: "interrupted", candidateIds: candidates.map(row => row.id) } })
    await tx.contentCandidate.updateMany({ where: { improvementId: run.id, userId: scope.userId, status: "reviewing" }, data: { status: "needs_review", qualityDecision: { autoAccept: false, comparable: false, baselineScore: null, candidateScore: null, reasons: ["评审执行已中断，候选保留供作者检查"] } } })
  })
}

export async function acceptContentCandidate(scope: ChapterScope, candidateId: string, input: { expectedVersion: number; operationId: string; candidateHash: string; mode?: "replace"; wordRangeAdjust?: { wordMin: number; wordBudget: number } }, transaction?: Prisma.TransactionClient): Promise<ContentReceipt> {
  requireVersion(input.expectedVersion)
  const commit = async (tx: Prisma.TransactionClient) => {
    await ownedChapter(tx, scope.userId, scope.novelId, scope.chapterId)
    await lockSceneTree(tx, scope.novelId)
    await lockContentOperation(tx, scope.userId, input.operationId)
    const loaded = await getContentCandidate(scope, candidateId, tx)
    if (input.candidateHash !== loaded.contentHash || contentHash(loaded.content) !== loaded.contentHash) throw new ContentError("CANDIDATE_HASH_CONFLICT", "候选稿校验不一致，请重新读取")
    const previous = await tx.contentMutation.findUnique({ where: { userId_operationId: { userId: scope.userId, operationId: input.operationId } } })
    if (!previous) {
      if (loaded.status !== "ready" && loaded.status !== "needs_review") throw new ContentError("CANDIDATE_UNAVAILABLE", loaded.status === "incomplete" ? "此稿尚未完整生成，不能采用" : "候选稿已处理")
      // 调整字数范围后采用（card-select F2）：唯一硬阻塞须为字数档；调档（Novel 锁）→ 移除已被覆盖的字数硬项 → 复评状态
      if (input.wordRangeAdjust) {
        const pre = await ownedChapter(tx, scope.userId, scope.novelId, scope.chapterId)
        if (pre.version !== input.expectedVersion) throw new ContentError("VERSION_CONFLICT", "稿件已有新修订，请核对后重试", 409)
        const hardNow = hardContentChecks(loaded.checks)
        if (!hardNow.length || !hardNow.every((c) => c.code === "OVER_TARGET" || c.code === "UNDER_TARGET")) throw new ContentError("WORD_RANGE_NOT_BLOCKING", "仅字数档未过时才可调整范围后采用", 409)
        const { wordMin, wordBudget } = input.wordRangeAdjust
        if (!Number.isInteger(wordMin) || !Number.isInteger(wordBudget) || wordMin < 1 || wordMin > wordBudget || wordBudget > 200000) throw new ContentError("INVALID_INPUT", "字数范围无效", 400)
        const words = countChineseWords(loaded.content)
        if (words < wordMin || words > wordBudget) throw new ContentError("WORD_RANGE_INSUFFICIENT", "所调范围仍不能容纳本稿字数", 409)
        await adjustChapterWordRange(scope, scope.chapterId, { wordMin, wordBudget }, `${input.operationId}:word-range`, tx)
        const remaining = (Array.isArray(loaded.checks) ? (loaded.checks as unknown as ContentCheck[]) : []).filter((c) => !(c && typeof c === "object" && c.hard === true && (c.code === "OVER_TARGET" || c.code === "UNDER_TARGET")))
        const nextStatus = hardContentChecks(remaining).length ? "incomplete" : remaining.length ? "needs_review" : "ready"
        await tx.contentCandidate.update({ where: { id: candidateId }, data: { checks: remaining as unknown as Prisma.InputJsonValue, status: nextStatus } })
      }
    }
    await tx.$queryRaw`SELECT id FROM "Chapter" WHERE id = ${scope.chapterId} FOR UPDATE`
    const candidate = await getContentCandidate(scope, candidateId, tx)
    const current = await ownedChapter(tx, scope.userId, scope.novelId, scope.chapterId)
    // 调档经投影联动会 bump 章版本（字数档嵌在投影大纲文本）：修订版本以调档后的当前版本为准；
    // 幂等重放时取原回执 beforeVersion，保持请求哈希一致
    const effectiveVersion = input.wordRangeAdjust
      ? previous
        ? (previous.beforeVersion ?? input.expectedVersion)
        : current.version
      : input.expectedVersion
    const revision: ChapterRevisionInput = { ...scope, expectedVersion: effectiveVersion, operationId: input.operationId, source: "candidate", reason: `${input.mode === "replace" ? "替换采用" : "采用"}候选稿 ${candidateId}`, changes: { content: candidate.content } }
    if (previous) return commitChapterRevisionInTransaction(tx, revision)
    // 锁后复查状态（锁前的状态检查只是提前失败；与丢弃/评审的并发以锁后为准）
    if (candidate.status !== "ready" && candidate.status !== "needs_review") throw new ContentError("CANDIDATE_UNAVAILABLE", candidate.status === "incomplete" ? "此稿尚未完整生成，不能采用" : "候选稿已处理")
    const hard = hardContentChecks(candidate.checks)
    if (hard.length) throw new ContentError("CANDIDATE_INCOMPLETE", `候选稿未通过完整性检查：${hard.map((c) => c.message).join("；")}`)
    // 换用（replace）：作者明确以本候选替换当前正文，跳过候选 baseVersion/baseHash 闸；expectedVersion 对当前章版本（commit 内 CAS 兜底）
    if (input.mode !== "replace" && (candidate.baseVersion !== input.expectedVersion || contentHash(current.content) !== candidate.baseHash)) throw new ContentError("CANDIDATE_STALE", "当前稿已有变化，候选已保留，请重新比较")
    return commitChapterRevisionInTransaction(tx, revision, async (_tx, _chapter, receipt) => {
      const actions = boundCommentActionSchema.array().parse(candidate.proposedCommentActions)
      await commitCandidateCommentActions(tx, scope, candidateId, actions)
      if (candidate.candidateReviewId) {
        const reviewed = await tx.review.findFirst({ where: { id: candidate.candidateReviewId, novelId: scope.novelId, targetType: "CHAPTER_CONTENT", targetId: scope.chapterId, candidateId, contentHash: candidate.contentHash, reviewConfigHash: candidate.reviewConfigHash, purpose: "candidate" } })
        if (!reviewed) throw new ContentError("REVIEW_REFERENCE_INVALID", "候选评审与正文不一致，未采用")
        const promoted = await tx.review.create({ data: { novelId: scope.novelId, targetType: "CHAPTER_CONTENT", targetId: scope.chapterId, contentHash: receipt.contentHash, contentVersion: receipt.version, candidateId,
          reviewConfigHash: reviewed.reviewConfigHash, sourceRunId: reviewed.sourceRunId, purpose: "current", aiScore: reviewed.aiScore, aiDimensions: reviewed.aiDimensions ?? undefined, aiComments: reviewed.aiComments ?? undefined } })
        await attachChapterReviewComments(tx, scope, candidate.content, promoted.id, normalizeComments(aiReviewSchema.shape.comments.parse(reviewed.aiComments ?? [])))
      }
      const moved = await tx.contentCandidate.updateMany({ where: { id: candidateId, status: candidate.status }, data: { status: "accepted", acceptedOperationId: input.operationId } })
      if (moved.count !== 1) throw new ContentError("CANDIDATE_UNAVAILABLE", "候选稿已被处理")
      // 换用：同事务撤回原采用稿（正文来自手工写作时可能没有，允许 count=0）
      if (input.mode === "replace") {
        await tx.contentCandidate.updateMany({ where: { userId: scope.userId, novelId: scope.novelId, chapterId: scope.chapterId, status: "accepted", id: { not: candidateId } }, data: { status: "withdrawn", withdrawnOperationId: input.operationId } })
      }
    })
  }
  return transaction ? commit(transaction) : prisma.$transaction(commit, { timeout: 15000 })
}

export async function discardContentCandidate(scope: ChapterScope, candidateId: string) {
  return prisma.$transaction(async tx => {
    await ownedChapter(tx, scope.userId, scope.novelId, scope.chapterId)
    await tx.$queryRaw`SELECT id FROM "Chapter" WHERE id = ${scope.chapterId} FOR UPDATE`
    const candidate = await getContentCandidate(scope, candidateId, tx)
    if (candidate.status === "discarded") return candidateMetadata(candidate)
    if (["accepted", "withdrawn"].includes(candidate.status)) throw new ContentError("CANDIDATE_ACCEPTED", "候选稿已经采用或撤回，不能丢弃")
    return candidateMetadata(await tx.contentCandidate.update({ where: { id: candidateId }, data: { status: "discarded" } }))
  })
}

/** 已有正文的全稿 AI 提交必须经过质量比较，普通生成只自动保存完整的新稿；抽卡候选一律等作者选稿。 */
export async function submitGeneratedContent(input: CreateCandidateInput) {
  const candidate = await createContentCandidate(input)
  let receipt: ContentReceipt | null = null
  if (!input.suppressAutoAccept && ((!input.previousContent.trim() && candidate.status === "ready") || candidate.status === "accepted")) {
    try { receipt = await acceptContentCandidate(input, candidate.id, { expectedVersion: input.expectedVersion, operationId: `${input.operationId}:accept`, candidateHash: candidate.contentHash }) }
    catch (error) {
      if (!(error instanceof ContentError) || !["VERSION_CONFLICT", "CANDIDATE_STALE", "CANDIDATE_UNAVAILABLE"].includes(error.code)) throw error
    }
  }
  return { candidate: candidateMetadata(await getContentCandidate(input, candidate.id)), receipt }
}

/** 撤回也产生新修订；不恢复旧标题/章纲/定稿状态，不覆盖采用后的编辑或讨论。 */
export async function withdrawContentCandidate(scope: ChapterScope, candidateId: string, input: { expectedVersion: number; operationId: string; candidateHash: string }) {
  requireVersion(input.expectedVersion)
  return prisma.$transaction(async tx => {
    await ownedChapter(tx, scope.userId, scope.novelId, scope.chapterId)
    await lockSceneTree(tx, scope.novelId)
    await lockContentOperation(tx, scope.userId, input.operationId)
    await tx.$queryRaw`SELECT id FROM "Chapter" WHERE id = ${scope.chapterId} FOR UPDATE`
    const candidate = await getContentCandidate(scope, candidateId, tx)
    if (input.candidateHash !== candidate.contentHash) throw new ContentError("CANDIDATE_HASH_CONFLICT", "候选稿校验不一致")
    let content = candidate.baseContent
    if (content === null) {
      const snapshot = await tx.contentVersion.findFirst({ where: { targetType: "Chapter", targetId: scope.chapterId, version: candidate.baseVersion } })
      const raw = snapshot?.snapshot as { content?: unknown } | null
      content = typeof raw?.content === "string" ? raw.content : null
    }
    if (content === null || contentHash(content) !== candidate.baseHash) throw new ContentError("BASELINE_UNAVAILABLE", "原稿历史无法核验，未撤回")
    const revision: ChapterRevisionInput = { ...scope, expectedVersion: input.expectedVersion, expectedContentHash: candidate.contentHash, operationId: input.operationId, source: "restore", reason: `撤回候选稿 ${candidateId}`, changes: { content } }
    const prior = await tx.contentMutation.findUnique({ where: { userId_operationId: { userId: scope.userId, operationId: input.operationId } } })
    if (prior) return { receipt: await commitChapterRevisionInTransaction(tx, revision), content }
    if (candidate.status !== "accepted" || !candidate.acceptedOperationId) throw new ContentError("CANDIDATE_UNAVAILABLE", "此候选未采用或已经撤回")
    const adoption = await tx.contentMutation.findUnique({ where: { userId_operationId: { userId: scope.userId, operationId: candidate.acceptedOperationId } } })
    const current = await ownedChapter(tx, scope.userId, scope.novelId, scope.chapterId)
    if (!adoption || adoption.afterVersion !== input.expectedVersion || current.version !== input.expectedVersion || contentHash(current.content) !== candidate.contentHash) throw new ContentError("CANDIDATE_STALE", "采用之后正文已有新修订，未撤回，请比较版本历史")
    const receipt = await commitChapterRevisionInTransaction(tx, revision, async () => {
      await withdrawCandidateCommentActions(tx, scope, candidateId)
      await tx.contentCandidate.update({ where: { id: candidateId }, data: { status: "withdrawn", withdrawnOperationId: input.operationId } })
    })
    return { receipt, content }
  }, { timeout: 15000 })
}

/** 放弃换用（card-select F7 问答选项 C）：恢复 replace 采用前的正文为新修订（不改写旧快照），候选状态回滚（新稿 withdrawn、被替换稿回 accepted）。 */
export async function revertCandidateReplacement(scope: ChapterScope, input: { expectedVersion: number; operationId: string }) {
  requireVersion(input.expectedVersion)
  return prisma.$transaction(async tx => {
    await ownedChapter(tx, scope.userId, scope.novelId, scope.chapterId)
    await lockSceneTree(tx, scope.novelId)
    await lockContentOperation(tx, scope.userId, input.operationId)
    await tx.$queryRaw`SELECT id FROM "Chapter" WHERE id = ${scope.chapterId} FOR UPDATE`
    const adopted = await tx.contentCandidate.findFirst({ where: { userId: scope.userId, novelId: scope.novelId, chapterId: scope.chapterId, status: "accepted" } })
    if (!adopted?.acceptedOperationId) throw new ContentError("CANDIDATE_UNAVAILABLE", "当前没有可撤回的换用", 409)
    const adoption = await tx.contentMutation.findUnique({ where: { userId_operationId: { userId: scope.userId, operationId: adopted.acceptedOperationId } } })
    if (!adoption) throw new ContentError("CANDIDATE_UNAVAILABLE", "采用记录缺失，无法撤回换用", 409)
    // 仅「替换采用」产生的采用可经此回滚（普通采用的恢复走候选撤回/历史恢复既有入口）
    if (adoption.afterVersion === null) throw new ContentError("CANDIDATE_UNAVAILABLE", "当前采用并非换用，没有可撤回的换用", 409)
    const afterSnap = await tx.contentVersion.findFirst({ where: { targetType: "Chapter", targetId: scope.chapterId, version: adoption.afterVersion } })
    if (!afterSnap?.reason?.startsWith("替换采用候选稿")) throw new ContentError("CANDIDATE_UNAVAILABLE", "当前采用并非换用，没有可撤回的换用", 409)
    if (adoption.beforeVersion === null) throw new ContentError("BASELINE_UNAVAILABLE", "换用前稿件历史无法核验，未撤回", 409)
    const snapshot = await tx.contentVersion.findFirst({ where: { targetType: "Chapter", targetId: scope.chapterId, version: adoption.beforeVersion } })
    const raw = snapshot?.snapshot as { content?: unknown } | null
    const content = typeof raw?.content === "string" ? raw.content : null
    if (content === null) throw new ContentError("BASELINE_UNAVAILABLE", "换用前稿件历史无法核验，未撤回", 409)
    const revision: ChapterRevisionInput = { ...scope, expectedVersion: input.expectedVersion, expectedContentHash: adopted.contentHash, operationId: input.operationId, source: "restore", reason: "放弃换用，恢复原正文", changes: { content } }
    const prior = await tx.contentMutation.findUnique({ where: { userId_operationId: { userId: scope.userId, operationId: input.operationId } } })
    if (prior) return { receipt: await commitChapterRevisionInTransaction(tx, revision) }
    const current = await ownedChapter(tx, scope.userId, scope.novelId, scope.chapterId)
    if (adoption.afterVersion !== input.expectedVersion || current.version !== input.expectedVersion || contentHash(current.content) !== adopted.contentHash) throw new ContentError("CANDIDATE_STALE", "换用之后正文已有新修订，未撤回，请比较版本历史", 409)
    const receipt = await commitChapterRevisionInTransaction(tx, revision, async () => {
      await withdrawCandidateCommentActions(tx, scope, adopted.id)
      await tx.contentCandidate.update({ where: { id: adopted.id }, data: { status: "withdrawn", withdrawnOperationId: input.operationId } })
      // 被本次换用撤回的候选回 accepted（其 acceptedOperationId 保留原值）
      await tx.contentCandidate.updateMany({ where: { userId: scope.userId, novelId: scope.novelId, chapterId: scope.chapterId, status: "withdrawn", withdrawnOperationId: adopted.acceptedOperationId }, data: { status: "accepted" } })
    })
    return { receipt }
  }, { timeout: 15000 })
}
