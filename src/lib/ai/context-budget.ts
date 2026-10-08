/**
 * 对话上下文预算与压缩规划（纯函数，无 IO——单测直接灌假数据）。
 * 设计见 design/research/context-management-tech.md。
 *
 * 核心思想（Anthropic compaction / Claude Code auto-compact 同构）：
 * 「有效预算 = contextWindow − 输出预留」；估算输入超过有效预算 × 触发线时，
 * 把更早的消息滚动收编进会话摘要，最近若干条原文逐字保留。
 */

import type { Message } from "@/generated/prisma/client"

/** DB 载入条数上限（取代旧 HISTORY_LIMIT=20 的语义；实际带进上下文的条数由 token 预算决定） */
export const HISTORY_LOAD_LIMIT = 200
/** 任何情况下至少原文保留的最近消息数（约 2 轮；当前用户消息永远逐字保留——Manus「保留最近行为节律」） */
export const MIN_RECENT_MESSAGES = 4
/** 触发线：估算 > 有效预算 × 0.85 即压缩（Claude Code 在 ~95% 触发，本链路每轮重建系统提示，取更保守值） */
export const TRIGGER_RATIO = 0.85
/** 目标线：压缩后 ≤ 有效预算 × 0.60（余量换多轮安稳，避免每轮都摘要） */
export const TARGET_RATIO = 0.6
/** 单块 digest 的估算上限：超出则分块迭代精炼（正常对话 200 条以内一块就够） */
export const DIGEST_CHUNK_TOKENS = 20_000

/** 每条消息的结构开销（角色标记、分隔等） */
const PER_MESSAGE_OVERHEAD = 8

/**
 * 输出预留：覆盖本轮 ≤32 步工具循环的产出与回读（章正文回读可达上万 token）。
 * 小窗口按比例缩，大窗口封顶 32k。
 */
export function reserveOutputTokens(contextWindow: number): number {
  return Math.min(32768, Math.max(2048, Math.floor(contextWindow * 0.25)))
}

/** 有效预算：窗口 − 输出预留（估算触发与目标的基准） */
export function effectiveBudget(contextWindow: number): number {
  return Math.max(1024, contextWindow - reserveOutputTokens(contextWindow))
}

/** 摘要预算上限：随窗口缩放（128k 窗口 → 4000；24k 窗口 → 1800） */
export function maxSummaryTokens(contextWindow: number): number {
  return Math.min(4000, Math.max(600, Math.floor(effectiveBudget(contextWindow) * 0.25)))
}

/**
 * 估算→真实的校准：不同模型分词器对中文的实际计量差异很大（实测同一系统提示在不同
 * 模型下 0.7~2 token/字），纯启发式可能显著低估——上一轮「首步实际输入 ÷ 发送前估算」
 * 的比值就是本会话内容混合下的真实标尺，本轮估算统一乘它（缺数据时用默认值）。
 * 校准对首步口径一致：都是「不含工具循环增长的第一步模型调用输入」。
 */
export const DEFAULT_CALIBRATION = 1
/** 校准系数夹取范围（防异常轮次把标尺带飞） */
export const CALIBRATION_MIN = 0.7
export const CALIBRATION_MAX = 3

/** 从会话观测字段计算校准系数；缺分子/分母或分母为 0 时回退默认值 */
export function calibrationFactor(conversation: {
  lastFirstStepInputTokens: number | null
  lastPromptEstimate: number | null
}): number {
  const actual = conversation.lastFirstStepInputTokens
  const estimate = conversation.lastPromptEstimate
  if (!actual || !estimate || estimate <= 0) return DEFAULT_CALIBRATION
  return Math.min(CALIBRATION_MAX, Math.max(CALIBRATION_MIN, actual / estimate))
}

/** CJK 表意文字、全角形式与 CJK 标点（现代分词器对中文 ≈0.6~1 token/字，取 1 保守高估） */
const CJK_RE = /[⺀-鿿豈-﫿　-〿＀-￯]/g

/**
 * token 估算（CJK 感知启发式）：CJK 1 token/字，其余 ÷4。
 * 对 DeepSeek/Kimi/GLM 的中文是偏高估（实际 ≈0.6~0.8），对 OpenAI cl100k 接近 1:1——
 * 偏高估只会让压缩提前，不会爆窗口，方向安全。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(CJK_RE) ?? []).length
  return Math.ceil(cjk + (text.length - cjk) / 4)
}

/**
 * 单条落库消息在「回放展开」后的估算（与 toModelMessages 同构）：
 * USER 计 content；ASSISTANT 计 content + 每条写工具调用的压缩入参 JSON 与 output JSON。
 * 读工具结果本就不回放，不计。
 */
export function estimateStoredMessage(
  message: Message,
  writeCalls: { input: unknown; output: unknown }[]
): number {
  let tokens = PER_MESSAGE_OVERHEAD + estimateTokens(message.content)
  for (const call of writeCalls) {
    tokens += estimateTokens(JSON.stringify(call.input ?? {}))
    tokens += estimateTokens(JSON.stringify(call.output ?? {}))
  }
  return tokens
}

/**
 * 压缩规划：给定 live 消息（未被摘要覆盖、按时间升序）与各自的回放估算，
 * 从尾部贪心选出「预算内能原文保留的最近消息」，首个超限处切开。
 *
 * @returns splitIndex — [0, splitIndex) 待收编进摘要，[splitIndex, end) 原文保留；
 *          保底 MIN_RECENT_MESSAGES 条原文（当前用户消息必须逐字在场）。
 */
export function planSplit(messageTokens: number[], recentBudget: number): number {
  const n = messageTokens.length
  let sum = 0
  let split = n
  for (let i = n - 1; i >= 0; i--) {
    const kept = n - split
    // 已保够 MIN_RECENT_MESSAGES 条原文后，再加一条会超预算即停（保底条数优先于预算）
    if (kept >= MIN_RECENT_MESSAGES && sum + messageTokens[i] > recentBudget) break
    sum += messageTokens[i]
    split = i
  }
  return split
}
