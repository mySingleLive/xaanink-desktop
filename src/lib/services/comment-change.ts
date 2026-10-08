import { lockSceneTree } from "./scene"
import { z } from "zod"
import type { PreparedTextChange, Prisma, TextComment } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { checkGeneratedContent } from "@/lib/content-policy"
import { createContentCandidate } from "./content-candidate"
import { resolveWriteAnchor, splitMarkdownBlocks } from "@/lib/comment-anchor"
import { generateJSON } from "@/lib/ai/generate"
import { renderPrompt } from "@/lib/prompts/render"
import { contentHash, lockContentOperation, requestHash, type CommitTransaction } from "./content-commit"
import { assertTextBaseline, committedTargetText, commitTargetTextInTransaction, findTextReceipt, lockTextTarget, readTextTarget, type TextBaseline, type TextReceipt, type TextScope } from "./target-text"

export interface CommentScope { userId: string; novelId: string; commentId: string }
export interface PrepareCommentInput extends CommentScope {
  operationId: string; baseline: TextBaseline; commentUpdatedAt: string
  range?: "selection" | "paragraph"
  replacement?: string; reply?: string
}
export interface CommitCommentInput extends CommentScope {
  preparedId: string; operationId: string; baseline: TextBaseline
}
export interface CommentTextReceipt extends TextReceipt { commentId: string; commentStatus: "APPLIED"; replyId: string }
type Rewrite = (input: { oldText: string; context: string; comment: string }) => Promise<{ oldText: string; replacement: string; finishReason?: string }>

export async function ownedComment(tx: CommitTransaction, input: CommentScope) {
  const comment = await tx.textComment.findFirst({ where: { id: input.commentId, novelId: input.novelId, parentId: null } })
  if (!comment) throw new ContentError("COMMENT_NOT_FOUND", "评论不存在", 404)
  const scope: TextScope = { userId: input.userId, novelId: input.novelId, targetType: comment.targetType, targetId: comment.targetId }
  const state = await readTextTarget(tx, scope)
  return { comment, scope, state }
}

function assertComment(comment: TextComment, updatedAt: string, status?: string) {
  if (!updatedAt) throw new ContentError("PRECONDITION_REQUIRED", "缺少评论版本，请刷新评论后重试", 428)
  if (comment.updatedAt.toISOString() !== updatedAt || (status !== undefined && comment.status !== status)) throw new ContentError("COMMENT_CONFLICT", "评论已被编辑或处理，请重新读取")
}

function assertApplicable(comment: TextComment) {
  if (!comment.quote) throw new ContentError("ANCHOR_REQUIRED", "整体评论须在完成改写后关联提交回执", 422)
  if (comment.status === "REJECTED" || comment.status === "APPLIED") throw new ContentError("COMMENT_CONFLICT", "这条评论已处理，请重新读取评论状态")
}

function assertPrepared(patch: PreparedTextChange, baseline: TextBaseline) {
  if (patch.status !== "ready") throw new ContentError("PATCH_CONSUMED", "此补丁已经提交，请查看原保存结果")
  if (patch.expiresAt.getTime() <= Date.now()) throw new ContentError("PATCH_EXPIRED", "准备的改写已过期，请重新准备")
  assertTextBaseline({ version: patch.baseVersion, updatedAt: patch.baseUpdatedAt.toISOString(), hash: patch.baseHash, text: patch.oldText }, baseline)
}

