import type { ContentImprovementRun, Prisma, Review } from "@/generated/prisma/client"
import { currentChatExecution } from "@/lib/chat-execution"
import { waitWithAbort } from "@/lib/abortable-stream"
import { chatActionSchema } from "@/lib/chat-parts"
import { ContentError, requireVersion } from "@/lib/content-errors"
import { checkGeneratedContent, type ContentCheck } from "@/lib/content-policy"
import { decideCandidate, type ComparableReview } from "@/lib/candidate-quality-policy"
import { prisma, controlPrisma } from "@/lib/db"
import { streamGeneration } from "@/lib/ai/generate"
import { QuotaExceededError, NoModelAvailableError, PlanRestrictedError } from "@/lib/ai/errors"
import { checkQuota } from "@/lib/quota"
import { getModelForUser } from "@/lib/ai/provider"
import { countChineseWords } from "@/lib/text"
import { inferWordRequirement, wordRequirementLabel, wordRequirementSchema } from "@/lib/word-requirement"
import { contentHash, lockContentOperation, ownedChapter, requestHash, type ContentReceipt } from "./content-commit"
import { acceptContentCandidate, createContentCandidate } from "./content-candidate"
import { readChapterBoundaries, type ChapterFactSource } from "./chapter-boundaries"
import { bindProposedCommentActions, commentRepliesHash, type CommentSnapshot } from "./candidate-comments"
import { createChapterReviewConfiguration, reviewChapterReference, type ChapterReviewConfiguration } from "./content-review"
import type { ChapterScope } from "./chapter-history"
import { completeRun, failRun, startRun } from "./subagent-run"
import { taskDefaults } from "@desktop/service/task-defaults"

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value))
const knownFailure = (error: unknown, fallback: string) => error instanceof ContentError || error instanceof QuotaExceededError || error instanceof NoModelAvailableError || error instanceof PlanRestrictedError ? error.message : fallback
export interface ImproveChapterInput extends ChapterScope { expectedVersion: number; operationId: string; authorInstructions?: string; abortSignal?: AbortSignal }

/** 使用真实 USER 消息；模型转述不能自行缩小目标、声明压缩授权或获得自动采用权限。 */
export async function chapterImprovementIntent(scope: ChapterScope, fallback = "") {
  const execution = currentChatExecution()
  if (!execution) return { instructions: fallback, authorized: false, action: null }
  const turn = await prisma.chatTurn.findFirst({ where: { id: execution.turnId, userId: scope.userId, conversation: { novelId: scope.novelId } } })
  const message = turn && await prisma.message.findFirst({ where: { id: turn.userMessageId, conversationId: execution.conversationId, role: "USER" } })
  if (!turn || !message) throw new ContentError("ACTION_SCOPE_INVALID", "未找到本轮作者请求", 409)
  const parsed = chatActionSchema.safeParse(turn.action)
  const action = parsed.success ? parsed.data : null
  // 写作方案来自已消费的固定问答，不能由工具参数或模型转述授予自动采用权限。
  const { getStoryWorkflow } = await import("./story-workflow")
  const workflow = await getStoryWorkflow(scope)
  if (workflow?.writingAuthorized && workflow.artifacts.some(a => a.kind === "chapter-content" && a.id === scope.chapterId)) return { instructions: `${message.content}\n作者已认可的创作简报：${workflow.brief}\n本章目标约${workflow.targetWords}字，保持大纲边界，依据当前评审改进。`, authorized: true, action }
  return { instructions: message.content, authorized: action?.kind === "improve" && action.targetType === "CHAPTER_CONTENT" && action.targetId === scope.chapterId, action }
}

