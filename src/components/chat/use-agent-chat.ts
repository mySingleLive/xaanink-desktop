"use client"
import type { NewConversationPayload } from "@/stores/chat"
import type { StorySelection } from "@/lib/story-task"

import { storyTaskNavigationSchema } from "@/lib/story-task"

import { chatStageLabel } from "@/lib/chat-stage"

import { useCallback, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { ChatSessionRepository, emptyChatSession, browserSessionStorage } from "@/lib/chat-session"
import { FramePublisher, parseChatParts, type ChatAction, type PlanProposal } from "@/lib/chat-parts"
import { connectionFeedback, type ChatInteraction } from "@/lib/chat-protocol"
import { classifyWireError, ERROR_TEXT } from "@/lib/ai/error-classification"
import { readSSE } from "@/lib/sse"
import { ChatExecutionController, finalizeAttempt, reduceChatStream, startChatStream } from "@/lib/chat-stream"
import { useChatStore } from "@/stores/chat"
import { useDesktopStore } from "@/stores/desktop"
import { defaultState } from "@desktop/core/settings"
import { taskDefaultsSchema, type TaskDefaults } from "@desktop/shared/task-defaults"
import { chatTaskOverrides, newChatChoices, restoreChatChoices } from "@/lib/desktop/chat-defaults"
import { registerDesktopChatNavigation } from "@/lib/desktop/navigation-runtime"
import { useStagedChangesStore } from "@/stores/staged-changes"
import { applySceneCommitReceipt } from "./scene-receipts"
import { stagedMessageSummary } from "@/lib/staged-save"
import { useTabsStore, buildTabId } from "@/stores/tabs"
import { useStoryActivityStore } from "@/stores/story-activity"
import { focusStoryArtifact, storyDraftText } from "./story-focus"

import type { CostEstimate } from "./cost-estimate"
import { invalidateSopPlan } from "./SopPlanCard"
import {
  WRITE_TOOLS,
  TOOL_LABELS,
  summarizeOutput,
  type ChatMessageView,
  type PendingQuestion,
  type PendingQuestionItem,
  type QuestionMarkerStyle,
  type ToolCallView,
} from "./types"

/** 服务端 Message 记录（GET /api/chat/conversations/[id] 返回） */
interface MessageRecord {
  id: string
  role: "USER" | "ASSISTANT" | "TOOL"
  content: string
  toolCalls?: unknown
  createdAt: string
  turnId?: string | null
  attemptId?: string | null
  attempt?: TurnState["attempts"][number] | null
  interaction?: ChatInteraction | null
  parts?: Array<Record<string, unknown>> | null
  stagedBatches?: import("@/lib/staged-save").StagedBatchPayload[] | null
}

interface ConversationDetail {
  conversation: {
    id: string
    novelId: string | null
    /** 已保存的显式选择；null 不能自动改用当前默认模型。 */
    modelId?: string | null
    thinkingEffort?: string | null
    defaultsSnapshot?: TaskDefaults | null
  }
  messages: MessageRecord[]
  turnState?: TurnState | null
}

interface ConversationLoadOptions { signal?: AbortSignal; preserveOnFailure?: boolean }
/** Settle cancelled navigation even if a delayed response body ignores abort. */
function navigationRead<T>(read: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason ?? new DOMException("Navigation cancelled", "AbortError")) }
    signal.addEventListener("abort", abort, { once: true })
    read.then(value => { signal.removeEventListener("abort", abort); if (signal.aborted) abort(); else resolve(value) }, error => { signal.removeEventListener("abort", abort); reject(error) })
    if (signal.aborted) abort()
  })
}

interface TurnState {
  turn: { id: string; conversationId: string; latestAttemptId: string; status: string; interaction: ChatInteraction | null; defaultsSnapshot?: TaskDefaults | null }
  attempts: Array<{ id: string; assistantMessageId: string; status: string; createdAt: string; endedAt: string | null; errorCode: string | null; errorMessage: string | null; hasWriteEffects: boolean; lastEventAt: string; lastProgressAt: string; stage: string; tools?: Array<{ effects: NonNullable<ChatMessageView["savedEffects"]> }> }>
  messages: MessageRecord[]
  estimateMs?: number | null
  recovery: { latest: boolean; canRetry: boolean; canResume: boolean; hasEffects: boolean; unknownExternal: boolean; reason?: string }
}
function turnMessages(data: TurnState) {
  return data.messages.flatMap(record => {
    const view = toMessageView({ ...record, interaction: data.turn.interaction })
    if (!view) return []
    const attempt = data.attempts.find(a => a.id === record.attemptId)
    if (!attempt) return [view]
    const active = ["queued", "running"].includes(attempt.status)
    return [{ ...view, status: active ? "running" as const : attempt.status as ChatMessageView["status"], streaming: false, stage: attempt.stage,
      startedAt: Date.parse(attempt.createdAt), endedAt: attempt.endedAt ? Date.parse(attempt.endedAt) : undefined,
      workedSeconds: attempt.endedAt ? Math.max(0, Math.round((Date.parse(attempt.endedAt) - Date.parse(attempt.createdAt)) / 1000)) : undefined,
      estimateMs: typeof data.estimateMs === "number" ? data.estimateMs : undefined,
      error: attempt.errorMessage ?? (attempt.id === data.turn.latestAttemptId ? data.recovery.reason : undefined), errorCode: attempt.errorCode ?? (data.recovery.reason ? "ACTION_NOT_COMPLETED" : undefined), hasWriteEffects: attempt.hasWriteEffects,
      savedEffects: data.attempts.flatMap(a => a.tools?.flatMap(t => t.effects) ?? []),
      canRetry: attempt.id === data.turn.latestAttemptId && data.recovery.canRetry, canResume: attempt.id === data.turn.latestAttemptId && data.recovery.canResume }]
  })
}
function restoredQuestion(data: TurnState): PendingQuestion | null {
  if (data.recovery.reason) return null
  const interaction = data.turn.interaction
  if (data.turn.status !== "waiting_user" || interaction?.state !== "pending" || interaction.kind !== "question") return null
  const parsed = parsePendingQuestion(interaction.payload)
  return parsed ? { ...parsed, interaction: { turnId: data.turn.id, id: interaction.id, revision: interaction.revision, action: "answer" } } : null
}

