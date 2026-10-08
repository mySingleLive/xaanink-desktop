/**
 * 对话上下文压缩管线（调研与方案：design/research/context-management*.md）。
 *
 * 触发：估算输入 tokens 超过（contextWindow − 输出预留）× 85%；
 * 动作：更早的 live 消息滚动收编进会话级增量摘要（旧摘要 + digest → 新摘要），
 *       最近若干条原文逐字保留（MIN_RECENT_MESSAGES 保底，含失败写操作回放）；
 * 落库：Conversation.{summary, summarizedThroughId, compactionCount}——消息本身不删不改，
 *       前端与历史接口完全无感知；
 * 失败：保留作者原话/交互/回执；原上下文装不下则停止，绝不静默截断。
 */

import { streamText, type LanguageModel } from "ai"

import type { AIModel, Conversation, Message } from "@/generated/prisma/client"
import {
  DIGEST_CHUNK_TOKENS,
  TARGET_RATIO,
  TRIGGER_RATIO,
  effectiveBudget,
  estimateStoredMessage,
  estimateTokens,
  maxSummaryTokens,
  planSplit,
  calibrationFactor,
} from "@/lib/ai/context-budget"
import { compactInput, storedWriteCalls, type StoredToolCall } from "@/lib/ai/chat"
import { prisma } from "@/lib/db"
import { ContextBudgetError, compactCompletedCall, protectMessage, protectionSection, type ProtectedContext } from "./context-protection"
import { currentChatExecution } from "@/lib/chat-execution"
import { waitWithAbort } from "@/lib/abortable-stream"
import { getMaxNetworkRetries, runWithNetworkRetry } from "./network-retry"

/** 摘要器输出中单个工具返回值 JSON 的截断长度 */
const DIGEST_OUTPUT_MAX = 300

/** 摘要函数签名（可注入假实现做测试；默认走本会话生效模型流式生成） */
export type SummarizeFn = (input: {
  prevSummary: string
  digest: string
  maxChars: number
}) => Promise<string>

/** 摘要调用的 token 消耗（路由层 recordUsage 记账，action=chat.compact） */
export interface CompactUsage {
  input: number
  output: number
}

export interface ManageContextInput {
  /** 与本轮 toModelMessages 使用同一回执压缩策略，预算不能按未发送的原始产物计算。 */
  compactCompleted?: boolean
  /** 灰度成本预算；undefined 保留仅按窗口的策略。工具 schema/额外指令计入硬安全预算。 */
  costBudgetTokens?: number
  extraTokens?: number
  protectedContext?: ProtectedContext[]
  /** 每次摘要调用一报告用量就记账，后续安全校验/持久化失败也不会漏记。 */
  onCompactUsage?: (usage: CompactUsage) => Promise<void>
  validateFinal?: (system: string, messages: Message[]) => number
  /** 会话行（读取 summary/summarizedThroughId/compactionCount） */
  conversation: Conversation
  /** 升序历史（含本轮新存的用户消息） */
  history: Message[]
  /** 含旧摘要段的完整系统提示（不触发压缩时原样使用） */
  system: string
  /** 用指定摘要重渲染系统提示（压缩发生后以新摘要重建） */
  renderSystem: (summary: string) => Promise<string>
  /** 本会话生效模型（摘要与对话用同一模型，质量优先） */
  model: LanguageModel
  /** 模型登记（contextWindow 来源） */
  modelRecord: AIModel
  providerOptions?: Parameters<typeof streamText>[0]["providerOptions"]
  /** 测试注入点：自定义摘要器 / 持久化 */
  summarize?: SummarizeFn
  persist?: (data: { summary: string; summarizedThroughId: string }) => Promise<void>
}

export interface ManageContextResult {
  /** 进 toModelMessages 的保留消息（未被摘要覆盖的部分） */
  messages: Message[]
  /** 本轮应使用的系统提示（含最新摘要段） */
  system: string
  /** 本轮是否发生了压缩 */
  compressed: boolean
  /** 摘要调用消耗（未压缩为 null） */
  compactUsage: CompactUsage | null
  /** 未校准估算（含额外工具/提醒），用作下一轮首步实际输入的校准分母。 */
  promptEstimate: number
}

/** 渲染待压缩消息为对话摘要（digest）：写工具调用含失败记录（模型需知道哪步没成），读工具跳过 */
export function renderDigest(messages: Message[]): string {
  const lines: string[] = []
  for (const m of messages) {
    if (m.role === "USER") {
      lines.push(`【作者】${m.content}`)
      continue
    }
    if (m.role !== "ASSISTANT") continue
    for (const call of storedWriteCalls(m.toolCalls)) {
      lines.push(`【操作】${renderCall(call)}`)
    }
    const text = m.content.trim()
    if (text) lines.push(`【参谋】${text}`)
  }
  return lines.join("\n\n")
}

function renderCall(call: StoredToolCall): string {
  const input = JSON.stringify(compactInput(call.input))
  let output = JSON.stringify(call.output ?? null) ?? "null"
  if (output.length > DIGEST_OUTPUT_MAX) {
    output = `${output.slice(0, DIGEST_OUTPUT_MAX)}…`
  }
  return `${call.toolName}(${input}) → ${output}`
}