export async function beginContentImprovement(input: ImproveChapterInput) {
  requireVersion(input.expectedVersion)
  if (!input.operationId || input.operationId.length > 100) throw new ContentError("INVALID_OPERATION", "缺少有效改进操作编号", 400)
  const intent = await chapterImprovementIntent(input, input.authorInstructions)
  const execution = currentChatExecution()
  const hash = requestHash({ chapterId: input.chapterId, novelId: input.novelId, expectedVersion: input.expectedVersion, instructions: intent.instructions })
  const defaultsSnapshot = execution?.taskDefaults ?? await taskDefaults()
  const boundaries = await readChapterBoundaries(input)
  return prisma.$transaction(async tx => {
    await ownedChapter(tx, input.userId, input.novelId, input.chapterId)
    await lockContentOperation(tx, input.userId, input.operationId)
    await tx.$queryRaw`SELECT id FROM "Chapter" WHERE id = ${input.chapterId} FOR UPDATE`
    const prior = await tx.contentImprovementRun.findUnique({ where: { userId_operationId: { userId: input.userId, operationId: input.operationId } } })
    if (prior) {
      if (prior.requestHash !== hash) throw new ContentError("OPERATION_CONFLICT", "改进操作编号已经用于不同请求")
      return { run: prior, created: false, authorized: intent.authorized }
    }
    if (execution) {
      const sameTurn = await tx.contentImprovementRun.findUnique({ where: { turnId_chapterId: { turnId: execution.turnId, chapterId: input.chapterId } } })
      if (sameTurn) return { run: sameTurn, created: false, authorized: intent.authorized }
    }
    const chapter = await ownedChapter(tx, input.userId, input.novelId, input.chapterId)
    if (chapter.version !== input.expectedVersion) throw new ContentError("VERSION_CONFLICT", "正文已有新修订，请重新读取")
    if (!chapter.content.trim()) throw new ContentError("REVIEW_CONTENT_EMPTY", "本章尚无正文，请先生成新稿", 400)
    const rows = await tx.textComment.findMany({ where: { novelId: input.novelId, targetType: "CHAPTER_CONTENT", targetId: input.chapterId }, orderBy: { createdAt: "asc" } })
    const comments: CommentSnapshot[] = rows.filter(row => !row.parentId).map(row => {
      const replies = rows.filter(reply => reply.parentId === row.id)
      return { id: row.id, content: row.content, status: row.status, quote: row.quote, startOffset: row.startOffset, endOffset: row.endOffset, prefix: row.prefix, suffix: row.suffix, anchorHash: row.anchorHash, updatedAt: row.updatedAt.toISOString(), replyHash: commentRepliesHash(replies), replies: replies.map(({ id, content, authorType, authorName }) => ({ id, content, authorType, authorName })) }
    })
    const wordRequirement = inferWordRequirement(intent.instructions, chapter.outline, countChineseWords(chapter.content))
    const run = await tx.contentImprovementRun.create({ data: { userId: input.userId, novelId: input.novelId, chapterId: input.chapterId, operationId: input.operationId, requestHash: hash, turnId: execution?.turnId, attemptId: execution?.attemptId,
      defaultsSnapshot,
      baseVersion: chapter.version, baseHash: contentHash(chapter.content), baseContent: chapter.content, authorInstructions: intent.instructions, comments: json(comments), boundaries: json(boundaries), wordRequirement: json(wordRequirement) } })
    return { run, created: true, authorized: intent.authorized }
  })
}

const budgets = { writerCalls: 2, baselineCalls: 1, candidateCalls: 2 } as const
/** 在模型调用前原子占额；失败照计，换 toolCallId/参数不会重置同 turn/章节的额度。 */
export async function claimImprovementCall(scope: ChapterScope, runId: string, kind: keyof typeof budgets) {
  await ownedChapter(prisma, scope.userId, scope.novelId, scope.chapterId)
  const result = await prisma.contentImprovementRun.updateMany({ where: { id: runId, userId: scope.userId, novelId: scope.novelId, chapterId: scope.chapterId, status: "running", [kind]: { lt: budgets[kind] } }, data: { [kind]: { increment: 1 } } })
  if (result.count !== 1) throw new ContentError("IMPROVEMENT_BUDGET_EXHAUSTED", "本轮改进已用完调用预算，已保留候选及检查结果", 409)
}