/** 写工具成功后刷新右侧内容区相关缓存（前缀匹配，覆盖子 key） */
function invalidateNovelQueries(queryClient: ReturnType<typeof useQueryClient>, novelId: string) {
  const keys: unknown[][] = [
    ["novels"],
    ["novels", novelId],
    ["story-workflow", novelId],
    ["story-review-history", novelId],
    ["story-sources", novelId],
    ["cascade", novelId],
    ["content-candidates"],
    ["content-versions"],
    ["theme", novelId],
    ["worlds"],
    ["settings"],
    ["characters", novelId],
    ["items"],
    ["scenes"],
    ["scene-factions"],
    ["attributes"],
    ["tropes", novelId],
    ["outline", novelId],
    ["planning", novelId],
    ["chapter"],
    ["comments"],
    ["foreshadow-characters"],
    ["foreshadows", novelId],
    // 悬浮评分指示器：对话内评审/生成类写工具完成后刷新评分聚合
    ["score-report"],
  ]
  for (const queryKey of keys) {
    queryClient.invalidateQueries({ queryKey })
  }
}

/** 会影响 SOP 计划卡状态的工具（计划 CRUD + 服务层自动打勾的执行类工具）：完成后刷新计划查询 */
const SOP_PLAN_TOOLS = new Set([
  "createSopPlan",
  "updateSopPlan",
  "assessThemeMarket",
  "summonPlaywright",
  "reviewWholeNovel",
  "generateChapterContent",
  "requestReaderReview",
])

function toMessageView(m: MessageRecord): ChatMessageView | null {
  if (m.role === "TOOL") return null
  const toolCalls: ToolCallView[] = Array.isArray(m.toolCalls)
    ? (m.toolCalls as { toolCallId?: string; toolName?: string; input?: unknown; output?: unknown }[]).map(
        (tc, i) => ({
          toolCallId: tc.toolCallId ?? `${m.id}-${i}`,
          toolName: tc.toolName ?? "unknown",
          input: tc.input ?? null,
          output: tc.output ?? null,
          status: tc.output == null ? "unknown" : summarizeOutput(tc.toolName ?? "unknown", tc.input ?? null, tc.output).ok ? "done" : "error",
        })
      )
    : []
  return {
    id: m.id,
    role: m.role === "USER" ? "user" : "assistant",
    content: m.content,
    interaction: m.interaction,
    status: m.attempt ? (["queued", "running"].includes(m.attempt.status) ? "running" : m.attempt.status as ChatMessageView["status"]) : undefined,
    error: m.attempt?.errorMessage ?? undefined, errorCode: m.attempt?.errorCode ?? undefined,
    startedAt: m.attempt ? Date.parse(m.attempt.createdAt) : undefined,
    workedSeconds: m.attempt?.endedAt ? Math.max(0, Math.round((Date.parse(m.attempt.endedAt) - Date.parse(m.attempt.createdAt)) / 1000)) : undefined,
    hasWriteEffects: m.attempt?.hasWriteEffects,
    turnId: m.turnId ?? undefined, attemptId: m.attemptId ?? undefined, parts: parseChatParts(m.parts),
    stagedBatches: m.stagedBatches ?? undefined,
    toolCalls,
  }
}

/** 防御性解析高成本操作的消耗预估（§2.6；畸形输入返回 undefined，面板不显示预估行） */
function parseCostEstimate(raw: unknown): CostEstimate | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const c = raw as { kind?: unknown; wordCount?: unknown; count?: unknown }
  if (c.kind === "chapterContent") {
    return {
      kind: "chapterContent",
      wordCount:
        typeof c.wordCount === "number" && Number.isFinite(c.wordCount) && c.wordCount > 0
          ? c.wordCount
          : undefined,
    }
  }
  if (c.kind === "characterImages") {
    return typeof c.count === "number" && Number.isFinite(c.count) && c.count > 0
      ? { kind: "characterImages", count: Math.round(c.count) }
      : undefined
  }
  if (c.kind === "outlineRebuild") return { kind: "outlineRebuild" }
  return undefined
}

/** 从 askUserQuestion 工具入参防御性解析待回答问题（畸形输入返回 null，不展示面板） */
function parsePendingQuestion(input: unknown): PendingQuestion | null {
  if (!input || typeof input !== "object") return null
  const raw = (input as { questions?: unknown }).questions
  if (!Array.isArray(raw)) return null
  const questions: PendingQuestionItem[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") return null
    const { question, options } = item as { question?: unknown; options?: unknown }
    if (typeof question !== "string" || !question.trim()) return null
    if (
      !Array.isArray(options) ||
      options.length === 0 ||
      options.some((o) => typeof o !== "string" || !o.trim())
    ) {
      return null
    }
    questions.push({ question, options: options as string[] })
  }
  if (questions.length === 0) return null
  const rawStyle = (input as { markerStyle?: unknown }).markerStyle
  const markerStyle: QuestionMarkerStyle =
    rawStyle === "numbers" || rawStyle === "stems" ? rawStyle : "letters"
  const costEstimate = parseCostEstimate((input as { costEstimate?: unknown }).costEstimate)
  const navigation = storyTaskNavigationSchema.safeParse((input as { storyNavigation?: unknown }).storyNavigation)
  const rawRedraw = (input as { drawRedraw?: unknown }).drawRedraw
  const drawRedraw = rawRedraw && typeof rawRedraw === "object"
    && typeof (rawRedraw as { drawId?: unknown }).drawId === "string"
    && typeof (rawRedraw as { chapterId?: unknown }).chapterId === "string"
    && typeof (rawRedraw as { chapterTitle?: unknown }).chapterTitle === "string"
    ? rawRedraw as PendingQuestion["drawRedraw"] : undefined
  return { questions, markerStyle, ...(navigation.success ? { storyNavigation: navigation.data } : {}), ...(costEstimate ? { costEstimate } : {}), ...(drawRedraw ? { drawRedraw } : {}) }
}

