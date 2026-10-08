import { abortLocalAttempt, isLocalAttemptRunning } from "@/lib/local-chat-cancellation"
import { randomUUID } from "node:crypto"
import { Prisma, type ChatAttempt, type ChatTurn, type Conversation } from "@/generated/prisma/client"
import { controlPrisma as db } from "@/lib/db"
import { assertChatExecution, CHAT_TRANSACTION_OPTIONS, reacquireChatLease, retryChatControlTransaction, type ChatExecutionScope } from "@/lib/chat-execution"
import { CHAT_LEASE_MS, RECLAIM_GRACE_MS, chatRequestSchema, type ChatInteraction } from "@/lib/chat-protocol"
import { planProposalSchema } from "@/lib/chat-parts"
import { createPlanInTransaction } from "@/lib/sop/plan"
import { validateChatAction } from "./chat-action"
import { ContentError } from "@/lib/content-errors"
import { ERROR_TEXT } from "@/lib/ai/error-classification"
import { requestHash, lockContentOperation } from "./content-commit"
import { stripMentionPayloads } from "@/lib/mention-token"
import { workflowApprovalSchema, isStoryApprovalAnswer } from "@/lib/story-workflow"
import { consumeStoryTask, navigationContextHash, refreshStoryNavigation } from "./story-task"
import { readStoryArtifacts } from "./story-artifacts"
import { approveStoryVersion } from "./story-workflow"
import { acceptStoryContentApproval } from "./story-content-approval"
import { selectedStoryChoice, storyTaskNavigationSchema } from "@/lib/story-task"
import { bindPlanningAdjustment, misplacedPlanningAdjustment, planningAdjustmentOf, planningAdjustmentRecoveryRequestAllowed, planningAdjustmentSchema, questionAnswer, type PlanningAdjustment } from "@/lib/planning-adjustment"
import { legacyTaskDefaults, overrideTaskDefaults, restoreTaskDefaults } from "@desktop/shared/task-defaults"
import { taskDefaults } from "@desktop/service/task-defaults"

type Tx = Prisma.TransactionClient
export class ChatProtocolError extends ContentError {
  constructor(code: string, message: string, status = 409, public turnId?: string) { super(code, message, status) }
}
/** 内部标记：消费导航回答时面板内容已过期（consumeStoryTask 的 VERSION_CONFLICT/INTERACTION_STALE）；供事务回滚后在请求级自愈识别，不外泄。 */
class NavigationContentStaleError extends Error {
  constructor(readonly reason: ContentError) { super(reason.message) }
}
export function scopeFor(conversation: Conversation, turn: ChatTurn, attempt: ChatAttempt): ChatExecutionScope {
  return { userId: turn.userId, conversationId: conversation.id, turnId: turn.id, attemptId: attempt.id, epoch: attempt.executionEpoch,
    taskDefaults: restoreTaskDefaults(turn.defaultsSnapshot) ?? legacyTaskDefaults(conversation.modelId, conversation.thinkingEffort) }
}
async function lockConversation(tx: Tx, id: string, userId: string) {
  await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`
  const conversation = await tx.conversation.findFirst({ where: { id, userId } })
  if (!conversation) throw new ChatProtocolError("CONVERSATION_NOT_FOUND", "会话不存在或无权访问", 404)
  return conversation
}
async function markRevoked(tx: Tx, attemptId: string, code: string, message: string, now: Date) {
  const attempt = await tx.chatAttempt.findUnique({ where: { id: attemptId } })
  if (attempt && ["queued", "running"].includes(attempt.status)) {
    await tx.chatAttempt.update({ where: { id: attempt.id }, data: { status: "interrupted", endedAt: now, errorCode: code, errorMessage: message } })
    await tx.chatTurn.update({ where: { id: attempt.turnId }, data: { status: "interrupted" } })
    await tx.chatToolExecution.updateMany({ where: { attemptId: attempt.id, status: "started" }, data: { status: "unknown" } })
    await tx.subAgentRun.updateMany({ where: { attemptId: attempt.id, status: "running" }, data: { status: "error", errorMessage: message } })
    // 保留检查点正文，仅追加准确终态。
    const previous = await tx.message.findUnique({ where: { id: attempt.assistantMessageId } })
    const parts = Array.isArray(previous?.parts) ? previous.parts : []
    await tx.message.updateMany({ where: { id: attempt.assistantMessageId }, data: { parts: [...parts, { type: "status", id: `${attempt.id}:terminal`, seq: attempt.lastEventSeq + 1, status: "interrupted", errorCode: code, error: message, endedAt: now.toISOString() }] as Prisma.InputJsonValue } })
  }
}

async function revoke(tx: Tx, conversation: Conversation, code: string, message: string) {
  const now = new Date()
  if (conversation.activeAttemptId) await markRevoked(tx, conversation.activeAttemptId, code, message, now)
  return tx.conversation.update({ where: { id: conversation.id }, data: { activeAttemptId: null, executionEpoch: { increment: 1 }, leaseExpiresAt: null, cancelRequestedAt: now } })
}

/** 租约回收专用：条件写复查「租约仍过期」才撤销，与执行方宽限内重新获租竞争时恰好一侧生效。 */
async function revokeExpiredLease(tx: Tx, conversation: Conversation, code: string, message: string) {
  // 同机执行器仍在等待模型/处理工具时，轮询先帮助它续租，不能因心跳延迟将它撤销。
  // 使用同一行锁和 epoch 条件；已取消、已替换或已结束的执行器不会重新取得执行权。
  if (conversation.activeAttemptId && isLocalAttemptRunning(conversation.activeAttemptId)) {
    const attempt = await tx.chatAttempt.findUnique({ where: { id: conversation.activeAttemptId } })
    if (attempt && await reacquireChatLease(tx, {
      userId: conversation.userId, conversationId: conversation.id, turnId: attempt.turnId,
      attemptId: attempt.id, epoch: attempt.executionEpoch,
    })) return false
  }
  const now = new Date()
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Conversation" SET "activeAttemptId" = NULL, "executionEpoch" = "executionEpoch" + 1, "leaseExpiresAt" = NULL, "cancelRequestedAt" = ${now}
    WHERE "id" = ${conversation.id} AND "activeAttemptId" IS NOT NULL
      AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${new Date(now.getTime() - RECLAIM_GRACE_MS)})
    RETURNING "id"`
  // 0 行 = 并发重新获租已生效，放弃回收；1 行 = 回收成立，活跃尝试取自同事务行锁下的先前读。
  if (rows.length !== 1 || !conversation.activeAttemptId) return false
  await markRevoked(tx, conversation.activeAttemptId, code, message, now)
  return true
}