type ReviewResult = Awaited<ReturnType<typeof reviewChapterReference>>
/** 服务测试可替换模型边界；工具/API 不接收此参数，数据库预算与提交协议始终真实执行。 */
export interface ImprovementModelBoundary {
  configure: typeof createChapterReviewConfiguration
  review: typeof reviewChapterReference
  write(input: { scope: ChapterScope; run: ContentImprovementRun; config: ChapterReviewConfiguration; baselineFeedback?: string; previousCandidate?: string; revisionGoal?: string; signal?: AbortSignal }): Promise<{ content: string; finishReason: string; runId?: string; failure?: string }>
}
const modelBoundary: ImprovementModelBoundary = {
  configure: createChapterReviewConfiguration,
  review: reviewChapterReference,
  async write({ scope, run, config, baselineFeedback, previousCandidate, revisionGoal, signal }) {
    const signals = [signal, currentChatExecution()?.signal].filter((value): value is AbortSignal => !!value)
    const callSignal = AbortSignal.any(signals)
    const writer = await startRun({ novelId: scope.novelId, agentKind: "writer", task: revisionGoal ? "按具体问题修订候选稿" : "生成正文改进候选", targetType: "CHAPTER_CONTENT", targetId: scope.chapterId, contentHash: run.baseHash, contentVersion: run.baseVersion, reviewConfigHash: config.hash })
    const requirement = wordRequirementSchema.parse((run.wordRequirement as Prisma.JsonObject).requirement)
    let content = "", finishReason = "error", previewAt = 0
    let failure: string | undefined
    try {
      const model = await getModelForUser(scope.userId, { fetch: currentChatExecution()?.networkRetry?.fetch })
      const prompt = `你是小说写手。只输出完整的本章候选正文，不输出解释、计划、工具或 JSON；不得假称已经保存、处理评论或定稿。\n【作者本轮要求】\n${run.authorInstructions}\n【篇幅约束】${wordRequirementLabel(requirement)}，不得自行缩小目标。\n【风格与设定】\n${JSON.stringify(config.sections)}\n【前章事实、本章事件、后章边界（保留来源）】\n${JSON.stringify(run.boundaries)}\n【原稿】\n${run.baseContent}\n【评论快照】\n${JSON.stringify(run.comments)}\n只落实 OPEN 意见，尊重 REJECTED 拒绝理由；不要反复首次描写已经发生的事件，没有依据不编造设定。保持章节的场景目标与因果，不用梗概代替正文。${previousCandidate ? `\n【上次候选】\n${previousCandidate}\n【唯一修订目标】\n${revisionGoal}\n围绕上述具体场景、动作或信息修订，保留其他情节；写到完整结尾。` : ""}`
      const stream = await streamGeneration({ userId: scope.userId, novelId: scope.novelId, action: "chapter.improve.write", prompt: `${prompt}\n【本稿对应评审与读者反馈】\n${baselineFeedback ?? "暂无可验证的基线评审，谨慎处理评论与原稿。"}`, resolvedModel: model, abortSignal: callSignal })
      const reader = stream.fullStream.getReader()
      try { for (;;) {
        const { done, value: part } = await waitWithAbort(reader.read(), callSignal)
        if (done) break
        if (part.type === "text-delta") {
          content += part.text
          if (Date.now() - previewAt >= 120) { previewAt = Date.now(); currentChatExecution()?.progress?.({ storyDraft: { key: `chapter-content:${scope.chapterId}`, text: content.slice(-40000) } }) }
        }
        else if (part.type === "finish") finishReason = part.finishReason
        else if (part.type === "error") finishReason = "error"
        else if (part.type === "abort") finishReason = "abort"
      } } finally { void reader.cancel().catch(() => undefined); reader.releaseLock() }
      if (callSignal.aborted) finishReason = "abort"
      if (finishReason === "stop") await completeRun(writer.id, { transcript: { contentHash: contentHash(content), wordCount: countChineseWords(content) }, result: { candidatePrepared: true, wordCount: countChineseWords(content) } })
      else await failRun(writer.id, "候选生成未完整结束，已保留收到的片段")
    } catch (error) { finishReason = callSignal.aborted ? "abort" : "error"; failure = knownFailure(error, "候选生成未完成，原稿保留"); await failRun(writer.id, failure) }
    return { content, finishReason, runId: writer.id, failure }
  },
}

function comparableReview(review: Review, criticalKeys: string[]): ComparableReview | null {
  return review.aiScore !== null && review.contentHash && review.reviewConfigHash ? { id: review.id, score: review.aiScore, contentHash: review.contentHash, reviewConfigHash: review.reviewConfigHash, criticalKeys } : null
}
async function reuseBaseline(scope: ChapterScope, run: ContentImprovementRun, config: ChapterReviewConfiguration) {
  const review = await prisma.review.findFirst({ where: { novelId: scope.novelId, targetType: "CHAPTER_CONTENT", targetId: scope.chapterId, purpose: { in: ["current", "comparison"] }, contentHash: run.baseHash, contentVersion: run.baseVersion, reviewConfigHash: config.hash, aiScore: { not: null }, sourceRunId: { not: null } }, orderBy: { createdAt: "desc" } })
  const source = review?.sourceRunId && await prisma.subAgentRun.findFirst({ where: { id: review.sourceRunId, novelId: scope.novelId, targetId: scope.chapterId, contentHash: run.baseHash, reviewConfigHash: config.hash, status: "done" } })
  const transcript = source ? source.transcript as Prisma.JsonObject | null : null
  if (!review || !transcript || !Array.isArray(transcript.criticalKeys) || !transcript.criticalKeys.every(key => typeof key === "string")) return null
  return comparableReview(review, transcript.criticalKeys as string[])
}

