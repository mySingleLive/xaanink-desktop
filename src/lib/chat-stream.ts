import { parseChatParts, unresolvedToolFailures } from "./chat-parts"
import type { ChatInteraction } from "./chat-protocol"
import { WRITE_TOOL_NAMES } from "./ai/tool-names"
import { isInternalToolErrorCode } from "./ai/error-classification"
import type { ChatMessageView, ThinkingView } from "../components/chat/types"

export type AttemptStatus = "running" | "waiting_user" | "succeeded" | "failed" | "interrupted"
export type ChatEvent = Record<string, unknown>
export interface ChatStreamState {
  attemptId: string
  turnId?: string
  lastSeq: number
  status: AttemptStatus
  finishSeen: boolean
  writeStarted: boolean
  message: ChatMessageView
}

export function startChatStream(attemptId: string, now: number, turnId?: string): ChatStreamState {
  return { attemptId, turnId, lastSeq: -1, status: "running", finishSeen: false, writeStarted: false,
    message: { id: attemptId, role: "assistant", content: "", toolCalls: [], attemptId, turnId, startedAt: now, streaming: true } }
}

const freezeThinking = (thinking: ThinkingView | undefined, now: number): ThinkingView | undefined =>
  thinking?.active ? { ...thinking, active: false, durationSec: Math.max(0, Math.round((now - (thinking.startedAt ?? now)) / 1000)) } : thinking

/** 唯一结束转换：已确认结果保留；未知结果不推断成功，所有时钟有固定终点。 */
export function finalizeAttempt(state: ChatStreamState, status: Exclude<AttemptStatus, "running">, now: number, error?: string, errorCode?: string): ChatStreamState {
  if (state.status !== "running") return state
  const toolCalls = state.message.toolCalls.map(call => call.status === "running" ? { ...call, status: "unknown" as const } : call)
  const unknown = toolCalls.some(call => call.status === "unknown")
  const interaction = state.message.interaction
  const toolFailure = unresolvedToolFailures(toolCalls.filter(call => !(interaction && call.toolName === (interaction.kind === "question" ? "askUserQuestion" : "proposePlan")))).at(-1)
  if ((status === "succeeded" || status === "waiting_user") && unknown) { status = "interrupted"; error = "部分工具结果待确认，请先查看已保存的改动"; errorCode = "STREAM_INTERRUPTED" }
  else if ((status === "succeeded" || status === "waiting_user" || status === "failed") && toolFailure) { status = "failed"; error ??= toolFailure.message; errorCode ??= toolFailure.code }
  else if (state.message.errorCode === "ACTION_NOT_COMPLETED") { status = "failed"; error = state.message.error; errorCode = "ACTION_NOT_COMPLETED" }
  return { ...state, status, message: { ...state.message, toolCalls, thinking: freezeThinking(state.message.thinking, now),
    networkRetry: undefined, streaming: false, endedAt: now, status, error, errorCode,
    hasWriteEffects: state.writeStarted, workedSeconds: Math.max(0, Math.round((now - (state.message.startedAt ?? now)) / 1000)) } }
}