/** 摘要器 prompt：面向任务连续性（Anthropic compaction 摘要指令同构），结构化分节对抗工件追踪丢失 */
function buildSummarizePrompt(prevSummary: string, digest: string, maxChars: number): string {
  return `你在为小说创作参谋「墨影」压缩对话历史。下面的[旧摘要]与[新增对话记录]的原文即将从对话上下文中移除，请把它们合并改写成一份新的前情摘要，让墨影在看不到原文的情况下仍能无缝继续协作。

分节输出（无内容的节写「（无）」）：
【创作进展】已完成的关键改动：建了/改了哪些角色、设定、世界观、世界线、叙事线、大纲、章节，带名称与关键 id；
【作者的决定与偏好】作者明确拍板的设定、风格要求、禁忌与审美取向；
【关键事实】作者特别强调要记住的信息（暗号、数字、日期、专有名词，必须逐字保留）；
【进行中的事项】未完成的计划、挂账待答的问题、答应作者要做的事、失败的改动及原因；
【下一步】最近约定的前进方向。

要求：用中文；总篇幅不超过约 ${maxChars} 字；专有名词、数字、id 逐字保留，不得改写；新旧内容冲突时以新内容为准；丢弃寒暄、重复表述、已被覆盖的中间方案、读工具拉取的冗长原文（只保留「读过什么+结论」）；直接输出摘要正文，不要任何额外说明。

[旧摘要]
${prevSummary.trim() || "（无）"}

[新增对话记录]
${digest}`
}

/** digest 按消息行贪心切块（单块估算 ≤ chunkTokens；超长单行独占一块） */
export function chunkDigest(digest: string, chunkTokens: number = DIGEST_CHUNK_TOKENS): string[] {
  const lines = digest.split("\n\n")
  const chunks: string[] = []
  let current: string[] = []
  let currentTokens = 0
  for (const line of lines) {
    const t = estimateTokens(line)
    if (current.length > 0 && currentTokens + t > chunkTokens) {
      chunks.push(current.join("\n\n"))
      current = []
      currentTokens = 0
    }
    current.push(line)
    currentTokens += t
  }
  if (current.length > 0) chunks.push(current.join("\n\n"))
  return chunks
}

/**
 * 上下文管理主入口：分区 → 估算 →（必要时）压缩 → 返回保留消息与最新系统提示。
 * 压缩失败时保留原文；安全预算不足会明确阻断本轮。
 */