function targetedRevisionGoal(checks: ContentCheck[], config: ChapterReviewConfiguration, result: ReviewResult | null) {
  const outline = config.sources.find(source => source.kind === "outline")?.text.trim()
  if (checks.some(check => check.code === "UNDER_TARGET") && outline) return `补足本章章纲尚未展开的具体场景、动作及因果信息：${outline.slice(0, 3000)}。不得重复已写段落，不越过后章边界。`
  const structural = result?.data.comments.find(comment => comment.suggestion && /场景|动作|因果|冲突|信息/.test(comment.suggestion))
  if (checks.some(check => ["SUSPICIOUS_ENDING", "CONSISTENCY"].includes(check.code)) && structural) return `${structural.issue}；具体修订：${structural.suggestion}`
  return null
}

export async function improveChapterContent(input: ImproveChapterInput, boundary: ImprovementModelBoundary = modelBoundary) {
  const started = await beginContentImprovement(input)
  const { run } = started
  if (!started.created) {
    const saved = run.result as { committed?: boolean; receipt?: ContentReceipt; notes?: string[] } | null
    return { improvementId: run.id, status: run.status, replayed: true, candidateIds: run.candidateIds, committed: saved?.committed === true, receipt: saved?.receipt ?? null, notes: saved?.notes ?? [] }
  }
  const comments = run.comments as unknown as CommentSnapshot[]
  const word = run.wordRequirement as Prisma.JsonObject
  const requirement = wordRequirementSchema.parse(word.requirement)
  const candidateIds: string[] = []
  let receipt: ContentReceipt | null = null
  let incomplete = false
  const notes: string[] = []
  try {
    await checkQuota(input.userId)
    const config = await boundary.configure(input, run.boundaries as unknown as ChapterFactSource[], { comments, authorInstructions: run.authorInstructions, wordRequirement: requirement })
    await prisma.contentImprovementRun.update({ where: { id: run.id }, data: { reviewConfig: config.metadata, reviewConfigHash: config.hash } })
    let baseline = await reuseBaseline(input, run, config)
    if (!baseline) {
      await claimImprovementCall(input, run.id, "baselineCalls")
      try { const reviewed = await boundary.review({ scope: input, reference: { kind: "comparison", improvementId: run.id }, config, abortSignal: input.abortSignal }); baseline = comparableReview(reviewed.review, reviewed.findings.criticalKeys) }
      catch (error) { notes.push(knownFailure(error, "基线评审未完成，候选不能自动采用")) }
    }
    const [baselineRow, readers] = await Promise.all([
      baseline ? prisma.review.findUnique({ where: { id: baseline.id }, select: { aiComments: true, aiDimensions: true } }) : null,
      prisma.subAgentRun.findMany({ where: { novelId: input.novelId, targetType: "CHAPTER_CONTENT", targetId: input.chapterId, contentHash: run.baseHash, contentVersion: run.baseVersion, agentKind: "reader", status: "done" }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, transcript: true } }),
    ])
    const baselineFeedback = JSON.stringify({ review: baselineRow, readers })
    let previousCandidate: string | undefined, revisionGoal: string | undefined
    for (let iteration = 1; iteration <= 2; iteration++) {
      await claimImprovementCall(input, run.id, "writerCalls")
      const generated = await boundary.write({ scope: input, run, config, baselineFeedback, previousCandidate, revisionGoal, signal: input.abortSignal })
      if (generated.failure) notes.push(generated.failure)
      const candidate = await createContentCandidate({ ...input, previousContent: run.baseContent, expectedVersion: run.baseVersion, content: generated.content, operationId: `${run.operationId}:candidate:${iteration}`, source: "正文改进", sourceRunId: generated.runId, finishReason: generated.finishReason,
        wordRequirement: requirement, compressionAuthorized: word.compressionAuthorized === true, improvementId: run.id, iteration })
      candidateIds.push(candidate.id)
      await prisma.contentImprovementRun.update({ where: { id: run.id }, data: { candidateIds } })
      await prisma.contentCandidate.update({ where: { id: candidate.id }, data: { reviewConfigHash: config.hash } })
      const checks = checkGeneratedContent({ content: candidate.content, previousContent: run.baseContent, finishReason: generated.finishReason, wordRequirement: requirement, compressionAuthorized: word.compressionAuthorized === true }).checks
      incomplete = checks.some(check => check.hard)
      let reviewed: ReviewResult | null = null
      if (!checks.some(check => check.hard)) {
        await claimImprovementCall(input, run.id, "candidateCalls")
        try { reviewed = await boundary.review({ scope: input, reference: { kind: "candidate", candidateId: candidate.id }, config, comments, abortSignal: input.abortSignal }) }
        catch { checks.push({ code: "REVIEW_FAILED", hard: false, message: "候选评审未完成，原稿保留" }) }
      }
      const mapped = bindProposedCommentActions(reviewed?.data.commentActions ?? [], comments, run.baseContent, candidate.content)
      checks.push(...mapped.issues.map(message => ({ code: "COMMENT_ACTION" as const, hard: false, message })))
      checks.push(...(reviewed?.findings.warnings ?? []).map(message => ({ code: "CONSISTENCY" as const, hard: false, message })))
      if (!config.dimensions.length) checks.push({ code: "REVIEW_FAILED", hard: false, message: "评审模板未固定维度，评分仅供参考" })
      if (reviewed?.findings.criticalKeys.some(key => !baseline?.criticalKeys.includes(key))) checks.push({ code: "CONSISTENCY", hard: false, message: "候选存在新增的关键一致性问题" })
      const current = await ownedChapter(prisma, input.userId, input.novelId, input.chapterId)
      const decision = decideCandidate({ baseHash: run.baseHash, candidateHash: candidate.contentHash, reviewConfigHash: config.hash, baseline, candidate: reviewed ? comparableReview(reviewed.review, reviewed.findings.criticalKeys) : null, checks, authorAuthorized: started.authorized, currentMatches: current.version === run.baseVersion && contentHash(current.content) === run.baseHash })
      const prepared = await prisma.contentCandidate.updateMany({ where: { id: candidate.id, status: { in: ["reviewing", "incomplete"] } }, data: { baselineReviewId: baseline?.id, candidateReviewId: reviewed?.review.id, proposedCommentActions: json(mapped.actions), qualityDecision: json({ ...decision, checks }), status: checks.some(check => check.hard) ? "incomplete" : decision.autoAccept ? "ready" : "needs_review" } })
      if (!prepared.count) { notes.push("候选在评审期间已被作者处理"); break }
      if (decision.autoAccept) {
        try { receipt = await acceptContentCandidate(input, candidate.id, { expectedVersion: run.baseVersion, operationId: `${run.operationId}:accept:${iteration}`, candidateHash: candidate.contentHash }) }
        catch (error) {
          if (!(error instanceof ContentError)) throw error
          notes.push(error.message)
          await prisma.contentCandidate.updateMany({ where: { id: candidate.id, status: "ready" }, data: { status: "needs_review", qualityDecision: json({ ...decision, autoAccept: false, reasons: [...decision.reasons, error.message], checks }) } })
        }
      }
      if (receipt || iteration === 2 || checks.some(check => check.hard)) break
      const goal = targetedRevisionGoal(checks, config, reviewed)
      if (!goal) break
      previousCandidate = candidate.content; revisionGoal = goal
    }
    const result = { committed: !!receipt, receipt, candidateIds, notes }
    const status = receipt ? "accepted" : incomplete ? "incomplete" : "needs_review"
    await prisma.contentImprovementRun.update({ where: { id: run.id }, data: { status, result: json(result) } })
    return { improvementId: run.id, status, replayed: false, ...result }
  } catch (error) {
    // 控制面仅结束本次运行；已生成候选不删除，失去 epoch 的执行不能借此写作品。
    const message = knownFailure(error, "改进未完成，已生成候选保留，当前稿未替换")
    // 中断后的完整候选可供作者手动检查；状态更新仅限本运行，不能恢复已丢弃/采用的候选。
    await controlPrisma.contentCandidate.updateMany({ where: { improvementId: run.id, userId: input.userId, status: "reviewing" }, data: { status: "needs_review", qualityDecision: json({ autoAccept: false, comparable: false, baselineScore: null, candidateScore: null, reasons: [message] }) } })
    await controlPrisma.contentImprovementRun.updateMany({ where: { id: run.id, userId: input.userId, attemptId: run.attemptId, status: "running" }, data: { status: receipt ? "accepted" : "interrupted", candidateIds, result: json({ committed: !!receipt, receipt, candidateIds, notes: [...notes, message] }) } })
    return { improvementId: run.id, status: receipt ? "accepted" : "interrupted", committed: !!receipt, receipt, candidateIds, notes: [...notes, message] }
  }
}
