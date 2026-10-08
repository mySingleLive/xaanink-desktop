import { acquireLongTask, runInsideLongTask } from "@/lib/long-task"
import { getCostConfig } from "@/lib/ai/cost-config"
import { AttemptMeter, saveAttemptObservation } from "@/lib/services/attempt-observation"
import { completedStoryKeys, prepareStoryTask } from "@/lib/services/story-task"
import { isReaskingAnsweredQuestion, requestHash } from "@/lib/services/content-commit"
import { isStepCount, streamText } from "ai"
import { repairToolInput, toolInputIssueHint } from "@/lib/ai/tool-input-repair"
import { AUTO_CONTINUATION_MESSAGE, hasUnexecutedDeclaration, MAX_AUTO_CONTINUATIONS } from "@/lib/ai/soft-stop"
import { NextResponse } from "next/server"
import type { Prisma } from "@/generated/prisma/client"
import { buildChatSystemPrompt, sanitizeModelMessages, toModelMessages, turnFormatReminder, withTurnReminder } from "@/lib/ai/chat"
import { HISTORY_LOAD_LIMIT, calibrationFactor, estimateTokens } from "@/lib/ai/context-budget"
import { loadContextProtection } from "@/lib/ai/context-protection"
import { buildTaskNovelContext } from "@/lib/ai/task-context"
import { assertPromptFits, compactCompletedMessages, estimateToolTokens } from "@/lib/ai/prompt-budget"
import { manageConversationContext } from "@/lib/ai/context-compression"
import { toErrorResponse } from "@/lib/ai/errors"
import { snapshotForRecord } from "@desktop/service/models"
import { chatTerminalError, ERROR_TEXT, isInternalToolErrorCode } from "@/lib/ai/error-classification"
import { createNetworkRetryFetch, getMaxNetworkRetries, networkRetryDelayMs, runWithNetworkRetry } from "@/lib/ai/network-retry"
import { getModelByIdForUser } from "@/lib/ai/provider"
import { buildThinkingProviderOptions } from "@/lib/ai/thinking-effort"
import { WRITE_TOOL_NAMES } from "@/lib/ai/tool-names"
import { createAgentTools } from "@/lib/ai/tools"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { checkQuota, recordUsage } from "@/lib/quota"
import { runInChatExecution, type ChatExecutionScope } from "@/lib/chat-execution"
import { CHAT_HEARTBEAT_MS, CHAT_LEASE_MS, chatRequestSchema, pendingQuestionSchema, type ChatInteraction } from "@/lib/chat-protocol"
import { beginChatRequest, ChatProtocolError, checkpointChatAttempt, estimateRecentTurnMs, finishChatAttempt, getChatTurn, heartbeatChatAttempt, nextChatAttempt, scopeFor, type ChatCheckpoint } from "@/lib/services/chat-turn"
import { bindChatTools, chatContinuationContext } from "@/lib/services/chat-tool-execution"
import { planProposalSchema, stopForInteraction, hasUnresolvedToolFailures, unresolvedToolFailures, hasModelResponseTimeout, hasRepeatedToolFailure, type ChatAction } from "@/lib/chat-parts"
import { actionToolHints, chatActionNote, hasActionReceipt } from "@/lib/services/chat-action"
import { ContentError } from "@/lib/content-errors"
import { registerAttemptAbort } from "@/lib/local-chat-cancellation"
import { nextStoryApproval, nextStoryDecision, storyStepContext, storyToolHints } from "@/lib/services/story-workflow"
import { nextPlanningProposalApproval } from "@/lib/services/planning"
import { drawResultOf } from "@/lib/draw-redraw"
import { STORY_APPROVAL_OPTIONS } from "@/lib/story-workflow"
import { compactCreationTools } from "@/lib/ai/compact-tools"
import { planningAdjustmentOf, planningAdjustmentQuestion, planningAdjustmentToolAllowed } from "@/lib/planning-adjustment"
import {runConversationTask,refreshConversationTask,finishConversationTask} from "@desktop/service/conversation-runtime"