/** 不修改旧快照；带服务器身份/序号的包在入口去重，旧执行的包永不越界。 */
export function reduceChatStream(state: ChatStreamState, event: ChatEvent, now: number): ChatStreamState {
  if (state.status !== "running" || (event.attemptId && event.attemptId !== state.attemptId) || (event.turnId && state.turnId && event.turnId !== state.turnId)) return state
  if (typeof event.seq === "number" && (!Number.isSafeInteger(event.seq) || event.seq <= state.lastSeq)) return state
  let next = { ...state, lastSeq: typeof event.seq === "number" ? event.seq : state.lastSeq }
  const m = state.message
  switch (event.type) {
    case "data-subagent-progress": {
      const data = event.data as { runId?: string; agentKind?: string; task?: string; stage?: string; startedAt?: string }
      if (!data?.runId) break
      const run = { runId: data.runId, agentKind: data.agentKind ?? "writer", task: data.task ?? "", stage: data.stage ?? "waiting_model", startedAt: data.startedAt ?? new Date(now).toISOString() }
      next.message = { ...m, liveRuns: [...(m.liveRuns ?? []).filter(r => r.runId !== run.runId), run] }; break
    }
    case "data-turn-status": {
      const data = event.data as { stage?: string; estimateMs?: unknown } | undefined
      next.message = { ...m, stage: data?.stage, ...(typeof data?.estimateMs === "number" && Number.isFinite(data.estimateMs) ? { estimateMs: data.estimateMs } : {}) }; break
    }
    case "data-write-started": next.writeStarted = true; break
    case "data-chat-error": {
      const data = event.data as { code?: string; hasWriteEffects?: boolean } | undefined
      next.writeStarted ||= data?.hasWriteEffects === true
      next.message = { ...m, errorCode: data?.code }; break
    }
    case "reasoning-start":
      next.message = { ...m, networkRetry: undefined, thinking: { text: "", startedAt: now, active: true, durationSec: null } }; break
    case "reasoning-delta":
      next.message = { ...m, networkRetry: undefined, thinking: { ...(m.thinking ?? { startedAt: now, durationSec: null }), active: true, text: (m.thinking?.text ?? "") + String(event.delta ?? "") } }; break
    case "reasoning-end": next.message = { ...m, thinking: freezeThinking(m.thinking, now) }; break
    case "text-delta": {
      const delta = String(event.delta ?? ""), parts = m.parts ?? [], last = parts.at(-1)
      const updated = last?.type === "text" ? [...parts.slice(0, -1), { ...last, text: last.text + delta }] : [...parts, { type: "text" as const, id: `${state.attemptId}:text:${next.lastSeq < 0 ? parts.length : next.lastSeq}`, seq: next.lastSeq < 0 ? parts.length : next.lastSeq, text: delta }]
      next.message = { ...m, parts: updated, networkRetry: undefined, thinking: freezeThinking(m.thinking, now), content: m.content + delta }; break
    }
    case "data-action-receipt": {
      const data = event.data as { completed?: boolean; message?: string; code?: string }
      if (data?.completed === false) next.message = { ...m, errorCode: data.code ?? "ACTION_NOT_COMPLETED", error: data.message ?? "这一步尚未完成，缺少实际动作回执" }; break
    }
    case "data-part": {
      const part = parseChatParts([event.data])?.[0]
      if (part) next.message = { ...m, parts: [...(m.parts ?? []).filter(p => p.id !== part.id), part] }; break
    }
    case "data-interaction": {
      const data = event.data as ChatInteraction
      const part = parseChatParts([{ type: data.kind === "planApproval" ? "plan" : "question", id: data.id, revision: data.revision, seq: Math.max(0, next.lastSeq), payload: data.payload }])?.[0]
      if (part) next.message = { ...m, interaction: data, parts: [...(m.parts ?? []).filter(p => p.id !== part.id), part] }; break
    }
    case "tool-input-start":
    case "tool-input-error":
    case "tool-input-available": {
      if (typeof event.toolCallId !== "string" || typeof event.toolName !== "string") break
      const existing = m.toolCalls.find(c => c.toolCallId === event.toolCallId)
      const invalid = event.type === "tool-input-error"
      const call = { toolCallId: event.toolCallId, toolName: event.toolName, input: event.input ?? null, output: invalid ? { ok: false, code: "TOOL_INPUT_INVALID", ...(event.toolName !== "askUserQuestion" ? { internal: true } : {}), message: event.toolName === "askUserQuestion" ? "问题未能生成，问题格式无效" : "工具参数无效，本步未执行" } : null, status: invalid ? "error" as const : "running" as const }
      next.writeStarted ||= WRITE_TOOL_NAMES.has(event.toolName)
      next.message = { ...m, parts: existing ? m.parts : [...(m.parts ?? []), { type: "tool", id: event.toolCallId, toolCallId: event.toolCallId, seq: next.lastSeq < 0 ? (m.parts?.length ?? 0) : next.lastSeq }], networkRetry: undefined, thinking: freezeThinking(m.thinking, now), toolCalls: existing
        ? m.toolCalls.map(c => c === existing && c.status === "running" ? invalid ? call : event.type === "tool-input-available" ? { ...c, input: event.input } : c : c)
        : [...m.toolCalls, call] }
      break
    }
    case "tool-output-available":
    case "tool-output-error": {
      const previous = m.toolCalls.find(call => call.toolCallId === event.toolCallId)
      const wireCode = typeof event.code === "string" ? event.code : "TOOL_FAILED"
      const output = event.type === "tool-output-error" ? previous?.output && typeof previous.output === "object" && "code" in previous.output && previous.output.code === "TOOL_INPUT_INVALID" ? previous.output : { ok: false, code: wireCode, ...(isInternalToolErrorCode(wireCode) && previous?.toolName !== "askUserQuestion" ? { internal: true } : {}), message: typeof event.errorText === "string" && /[\u4e00-\u9fff]/.test(event.errorText) ? event.errorText : "工具执行失败，请查看错误详情" } : event.output
      const failed = output != null && typeof output === "object" && "ok" in output && output.ok === false
      next.message = { ...m, networkRetry: undefined, toolCalls: m.toolCalls.map(c => c.toolCallId === event.toolCallId ? { ...c, output, status: failed ? "error" : "done" } : c) }; break
    }
    case "data-network-retry": {
      const data = event.data as { attempt?: number; maxRetries?: number; scope?: string } | undefined
      next.message = { ...m, ...(data?.scope === "turn" ? { content: "", parts: [], thinking: undefined, toolCalls: [], error: undefined } : {}),
        networkRetry: { attempt: data?.attempt ?? 1, maxRetries: data?.maxRetries ?? 0 } }; break
    }
    case "finish": {
      const total = (event.messageMetadata as { totalUsage?: { input?: number; output?: number } } | undefined)?.totalUsage
      next = { ...next, finishSeen: true, message: { ...m, ...(typeof total?.input === "number" && typeof total.output === "number" ? { roundUsage: total.input + total.output } : {}) } }; break
    }
  }
  return next
}

/** IO 所有权与 React 渲染分离。调用 begin 同步抢锁，旧 finally 不能释放新执行。 */
export class ChatExecutionController {
  private generation = 0
  private active: { generation: number; controller: AbortController; kind: "send" | "load" } | null = null
  begin(kind: "send" | "load") {
    if (kind === "send" && this.active) return null
    this.cancel()
    const token = { generation: ++this.generation, controller: new AbortController(), kind }
    this.active = token
    return token
  }
  owns(token: { generation: number }) { return this.active?.generation === token.generation }
  end(token: { generation: number }) { if (this.owns(token)) this.active = null }
  cancel() { const active = this.active; this.active = null; this.generation++; active?.controller.abort() }
  get busy() { return this.active !== null }
  /** Changes whenever an operation starts or navigation cancels its ownership. */
  get revision() { return this.generation }
}