async function requestBinding(tx: Tx, request: { turnId: string; entryAttemptId: string }) {
  const turn = await tx.chatTurn.findUniqueOrThrow({ where: { id: request.turnId } })
  const entry = await tx.chatAttempt.findUniqueOrThrow({ where: { id: request.entryAttemptId } })
  const attempt = entry.requestId ? await tx.chatAttempt.findFirstOrThrow({ where: { turnId: turn.id, requestId: entry.requestId }, orderBy: { attemptNo: "desc" } }) : entry
  const conversation = await tx.conversation.findUniqueOrThrow({ where: { id: turn.conversationId } })
  return { replay: true as const, turn, attempt, conversation }
}

/** Real proposal receipt + owned, current, unapplied candidate. Never accept a client-provided context. */
async function bindStoredPlanningAdjustment(tx: Tx, origin: ChatTurn, novelId: string, answer: string) {
  const calls = await tx.chatToolExecution.findMany({ where: { turnId: origin.id, status: "succeeded" }, orderBy: { createdAt: "asc" }, select: { toolName: true, status: true, input: true, output: true } })
  const proposed = calls.filter(call => call.toolName === "proposeNovelPlanning").at(-1)
  const proposalId = (proposed?.output as { result?: { id?: unknown } } | null)?.result?.id
  if (typeof proposalId !== "string") return null
  const row = await tx.contentVersion.findFirst({ where: { id: proposalId, targetType: "PlanningProposal", targetId: novelId } })
  const snapshot = row?.snapshot as { expectedVersion?: unknown; operationId?: unknown; operations?: unknown } | undefined
  if (!row || typeof snapshot?.expectedVersion !== "number" || typeof snapshot.operationId !== "string" || !Array.isArray(snapshot.operations)) return null
  if (await tx.contentMutation.findFirst({ where: { userId: origin.userId, novelId, targetType: "Planning", operationId: snapshot.operationId }, select: { id: true } })) return null
  const current = await tx.planningDocument.findUnique({ where: { novelId }, select: { version: true } })
  return bindPlanningAdjustment({ origin, answer, calls, proposal: { id: row.id, expectedVersion: snapshot.expectedVersion, operations: snapshot.operations }, currentVersion: current?.version ?? 0 })
}
async function validateStoredPlanningAdjustment(tx: Tx, context: PlanningAdjustment, userId: string, conversationId: string, novelId: string) {
  const origin = await tx.chatTurn.findFirst({ where: { id: context.originTurnId, userId, conversationId } })
  const interaction = origin?.interaction as unknown as ChatInteraction | null
  if (!origin || interaction?.id !== context.originInteractionId || interaction.state !== "answered" || !interaction.responseMessageId) return null
  const answer = await tx.message.findFirst({ where: { id: interaction.responseMessageId, conversationId, role: "USER" }, select: { content: true } })
  const actual = answer ? await bindStoredPlanningAdjustment(tx, origin, novelId, answer.content) : null
  return actual && actual.proposalId === context.proposalId && actual.expectedVersion === context.expectedVersion
    && JSON.stringify(actual.focusKeys) === JSON.stringify(context.focusKeys) ? { ...actual, phase: context.phase, answer: context.answer } : null
}
async function recoverablePlanningAdjustment(tx: Tx, turn: ChatTurn, novelId: string | null) {
  if (!novelId || turn.status !== "waiting_user" || turn.action) return null
  const calls = await tx.chatToolExecution.findMany({ where: { turnId: turn.id }, select: { id: true } })
  if (calls.length) return null
  const origin = await tx.chatTurn.findFirst({ where: { userId: turn.userId, conversationId: turn.conversationId, interaction: { path: ["responseTurnId"], equals: turn.id } } })
  const originalInteraction = origin?.interaction as unknown as ChatInteraction | null
  if (originalInteraction?.state !== "answered" || originalInteraction.responseTurnId !== turn.id || originalInteraction.responseMessageId !== turn.userMessageId) return null
  const answer = await tx.message.findUnique({ where: { id: turn.userMessageId }, select: { content: true } })
  const context = origin && answer ? await bindStoredPlanningAdjustment(tx, origin, novelId, answer.content) : null
  return misplacedPlanningAdjustment({ ...turn, calls }, context) ? context : null
}