/** 只有服务端选择的 oldText 能扩大范围，模型不得自行扩展。 */
export async function prepareCommentChange(input: PrepareCommentInput, rewrite?: Rewrite) {
  if (!input.operationId || input.operationId.length > 160) throw new ContentError("INVALID_OPERATION", "缺少有效操作编号", 400)
  const { comment, scope, state } = await ownedComment(prisma, input)
  // 候选稿只读：拦截在 ownedComment 之外，对话工具对候选评论的 AGREE/REJECT 状态流转不受影响
  if (comment.targetType === "CANDIDATE_CONTENT") throw new ContentError("TARGET_READONLY", "候选稿为只读稿，不能应用改写", 422)
  const hash = requestHash(input)
  const old = await prisma.preparedTextChange.findUnique({ where: { userId_operationId: { userId: input.userId, operationId: input.operationId } } })
  if (old) {
    if (old.requestHash !== hash) throw new ContentError("OPERATION_CONFLICT", "准备操作编号已用于不同内容")
    return old
  }
  assertTextBaseline(state, input.baseline)
  assertComment(comment, input.commentUpdatedAt)
  assertApplicable(comment)
  const anchor = resolveWriteAnchor(state.text, comment, comment.anchorHash === state.hash)
  if (!("start" in anchor)) throw new ContentError(anchor.kind === "missing" ? "ANCHOR_MISSING" : "ANCHOR_AMBIGUOUS", anchor.kind === "missing" ? "原文已改动，请重新选择范围" : "引用在原文中出现多次，无法唯一定位，请重新选择范围", 422)
  let { start, end } = anchor
  if (input.range === "paragraph") {
    const blocks = splitMarkdownBlocks(state.text).filter(block => block.end > start && block.start < end)
    if (blocks.length) {
      start = blocks[0].start; end = blocks[blocks.length - 1].end
      // 展示分块按 LF 计数，不能让写入范围只吞掉 CRLF 的前半个字符。
      if (state.text[end - 1] === "\r" && state.text[end] === "\n") end--
    }
  }
  const oldText = state.text.slice(start, end)
  const context = state.text.slice(Math.max(0, start - 500), Math.min(state.text.length, end + 500))
  let replacement = input.replacement
  let finishReason: string | undefined = replacement === undefined ? undefined : "tool-calls"
  if (replacement === undefined) {
    const run: Rewrite = rewrite ?? (async values => {
      const prompt = await renderPrompt("comment.apply", { quote: values.oldText, comment: values.comment, context: values.context })
      const result = await generateJSON({ userId: input.userId, novelId: input.novelId, tier: "ADVANCED", action: "comment.apply", prompt: `${prompt}\n\n仅替换给出的 quote 范围，范围外文字不能出现在 replacement 中。返回 JSON {oldText, replacement}，oldText 必须逐字等于 quote。不要自行扩展为整段；范围不够时保留原文。`, schema: z.object({ oldText: z.string(), replacement: z.string() }) })
      return { ...result.data, finishReason: result.finishReason }
    })
    const result = await run({ oldText, context, comment: comment.content })
    if (result.oldText !== oldText) throw new ContentError("PATCH_RANGE_MISMATCH", "改写范围与所选原文不一致，请重新选择范围", 422)
    replacement = result.replacement
    finishReason = result.finishReason
  }
  // 短词选区不能悄悄塞入整段。语义好坏另由作者/候选评审判断。
  if (replacement === oldText) throw new ContentError("PATCH_UNCHANGED", "此次没有产生可提交的修改，请调整意见或选择整段范围", 422)
  if (oldText.length < 32 && (replacement.length > Math.max(32, oldText.length * 3) || (!oldText.includes("\n") && replacement.includes("\n")))) throw new ContentError("PATCH_RANGE_TOO_SMALL", "改写超出了当前短句范围，请选择整段后重新应用", 422)
  if (replacement.length > 200000) throw new ContentError("CONTENT_TOO_LONG", "改写文本过长", 422)
  const latest = await ownedComment(prisma, input)
  assertTextBaseline(latest.state, input.baseline)
  assertComment(latest.comment, input.commentUpdatedAt, comment.status)
  const next = state.text.slice(0, start) + replacement + state.text.slice(end)
  const check = checkGeneratedContent({ previousContent: state.text, content: next, finishReason })
  if (scope.targetType === "CHAPTER_CONTENT" && check.status !== "ready") {
    await createContentCandidate({ userId: scope.userId, novelId: scope.novelId, chapterId: scope.targetId, expectedVersion: state.version!, previousContent: state.text, operationId: `${input.operationId}:candidate`, source: "评论改写（待检查，未改变评论状态）", content: next, finishReason })
    throw new ContentError("CANDIDATE_REQUIRED", "改写需要检查，候选稿已保留。请打开正文的「候选稿」查看。", 409)
  }
  if (scope.targetType !== "CHAPTER_CONTENT" && !["stop", "tool-calls"].includes(finishReason ?? "")) throw new ContentError("GENERATION_INCOMPLETE", "改写输出尚未确认完成，原文与评论状态均保留", 409)
  const data = { ...scope, commentId: comment.id, operationId: input.operationId, requestHash: hash, baseVersion: state.version, baseUpdatedAt: new Date(state.updatedAt), baseHash: state.hash, oldText, start, end, replacement, reply: input.reply?.trim() || "已按这条意见修改所选原文。", commentUpdatedAt: comment.updatedAt, commentStatus: comment.status, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
  try { return await prisma.preparedTextChange.create({ data }) }
  catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      const replay = await prisma.preparedTextChange.findUniqueOrThrow({ where: { userId_operationId: { userId: input.userId, operationId: input.operationId } } })
      if (replay.requestHash !== hash) throw new ContentError("OPERATION_CONFLICT", "准备操作编号已用于不同内容")
      return replay
    }
    throw error
  }
}