/** IO 控制器负责所有权和副作用，流转换只产生不可变快照。 */
export function useAgentChat(userId: string) {
  const [sessionRepo] = useState(() => new ChatSessionRepository(userId, browserSessionStorage()))
  // Confirmed missing conversations are skipped by desktop navigation only.
  // Local drafts remain available; a successful explicit reload clears the mark.
  const missingConversations = useRef(new Set<string>())
  const conversationIdentity = (id: string) => JSON.stringify([userId, id])
  const queryClient = useQueryClient()
  const [execution] = useState(() => new ChatExecutionController())
  const [messages, setMessages] = useState<ChatMessageView[]>([])
  const [activeNovelId, setActiveNovelId] = useState<string | null>(null)
  const [isLoadingConversation, setLoadingConversation] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)
  const recoveringRef = useRef(false)
  /** 每个回合最多自动重试一次（仅服务端异常且无任何写入效果时），用户主动停止不自动重试。 */
  const autoRetriedRef = useRef(new Set<string>())
  const [following, setFollowing] = useState<string | null>(null)
  const applyTurnState = useCallback((data: TurnState) => {
    if (useChatStore.getState().accountId !== userId || useChatStore.getState().conversationId !== data.turn.conversationId || useChatStore.getState().isGenerating) return
    for (const message of data.messages) if (Array.isArray(message.toolCalls)) for (const call of message.toolCalls as {toolName?: string; output?: unknown}[]) if(call.toolName === "commitStagedChanges") applySceneCommitReceipt(call.output)
    const views = turnMessages(data), ids = new Set(views.map(m => m.id))
    setMessages(prev => [...prev.filter(m => m.turnId !== data.turn.id && !ids.has(m.id)), ...views])
    if (!data.recovery.latest) return
    const running = ["queued", "running"].includes(data.turn.status)
    const current = data.attempts.find(a => a.id === data.turn.latestAttemptId)
    const slow = current && connectionFeedback(Date.parse(current.lastEventAt), Date.parse(current.lastProgressAt), Date.now())
    useChatStore.setState({ pendingQuestion: restoredQuestion(data), pendingPlan: data.turn.status === "waiting_user" && data.turn.interaction?.kind === "planApproval" && data.turn.interaction.state === "pending" ? { ...data.turn.interaction, turnId: data.turn.id, payload: data.turn.interaction.payload as PlanProposal } : null, suspendedExecution: running || data.recovery.unknownExternal,
      recoveryNotice: running ? slow === "stale" ? "暂未收到连接更新，正在核对状态" : current?.stage === "queued" || current?.stage === "preparing" ? chatStageLabel(current.stage) : slow === "slow" ? "仍在等待模型，执行尚未结束" : "执行仍在进行，正在读取已保存的进展" : null })
    setFollowing(running ? data.turn.id : null)
  }, [userId])
  const reconcile = useCallback(async (turnId: string, signal?: AbortSignal) => {
    const before=useChatStore.getState()
    const owner=JSON.stringify([before.accountId,before.conversationId,before.draftId]),revision=execution.revision
    const response = await fetch(`/api/chat/turns/${turnId}`, { signal })
    if (!response.ok) throw new Error("暂时无法核对回合状态，请稍后再试")
    const data = await response.json() as TurnState
    const current=useChatStore.getState()
    if (execution.revision===revision && JSON.stringify([current.accountId,current.conversationId,current.draftId])===owner) applyTurnState(data)
    return data
  }, [applyTurnState,execution])
  useEffect(() => () => {
    execution.cancel()
    stopRef.current = null
    useChatStore.getState().setIsGenerating(false)
  }, [execution])

  const stop = useCallback(() => { stopRef.current?.() }, [])

  const loadConversation = useCallback(async (id: string, options: ConversationLoadOptions = {}) => {
    if (options.signal?.aborted) return false
    const owner = () => { const state = useChatStore.getState(); return JSON.stringify([state.accountId, state.conversationId, state.draftId]) }
    const source = owner()
    let expectedOwner = source
    stopRef.current?.()
    const token = execution.begin("load")!
    const abort = () => token.controller.abort()
    options.signal?.addEventListener("abort", abort, { once: true })
    if (options.signal?.aborted) abort()
    const owns = () => execution.owns(token) && !token.controller.signal.aborted && owner() === source
    let committed = false
    const savedDraft = sessionRepo.get(id)
    setFollowing(null)
    setLoadingConversation(true)
    useChatStore.setState({ isGenerating: false, queuePaused: true, recoveryStatus: "restoring" })
    try {
      const res = await navigationRead(fetch(`/api/chat/conversations/${id}`, { signal: token.controller.signal }), token.controller.signal)
      if (!owns()) return false
      if (!res.ok) {
        if (res.status === 404) missingConversations.current.add(conversationIdentity(id))
        if (!options.preserveOnFailure && (res.status === 401 || res.status === 404)) {
          useChatStore.setState({ conversationId: null, draftId: crypto.randomUUID(), draftNovelId: null, draft: savedDraft?.draft ?? "", recoveryNotice: res.status === 401 ? "登录已失效，请重新登录；本地草稿保留" : "会话不存在或已无权访问，已保留本地草稿", pendingQuestion: null, queuedMessages: savedDraft?.queuedMessages ?? [] })
          expectedOwner = owner()
          setMessages([]); setActiveNovelId(null)
        }
        throw new Error(res.status === 404 ? "会话不存在或已无权访问" : res.status === 401 ? "登录已失效，请重新登录" : "加载会话失败，请稍后重试")
      }
      const data = await navigationRead(res.json(), token.controller.signal) as ConversationDetail
      if (!owns()) return false
      missingConversations.current.delete(conversationIdentity(id))
      useChatStore.setState({ conversationId: id, draftAction: savedDraft?.action ?? null, pendingPlan: null, pendingRequest: savedDraft?.pendingRequest ?? null, draftId: savedDraft?.draftId ?? crypto.randomUUID(), draft: savedDraft?.draft ?? "", draftNovelId: data.conversation.novelId, novelCreationRequestId: null, suspendedExecution: !!(savedDraft?.wasRunning || savedDraft?.awaitingQuestion), modelChoice: { modelId: data.conversation.modelId ?? null, effort: data.conversation.thinkingEffort ?? null }, modelChoiceExplicit: true, mode: data.turnState?.turn.defaultsSnapshot?.mode ?? data.conversation.defaultsSnapshot?.mode ?? "standard", modeExplicit: true, pendingQuestion: null, pendingNovelTitle: null, pendingNovelPosition: null, queuedMessages: savedDraft?.queuedMessages ?? [], queuePaused: true, recoveryNotice: savedDraft?.wasRunning || savedDraft?.awaitingQuestion ? "上次对话的执行状态待核对，请先查看已保存的消息和改动。" : savedDraft?.queuedMessages.length ? "已恢复待确认队列，尚未发送。" : null })
      committed = true
      expectedOwner = owner()
      for (const message of data.messages) if (Array.isArray(message.toolCalls)) for (const call of message.toolCalls as {toolName?: string; output?: unknown}[]) if(call.toolName === "commitStagedChanges") applySceneCommitReceipt(call.output)
      setActiveNovelId(data.conversation.novelId)
      setMessages(data.messages.map(toMessageView).filter((m): m is ChatMessageView => m !== null))
      if (data.turnState) applyTurnState(data.turnState)
      return true
    } catch (error) {
      if (execution.owns(token) && !token.controller.signal.aborted && owner() === expectedOwner) toast.error(error instanceof Error ? error.message : "加载会话失败")
      return false
    } finally {
      options.signal?.removeEventListener("abort", abort)
      if (execution.owns(token)) {
        execution.end(token); setLoadingConversation(false)
        if (owner() === expectedOwner) useChatStore.setState({ recoveryStatus: "ready" })
        if (committed && !token.controller.signal.aborted && execution.revision === token.generation && owner() === expectedOwner) useChatStore.getState().requestChatFocus()
      }
    }
  }, [execution, sessionRepo, applyTurnState])

  const resetConversation = useCallback((novelId: string | null, draft = "", action: ChatAction | null = null, pending?: Pick<NewConversationPayload, "pendingNovelTitle" | "pendingNovelPosition">) => {
    stopRef.current?.()
    execution.cancel()
    setFollowing(null)
    setLoadingConversation(false)
    const choices = newChatChoices(useDesktopStore.getState().bootstrap?.settings.agent ?? defaultState.settings.agent)
    useChatStore.setState({ conversationId: null, pendingNovelTitle: pending?.pendingNovelTitle ?? null, pendingNovelPosition: pending?.pendingNovelPosition ?? null, novelCreationRequestId: pending?.pendingNovelTitle ? crypto.randomUUID() : null, pendingRequest: null, pendingPlan: null, draftAction: action, draftId: crypto.randomUUID(), draftNovelId: novelId, draft, recoveryNotice: null, recoveryStatus: "ready", suspendedExecution: false, ...choices, pendingQuestion: null, queuedMessages: [], queuePaused: false, isGenerating: false })
    setActiveNovelId(novelId)
    setMessages([])
  }, [execution])

  useEffect(() => {
    const lifetime = new AbortController()
    const available = (target: import("@/lib/desktop/navigation-history").ChatNavigationTarget) => {
      const state = useChatStore.getState()
      if (lifetime.signal.aborted || target.accountId !== userId || state.accountId !== userId) return false
      if (target.kind === "conversation" && missingConversations.current.has(conversationIdentity(target.id))) return false
      if (target.kind === "conversation" && state.conversationId === target.id || target.kind === "draft" && !state.conversationId && state.draftId === target.id) return true
      const saved = sessionRepo.get(target.id)
      return !!saved && (target.kind === "conversation" ? saved.conversationId === target.id : saved.conversationId === null && saved.draftId === target.id)
    }
    const unregister = registerDesktopChatNavigation({ accountId: userId, available, navigate: async (target, external) => {
      const signal = AbortSignal.any([lifetime.signal, external])
      if (signal.aborted || !available(target) || useChatStore.getState().recoveryStatus !== "ready") return false
      const state = useChatStore.getState()
      if (target.kind === "conversation") {
        if (state.conversationId !== target.id) return await loadConversation(target.id, { signal, preserveOnFailure: true }) && !signal.aborted && useChatStore.getState().accountId === userId && useChatStore.getState().conversationId === target.id
      } else if (state.conversationId || state.draftId !== target.id) {
        const saved = sessionRepo.get(target.id)
        if (!saved || saved.conversationId || saved.draftId !== target.id) return false
        stopRef.current?.(); execution.cancel(); setFollowing(null); setLoadingConversation(false)
        if (signal.aborted || useChatStore.getState().accountId !== userId) return false
        const choices = restoreChatChoices(saved, useDesktopStore.getState().bootstrap?.settings.agent ?? defaultState.settings.agent)
        useChatStore.setState({ conversationId: null, draftId: saved.draftId, draftNovelId: saved.novelId, draft: saved.draft,
          pendingNovelTitle: saved.pendingNovelTitle, pendingNovelPosition: saved.pendingNovelPosition ?? null, novelCreationRequestId: saved.novelCreationRequestId,
          pendingRequest: saved.pendingRequest ?? null, draftAction: saved.action ?? null, pendingPlan: null, pendingQuestion: null,
          queuedMessages: structuredClone(saved.queuedMessages), queuePaused: true, suspendedExecution: saved.wasRunning || saved.awaitingQuestion,
          ...choices, recoveryStatus: "ready", isGenerating: false, creatingNovel: false,
          recoveryNotice: saved.wasRunning || saved.awaitingQuestion ? "已恢复草稿，执行状态需核对，尚未自动发送。" : saved.queuedMessages.length || saved.pendingRequest ? "已恢复待确认草稿和队列，尚未发送。" : null })
        setActiveNovelId(saved.novelId); setMessages([])
      }
      if (signal.aborted || useChatStore.getState().accountId !== userId) return false
      useChatStore.getState().requestChatFocus()
      return true
    } })
    return () => { lifetime.abort(); unregister() }
  }, [userId, sessionRepo, execution, loadConversation])

  useEffect(() => {
    let cancelled = false
    let writing = false
    const { entry, error } = sessionRepo.read()
    const initial = entry ?? emptyChatSession()
    const initialChoices = restoreChatChoices(initial, useDesktopStore.getState().bootstrap?.settings.agent ?? defaultState.settings.agent)
    useChatStore.setState({ accountId: userId, requestedConversationId: null, newConversationRequested: false, newConversationPayload: null, recoveryStatus: "restoring", storageNotice: error ?? null, isGenerating: false, creatingNovel: false,
      conversationId: initial.conversationId, draftAction: initial.action ?? null, pendingPlan: null, pendingRequest: initial.pendingRequest ?? null, draftId: initial.draftId, draft: initial.draft, draftNovelId: initial.novelId,
      pendingNovelTitle: initial.pendingNovelTitle, pendingNovelPosition: initial.pendingNovelPosition ?? null, novelCreationRequestId: initial.novelCreationRequestId,
      queuedMessages: initial.queuedMessages, queuePaused: true, pendingQuestion: null, suspendedExecution: initial.wasRunning || initial.awaitingQuestion,
      ...initialChoices, recoveryNotice: initial.wasRunning || initial.awaitingQuestion ? "上次对话的执行状态待核对，请先查看已保存的消息和改动。" : initial.queuedMessages.length ? "已恢复待确认队列，尚未发送。" : null })
    const unsubscribe = useChatStore.subscribe(state => {
      if (writing || state.accountId !== userId || state.recoveryStatus !== "ready") return
      writing = true
      try {
        const warning = sessionRepo.save({ draftId: state.draftId, conversationId: state.conversationId, novelId: state.draftNovelId, draft: state.draft,
          pendingNovelTitle: state.pendingNovelTitle, pendingNovelPosition: state.pendingNovelPosition, novelCreationRequestId: state.novelCreationRequestId, modelChoice: state.modelChoice, modelChoiceExplicit: state.modelChoiceExplicit, mode: state.mode, modeExplicit: state.modeExplicit,
          queuedMessages: state.queuedMessages, wasRunning: state.isGenerating || state.creatingNovel || state.suspendedExecution, awaitingQuestion: !!state.pendingQuestion, pendingRequest: state.pendingRequest, action: state.draftAction })
        if (warning !== state.storageNotice) useChatStore.setState({ storageNotice: warning })
      } finally { writing = false }
    })
    const restore = async () => {
      if (initial.conversationId) await loadConversation(initial.conversationId)
      else setActiveNovelId(initial.novelId)
      if (!cancelled && useChatStore.getState().draftId === initial.draftId) useChatStore.setState({ recoveryStatus: "ready", queuePaused: true })
    }
    void restore()
    return () => { cancelled = true; unsubscribe() }
  }, [userId, sessionRepo, loadConversation])

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel("xaanink-chat-account")
    channel.onmessage = event => {
      if (event.data?.type !== "logout" || event.data.userId !== userId || useChatStore.getState().accountId !== userId) return
      execution.cancel()
      useChatStore.setState({ accountId: null, draft: "", conversationId: null, novelCreationRequestId: null, pendingNovelTitle: null, pendingNovelPosition: null, pendingQuestion: null, queuedMessages: [], isGenerating: false, recoveryStatus: "restoring" })
      try { sessionRepo.clear() } catch {}
      setMessages([]); setActiveNovelId(null)
      queryClient.clear()
      window.location.assign("/login")
    }
    return () => channel.close()
  }, [execution, queryClient, sessionRepo, userId])

  const updateActiveNovelId = useCallback((novelId: string | null) => {
    useChatStore.setState({ draftNovelId: novelId })
    setActiveNovelId(novelId)
  }, [])

  const send = useCallback(async (text: string, novelId: string | null, recovery?: { turnId: string; resume: boolean }, approval?: { turnId: string; id: string; revision: number; action: "approve" }, storySelection?: StorySelection) => {
    // 三阶段保存：发送时从暂存仓取当前作品的气泡批次，附带为 stagedChanges；
    // 气泡存在时即使无文本也可发送（消息首行序列化气泡摘要，历史可见发的是什么）。
    const stagedBatches = recovery ? [] : useStagedChangesStore.getState().takeForSend(novelId)
    const rawText = text.trim()
    const message = stagedBatches.length > 0
      ? [stagedMessageSummary(stagedBatches), rawText].filter(Boolean).join("\n")
      : rawText
    if (!message && !recovery) return false
    const store = useChatStore.getState()
    if (store.recoveryStatus !== "ready") return false
    const token = execution.begin("send")
    if (!token) return false
    let conversationId = store.conversationId
    const applyAcceptedDefaults = (value: unknown) => {
      if (recovery) return
      const parsed = taskDefaultsSchema.safeParse(value)
      if (!parsed.success) return
      const defaults = parsed.data
      useChatStore.setState(current => ({
        // A selection made while submission was pending belongs to the next
        // turn. An accepted snapshot must not erase that newer user choice.
        ...(current.modelChoiceExplicit === store.modelChoiceExplicit && current.modelChoice.modelId === store.modelChoice.modelId && current.modelChoice.effort === store.modelChoice.effort
          ? { modelChoice: { modelId: defaults.textModelId, effort: defaults.thinking === "default" ? null : defaults.thinking }, modelChoiceExplicit: true } : {}),
        ...(current.modeExplicit === store.modeExplicit && current.mode === store.mode ? { mode: defaults.mode, modeExplicit: true } : {}),
      }))
    }
    const localUserId = `local-${crypto.randomUUID()}`
    let displayId = `assistant-${crypto.randomUUID()}`
    let state = startChatStream(displayId, Date.now())
    let pendingQuestion: PendingQuestion | null = null
    let pendingPlan: ReturnType<typeof useChatStore.getState>["pendingPlan"] = null
    let ended = false, accepted = false, serverTurnId: string | undefined, submitErrorCode: string | undefined
    const requested = { clientRequestId: crypto.randomUUID(), conversationId: conversationId ?? undefined, novelId: novelId ?? undefined,
      storySelection: recovery ? undefined : storySelection, message: recovery ? undefined : message, retryOfTurnId: recovery?.turnId, resume: recovery?.resume, ...chatTaskOverrides(store, !!recovery),
      interaction: recovery ? undefined : approval ?? store.pendingQuestion?.interaction, action: recovery ? undefined : store.draftAction ?? undefined,
      ...(stagedBatches.length > 0 ? { stagedChanges: stagedBatches } : {}) }
    const body = store.pendingRequest?.body ?? JSON.stringify(requested)
    if (store.pendingRequest && (JSON.parse(body).message !== message || JSON.stringify(JSON.parse(body).storySelection) !== JSON.stringify(storySelection)) && !recovery) {
      execution.end(token); toast.error("上次发送结果待确认，请先核对上次发送"); return false
    }
    const transmittedBatches = (JSON.parse(body) as {stagedChanges?: typeof stagedBatches}).stagedChanges ?? []
    if (transmittedBatches.length) useStagedChangesStore.getState().markSent(transmittedBatches.map(b => b.batchKey), transmittedBatches, true)
    useChatStore.setState({ pendingRequest: store.pendingRequest ?? { clientRequestId: requested.clientRequestId, body }, isGenerating: true, suspendedExecution: true, recoveryNotice: null, pendingQuestion: null, pendingPlan: null, queuePaused: true })
    const initial = state.message
    setMessages(prev => [...prev.map(m => ({ ...m, canRetry: false, canResume: false })), ...(!recovery ? [{ id: localUserId, role: "user" as const, content: message, toolCalls: [], ...(stagedBatches.length > 0 ? { stagedBatches } : {}) }] : []), initial])
    const frames = new FramePublisher<ChatMessageView>(snapshot => setMessages(prev => prev.map(m => m.id === snapshot.id ? snapshot : m)), run => requestAnimationFrame(run), id => cancelAnimationFrame(id))
    // 工具参数也是逐字流；同一帧只解析和展示最新草稿，避免每个 JSON token 重绘整个工作台。
    const draftFrames = new FramePublisher<{ toolCallId: string; raw: string }>(draft => {
      if (!execution.owns(token)) return
      const activity = useStoryActivityStore.getState().activity
      if (activity?.toolCallId === draft.toolCallId && activity.conversationId === conversationId) {
        useStoryActivityStore.setState({ activity: { ...activity, text: storyDraftText(draft.raw) } })
      }
    }, run => requestAnimationFrame(run), id => cancelAnimationFrame(id))
    const publish = (urgent = true) => frames.push({ ...state.message, id: displayId }, urgent)
    const finish = (status: "succeeded" | "failed" | "interrupted" | "waiting_user", error?: string, code?: string) => {
      if (ended || !execution.owns(token)) return
      draftFrames.flush()
      ended = true; state = finalizeAttempt(state, status, Date.now(), error, code); publish()
      execution.end(token); stopRef.current = null
      useChatStore.setState({ isGenerating: false, pendingQuestion, pendingPlan,
        suspendedExecution: state.status === "interrupted" && (code !== "USER_STOPPED" || state.writeStarted || !!serverTurnId),
        queuePaused: state.status === "failed" || (state.status === "interrupted" && (state.writeStarted || code !== "USER_STOPPED" || !!serverTurnId)) || !!pendingQuestion || !!pendingPlan })
    }
    stopRef.current = () => {
      finish("interrupted", serverTurnId ? "已停止跟随，正在确认服务端取消结果" : state.writeStarted ? "已停止跟随；工具可能已写入，请先查看已保存的改动" : "已停止生成，部分输出已保留", "USER_STOPPED")
      token.controller.abort()
      if (serverTurnId) {
        const id = serverTurnId
        setFollowing(id)
        void fetch(`/api/chat/turns/${id}/cancel`, { method: "POST" }).then(async r => {
          if (!r.ok) throw new Error("取消状态待确认")
          const data = await r.json() as TurnState
          if (useChatStore.getState().conversationId !== data.turn.conversationId) return
          applyTurnState(data)
          if (!data.recovery.hasEffects && !data.recovery.unknownExternal && !["running", "queued"].includes(data.turn.status)) useChatStore.setState({ queuePaused: false })
        }).catch(() => {})
      }
    }
    let lastEventAt = Date.now(), lastProgressAt = Date.now()
    const draftInputs = new Map<string, string>()
    let lastStoryFocus = ""
    const focus = (raw: unknown, toolCallId = "") => {
      if (!novelId || !raw || typeof raw !== "object" || !("key" in raw)) return
      const key = `${toolCallId}:${raw.key}`
      if (key === lastStoryFocus) return
      lastStoryFocus = key
      focusStoryArtifact(novelId, raw)
      const activity = useStoryActivityStore.getState().activity
      if (activity) useStoryActivityStore.setState({ activity: { ...activity, artifactKey: String(raw.key), targetTabId: useTabsStore.getState().activeTabId ?? undefined } })
    }
    const watch = setInterval(() => {
      if (!execution.owns(token) || !serverTurnId) return
      const feedback = connectionFeedback(lastEventAt, lastProgressAt, Date.now())
      if (feedback === "stale") {
        useChatStore.setState({ recoveryNotice: "暂未收到连接更新，正在核对状态" })
        const id = serverTurnId
        finish("interrupted", "连接更新暂时中断，正在核对已保存的进展", "CONNECTION_STALE")
        token.controller.abort(); setFollowing(id); void reconcile(id).catch(() => {})
      } else if (feedback === "slow") useChatStore.setState({ recoveryNotice: "仍在等待模型，执行尚未结束" })
    }, 1000)
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: token.controller.signal })
      if (!execution.owns(token)) { await res.body?.cancel(); return false }
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null) as { error?: string; turnId?: string; code?: string } | null
        if (!execution.owns(token)) return false
        submitErrorCode = data?.code
        if (res.status >= 400 && res.status < 500) {
          useChatStore.setState({ pendingRequest: null })
          applySceneCommitReceipt({committed: [], conflicts: [], errors: transmittedBatches.flatMap(b => b.changes.filter(c => c.targetKind === "SCENE").map(c => ({targetKind: c.targetKind, targetId: c.targetId, targetLabel: c.targetLabel, op: c.op, operationId: (c.request.body as {operationId?: string})?.operationId, message: data?.error ?? "发送被拒绝，草稿已保留"})))})
        }
        if (data?.turnId) { serverTurnId = data.turnId; setFollowing(data.turnId) }
        throw new Error(data?.error ?? "请求失败，请稍后重试")
      }
      accepted = true
      // 服务端已受理：消耗对应气泡（未受理的失败路径保留气泡与草稿，同现有重填语义）
      if (stagedBatches.length > 0) useStagedChangesStore.getState().markSent(transmittedBatches.map(b => b.batchKey), transmittedBatches)
      // 问答提交本身可能采用候选、清空或移除内容；不依赖后续模型再次调用写工具来刷新。
      if (requested.interaction && novelId) invalidateNovelQueries(queryClient, novelId)
      if (res.headers.get("Content-Type")?.includes("application/json")) {
        const data = await res.json() as TurnState
        if (!execution.owns(token)) return false
        conversationId = data.turn.conversationId; serverTurnId = data.turn.id
        applyAcceptedDefaults(data.turn.defaultsSnapshot)
        useChatStore.setState({ conversationId, pendingRequest: null, draftNovelId: novelId })
        finish("interrupted", "正在绑定已保存的回合", "RECONCILING")
        setMessages(prev => prev.filter(m => m.id !== localUserId && m.id !== displayId))
        applyTurnState(data)
        return true
      }
      conversationId = res.headers.get("X-Conversation-Id") ?? conversationId
      serverTurnId = res.headers.get("X-Turn-Id") ?? undefined
      const serverAttempt = res.headers.get("X-Attempt-Id")
      if (serverAttempt && serverTurnId) {
        const old = displayId
        displayId = res.headers.get("X-Assistant-Message-Id") ?? serverAttempt
        state = startChatStream(serverAttempt, Date.now(), serverTurnId)
        const mapped = { ...state.message, id: displayId }, userMessageId = res.headers.get("X-User-Message-Id") ?? localUserId
        setMessages(prev => prev.map(m => m.id === old ? mapped : m.id === localUserId ? { ...m, id: userMessageId, turnId: serverTurnId } : m))
      }
      useChatStore.setState({ conversationId, draftNovelId: novelId, pendingRequest: null, draftAction: null })
      setActiveNovelId(novelId)
      for await (const event of readSSE(res.body)) {
        if (!execution.owns(token)) break
        if (event.type === "data-conversation") applyAcceptedDefaults((event.data as { defaultsSnapshot?: unknown } | null)?.defaultsSnapshot)
        lastEventAt = Date.now()
        if (event.type !== "data-heartbeat") lastProgressAt = lastEventAt
        if (event.type === "data-turn-status") {
          const created = (event.data as { novelCreated?: { id: string; title: string } } | null)?.novelCreated
          if (created?.id && conversationId) {
            novelId = created.id
            useChatStore.setState({ draftNovelId: created.id })
            setActiveNovelId(created.id)
            invalidateNovelQueries(queryClient, created.id)
            useTabsStore.getState().openTab({ id: buildTabId("story-workflow", created.id), type: "story-workflow", novelId: created.id, title: "创作进度" })
          }
        }
        if (novelId && conversationId) {
          if (event.type === "tool-input-start" && typeof event.toolName === "string" && typeof event.toolCallId === "string" && WRITE_TOOLS.has(event.toolName) && !/Review|Checkpoint|SopPlan|StoryArtifacts|^approve|^finalize/.test(event.toolName)) {
            const workflowTool = /StoryWorkflow|StoryPhase/.test(event.toolName)
            useStoryActivityStore.setState({ activity: { novelId, conversationId, toolCallId: event.toolCallId, title: TOOL_LABELS[event.toolName] ?? "更新内容", text: "", state: "working" } })
            draftInputs.set(event.toolCallId, "")
            const type = workflowTool ? "story-workflow" : "story-activity"
            useTabsStore.getState().openTab({ id: buildTabId(type, novelId), type, novelId, title: workflowTool ? "创作进度" : "正在创作" })
          }
          if (event.type === "tool-input-delta" && typeof event.toolCallId === "string" && draftInputs.has(event.toolCallId)) {
            const raw = (draftInputs.get(event.toolCallId) ?? "") + String(event.inputTextDelta ?? "")
            draftInputs.set(event.toolCallId, raw)
            const current = useStoryActivityStore.getState().activity
            if (current?.toolCallId === event.toolCallId) draftFrames.push({ toolCallId: event.toolCallId, raw })
          }
          if (event.type === "data-turn-status") {
            const data = event.data as { storyFocus?: { key?: string }; storyDraft?: { key?: string; text: string }; toolCallId?: string; saved?: boolean } | null
            if (data?.storyFocus) focus(data.storyFocus, data.toolCallId ?? useStoryActivityStore.getState().activity?.toolCallId)
            const activity = useStoryActivityStore.getState().activity
            if (activity?.conversationId === conversationId && data?.storyFocus?.key) useStoryActivityStore.setState({ activity: { ...activity, artifactKey: data.storyFocus.key } })
            if (activity?.conversationId === conversationId && data?.storyDraft) useStoryActivityStore.setState({ activity: { ...activity, artifactKey: data.storyDraft.key ?? activity.artifactKey, text: data.storyDraft.text } })
            if (data?.saved) invalidateNovelQueries(queryClient, novelId)
          }
          if (event.type === "data-story-draft") {
            const data = event.data as { key?: string; text: string }
            const current = useStoryActivityStore.getState().activity
            if (current?.conversationId === conversationId) useStoryActivityStore.setState({ activity: { ...current, artifactKey: data.key ?? current.artifactKey, text: data.text } })
          }
        }
        if (event.type === "data-turn-status" && typeof event.attemptId === "string" && event.attemptId !== state.attemptId && event.turnId === serverTurnId) {
          const old = displayId, previous = finalizeAttempt(state, "interrupted", Date.now(), "网络重试前的历史尝试", "NETWORK_RETRY").message
          const data = event.data as { assistantMessageId: string }
          displayId = data.assistantMessageId; state = startChatStream(event.attemptId, Date.now(), serverTurnId)
          const next = { ...state.message, id: displayId }
          setMessages(prev => [...prev.map(m => m.id === old ? { ...previous, id: old } : m), next])
        }
        if (event.type === "data-interaction") {
          const interaction = event.data as ChatInteraction
          if (interaction.kind === "planApproval" && serverTurnId) pendingPlan = { ...interaction, turnId: serverTurnId, payload: interaction.payload as PlanProposal }
          const parsed = parsePendingQuestion(interaction.payload)
          if (parsed && serverTurnId && interaction.kind === "question") pendingQuestion = { ...parsed, interaction: { turnId: serverTurnId, id: interaction.id, revision: interaction.revision, action: "answer" } }
        }
        if (event.type === "error") {
          const text = typeof event.errorText === "string" && /[\u4e00-\u9fff]/.test(event.errorText) ? event.errorText : classifyWireError(state.message.errorCode ?? "STREAM_INTERRUPTED").message
          finish("failed", text, state.message.errorCode ?? "STREAM_INTERRUPTED"); break
        }
        const next = reduceChatStream(state, event, Date.now())
        if (next === state) continue
        const changed = next.message !== state.message
        state = next; if (changed) publish(event.type !== "text-delta" && event.type !== "reasoning-delta")
        if (event.type === "finish") {
          const reported = (event.messageMetadata as { status?: string } | undefined)?.status
          finish(reported === "failed" ? "failed" : pendingQuestion || pendingPlan ? "waiting_user" : "succeeded", state.message.error, state.message.errorCode)
          break
        }
        if (event.type === "data-network-retry" && (event.data as { scope?: string })?.scope === "turn") pendingQuestion = null
        if (!serverTurnId && event.type === "tool-input-available" && event.toolName === "askUserQuestion") pendingQuestion = parsePendingQuestion(event.input)
        if (event.type === "tool-output-available") {
          const call = state.message.toolCalls.find(c => c.toolCallId === event.toolCallId)
          if (call?.toolName === "commitStagedChanges") applySceneCommitReceipt(event.output)
          const output = event.output as { storyFocus?: unknown; committed?: boolean; ok?: boolean } | null
          if (output?.storyFocus && output.ok !== false) focus(output.storyFocus, String(event.toolCallId ?? ""))
          const activity = useStoryActivityStore.getState().activity
          if (activity && activity.toolCallId === event.toolCallId) useStoryActivityStore.setState({ activity: { ...activity, state: call?.status === "done" && output?.committed !== false ? "saved" : "uncommitted" } })
          if (call?.status === "done" && WRITE_TOOLS.has(call.toolName) && novelId) invalidateNovelQueries(queryClient, novelId)
          if (call && SOP_PLAN_TOOLS.has(call.toolName)) invalidateSopPlan(queryClient, conversationId)
        }
      }
      if (state.finishSeen) finish(pendingQuestion || pendingPlan ? "waiting_user" : "succeeded")
      else finish("interrupted", ERROR_TEXT.connectionLostPending, "STREAM_INTERRUPTED")
      if (serverTurnId && useChatStore.getState().conversationId === conversationId) { setFollowing(serverTurnId); await reconcile(serverTurnId).catch(() => {}) }
    } catch (error) {
      if (execution.owns(token)) {
        if (!accepted) { pendingQuestion = store.pendingQuestion; pendingPlan = store.pendingPlan }
        const text = error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : ERROR_TEXT.connectionLostSaved
        finish("interrupted", text, submitErrorCode ?? "STREAM_INTERRUPTED")
        if (serverTurnId) { setFollowing(serverTurnId); await reconcile(serverTurnId).catch(() => {}) }
      }
    } finally {
      const activity = useStoryActivityStore.getState().activity
      if (activity?.conversationId === conversationId && activity.state === "working") useStoryActivityStore.setState({ activity: { ...activity, state: "uncommitted" } })
      clearInterval(watch)
      if (execution.owns(token)) finish("interrupted", ERROR_TEXT.connectionReconciling, "STREAM_INTERRUPTED")
      frames.dispose()
      draftFrames.dispose()
      token.controller.abort()
    }
    return accepted
  }, [execution, queryClient, applyTurnState, reconcile])
  const retryTurn = useCallback(async (turnId: string) => {
    if (execution.busy || recoveringRef.current) return
    const before=useChatStore.getState()
    const owner=JSON.stringify([before.accountId,before.conversationId,before.draftId]),revision=execution.revision
    const originalConversation=before.conversationId,originalNovel=before.draftNovelId
    recoveringRef.current = true
    try {
      const data = await reconcile(turnId)
      const current=useChatStore.getState()
      if (execution.revision!==revision || JSON.stringify([current.accountId,current.conversationId,current.draftId])!==owner || data.turn.id!==turnId || data.turn.conversationId!==originalConversation) return
      if (!data.recovery.canRetry && !data.recovery.canResume) return
      await send("", originalNovel, { turnId, resume: data.recovery.canResume })
    } catch (error) { toast.error(error instanceof Error ? error.message : "核对失败") }
    finally { recoveringRef.current = false }
  }, [execution, reconcile, send])
  useEffect(() => {
    if (!following) return
    const controller = new AbortController()
    let busy = false
    const delayedRetries = new Set<ReturnType<typeof setTimeout>>()
    const timer = setInterval(() => {
      if (busy || useChatStore.getState().isGenerating) return
      busy = true
      void reconcile(following, controller.signal).then(data => {
        // 自动重试白名单：错误分类为整轮可重试（retryScope === "turn"，如网络波动/生成超时）立即自动重试一次；
        // 请求受限（rate_limited）经请求层退避后仍失败，约 1 分钟后自动重试一次（限流窗口通常为分钟级）；
        // 用户取消、配额耗尽、内容审核与内部缺陷不自动重试（注定失败或需作者先处理）。
        const latest = data.attempts.find(a => a.id === data.turn.latestAttemptId)
        const code = latest?.errorCode
        if (!data.recovery.latest || !data.recovery.canRetry || !code) return
        const classified = classifyWireError(code, latest?.errorMessage)
        const isTurnRetryable = classified.retryScope === "turn"
        const isRateLimited = classified.category === "rate_limited"
        if (!isTurnRetryable && !isRateLimited) return
        if (autoRetriedRef.current.has(data.turn.id)) return
        autoRetriedRef.current.add(data.turn.id)
        if (isRateLimited && !isTurnRetryable) {
          useChatStore.setState({ recoveryNotice: "模型请求受限，约 1 分钟后自动重试本轮（也可切换其他可用模型）…" })
          const timeout = setTimeout(() => {
            delayedRetries.delete(timeout)
            if (!useChatStore.getState().isGenerating) void retryTurn(data.turn.id)
          }, 60_000)
          delayedRetries.add(timeout)
          return
        }
        useChatStore.setState({ recoveryNotice: "执行中断，正在自动重试本轮…" })
        void retryTurn(data.turn.id)
      }).catch(() => {}).finally(() => { busy = false })
    }, 2000)
    return () => { clearInterval(timer); for (const timeout of delayedRetries) clearTimeout(timeout); controller.abort() }
  }, [following, reconcile, retryTurn])
  const skipQuestion = useCallback(async () => {
    const pending = useChatStore.getState().pendingQuestion
    if (!pending?.interaction) { useChatStore.setState({ pendingQuestion: null }); return }
    const { turnId, id, revision } = pending.interaction
    const response = await fetch(`/api/chat/turns/${turnId}/interaction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, revision, action: "skip" }) })
    if (!response.ok) { toast.error("问题状态已变化，请重新核对"); return }
    applyTurnState(await response.json())
  }, [applyTurnState])
  const approvePlan = useCallback(async () => {
    const plan = useChatStore.getState().pendingPlan
    if (!plan || execution.busy || recoveringRef.current) return
    recoveringRef.current = true
    useChatStore.getState().setMode("standard")
    try {
      if (await send(`批准「${plan.payload.title}」这一版计划，请开始执行。`, useChatStore.getState().draftNovelId, undefined, { turnId: plan.turnId, id: plan.id, revision: plan.revision, action: "approve" })) {
        invalidateSopPlan(queryClient, useChatStore.getState().conversationId)
        setMessages(prev => prev.map(message => message.turnId === plan.turnId && message.interaction ? { ...message, interaction: { ...message.interaction, state: "approved" } } : message))
      }
    }
    finally { recoveringRef.current = false }
  }, [execution, send, queryClient])
  const skipPlan = useCallback(async () => {
    const plan = useChatStore.getState().pendingPlan
    if (!plan) return
    const response = await fetch(`/api/chat/turns/${plan.turnId}/interaction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: plan.id, revision: plan.revision, action: "skip" }) })
    if (response.ok) applyTurnState(await response.json()); else toast.error("计划状态已变化，请重新核对")
  }, [applyTurnState])
  const cancelFollowing = useCallback(async () => {
    if (!following) return
    const response = await fetch(`/api/chat/turns/${following}/cancel`, { method: "POST" })
    if (!response.ok) { toast.error("取消尚未确认，继续核对状态"); return }
    applyTurnState(await response.json())
  }, [following, applyTurnState])
  const reconcilePending = useCallback(async () => {
    const pending = useChatStore.getState().pendingRequest
    if (pending) { const body = JSON.parse(pending.body); await send(body.message ?? "", body.novelId ?? null, body.retryOfTurnId ? { turnId: body.retryOfTurnId, resume: body.resume } : undefined) }
  }, [send])
  return { messages, activeNovelId, setActiveNovelId: updateActiveNovelId, loadConversation, resetConversation, send, stop, retryTurn, skipQuestion, reconcilePending, cancelFollowing, following, approvePlan, skipPlan, isLoadingConversation }
}