export async function manageConversationContext(
  input: ManageContextInput
): Promise<ManageContextResult> {
  const { conversation, history, system, renderSystem, model, modelRecord } = input
  const contextWindow = modelRecord.contextWindow
  const k = calibrationFactor(conversation)
  const extra = input.extraTokens ?? 0
  const safetyBudget = effectiveBudget(contextWindow) - Math.ceil(k * extra)
  const budget = Math.min(safetyBudget, (input.costBudgetTokens ?? Infinity) - Math.ceil(k * extra))
  if (safetyBudget <= 0) throw new ContextBudgetError()
  const oldSummary = conversation.summary ?? ""
  const protectedEntries = input.protectedContext ?? history.flatMap(message => { const entry = protectMessage(message); return entry ? [entry] : [] })
  const protect = (value: string, messages: Message[]) => value + protectionSection(protectedEntries, new Set(messages.map(message => message.id)))
  /**
   * 校准系数（context-budget.ts）：估算器是纯启发式，实测各模型对中文的真实计量可达
   * 估算的 0.7~2 倍——用上一轮「首步实际输入 ÷ 发送前估算」校准本轮，全部预算比较
   * 都在校准后的真实 token 口径下进行，避免低估导致真实窗口被打爆。
   */

  // 1. 分区：游标之前的消息已被摘要覆盖；游标不在载入窗口内（历史超长被 take 截断）⇒ 全部为 live
  const cursorIdx = conversation.summarizedThroughId
    ? history.findIndex((m) => m.id === conversation.summarizedThroughId)
    : -1
  const afterCursor = history.slice(cursorIdx + 1)
  const firstUser = afterCursor.findIndex(message => message.role === "USER")
  const live = firstUser > 0 ? afterCursor.slice(firstUser) : afterCursor

  const tokensOf = (m: Message) => Math.ceil(k * estimateStoredMessage(m,
    storedWriteCalls(m.toolCalls).map(call => input.compactCompleted ? compactCompletedCall(call) : call)))
  const liveTokens = live.map(tokensOf)
  const protectedSystem = protect(system, live)
  const systemTokens = Math.ceil(k * estimateTokens(protectedSystem))
  const totalEstimate = systemTokens + liveTokens.reduce((a, b) => a + b, 0)

  // 2. 未超触发线：原样放行
  if (totalEstimate <= budget * TRIGGER_RATIO) {
    return {
      messages: live,
      system: protectedSystem,
      compressed: false,
      compactUsage: null,
      promptEstimate: input.validateFinal?.(protectedSystem, live) ?? Math.ceil(totalEstimate / k) + extra,
    }
  }

  // 3. 压缩规划：系统提示去掉旧摘要、预留新摘要上限后的空间留给最近消息原文
  const recentBudget = Math.max(
    0,
    budget * TARGET_RATIO - (systemTokens - Math.ceil(k * estimateTokens(oldSummary))) -
      maxSummaryTokens(contextWindow)
  )
  let split = planSplit(liveTokens, recentBudget)
  // 保留段从作者消息开始；防止供应商适配丢弃开头的助手工具/答复。
  while (split > 0 && live[split]?.role !== "USER") split--
  const toCompress = live.slice(0, split)
  const keep = live.slice(split)

  const unchanged = (compactUsage: CompactUsage | null = null): ManageContextResult => {
    if (totalEstimate > safetyBudget) throw new ContextBudgetError()
    return { messages: live, system: protectedSystem, compressed: false, compactUsage, promptEstimate: input.validateFinal?.(protectedSystem, live) ?? Math.ceil(totalEstimate / k) + extra }
  }
  if (toCompress.length === 0) return unchanged()

  // 4. 摘要。失败时保留原文，不能用丢弃作者要求的方式降级。
  const persist =
    input.persist ??
    (async (data: { summary: string; summarizedThroughId: string }) => {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { ...data, compactionCount: { increment: 1 } },
      })
    })
  const usage: CompactUsage = { input: 0, output: 0 }
  const summarize: SummarizeFn =
    input.summarize ??
    (async ({ prevSummary, digest, maxChars }) => {
      const execution = currentChatExecution()
      const signal = execution?.signal
      const result = await runWithNetworkRetry(async () => {
        let streamError: unknown
        const stream = streamText({ onError: ({ error }) => { streamError = error },
          model, maxRetries: 0, abortSignal: signal, providerOptions: input.providerOptions, maxOutputTokens: Math.min(8192, maxChars * 2),
          messages: [{ role: "user", content: buildSummarizePrompt(prevSummary, digest, maxChars) }],
        })
        const [text, usage, finishReason] = await waitWithAbort(Promise.all([stream.text, stream.usage, stream.finishReason]), signal)
        if (streamError) throw streamError
        return { text, usage, finishReason }
      }, { maxRetries: execution?.networkRetry?.maxRetries ?? await getMaxNetworkRetries(), signal,
        shouldRetry: execution?.networkRetry?.canRetry, onRetry: execution?.networkRetry?.notify })
      usage.input += result.usage.inputTokens ?? 0
      usage.output += result.usage.outputTokens ?? 0
      if (result.usage.inputTokens !== undefined || result.usage.outputTokens !== undefined) await input.onCompactUsage?.({ input: result.usage.inputTokens ?? 0, output: result.usage.outputTokens ?? 0 })
      if (result.finishReason === "length" || result.finishReason === "error") throw new Error("摘要未完整生成")
      return result.text
    })

  try {
    // 摘要字数与分块上限按校准换算回估算/字符尺度（摘要器与对话同模型，真实口径一致）
    const maxChars = Math.max(300, Math.floor(maxSummaryTokens(contextWindow) / k))
    const chunkCap = Math.max(2000, Math.floor(DIGEST_CHUNK_TOKENS / k))
    let newSummary = oldSummary
    const chunks = chunkDigest(renderDigest(toCompress), chunkCap)
    // 一轮最多三次摘要，避免长历史无限精炼。原记录继续受硬预算保护。
    if (chunks.length > 3 || chunks.some(chunk => estimateTokens(chunk) * k > safetyBudget)) return unchanged()
    for (const chunk of chunks) {
      const refined = (await summarize({ prevSummary: newSummary, digest: chunk, maxChars })).trim()
      if (!refined) throw new Error("摘要器返回空内容")
      newSummary = refined
    }
    const throughId = toCompress[toCompress.length - 1].id
    const newSystem = protect(await renderSystem(newSummary), keep)
    const finalEstimate = Math.ceil(k * estimateTokens(newSystem)) + keep.reduce((sum, message) => sum + tokensOf(message), 0)
    // 保真保护增加的原话也要算入窗口；校验成功才推进摘要游标。
    if (finalEstimate > safetyBudget) return unchanged(usage.input + usage.output ? usage : null)
    const promptEstimate = input.validateFinal?.(newSystem, keep) ?? Math.ceil(finalEstimate / k) + extra
    await persist({ summary: newSummary, summarizedThroughId: throughId })
    return { messages: keep, system: newSystem, compressed: true, compactUsage: usage.input + usage.output ? usage : null, promptEstimate }
  } catch (error) {
    if (error instanceof ContextBudgetError) throw error
    if (currentChatExecution()?.signal?.aborted) throw error
    console.warn("[chat] 摘要不可用，保留原文并重新检查安全预算", error instanceof Error ? error.name : "UnknownError")
    return unchanged(usage.input + usage.output ? usage : null)
  }
}