/** 重放先查回执；取消/拒绝/新稿均不能让旧补丁落下。事务中不调用模型。 */
export async function commitCommentChange(input: CommitCommentInput) {
  if (!input.operationId || input.operationId.length > 160) throw new ContentError("PRECONDITION_REQUIRED", "缺少有效提交编号", 428)
  const receipt = await prisma.$transaction(async tx => {
    const { comment: target, scope } = await ownedComment(tx, input)
    if (target.targetType === "CANDIDATE_CONTENT") throw new ContentError("TARGET_READONLY", "候选稿为只读稿，不能应用改写", 422)
    if (scope.targetType === "SCENE") await lockSceneTree(tx, scope.novelId)
    await lockContentOperation(tx, input.userId, input.operationId)
    const hash = requestHash(input)
    const prior = await findTextReceipt(tx, scope, input.operationId, hash)
    if (prior) return prior as CommentTextReceipt
    await lockTextTarget(tx, scope)
    await tx.$queryRaw`SELECT id FROM "TextComment" WHERE id = ${input.commentId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM "PreparedTextChange" WHERE id = ${input.preparedId} FOR UPDATE`
    const patch = await tx.preparedTextChange.findFirst({ where: { id: input.preparedId, userId: input.userId, novelId: input.novelId, commentId: input.commentId, targetId: scope.targetId, targetType: scope.targetType } })
    if (!patch) throw new ContentError("PATCH_NOT_FOUND", "改写补丁不存在或无权访问", 404)
    assertPrepared(patch, input.baseline)
    const { state, comment } = await ownedComment(tx, input)
    assertTextBaseline(state, input.baseline)
    assertComment(comment, patch.commentUpdatedAt.toISOString(), patch.commentStatus)
    assertApplicable(comment)
    if (state.text.slice(patch.start, patch.end) !== patch.oldText) throw new ContentError("PATCH_RANGE_MISMATCH", "所选范围已有修改", 409)
    const text = state.text.slice(0, patch.start) + patch.replacement + state.text.slice(patch.end)
    let replyId = ""
    const saved = await commitTargetTextInTransaction(tx, { ...scope, operationId: input.operationId, baseline: input.baseline, text, source: "comment", reason: `评论应用:${patch.id}` }, async tx => {
      await tx.textComment.update({ where: { id: comment.id }, data: { status: "APPLIED" } })
      const reply = await tx.textComment.create({ data: { novelId: scope.novelId, targetType: scope.targetType, targetId: scope.targetId, parentId: comment.id, authorType: "AI", authorName: "AI 评审员", content: patch.reply } })
      replyId = reply.id
      await tx.preparedTextChange.update({ where: { id: patch.id }, data: { status: "consumed", consumedOperationId: input.operationId } })
    })
    const result: CommentTextReceipt = { ...saved, commentId: comment.id, commentStatus: "APPLIED", replyId }
    await tx.contentMutation.update({ where: { userId_operationId: { userId: input.userId, operationId: input.operationId } }, data: { requestHash: hash, result: result as unknown as Prisma.InputJsonValue } })
    return result
  }, { timeout: 15000 })
  const { scope } = await ownedComment(prisma, input)
  return { receipt, text: await committedTargetText(scope, receipt), committed: true as const }
}