/** SSE 只是跟随通道；数据库中的 turn/attempt/回执才是恢复依据。 */
export async function POST(request: Request) {
  const initialMeter = new AttemptMeter()
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "未登录" }, { status: 401 })
  const userId = session.user.id
  try {
    const raw = await request.json().catch(() => null)
    const databaseStart = performance.now()
    const binding = await beginChatRequest(userId, raw)
    initialMeter.data.databaseMs = performance.now() - databaseStart
    const input = chatRequestSchema.parse(raw)
    if (binding.replay) {
      const state = await getChatTurn(userId, binding.turn.id)
      return NextResponse.json({ ...state, binding: { turnId: binding.turn.id, attemptId: binding.attempt.id, userMessageId: binding.turn.userMessageId, assistantMessageId: binding.attempt.assistantMessageId }, statusUrl: `/api/chat/turns/${binding.turn.id}` },
        { status: ["queued", "running"].includes(state.attempts.find(a => a.id === binding.attempt.id)?.status ?? "") ? 202 : 200 })
    }
    const abort = new AbortController()
    // 执行寿命不绑在 SSE 跟随连接上：客户端断连（含 45s 无事件后的主动核对性断开）只停止推送，
    // 回合继续跑完并落库，前端经 /api/chat/turns/[id] 轮询恢复；取消走 /cancel（cancelRequestedAt + abortLocalAttempt）。
    const signal = abort.signal
    let current = binding
    let scope: ChatExecutionScope = { ...scopeFor(current.conversation, current.turn, current.attempt), signal }
    input.mode = scope.taskDefaults?.mode ?? input.mode
    return await runConversationTask(scope,async()=>{
    let unregisterAbort = registerAttemptAbort(scope.attemptId, abort)
    try{
    const encoder = new TextEncoder()
    let listening = true
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let seq = 0
        let snapshot: ChatCheckpoint = { content: "", toolCalls: [], parts: [], seq: 0 }
        const calls = new Map<string, { toolCallId: string; toolName: string; input: unknown; output: unknown }>()
        let writeStarted = false
        let interaction: ChatInteraction | undefined
        let lastCheckpoint = Date.now()
        let checkpointBytes = 0
        let checkpointSeq = 0
        let progressed = false
        let stage = "queued"
        let meter = initialMeter
        let observedModel: { id: string; provider: string } | undefined
        let autoRoute = false
        let releaseSlot: (() => void) | undefined
        let retryUsed = 0
        let checkpointFailure: unknown
        let checkpointPending: Promise<void> | undefined
        let io: Promise<unknown> = Promise.resolve()
        const toolErrorCodes = new Map<string, string>()
        const serial = <T,>(fn: () => Promise<T>): Promise<T> => { const next = io.then(fn); io = next.catch(() => {}); return next }
        const emit = (event: Record<string, unknown>, progress = true) => {
          seq += 1
          snapshot.seq = seq
          progressed ||= progress
          if (!listening) return
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ...event, turnId: scope.turnId, attemptId: scope.attemptId, seq })}\n\n`)) }
          catch { listening = false }
        }
        const status = (data: Record<string, unknown>) => {
          // 草稿仅供右栏实时预览，不将逐字增长的全文重复写入回合快照。
          if (data.storyDraft) { emit({ type: "data-story-draft", data: data.storyDraft }); return }
          stage = String(data.stage ?? stage)
          emit({ type: data.runId ? "data-subagent-progress" : "data-turn-status", data: { ...data, stage, startedAt: current.attempt.createdAt.toISOString() } })
          snapshot.parts.push({ type: "status", id: `${scope.attemptId}:${seq}`, seq, ...JSON.parse(JSON.stringify(data)), stage })
        }
        emit({ type: "data-conversation", data: { conversationId: current.conversation.id,
          modelId: scope.taskDefaults ? scope.taskDefaults.textModelId : current.conversation.modelId,
          thinkingEffort: scope.taskDefaults ? scope.taskDefaults.thinking === "default" ? null : scope.taskDefaults.thinking : current.conversation.thinkingEffort,
          defaultsSnapshot: scope.taskDefaults } }, false)
        scope.progress = status
        scope.onToolError = (toolCallId, code) => { toolErrorCodes.set(toolCallId, code) }
        // 提交前一次性快照：parts 中只有末尾 text 会原地增长，浅拷贝数组并克隆末段即可，
        // 不再对全量 parts 做 structuredClone（消除流循环检查点对事件循环的阻塞）。
        const savedSnapshot = (): ChatCheckpoint => {
          const parts = snapshot.parts.slice()
          const last = parts.at(-1) as Record<string, Prisma.InputJsonValue> | undefined
          if (last && typeof last === "object" && !Array.isArray(last) && last.type === "text") parts[parts.length - 1] = { ...last } as Prisma.InputJsonValue
          return { content: snapshot.content, seq: snapshot.seq, parts, toolCalls: JSON.parse(JSON.stringify([...calls.values()])) }
        }
        const checkpoint = (): Promise<void> => {
          if (checkpointPending) return checkpointPending
          if (seq <= checkpointSeq) return Promise.resolve()
          const captured = savedSnapshot(), owner = scope
          checkpointPending = serial(() => checkpointChatAttempt(owner, captured)).then(() => {
            checkpointSeq = captured.seq; lastCheckpoint = Date.now(); checkpointBytes = 0
          }).catch((error: unknown) => {
            console.error("[chat] 检查点保存失败", { attemptId: owner.attemptId, name: error instanceof Error ? error.name : "Unknown", detail: error instanceof Error ? error.message.split("\n").slice(-3).join("\n").slice(0, 500) : "未知数据库错误" })
            throw error
          }).finally(() => { checkpointPending = undefined })
          return checkpointPending
        }
        /** 撤销/取消（执行权确实丢失）才中断本轮；瞬时数据库故障留待下一次续租，避免一次抖动杀死数分钟的长任务。 */
        const isRevoked = (error: unknown) => error instanceof ContentError && error.code === "EXECUTION_REVOKED"
        /** 起步阶段的控制面短写：瞬时故障短暂退避重试，执行权撤销立即抛。 */
        const resilient = async <T,>(fn: () => Promise<T>, attempts = 3): Promise<T> => {
          let last: unknown
          for (let i = 0; i < attempts; i++) {
            try { return await fn() }
            catch (error) {
              if (isRevoked(error)) throw error
              last = error
              if (i + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 1_000 * (i + 1)))
            }
          }
          throw last
        }
        let leaseFailures = 0
        let lastLeaseSuccessAt = Date.now()
        // 心跳走独立轻量路径（幂等、只写租约字段、无顺序要求），不排入 serial()/io 业务串行队列；
        // 在飞去重：上一次心跳未回则跳过本次。瞬时失败维持租约窗口内 3s 快速补租。
        let heartbeatInFlight: Promise<void> | undefined
        let heartbeatRetry: ReturnType<typeof setTimeout> | undefined
        let stopping = false
        const renewLease = (retrying = false) => {
          if (stopping || heartbeatInFlight) return
          const owner = scope, progress = progressed, heartbeatSeq = seq, heartbeatStartedAt = Date.now()
          progressed = false
          heartbeatInFlight = heartbeatChatAttempt(owner, { seq: heartbeatSeq, stage, progress, retryUsed }).then(() => {
            if (owner.attemptId !== scope.attemptId) return
            if (Date.now() - lastLeaseSuccessAt >= CHAT_LEASE_MS) console.warn("[chat] 续租延迟后恢复", JSON.stringify({ attemptId: owner.attemptId, elapsedMs: Date.now() - heartbeatStartedAt, sinceLastSuccessMs: Date.now() - lastLeaseSuccessAt }))
            leaseFailures = 0
            lastLeaseSuccessAt = Date.now()
            if (owner.attemptId === scope.attemptId) emit({ type: "data-heartbeat", data: { stage, at: new Date().toISOString() } }, false)
          }).catch((error: unknown) => {
            if (owner.attemptId !== scope.attemptId) return
            if (isRevoked(error)) { abort.abort(); return }
            leaseFailures += 1
            console.warn("[chat] 心跳续租暂未成功，等待重试", JSON.stringify({ attemptId: owner.attemptId, failures: leaseFailures, elapsedMs: Date.now() - heartbeatStartedAt, sinceLastSuccessMs: Date.now() - lastLeaseSuccessAt, name: error instanceof Error ? error.name : "Unknown", code: error && typeof error === "object" && "code" in error ? String(error.code) : undefined }))
            // 短时故障尽快补租；本机存活证明可跨过宽限，取消/执行权变更仍立即停止。
            if (!stopping && !retrying && leaseFailures * CHAT_HEARTBEAT_MS < CHAT_LEASE_MS) heartbeatRetry = setTimeout(() => { if (!signal.aborted) renewLease(true) }, 3_000)
          }).finally(() => { heartbeatInFlight = undefined })
        }
        const heartbeat = setInterval(() => renewLease(), CHAT_HEARTBEAT_MS)
        const checkpoints = setInterval(() => {
          if (Date.now() - lastCheckpoint >= 1000 && seq > checkpointSeq) void checkpoint().catch((error: unknown) => {
            if (isRevoked(error)) { checkpointFailure = error; abort.abort(); return }
            console.warn("[chat] 检查点暂未保存，继续重试", { attemptId: scope.attemptId, name: error instanceof Error ? error.name : "Unknown" })
            // 整个租约窗口都无法落盘才算持久化故障：继续生成只会扩大丢失面。
            if (Date.now() - lastCheckpoint >= CHAT_LEASE_MS) { checkpointFailure = error; abort.abort() }
          })
        }, 1000)
        const run = async () => {
          // W4 进度卡估时：回合起步即带同作品近期时长均值（无数据缺省；历史轮询由 getChatTurn 同口径补充）
          const estimateMs = current.conversation.novelId ? await estimateRecentTurnMs(prisma, { novelId: current.conversation.novelId, userId }).catch(() => null) : null
          status({ stage: "queued", status: "queued", assistantMessageId: current.attempt.assistantMessageId, userMessageId: current.turn.userMessageId, ...(estimateMs != null ? { estimateMs } : {}) })
          try {
            await saveAttemptObservation(scope, meter).catch(error => console.error("[chat] 观测写入失败", error))
            await resilient(() => heartbeatChatAttempt(scope, { seq, stage, progress: true }))
            const costConfig = await getCostConfig()
            const queueStart = performance.now()
            try { releaseSlot = await acquireLongTask(signal, costConfig.maxConcurrentTasks) }
            finally { meter.data.queueMs = performance.now() - queueStart }
            await resilient(() => heartbeatChatAttempt(scope, { seq, stage: "preparing" }))
            status({ stage: "preparing", status: "running" })
            await runInsideLongTask(async () => {
            const prepareStart = performance.now()
            await checkQuota(userId)
            const maxRetries = await getMaxNetworkRetries()
            const retry = (retryScope: "request" | "turn") => {
              retryUsed += 1
              emit({ type: "data-network-retry", data: { attempt: retryUsed, maxRetries, scope: retryScope } })
            }
            const measuredFetch: typeof fetch = async (input, init) => {
              meter.data.networkRequests++
              try {
                const response = await fetch(input, init)
                const statuses = meter.data.httpStatuses ??= {}; statuses[response.status] = (statuses[response.status] ?? 0) + 1
                if (!response.ok) {
                  meter.data.networkErrors++
                  const body = await response.clone().json().catch(() => null) as { error?: { code?: unknown } } | null
                  const code = String(body?.error?.code ?? "")
                  if (/^[a-zA-Z0-9_-]{1,64}$/.test(code)) meter.data.providerErrorCodes = [...new Set([...(meter.data.providerErrorCodes ?? []), code])].slice(-8)
                }
                return response
              }
              catch (error) { meter.data.networkErrors++; throw error }
            }
            const retryFetch = createNetworkRetryFetch({ fetch: measuredFetch, onRetry: () => retry("request"), canRetry: () => retryUsed < maxRetries && !signal.aborted, nextDelayMs: () => networkRetryDelayMs(retryUsed), signal })
            scope.networkRetry = { maxRetries, canRetry: () => retryUsed < maxRetries && !signal.aborted, notify: () => retry("request"), fetch: retryFetch }
            const conversation = current.conversation
            autoRoute = false
            const configuredThinking = scope.taskDefaults?.thinking ?? conversation.thinkingEffort ?? "default"
            const modelOptions = { fetch: retryFetch, conversationId: conversation.id, thinkingEffort: configuredThinking === "default" ? null : configuredThinking }
            const resolved = await getModelByIdForUser(userId, scope.taskDefaults ? scope.taskDefaults.textModelId : conversation.modelId, modelOptions)
            const { model, modelRecord } = resolved
            observedModel = modelRecord
            const effort = configuredThinking !== "default" && snapshotForRecord(modelRecord).thinkingLevels.includes(configuredThinking) ? configuredThinking : null
            Object.assign(meter.data, { modelName: modelRecord.modelId, effort, costStrategy: costConfig.enabled,
              configHash: requestHash({ modelId: modelRecord.id, provider: modelRecord.provider, model: modelRecord.modelId, effort, costConfig }) })
            const providerOptions = effort ? buildThinkingProviderOptions(modelRecord.provider, effort, modelRecord.modelId) : resolved.providerOptions
            scope.resolvedModel = { model, modelRecord, providerOptions }
            const history = await prisma.message.findMany({ where: { conversationId: conversation.id, id: { not: current.attempt.assistantMessageId } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: -HISTORY_LOAD_LIMIT })
            const action = current.turn.action as ChatAction | null
            const adjustment = planningAdjustmentOf(action)
            // 续跑沿用同一 turn 的已成功回执；不能要求作者把已保存的改动再写一遍。
            // 仅用于动作判定，旧失败与旧工具展示不混入当前 attempt。
            const priorReceipts = input.retryOfTurnId ? await prisma.chatToolExecution.findMany({
              where: { turnId: current.turn.id, attemptId: { not: current.attempt.id }, status: "succeeded" },
              select: { toolName: true, input: true, output: true },
            }) : []
            const answerOrigin = input.interaction ? await prisma.chatTurn.findFirst({ where: { id: input.interaction.turnId, userId, conversationId: conversation.id }, select: { interaction: true } }) : null
            const answeredTask = answerOrigin?.interaction as unknown as ChatInteraction | null
            const answeredQuestion = answeredTask?.kind === "question" ? pendingQuestionSchema.safeParse(answeredTask.payload) : null
            // 自由回答也是当前任务的后续，继续压缩上下文；它仍不构成任何认可。
            const taskMode = action?.kind === "storyTask" || !!adjustment || Boolean(answeredQuestion?.success && answeredQuestion.data.storyNavigation)
            const taskContext = (costConfig.enabled || taskMode) && conversation.novelId ? await buildTaskNovelContext(conversation.novelId, input.message ?? history.findLast(message => message.role === "USER")?.content ?? "", action?.kind === "storyTask" ? action.targetKey?.split(":").slice(1).join(":") : adjustment?.focusKeys[0]?.split(":").slice(1).join(":") ?? (action && "targetId" in action ? action.targetId : undefined)) : undefined
            const extraNote = chatActionNote(action) + (input.retryOfTurnId ? await chatContinuationContext(userId, current.turn.id) : "")
            const renderSystem = async (summary: string) => await buildChatSystemPrompt(conversation.novelId, input.mode, summary, taskContext, input.message ?? history.findLast(message => message.role === "USER")?.content ?? "") + extraNote
            const all = createAgentTools({ userId, novelId: conversation.novelId, conversationId: conversation.id })
            const allowedTools = adjustment ? Object.fromEntries(Object.entries(all).filter(([name]) => planningAdjustmentToolAllowed(adjustment, name, WRITE_TOOL_NAMES.has(name)))) : all
            const boundTools = bindChatTools(input.mode === "plan" ? Object.fromEntries(Object.entries(allowedTools).filter(([name]) => !WRITE_TOOL_NAMES.has(name) && !["requestStoryApproval", "requestContentApproval", "requestStoryRemoval", "completeStoryTask"].includes(name))) : Object.fromEntries(Object.entries(allowedTools).filter(([name]) => name !== "proposePlan")), () => scope)
            const fullToolTokens = await estimateToolTokens(boundTools)
            const toolBudget = Math.max(3000, Math.min(16000, Math.floor(modelRecord.contextWindow * .4)))
            const compact = fullToolTokens > Math.min(16000, modelRecord.contextWindow * .3) ? compactCreationTools(boundTools, toolBudget, taskMode ? 16 : 48) : null
            if (compact && conversation.novelId) await compact.prime(action?.kind === "storyTask" ? actionToolHints(action) : [...actionToolHints(action), ...await storyToolHints({ userId, novelId: conversation.novelId })])
            const tools = compact?.tools ?? boundTools
            // 为每一步服务器状态及后续启用的工具预留空间。
            const toolTokens = (compact ? toolBudget : fullToolTokens) + 2400
            const protectedContext = await loadContextProtection(conversation.id, modelRecord.contextWindow * 4)
            const managed = await runInChatExecution(scope, async () => {
              return manageConversationContext({ conversation, history, system: await renderSystem(conversation.summary ?? ""), renderSystem, model, modelRecord,
                protectedContext, providerOptions, compactCompleted: costConfig.enabled || !!compact,
                costBudgetTokens: costConfig.enabled || taskMode ? costConfig.inputBudgetTokens : undefined,
                extraTokens: toolTokens + estimateTokens(turnFormatReminder(input.mode)),
                validateFinal: (system, messages) => assertPromptFits(system, withTurnReminder(toModelMessages(messages, costConfig.enabled || !!compact), input.mode), toolTokens, modelRecord.contextWindow, calibrationFactor(conversation)),
                onCompactUsage: async usage => { await recordUsage({ turnId: scope.turnId, attemptId: scope.attemptId, userId, novelId: conversation.novelId ?? undefined, modelId: modelRecord.id, modelSnapshot: snapshotForRecord(modelRecord), action: "chat.compact", promptTokens: usage.input, completionTokens: usage.output }) },
              })
            })
            const system = managed.system
            const messages = withTurnReminder(toModelMessages(managed.messages, costConfig.enabled || !!compact), input.mode)
            const calibration = calibrationFactor(conversation)
            const promptEstimate = assertPromptFits(system, messages, toolTokens, modelRecord.contextWindow, calibration)
            meter.data.prepareMs = performance.now() - prepareStart
            meter.data.inputEstimate = promptEstimate
            const attempt = async () => {
              meter.startModel()
              meter.data.status = "running"
              status({ stage: "waiting_model", status: "running" })
              await saveAttemptObservation(scope, meter, observedModel, autoRoute).catch(error => console.error("[chat] 观测写入失败", error))
              let error: unknown, finish: Record<string, unknown> | undefined
              let firstStep = true
              /** 末次流的用量（收尾 messageMetadata 展示）；每次流式调用各自实报实记 */
              let usage: { inputTokens?: number; outputTokens?: number } | null = null
              /** W5：连续软停顿达上限仍不执行时如实收尾（回执说明「宣布的动作未执行」） */
              let unexecutedDeclaration = false
              let streamMessages = messages
              // W5 软停顿自动续跑（ISS-010）：宣布动作却无工具调用的收尾，在原回合内续跑，上限 MAX_AUTO_CONTINUATIONS
              for (let continuations = 0; ; continuations++) {
                error = undefined; finish = undefined
                // 供应商响应映射回的消息可能有 schema 非法零件（曾以 AI_InvalidPromptError 终止整轮）：每次进 streamText 前消毒
                const sanitized = sanitizeModelMessages(streamMessages)
                if (sanitized.dropped) { console.warn("[chat] 消息消毒丢弃非法零件", JSON.stringify({ attemptId: scope.attemptId, dropped: sanitized.dropped })); meter.data.errorDetail = `sanitizeModelMessages dropped ${sanitized.dropped} invalid part(s)` }
                streamMessages = sanitized.messages as typeof streamMessages
                const result = streamText({ model, system, messages: streamMessages, tools,
                  repairToolCall: repairToolInput,
                  ...(providerOptions ? { providerOptions } : {}), stopWhen: [isStepCount(32), ({ steps }) => stopForInteraction(steps) || hasModelResponseTimeout(steps.flatMap(step => step.toolResults)) || hasRepeatedToolFailure([...calls.values()])], maxRetries: 0, abortSignal: signal,
                  prepareStep: async ({ messages: stepMessages }) => {
                    const next = costConfig.enabled || taskMode || !!compact ? compactCompletedMessages(stepMessages) : stepMessages
                    const bound = conversation.novelId ? conversation : await prisma.conversation.findFirst({ where: { id: conversation.id, userId }, select: { novelId: true } })
                    const currentContext = bound?.novelId ? await storyStepContext({ userId, novelId: bound.novelId }, action) : ""
                    const currentSystem = system + currentContext + (compact?.instruction() ?? "")
                    const activeTools = (compact?.activeTools() ?? Object.keys(tools)).filter(n => bound?.novelId ? n !== "startNovelFromChat" : ["startNovelFromChat", "askUserQuestion", "proposePlan"].includes(n))
                    const activeTokenCount = await estimateToolTokens(Object.fromEntries(activeTools.map(name => [name, tools[name]])))
                    assertPromptFits(currentSystem, next, activeTokenCount, modelRecord.contextWindow, calibration)
                    return { system: currentSystem, messages: next, activeTools }
                  },
                  onStepEnd: async event => {
                    if (!firstStep) return
                    firstStep = false
                    if (event.usage.inputTokens !== undefined) await prisma.conversation.updateMany({ where: { id: conversation.id, activeAttemptId: scope.attemptId }, data: { lastFirstStepInputTokens: event.usage.inputTokens, lastPromptEstimate: promptEstimate } })
                  },
                  onToolExecutionStart: ({ toolCall }) => { if (WRITE_TOOL_NAMES.has(toolCall.toolName)) { writeStarted = true; emit({ type: "data-write-started", data: { toolCallId: toolCall.toolCallId } }) } },
                  onError: event => { error = event.error },
                })
                for await (const chunk of result.toUIMessageStream({ onError: error => error instanceof ContentError ? error.message : ERROR_TEXT.operationIncomplete })) {
                  if (!["start", "start-step"].includes(chunk.type)) meter.event(chunk.type === "text-delta" && !!chunk.delta)
                  if (chunk.type === "error") { error ??= new Error("回复流未完成"); continue }
                  if (chunk.type === "finish") { finish = chunk; continue }
                  if (chunk.type === "text-delta") {
                    stage = "responding"; snapshot.content += chunk.delta; checkpointBytes += encoder.encode(chunk.delta).length
                    const last = snapshot.parts.at(-1) as Record<string, Prisma.InputJsonValue> | undefined
                    if (last && typeof last === "object" && !Array.isArray(last) && last.type === "text") last.text = String(last.text ?? "") + chunk.delta
                    else snapshot.parts.push({ type: "text", id: `${scope.attemptId}:text:${seq + 1}`, seq: seq + 1, text: chunk.delta })
                  }
                  if (chunk.type === "reasoning-start") status({ stage: "thinking" })
                  if (chunk.type === "tool-input-start" || chunk.type === "tool-input-available" || chunk.type === "tool-input-error") {
                    writeStarted ||= WRITE_TOOL_NAMES.has(chunk.toolName)
                    const old = calls.get(chunk.toolCallId)
                    const inputHint = chunk.type === "tool-input-error" ? toolInputIssueHint(tools, chunk.toolName, chunk.input) : null
                    calls.set(chunk.toolCallId, { toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.type !== "tool-input-start" ? chunk.input : old?.input ?? null, output: chunk.type === "tool-input-error" ? { ok: false, code: "TOOL_INPUT_INVALID", ...(chunk.toolName !== "askUserQuestion" ? { internal: true } : {}), message: chunk.toolName === "askUserQuestion" ? "问题未能生成，问题格式无效" : `工具参数无效，本步未执行${inputHint ? `（${inputHint}）` : ""}` } : old?.output ?? null })
                    if (!old) snapshot.parts.push({ type: "tool", id: chunk.toolCallId, seq: seq + 1, toolCallId: chunk.toolCallId })
                  }
                  if (chunk.type === "tool-output-available" || chunk.type === "tool-output-error") {
                    const call = calls.get(chunk.toolCallId)
                    if (call) {
                      const preservedInputInvalid = chunk.type === "tool-output-error" && call.output && typeof call.output === "object" && "code" in call.output && call.output.code === "TOOL_INPUT_INVALID"
                      if (chunk.type === "tool-output-available") call.output = chunk.output
                      else if (!preservedInputInvalid) {
                        const code = toolErrorCodes.get(chunk.toolCallId) ?? "TOOL_FAILED"
                        call.output = { ok: false, code, ...(isInternalToolErrorCode(code) && call.toolName !== "askUserQuestion" ? { internal: true } : {}), message: call.toolName === "askUserQuestion" ? "问题未能生成，请稍后重试" : typeof chunk.errorText === "string" && /[\u4e00-\u9fff]/.test(chunk.errorText) ? chunk.errorText : "工具执行失败" }
                      }
                    }
                    if (call && ["askUserQuestion", "requestStoryApproval", "requestContentApproval", "requestStoryRemoval", "completeStoryTask"].includes(call.toolName) && chunk.type === "tool-output-available") {
                      const question = pendingQuestionSchema.safeParse(call.toolName !== "askUserQuestion" ? (chunk.output as { question?: unknown } | null)?.question : call.input)
                      if (question.success && !!chunk.output && typeof chunk.output === "object" && "ok" in chunk.output && chunk.output.ok === true) {
                        // 抽卡后的单问题选稿问答：同轮定位最近一次成功抽卡，附加 drawRedraw（面板据此注入换一批选项）
                        const drawRedraw = call.toolName === "askUserQuestion" && question.data.questions.length === 1
                          ? [...calls.values()].map(c => (c.toolName === "drawChapterCandidates" || c.toolName === "getChapterCandidates") ? drawResultOf(c.output) : null).filter(d => d !== null).at(-1) ?? null
                          : null
                        const newProposal = [...(adjustment ? priorReceipts : []), ...calls.values()].some(c => c.toolName === "proposeNovelPlanning" && (c.output as { ok?: boolean } | null)?.ok === true)
                        const payload = adjustment?.phase === "clarify" ? planningAdjustmentQuestion(adjustment) : adjustment ? { questions: question.data.questions, markerStyle: question.data.markerStyle, ...(!newProposal ? { planningAdjustment: { ...adjustment, phase: "clarify" as const } } : {}) } : drawRedraw ? { ...question.data, drawRedraw: { drawId: drawRedraw.drawId, chapterId: drawRedraw.chapterId, chapterTitle: drawRedraw.chapterTitle } } : question.data
                        interaction = { kind: "question", id: crypto.randomUUID(), revision: 1, state: "pending", payload }
                        snapshot.parts.push({ type: "question", id: interaction.id, seq: seq + 1, revision: 1, payload })
                      }
                    }
                  }
                  if (chunk.type === "tool-output-available") {
                    const call = calls.get(chunk.toolCallId)
                    const output = chunk.output as { ok?: boolean; planId?: string } | null
                    if (call?.toolName === "proposePlan" && input.mode === "plan" && output?.ok) {
                      const proposal = planProposalSchema.safeParse(call.input)
                      if (proposal.success) { interaction = { kind: "planApproval", id: crypto.randomUUID(), revision: 1, payload: proposal.data, state: "pending" }; snapshot.parts.push({ type: "plan", id: interaction.id, seq: seq + 1, revision: 1, payload: proposal.data }) }
                    }
                    if (output?.planId) { const part = { type: "planRef", id: `${scope.attemptId}:plan:${seq + 1}`, seq: seq + 1, planId: output.planId }; snapshot.parts.push(part); emit({ type: "data-part", data: part }) }
                    if (call && WRITE_TOOL_NAMES.has(call.toolName) && output?.ok !== false) snapshot.parts.push({ type: "artifact", id: `${scope.attemptId}:artifact:${seq + 1}`, seq: seq + 1, toolCallId: call.toolCallId })
                  }
                  emit(chunk.type === "tool-output-error" && toolErrorCodes.has(chunk.toolCallId) ? { ...chunk, code: toolErrorCodes.get(chunk.toolCallId) } : chunk)
                  if (checkpointBytes >= 4096 || chunk.type === "tool-output-available" || chunk.type === "tool-output-error" || chunk.type === "tool-input-error") await checkpoint().catch((error: unknown) => {
                    // 执行权撤销必须停；瞬时持久化故障由检查点周期继续重试，超过租约窗口仍失败才终止本轮。
                    if (isRevoked(error)) throw error
                    console.warn("[chat] 检查点暂未保存，继续生成", { attemptId: scope.attemptId })
                  })
                }
                // 用量只记录已报告的实际调用；失败流没有 usage 时不臆造。
                usage = await Promise.resolve(result.totalUsage).catch(() => null)
                if (usage && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)) await recordUsage({ turnId: scope.turnId, attemptId: scope.attemptId, userId, novelId: conversation.novelId ?? undefined, modelId: modelRecord.id, modelSnapshot: snapshotForRecord(modelRecord), action: "chat", promptTokens: usage.inputTokens ?? 0, completionTokens: usage.outputTokens ?? 0 }).catch(console.error)
                if (error || !finish || signal.aborted) throw error ?? new TypeError("network stream interrupted")
                if (interaction) break
                // 只检查最后一步，早先的采用/保存不能冒充后面宣布的评审回执。
                if (hasModelResponseTimeout([...calls.values()]) || hasRepeatedToolFailure([...calls.values()])) break
                const unresolvedTask = action?.kind === "storyTask" && !hasActionReceipt(action, [...priorReceipts, ...calls.values()], false)
                const steps = await result.steps
                const stepLimited = steps.length >= 32
                const declared = hasUnexecutedDeclaration(steps)
                if (!unresolvedTask && !stepLimited && !declared) break
                if (continuations >= MAX_AUTO_CONTINUATIONS) { unexecutedDeclaration = true; break }
                const responseMessages = (await Promise.resolve(result.response).catch(() => null))?.messages
                if (!responseMessages) break
                console.warn("[chat] 宣布的动作未执行，原回合内自动续跑", { attemptId: scope.attemptId, continuation: continuations + 1 })
                streamMessages = [...streamMessages, ...responseMessages, { role: "user", content: AUTO_CONTINUATION_MESSAGE }]
                status({ stage: "waiting_model", status: "running" })
              }
              meter.modelEnd()
              // A scoped adjustment cannot fall through to another world's global approval.
              // The deterministic question is also the safety net when the model only wrote a promise to ask.
              const adjustedProposal = [...(adjustment ? priorReceipts : []), ...calls.values()].some(call => call.toolName === "proposeNovelPlanning" && (call.output as { ok?: boolean } | null)?.ok === true)
              if (!interaction && adjustment && !adjustedProposal && !hasUnresolvedToolFailures([...calls.values()])) {
                const question = pendingQuestionSchema.parse(planningAdjustmentQuestion(adjustment))
                interaction = { kind: "question", id: crypto.randomUUID(), revision: 1, state: "pending", payload: question }
                const part = { type: "question", id: interaction.id, seq: seq + 1, revision: 1, payload: question }
                snapshot.parts.push(part); emit({ type: "data-part", data: part })
              }
              if (!interaction && input.mode !== "plan") {
                const attached = await prisma.conversation.findFirst({ where: { id: conversation.id, userId }, select: { novelId: true } })
                const story = attached?.novelId ? { userId, novelId: attached.novelId } : null
                const completedKeys = completedStoryKeys(calls.values())
                // 本轮新候选的采用问题不能被全局旧脑洞/角色的待认可状态抢走。
                const proposed = [...(adjustment ? priorReceipts : []), ...calls.values()].findLast(call => call.toolName === "proposeNovelPlanning"
                  && (call.output as { ok?: boolean } | null)?.ok === true)
                const proposedId = (proposed?.output as { result?: { id?: unknown } } | undefined)?.result?.id
                const currentProposalQuestion = story && typeof proposedId === "string"
                  ? await nextPlanningProposalApproval(story, proposedId) : null
                // 普通会话写一张角色卡不等于启动整套创作流程；显式任务或已开启的流程才自动收尾评审。
                const workflowStarted = story && (taskMode || await prisma.storyWorkflow.findUnique({ where: { novelId: story.novelId }, select: { novelId: true } }))
                const navigation = !currentProposalQuestion && story && workflowStarted && completedKeys.length && !hasUnresolvedToolFailures([...calls.values()]) ? await runInChatExecution(scope, () => prepareStoryTask(story, completedKeys)) : null
                // 单选项免弹面板：autoProceed（无 question）时不落交互，由模型按指令直接执行并文字收尾
                const navigationQuestion = currentProposalQuestion ? { questions: currentProposalQuestion.questions, markerStyle: "letters" as const } : navigation?.question
                const lastCall = [...calls.values()].at(-1)
                const chapterResult = !completedKeys.length && lastCall && ["checkChapterNarrative", "getChapterCandidates", "drawChapterCandidates"].includes(lastCall.toolName)
                // 工具失败保留本次失败原因，不能用全局旧认可问题覆盖并阻塞作者补救。
                const quietTask = taskMode || chapterResult || hasUnresolvedToolFailures([...calls.values()])
                const decision = !navigationQuestion && !quietTask && story ? await nextStoryDecision(story) : null
                const approval = !navigationQuestion && !quietTask && !decision && story ? await nextStoryApproval(story) : null
                // 断流安全网：有待采用规划提案时对话内请作者采用（认可边界不变——采用动作仍由作者回答驱动模型执行）
                const proposalQuestion = !navigationQuestion && !quietTask && !decision && !approval && story ? await nextPlanningProposalApproval(story) : null
                if (navigationQuestion || decision || approval || proposalQuestion) {
                  const question = pendingQuestionSchema.parse(navigationQuestion ?? (decision ? { questions: decision.questions, markerStyle: "letters" } : approval ? { questions: [{ question: `你认可这一版「${approval.title}」吗？`, options: [...STORY_APPROVAL_OPTIONS] }], markerStyle: "letters", storyApproval: approval.approval } : { questions: proposalQuestion!.questions, markerStyle: "letters" }))
                  // 本轮就是作者对同一待确认问题的回答（如选「需要修改，我来说明」）：重复附同一张卡会阻塞作者自由说明。
                  // 内容真正变化后 approval/checkpoint 哈希改变，同一 key 会作为新问题再次出现；模型也可随时用 requestStoryApproval 主动再请求。
                  const answered = input.interaction
                    ? (await prisma.chatTurn.findFirst({ where: { id: input.interaction.turnId, userId }, select: { interaction: true } }))?.interaction as unknown as ChatInteraction | null
                    : null
                  const reaskingAnswered = isReaskingAnsweredQuestion(answered, question)
                  if (!reaskingAnswered) {
                    interaction = { kind: "question", id: crypto.randomUUID(), revision: 1, state: "pending", payload: question }
                    const part = { type: "question", id: interaction.id, seq: seq + 1, revision: 1, payload: question }
                    snapshot.parts.push(part)
                    emit({ type: "data-part", data: part })
                    status({ storyFocus: currentProposalQuestion?.focus ?? navigation?.storyFocus ?? decision?.focus ?? approval?.focus ?? proposalQuestion!.focus })
                  }
                }
              }
              const toolFailure = unresolvedToolFailures([...calls.values()]).at(-1)
              const toolFailed = !!toolFailure
              const actionDone = hasActionReceipt(current.turn.action as ChatAction | null, [...priorReceipts, ...calls.values()], interaction?.kind === "question") && (input.mode !== "plan" || !!interaction) && !unexecutedDeclaration && !toolFailed
              const receiptMessage = unexecutedDeclaration && !current.turn.action && input.mode !== "plan" ? "参谋宣布的动作本轮未执行，可要求继续或重试" : "这一步尚未完成，缺少实际动作回执"
              if (current.turn.action || input.mode === "plan" || unexecutedDeclaration) emit({ type: "data-action-receipt", data: { expectedAction: current.turn.action ?? { kind: "plan" }, completed: actionDone, ...(!actionDone ? { message: toolFailure?.message ?? receiptMessage, code: toolFailure?.code ?? "ACTION_NOT_COMPLETED" } : {}) } })
              const finalStatus = interaction ? "waiting_user" : toolFailed || !actionDone ? "failed" : "succeeded"
              const saveStart = performance.now()
              const persisted = await serial(() => finishChatAttempt(scope, { status: finalStatus, snapshot: savedSnapshot(), interaction, retryUsed, ...(!interaction && toolFailure ? { errorCode: toolFailure.code, errorMessage: toolFailure.message } : !interaction && !actionDone ? { errorCode: "ACTION_NOT_COMPLETED", errorMessage: receiptMessage } : {}) })).catch((error: unknown) => {
                console.error("[chat] 终态保存失败", { attemptId: scope.attemptId, name: error instanceof Error ? error.name : "Unknown", detail: error instanceof Error ? error.message.split("\n").slice(-3).join("\n").slice(0, 500) : "未知数据库错误" })
                throw new ContentError("PERSISTENCE_FAILED", "回复未完整保存", 500)
              })
              meter.data.saveConfirmMs = performance.now() - saveStart
              meter.data.status = finalStatus
              if (finalStatus === "failed") meter.data.errorCode = toolFailure?.code ?? "ACTION_NOT_COMPLETED"
              if (!persisted) throw new ContentError("EXECUTION_REVOKED", "执行已停止，已提交改动保留", 409)
              if (interaction) emit({ type: "data-interaction", data: interaction })
              emit({ ...finish, messageMetadata: { status: finalStatus, totalUsage: { input: usage?.inputTokens ?? 0, output: usage?.outputTokens ?? 0 } } })
            }
            await runWithNetworkRetry(attempt, { maxRetries, signal, shouldRetry: () => !writeStarted && retryUsed < maxRetries,
              onRetry: async ({ error }) => {
                retry("turn")
                meter.data.errorCode = "NETWORK_STREAM_INTERRUPTED"
                // 自动重试也保留失败原因；只记重试次数会丢失最终成功之前的断流诊断。
                meter.data.errorName = error instanceof Error ? error.name : "Unknown"
                meter.data.errorDetail = error instanceof Error ? error.message.split("\n").slice(-3).join("\n").slice(0, 500) : "未知错误"
                console.warn("[chat] 模型流中断，准备续跑", JSON.stringify({ attemptId: scope.attemptId, retryUsed, name: meter.data.errorName }))
                meter.modelEnd()
                meter.end("interrupted", retryUsed)
                await saveAttemptObservation(scope, meter, observedModel, autoRoute).catch(console.error)
                const previous = meter.data
                meter = new AttemptMeter(); Object.assign(meter.data, { modelName: previous.modelName, effort: previous.effort, configHash: previous.configHash, costStrategy: previous.costStrategy })
                const next = await serial(() => nextChatAttempt(scope, retryUsed, savedSnapshot()))
                current = { ...next, replay: false }
                scope = { ...scopeFor(next.conversation, next.turn, next.attempt), signal, progress: status, onToolError: scope.onToolError, networkRetry: scope.networkRetry, resolvedModel: scope.resolvedModel }
                unregisterAbort(); unregisterAbort = registerAttemptAbort(scope.attemptId, abort)
                await refreshConversationTask(scope)
                seq = 0; snapshot = { content: "", toolCalls: [], parts: [], seq: 0 }; calls.clear(); interaction = undefined; checkpointSeq = 0
                status({ stage: "retrying", status: "running", assistantMessageId: next.attempt.assistantMessageId, userMessageId: next.turn.userMessageId })
              },
            })
            })
          } catch (error) {
            // 终态分类由统一错误分类层驱动（保留 checkpointFailure/作者中断前置分支与 ContentError 业务透传）。
            const { code, message } = chatTerminalError({ error, checkpointFailure: !!checkpointFailure, aborted: signal.aborted, writeStarted, retryUsed, providerCodes: meter.data.providerErrorCodes, statuses: meter.data.httpStatuses })
            meter.modelEnd()
            meter.data.status = signal.aborted ? "interrupted" : "failed"
            meter.data.errorCode = code
            const diagnosticId = crypto.randomUUID()
            // 原始错误必须留证：分类文案面向作者，技术细节（错误名/Prisma 码/消息尾部）只进日志与观测，diagnosticId 串联两侧。
            const rawName = error instanceof Error ? error.name : "Unknown"
            const rawCode = error && typeof error === "object" && "code" in error ? String(error.code) : undefined
            meter.data.errorName = rawName
            const causeTail = error instanceof Error && error.cause instanceof Error ? `｜cause:${error.cause.message.split("\n").slice(-2).join(" ").slice(0, 300)}` : ""
            meter.data.errorDetail = (error instanceof Error ? error.message.split("\n").slice(-3).join("\n").slice(0, 500) : "未知错误") + causeTail
            console.error("[chat] 回合失败", JSON.stringify({ attemptId: scope.attemptId, diagnosticId, errorCode: code, name: rawName, code: rawCode, detail: meter.data.errorDetail }))
            const terminal = { status: signal.aborted ? "interrupted" as const : "failed" as const, errorCode: code, errorMessage: message, diagnosticId, retryUsed }
            try { await serial(() => finishChatAttempt(scope, { ...terminal, snapshot: savedSnapshot() })) }
            catch { await serial(() => finishChatAttempt(scope, { ...terminal, errorCode: "PERSISTENCE_FAILED" })).catch(console.error) }
            emit({ type: "data-chat-error", data: { code, retryUsed, hasWriteEffects: writeStarted, diagnosticId } })
            emit({ type: "error", errorText: message })
          } finally {
            stopping = true
            clearInterval(heartbeat); clearInterval(checkpoints); clearTimeout(heartbeatRetry)
            try {
              await Promise.allSettled([heartbeatInFlight, checkpointPending])
              meter.end(meter.data.status, retryUsed)
              await saveAttemptObservation(scope, meter, observedModel, autoRoute).catch(console.error)
              await io
            } finally {
              await finishConversationTask().catch(error=>console.error("[chat] 目录任务授权释放失败",error))
              unregisterAbort()
              releaseSlot?.()
              if (listening) { try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close() } catch {} }
              listening = false; abort.abort()
            }
          }
        }
        void run()
      },
      // 跟随连接断开不终止执行：数据库中的检查点/心跳才是恢复依据。
      cancel() { listening = false },
    })
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Conversation-Id": binding.conversation.id,
      "X-Turn-Id": binding.turn.id, "X-Attempt-Id": binding.attempt.id, "X-User-Message-Id": binding.turn.userMessageId, "X-Assistant-Message-Id": binding.attempt.assistantMessageId } })
    }catch(error){unregisterAbort();throw error}
    })
  } catch (error) {
    if (error instanceof ChatProtocolError) return NextResponse.json({ error: error.message, code: error.code, ...(error.turnId ? { turnId: error.turnId, statusUrl: `/api/chat/turns/${error.turnId}` } : {}) }, { status: error.status })
    return toErrorResponse(error)
  }
}