/** 请求 key 先去重；会话锁下分配唯一 USER/attempt/epoch，所有记录同事务。 */
export async function beginChatRequest(userId: string, raw: unknown) {
  if (!raw || typeof raw !== "object" || !("clientRequestId" in raw)) throw new ChatProtocolError("PRECONDITION_REQUIRED", "缺少对话请求编号，草稿已保留，请刷新后重试", 428)
  const parsed = chatRequestSchema.safeParse(raw)
  if (!parsed.success) throw new ChatProtocolError("INVALID_REQUEST", parsed.error.issues[0]?.message ?? "参数不合法", 400)
  const input = parsed.data
  const { clientRequestId, ...payload } = input
  const hash = requestHash(payload)
  const explicitMode = "mode" in raw && raw.mode !== undefined ? input.mode : undefined
  // Read the committed, keyless settings before acquiring a DB transaction.
  // Existing conversations never consult today's global defaults here.
  const initialDefaults = !input.conversationId ? overrideTaskDefaults(await taskDefaults(), { modelId: input.modelId, thinkingEffort: input.thinkingEffort, mode: explicitMode }) : undefined
  // 导航面板过期预检（2026-09-25 作者实测死循环）：回答 storyNavigation 面板且面板内容与当前图谱不一致时，
  // 先把面板刷新到当前版本（独立事务），主事务内消费即可一击命中稳定选项 ID；刷新失败按原规则由主事务严格校验。
  if (input.interaction?.action === "answer" && input.interaction.turnId) {
    const interactionTurn = await db.chatTurn.findFirst({ where: { id: input.interaction.turnId, userId } })
    const stored = interactionTurn?.interaction as unknown as ChatInteraction | null
    const navigation = stored?.kind === "question" ? (stored.payload as { storyNavigation?: { contextHash?: string } } | null)?.storyNavigation : null
    if (navigation && stored?.state === "pending" && interactionTurn?.status === "waiting_user") {
      const conversation = await db.conversation.findFirst({ where: { id: interactionTurn.conversationId, userId } })
      if (conversation?.novelId) {
        const scope = { userId, novelId: conversation.novelId }
        if (navigation.contextHash !== navigationContextHash(await readStoryArtifacts(scope))) {
          let refreshed: Awaited<ReturnType<typeof refreshStoryNavigation>> | undefined
          try { refreshed = await refreshStoryNavigation(userId, interactionTurn.id, stored.id, stored.revision) } catch { /* 刷新失败按原规则：主事务内严格校验 */ }
          // 历史客户端按标签回答：刷新后已消失的选项不能降级成普通自由回答而绕过任务守卫。
          const original = storyTaskNavigationSchema.safeParse(navigation)
          if (refreshed && !input.storySelection && original.success && selectedStoryChoice(original.data, input.message ?? "") && !selectedStoryChoice(refreshed.payload.storyNavigation, input.message ?? "")) {
            throw new ContentError("VERSION_CONFLICT", "当前评审或内容已变化，请查看更新后的选项", 409)
          }
        }
      }
    }
  }
  return db.$transaction(async tx => {
    await lockContentOperation(tx, userId, `chat-request:${clientRequestId}`)
    const previous = await tx.chatRequest.findUnique({ where: { userId_clientRequestId: { userId, clientRequestId } } })
    if (previous) {
      if (previous.requestHash !== hash) throw new ChatProtocolError("REQUEST_CONFLICT", "此请求编号已经用于不同消息")
      return requestBinding(tx, previous)
    }
    let retryTurn: ChatTurn | null = null
    if (input.retryOfTurnId) {
      retryTurn = await tx.chatTurn.findFirst({ where: { id: input.retryOfTurnId, userId } })
      if (!retryTurn || input.conversationId !== retryTurn.conversationId) throw new ChatProtocolError("TURN_NOT_FOUND", "回合不存在或无权访问", 404)
    }
    let conversation: Conversation
    if (input.conversationId) conversation = await lockConversation(tx, input.conversationId, userId)
    else {
      if (input.novelId && !await tx.novel.findFirst({ where: { id: input.novelId, userId, status: { not: "DELETED" } }, select: { id: true } })) throw new ChatProtocolError("NOVEL_NOT_FOUND", "作品不存在或无权访问", 404)
      conversation = await tx.conversation.create({ data: { userId, novelId: input.novelId ?? null, title: stripMentionPayloads(input.message!).slice(0, 50), modelId: initialDefaults!.textModelId,
        thinkingEffort: initialDefaults!.thinking === "default" ? null : initialDefaults!.thinking, defaultsSnapshot: initialDefaults! } })
    }
    const latest = await tx.chatTurn.findFirst({ where: { conversationId: conversation.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })
    if (retryTurn) retryTurn = await tx.chatTurn.findUniqueOrThrow({ where: { id: retryTurn.id } })
    const conversationDefaults = overrideTaskDefaults(restoreTaskDefaults(conversation.defaultsSnapshot) ?? legacyTaskDefaults(conversation.modelId, conversation.thinkingEffort), { modelId: conversation.modelId, thinkingEffort: conversation.thinkingEffort, mode: restoreTaskDefaults(latest?.defaultsSnapshot)?.mode })
    const turnDefaults = retryTurn ? restoreTaskDefaults(retryTurn.defaultsSnapshot) ?? legacyTaskDefaults(conversation.modelId, conversation.thinkingEffort)
      : overrideTaskDefaults(conversationDefaults, { modelId: input.modelId, thinkingEffort: input.thinkingEffort, mode: explicitMode })
    input.mode = turnDefaults.mode
    const restoredAdjustment = retryTurn && latest?.id === retryTurn.id ? await recoverablePlanningAdjustment(tx, retryTurn, conversation.novelId) : null
    if (restoredAdjustment && !planningAdjustmentRecoveryRequestAllowed(input)) throw new ChatProtocolError("RETRY_NOT_ALLOWED", "提案调整恢复只能重试原回答，不能同时提交另一问题或操作", 409, retryTurn!.id)
    if (retryTurn && (latest?.id !== retryTurn.id || !["failed", "interrupted"].includes(retryTurn.status) && !restoredAdjustment)) throw new ChatProtocolError("RETRY_NOT_ALLOWED", "只能恢复此会话最新的失败回合或失焦的提案澄清", 409, retryTurn.id)
    const retryAdjustment = planningAdjustmentOf(retryTurn?.action)
    if (retryAdjustment && (!conversation.novelId || !await validateStoredPlanningAdjustment(tx, retryAdjustment, userId, conversation.id, conversation.novelId))) throw new ChatProtocolError("INTERACTION_STALE", "原提案或调整范围已变化，请重新核对", 409, retryTurn!.id)
    if (retryTurn) {
      const tools = await tx.chatToolExecution.findMany({ where: { turnId: retryTurn.id }, include: { effects: true } })
      if (tools.some(t => t.hasExternalEffects && ["started", "unknown"].includes(t.status))) throw new ChatProtocolError("EFFECTS_UNCONFIRMED", "外部操作结果仍待核对，不能自动重新执行", 409, retryTurn.id)
      if (tools.some(t => t.effects.length > 0) && !input.resume) throw new ChatProtocolError("RECONCILIATION_REQUIRED", "已有改动，请先核对并选择继续未完成步骤", 409, retryTurn.id)
    }
    let interactionTurn: ChatTurn | null = null
    let interaction: ChatInteraction | null = null
    if (input.interaction) {
      interactionTurn = await tx.chatTurn.findFirst({ where: { id: input.interaction.turnId, userId, conversationId: conversation.id } })
      interaction = interactionTurn?.interaction as unknown as ChatInteraction | null
      // storyNavigation 回答豁免客户端 revision（预检已保证面板内容新鲜，且选项 ID 稳定可安全映射）；
      // 认可卡/候选采用/计划批准等其他交互维持严格 revision 校验
      const storyNavAnswer = input.interaction.action === "answer" && !!((interaction?.payload as { storyNavigation?: unknown } | null)?.storyNavigation)
      if (!interaction || interaction.id !== input.interaction.id || (!storyNavAnswer && interaction.revision !== input.interaction.revision)) throw new ChatProtocolError("INTERACTION_STALE", "问题或计划已变化，请重新读取")
      if ((interaction.kind === "question") !== (input.interaction.action === "answer")) throw new ChatProtocolError("INTERACTION_ACTION_INVALID", "交互动作不匹配")
      if (interaction.state !== "pending") {
        if (interaction.responseHash !== hash || !interaction.responseTurnId) throw new ChatProtocolError("INTERACTION_CONSUMED", "此问题已经处理，不能重复提交不同回答")
        const response = await tx.chatTurn.findUniqueOrThrow({ where: { id: interaction.responseTurnId } })
        const alias = await tx.chatRequest.create({ data: { userId, clientRequestId, requestHash: hash, turnId: response.id, entryAttemptId: response.latestAttemptId! } })
        return requestBinding(tx, alias)
      }
      if (interactionTurn?.status !== "waiting_user" || latest?.id !== interactionTurn.id) throw new ChatProtocolError("INTERACTION_STALE", "此问题不再是当前等待的交互")
    } else if (!retryTurn && latest?.status === "waiting_user" && (latest.interaction as unknown as ChatInteraction | null)?.state === "pending") {
      throw new ChatProtocolError("QUESTION_PENDING", "请先回答或跳过当前问题", 409, latest.id)
    }
    if (conversation.activeAttemptId) {
      const active = await tx.chatAttempt.findUniqueOrThrow({ where: { id: conversation.activeAttemptId } })
      throw new ChatProtocolError("CONVERSATION_BUSY", "此会话已有执行记录，请先核对当前状态", 409, active.turnId)
    }
    await validateChatAction(tx, input.action, conversation.novelId)
    if (interaction?.kind === "planApproval") {
      if (input.mode !== "standard" || !conversation.novelId) throw new ChatProtocolError("PLAN_APPROVAL_INVALID", "请关联作品后批准并进入标准模式", 400)
      const proposal = planProposalSchema.parse(interaction.payload)
      const plan = await createPlanInTransaction(tx, { ...proposal, conversationId: conversation.id, novelId: conversation.novelId, defaultsSnapshot: turnDefaults })
      interaction = { ...interaction, payload: { ...proposal, planId: plan.id } }
    }
    const userMessageId = retryTurn?.userMessageId ?? randomUUID()
    if (input.storySelection && (interaction?.kind !== "question" || !(interaction.payload as { storyNavigation?: unknown })?.storyNavigation || input.mode === "plan")) throw new ChatProtocolError("STORY_CHOICE_INVALID", "请先打开当前作品的任务选择", 400)
    let confirmedAction = input.action
    // 三阶段保存：暂存批次落 turn.action，重试/恢复可复原（retryOfTurnId 时沿用原 turn.action）
    if (!retryTurn && input.stagedChanges?.length) confirmedAction = { kind: "stagedSave", batches: input.stagedChanges } as Prisma.InputJsonValue as typeof confirmedAction
    if (interaction?.kind === "question" && conversation.novelId && input.mode !== "plan") {
      const navigation = (interaction.payload as { storyNavigation?: unknown })?.storyNavigation
      if (navigation) {
        try {
          confirmedAction = await consumeStoryTask({ userId, novelId: conversation.novelId }, navigation, input.message ?? "", userMessageId, tx, input.storySelection) ?? confirmedAction
        } catch (error) {
          // 面板选项内容过期（图谱哈希已变）：标记后由请求级自愈刷新面板；本事务照章回滚
          if (error instanceof ContentError && (error.code === "VERSION_CONFLICT" || error.code === "INTERACTION_STALE")) throw new NavigationContentStaleError(error)
          throw error
        }
      }
      else {
        const carried = planningAdjustmentSchema.safeParse((interaction.payload as { planningAdjustment?: unknown })?.planningAdjustment)
        if (carried.success) {
          const verified = await validateStoredPlanningAdjustment(tx, carried.data, userId, conversation.id, conversation.novelId)
          const answer = questionAnswer(interaction.payload, input.message ?? "")
          if (!verified || !answer) throw new ChatProtocolError("INTERACTION_STALE", "原提案或调整范围已变化，请重新核对")
          confirmedAction = { kind: "question", planningAdjustment: { ...verified, phase: "refine", answer } }
        } else if (interactionTurn) {
          const adjustment = await bindStoredPlanningAdjustment(tx, interactionTurn, conversation.novelId, input.message ?? "")
          if (adjustment) confirmedAction = { kind: "question", planningAdjustment: adjustment }
        }
      }
    }
    if (restoredAdjustment && retryTurn) {
      const previousInteraction = retryTurn.interaction as unknown as ChatInteraction
      retryTurn = await tx.chatTurn.update({ where: { id: retryTurn.id }, data: { action: { kind: "question", planningAdjustment: restoredAdjustment } as Prisma.InputJsonValue,
        interaction: { ...previousInteraction, state: "skipped" } as Prisma.InputJsonValue } })
    }
    if (interaction?.kind === "question" && conversation.novelId && isStoryApprovalAnswer(input.message ?? "")) {
      const payload = interaction.payload as { storyApproval?: unknown; contentApproval?: unknown } | null
      if (payload?.storyApproval) await approveStoryVersion({ userId, novelId: conversation.novelId }, workflowApprovalSchema.parse(payload.storyApproval), userMessageId, tx)
      if (payload?.contentApproval) confirmedAction = await acceptStoryContentApproval(userId, conversation.novelId, payload.contentApproval, userMessageId, tx) ?? confirmedAction
    }
    const turn = retryTurn ?? await tx.chatTurn.create({ data: { userId, conversationId: conversation.id, clientRequestId, userMessageId, status: "queued", defaultsSnapshot: turnDefaults, ...(confirmedAction ? { action: confirmedAction } : {}) } })
    if (!retryTurn) await tx.message.create({ data: { id: userMessageId, conversationId: conversation.id, turnId: turn.id, role: "USER", content: input.message! } })
    const attemptId = randomUUID()
    const request = await tx.chatRequest.create({ data: { userId, clientRequestId, requestHash: hash, turnId: turn.id, entryAttemptId: attemptId } })
    const last = await tx.chatAttempt.findFirst({ where: { turnId: turn.id }, orderBy: { attemptNo: "desc" } })
    const epoch = conversation.executionEpoch + 1
    const attempt = await tx.chatAttempt.create({ data: { id: attemptId, turnId: turn.id, requestId: request.id, attemptNo: (last?.attemptNo ?? 0) + 1, assistantMessageId: randomUUID(), executionEpoch: epoch, status: "queued" } })
    await tx.message.create({ data: { id: attempt.assistantMessageId, conversationId: conversation.id, turnId: turn.id, attemptId: attempt.id, role: "ASSISTANT", content: "", parts: [{ id: `${attempt.id}:start`, seq: 0, type: "status", status: "queued", startedAt: attempt.createdAt.toISOString() }] } })
    if (interactionTurn && interaction) await tx.chatTurn.update({ where: { id: interactionTurn.id }, data: { status: "succeeded", interaction: { ...interaction, state: input.interaction!.action === "approve" ? "approved" : "answered", responseTurnId: turn.id, responseMessageId: userMessageId, responseHash: hash } as Prisma.InputJsonValue } })
    const currentTurn = await tx.chatTurn.update({ where: { id: turn.id }, data: { status: "queued", latestAttemptId: attempt.id } })
    conversation = await tx.conversation.update({ where: { id: conversation.id }, data: { activeAttemptId: attempt.id, executionEpoch: epoch, leaseExpiresAt: new Date(Date.now() + CHAT_LEASE_MS), cancelRequestedAt: null,
      ...(!retryTurn && input.modelId !== undefined ? { modelId: input.modelId } : {}), ...(!retryTurn && input.thinkingEffort !== undefined ? { thinkingEffort: input.thinkingEffort } : {}) } })
    return { replay: false as const, turn: currentTurn, attempt, conversation }
    // 回合建立事务含 consumeStoryTask 的全量产物图读取：48 章规模下把上限放宽到 30s，慢读不应让面板消费 500。
  }, { ...CHAT_TRANSACTION_OPTIONS, timeout: 30_000 }).catch(async (error: unknown) => {
    // 导航面板内容过期的请求级自愈：消费事务已回滚，换独立事务把该面板刷新到当前版本（revision+1），
    // 引导作者重新选择；刷新不了（已回答/会话占用等）保留原错误。
    if (error instanceof NavigationContentStaleError && input.interaction) {
      try {
        await refreshStoryNavigation(userId, input.interaction.turnId, input.interaction.id, input.interaction.revision)
        throw new ContentError("NAVIGATION_REFRESHED", "作品内容刚有变化，该面板的选项已刷新为当前版本，请重新选择。", 409)
      } catch (healError) {
        if (healError instanceof ContentError && healError.code === "NAVIGATION_REFRESHED") throw healError
        throw error.reason
      }
    }
    throw error
  })
}

/** 时长预估样本上限：同作品近期成功回合（W4 进度卡估时；有界简单聚合，无数据缺省） */
export const TURN_DURATION_ESTIMATE_SAMPLES = 50

/** 同作品近期 succeeded attempt 的时长均值（createdAt→endedAt）；无数据返回 null。查询只取最近样本行，走 turn→conversation 关系索引。 */
export async function estimateRecentTurnMs(client: Pick<Prisma.TransactionClient, "chatAttempt">, input: { novelId: string; userId: string }): Promise<number | null> {
  const recent = await client.chatAttempt.findMany({
    where: { status: "succeeded", endedAt: { not: null }, turn: { conversation: { novelId: input.novelId, userId: input.userId } } },
    orderBy: { createdAt: "desc" }, take: TURN_DURATION_ESTIMATE_SAMPLES, select: { createdAt: true, endedAt: true },
  })
  const durations = recent.map(attempt => attempt.endedAt!.getTime() - attempt.createdAt.getTime()).filter(ms => ms >= 0)
  return durations.length ? Math.round(durations.reduce((sum, ms) => sum + ms, 0) / durations.length) : null
}

/** 核对是读取+过期租约回收，不重新调用模型。宽限期内不回收；过宽限先核对本机执行器，再在事务内复查租约才回收。 */
export async function getChatTurn(userId: string, turnId: string) {
  return db.$transaction(async tx => {
    const found = await tx.chatTurn.findFirst({ where: { id: turnId, userId } })
    if (!found) throw new ChatProtocolError("TURN_NOT_FOUND", "回合不存在或无权访问", 404)
    const conversation = await lockConversation(tx, found.conversationId, userId)
    if (conversation.activeAttemptId && (!conversation.leaseExpiresAt || conversation.leaseExpiresAt.getTime() <= Date.now() - RECLAIM_GRACE_MS)) await revokeExpiredLease(tx, conversation, "LEASE_EXPIRED", "执行进程未能续租，部分结果待核对")
    const turn = await tx.chatTurn.findUniqueOrThrow({ where: { id: turnId } })
    const attempts = await tx.chatAttempt.findMany({ where: { turnId }, orderBy: { attemptNo: "asc" }, include: { tools: { include: { effects: true } } } })
    const messages = await tx.message.findMany({ where: { turnId }, orderBy: { createdAt: "asc" } })
    const latestTurn = await tx.chatTurn.findFirst({ where: { conversationId: conversation.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })
    const unknownExternal = attempts.some(a => a.tools.some(t => t.hasExternalEffects && ["started", "unknown"].includes(t.status)))
    const hasEffects = attempts.some(a => a.tools.some(t => t.effects.length > 0))
    const adjustmentRecovery = latestTurn?.id === turn.id && !unknownExternal && !hasEffects ? await recoverablePlanningAdjustment(tx, turn, conversation.novelId) : null
    const estimateMs = conversation.novelId ? await estimateRecentTurnMs(tx, { novelId: conversation.novelId, userId }) : null
    return { turn, attempts, messages, estimateMs, recovery: { latest: latestTurn?.id === turn.id, canRetry: latestTurn?.id === turn.id && (["failed", "interrupted"].includes(turn.status) || !!adjustmentRecovery) && !unknownExternal && !hasEffects,
      ...(adjustmentRecovery ? { reason: "提案调整尚未生成有效澄清题，当前认可题超出原范围；可重试本轮恢复原提案澄清。" } : {}),
      canResume: latestTurn?.id === turn.id && ["failed", "interrupted"].includes(turn.status) && !unknownExternal && hasEffects, unknownExternal, hasEffects } }
  }, CHAT_TRANSACTION_OPTIONS)
}

export async function cancelChatTurn(userId: string, turnId: string) {
  let revoked: string | null = null
  await db.$transaction(async tx => {
    const turn = await tx.chatTurn.findFirst({ where: { id: turnId, userId } })
    if (!turn) throw new ChatProtocolError("TURN_NOT_FOUND", "回合不存在或无权访问", 404)
    const conversation = await lockConversation(tx, turn.conversationId, userId)
    if (conversation.activeAttemptId === turn.latestAttemptId) { await revoke(tx, conversation, "USER_CANCELLED", "作者已停止执行，已提交的改动保留"); revoked = turn.latestAttemptId }
  }, CHAT_TRANSACTION_OPTIONS)
  if (revoked) abortLocalAttempt(revoked)
  return getChatTurn(userId, turnId)
}

export async function heartbeatChatAttempt(scope: ChatExecutionScope, input: { seq: number; stage?: string; progress?: boolean; retryUsed?: number }) {
  return retryChatControlTransaction(() => db.$transaction(async tx => {
    await assertChatExecution(tx, scope)
    const now = new Date()
    await tx.conversation.update({ where: { id: scope.conversationId }, data: { leaseExpiresAt: new Date(now.getTime() + CHAT_LEASE_MS) } })
    await tx.chatAttempt.update({ where: { id: scope.attemptId }, data: { status: "running", lastEventAt: now, ...(input.progress ? { lastProgressAt: now } : {}), ...(input.stage ? { stage: input.stage } : {}), lastEventSeq: input.seq, ...(input.retryUsed !== undefined ? { retryUsed: input.retryUsed } : {}) } })
    await tx.chatTurn.update({ where: { id: scope.turnId }, data: { status: "running" } })
  }, CHAT_TRANSACTION_OPTIONS))
}

export interface ChatCheckpoint {
  content: string
  toolCalls: Prisma.InputJsonValue
  parts: Prisma.InputJsonValue[]
  seq: number
}

/** 检查点即续租：消息落库成功同时推进租约，检查点存活证明可独立保住长回合。 */
export async function checkpointChatAttempt(scope: ChatExecutionScope, snapshot: ChatCheckpoint) {
  return retryChatControlTransaction(() => db.$transaction(async tx => {
    await assertChatExecution(tx, scope)
    const attempt = await tx.chatAttempt.findUniqueOrThrow({ where: { id: scope.attemptId } })
    if (snapshot.seq < attempt.lastEventSeq) return
    await tx.message.update({ where: { id: attempt.assistantMessageId }, data: { content: snapshot.content, toolCalls: snapshot.toolCalls, parts: snapshot.parts } })
    await tx.chatAttempt.update({ where: { id: attempt.id }, data: { lastEventSeq: snapshot.seq } })
    await tx.conversation.update({ where: { id: scope.conversationId }, data: { leaseExpiresAt: new Date(Date.now() + CHAT_LEASE_MS) } })
  }, CHAT_TRANSACTION_OPTIONS))
}

/** 终态与回复同事务；失败记录可以单独保存，但绝不补发成功 finish。 */
export async function finishChatAttempt(scope: ChatExecutionScope, input: {
  status: "succeeded" | "failed" | "interrupted" | "waiting_user"
  snapshot?: ChatCheckpoint
  errorCode?: string
  errorMessage?: string
  diagnosticId?: string
  retryUsed?: number
  interaction?: ChatInteraction
}) {
  return retryChatControlTransaction(() => db.$transaction(async tx => {
    const conversation = await lockConversation(tx, scope.conversationId, scope.userId)
    if (conversation.activeAttemptId !== scope.attemptId || conversation.executionEpoch !== scope.epoch) return false
    // 收尾前主动续租：条件写重新获租（活租约顺延、宽限或本机存活证明）；0 行=已回收/无存活证明且越宽限/已取消，保留回收方终态，不再自行 revoke。
    if (!await reacquireChatLease(tx, scope)) return false
    const attempt = await tx.chatAttempt.findUniqueOrThrow({ where: { id: scope.attemptId } })
    const now = new Date()
    if (input.snapshot) await tx.message.update({ where: { id: attempt.assistantMessageId }, data: {
      content: input.snapshot.content, toolCalls: input.snapshot.toolCalls,
      parts: [...input.snapshot.parts, { type: "status", id: `${attempt.id}:terminal`, seq: input.snapshot.seq + 1, status: input.status, endedAt: now.toISOString(), ...(input.errorCode ? { errorCode: input.errorCode, error: input.errorMessage ?? ERROR_TEXT.terminalFallback } : {}) }],
    } })
    await tx.chatToolExecution.updateMany({ where: { attemptId: attempt.id, status: "started" }, data: { status: "unknown" } })
    await tx.chatAttempt.update({ where: { id: attempt.id }, data: { status: input.status, endedAt: now, errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null, diagnosticId: input.diagnosticId ?? null, retryUsed: input.retryUsed ?? attempt.retryUsed } })
    await tx.chatTurn.update({ where: { id: scope.turnId }, data: { status: input.status, ...(input.interaction ? { interaction: input.interaction as unknown as Prisma.InputJsonValue } : {}) } })
    await tx.conversation.update({ where: { id: conversation.id }, data: { activeAttemptId: null, executionEpoch: { increment: 1 }, leaseExpiresAt: null } })
    return true
  }, CHAT_TRANSACTION_OPTIONS))
}

/** 仅请求内无写工具开始的网络重跑可轮换 attempt；原 USER 和请求映射不变。 */
export async function nextChatAttempt(scope: ChatExecutionScope, retryUsed: number, snapshot: ChatCheckpoint) {
  return db.$transaction(async tx => {
    await assertChatExecution(tx, scope)
    const previous = await tx.chatAttempt.findUniqueOrThrow({ where: { id: scope.attemptId }, include: { tools: true } })
    const { WRITE_TOOL_NAMES } = await import("@/lib/ai/tool-names")
    if (previous.hasWriteEffects || previous.tools.some(tool => WRITE_TOOL_NAMES.has(tool.toolName))) throw new ChatProtocolError("EFFECTS_UNCONFIRMED", "本轮已开始写入，不能整轮重跑")
    await tx.message.update({ where: { id: previous.assistantMessageId }, data: { content: snapshot.content, toolCalls: snapshot.toolCalls, parts: [...snapshot.parts, { type: "status", id: `${previous.id}:terminal`, seq: snapshot.seq + 1, status: "interrupted", errorCode: "NETWORK_RETRY", endedAt: new Date().toISOString() }] } })
    await tx.chatAttempt.update({ where: { id: previous.id }, data: { status: "interrupted", endedAt: new Date(), errorCode: "NETWORK_RETRY", retryUsed } })
    await tx.chatToolExecution.updateMany({ where: { attemptId: previous.id, status: "started" }, data: { status: "unknown" } })
    const attempt = await tx.chatAttempt.create({ data: { turnId: scope.turnId, requestId: previous.requestId, attemptNo: previous.attemptNo + 1, assistantMessageId: randomUUID(), executionEpoch: scope.epoch + 1, retryUsed } })
    await tx.message.create({ data: { id: attempt.assistantMessageId, conversationId: scope.conversationId, turnId: scope.turnId, attemptId: attempt.id, role: "ASSISTANT", content: "", parts: [] } })
    const turn = await tx.chatTurn.update({ where: { id: scope.turnId }, data: { latestAttemptId: attempt.id, status: "queued" } })
    const conversation = await tx.conversation.update({ where: { id: scope.conversationId }, data: { activeAttemptId: attempt.id, executionEpoch: attempt.executionEpoch, leaseExpiresAt: new Date(Date.now() + CHAT_LEASE_MS) } })
    return { turn, attempt, conversation }
  }, CHAT_TRANSACTION_OPTIONS)
}

export async function skipChatInteraction(userId: string, turnId: string, id: string, revision: number) {
  await db.$transaction(async tx => {
    const turn = await tx.chatTurn.findFirst({ where: { id: turnId, userId } })
    if (!turn) throw new ChatProtocolError("TURN_NOT_FOUND", "回合不存在或无权访问", 404)
    await lockConversation(tx, turn.conversationId, userId)
    const current = await tx.chatTurn.findUniqueOrThrow({ where: { id: turnId } })
    const interaction = current.interaction as unknown as ChatInteraction | null
    if (!interaction || interaction.id !== id || interaction.revision !== revision) throw new ChatProtocolError("INTERACTION_STALE", "问题已变化，请重新读取")
    if (interaction.state === "skipped") return
    if (interaction.state !== "pending" || current.status !== "waiting_user") throw new ChatProtocolError("INTERACTION_CONSUMED", "此问题已经处理")
    await tx.chatTurn.update({ where: { id: turnId }, data: { status: "succeeded", interaction: { ...interaction, state: "skipped" } as unknown as Prisma.InputJsonValue } })
  }, CHAT_TRANSACTION_OPTIONS)
  return getChatTurn(userId, turnId)
}