export interface HandleCommentInput extends CommentScope {
  action: "MODIFY" | "AGREE" | "REJECT"; operationId: string; commentUpdatedAt: string
  baseline?: TextBaseline; replacement?: string; reply: string; committedOperationId?: string
}

/** 对话调用也使用同一准备/提交实现；无锚点只接受已提交且仍为当前稿的真实回执。 */
export async function handleCommentChange(input: HandleCommentInput) {
  if (!input.operationId || input.operationId.length > 140) throw new ContentError("PRECONDITION_REQUIRED", "缺少有效处理编号", 428)
  if (!input.reply.trim()) throw new ContentError("REPLY_REQUIRED", "请说明处理理由", 400)
  const { comment } = await ownedComment(prisma, input)
  if (input.action === "MODIFY" && comment.quote) {
    if (input.replacement === undefined || !input.baseline) throw new ContentError("PRECONDITION_REQUIRED", "改写需要原文基线与 replacement", 428)
    const patch = await prepareCommentChange({ ...input, operationId: `${input.operationId}:prepare`, baseline: input.baseline })
    const result = await commitCommentChange({ ...input, preparedId: patch.id, baseline: input.baseline })
    return { modified: true, ...result }
  }
  return prisma.$transaction(async tx => {
    const { scope } = await ownedComment(tx, input)
    if (scope.targetType === "SCENE") await lockSceneTree(tx, scope.novelId)
    await lockContentOperation(tx, input.userId, input.operationId)
    const hash = requestHash(input)
    const key = { userId_operationId: { userId: input.userId, operationId: input.operationId } }
    const prior = await tx.contentMutation.findUnique({ where: key })
    if (prior) {
      if (prior.requestHash !== hash) throw new ContentError("OPERATION_CONFLICT", "操作编号已用于不同处理")
      return prior.result as { modified: boolean; replyId: string; operationId: string }
    }
    await lockTextTarget(tx, scope)
    await tx.$queryRaw`SELECT id FROM "TextComment" WHERE id = ${input.commentId} FOR UPDATE`
    const { state, comment } = await ownedComment(tx, input)
    assertComment(comment, input.commentUpdatedAt)
    if (comment.status === "REJECTED" || comment.status === "APPLIED") throw new ContentError("COMMENT_CONFLICT", "评论已处理，请重新读取")
    if (input.action === "MODIFY") {
      const proof = input.committedOperationId ? await tx.contentMutation.findUnique({ where: { userId_operationId: { userId: input.userId, operationId: input.committedOperationId } } }) : null
      if (!proof || proof.novelId !== scope.novelId || proof.targetId !== scope.targetId || proof.targetType !== scope.targetType || proof.beforeHash === proof.afterHash || proof.afterHash !== state.hash || proof.createdAt < comment.updatedAt) throw new ContentError("COMMIT_PROOF_REQUIRED", "整体意见尚未关联当前稿的已提交改写，请先完成改写再标记已修改", 409)
    }
    const status = input.action === "MODIFY" ? "APPLIED" : input.action === "AGREE" ? "AGREED" : "REJECTED"
    await tx.textComment.update({ where: { id: comment.id }, data: { status } })
    const reply = await tx.textComment.create({ data: { novelId: scope.novelId, targetType: scope.targetType, targetId: scope.targetId, parentId: comment.id, authorType: "AI", authorName: "AI 评审员", content: input.reply.trim() } })
    const result = { modified: input.action === "MODIFY", replyId: reply.id, operationId: input.operationId }
    await tx.contentMutation.create({ data: { userId: scope.userId, novelId: scope.novelId, targetType: "COMMENT", targetId: comment.id, operationId: input.operationId, requestHash: hash, beforeHash: state.hash, afterHash: state.hash, result } })
    return result
  }, { timeout: 15000 })
}

export { contentHash }
