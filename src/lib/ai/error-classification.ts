/**
 * 统一错误分类与文案翻译层（2026-09，S2/W2）。
 *
 * 全站唯一错误翻译入口：服务端把异常分类为 { category, code, message, retryScope, userAction }，
 * 前端按 wire code + 服务端文案查同一张表（classifyWireError）渲染错误卡与自动重试门控。
 *
 * 既有 wire code 保持稳定（QUOTA_EXHAUSTED / NETWORK_RETRY_EXHAUSTED / STREAM_INTERRUPTED /
 * EXECUTION_INTERRUPTED / PERSISTENCE_FAILED），前端既有消费方不破坏；
 * QUOTA_EXHAUSTED 一个 code 两个 category，由 message（是否含「墨滴」）区分用户充值与平台充值。
 * Prisma 结构漂移（P2021 表不存在 / P2022 列不存在，迁移未应用）识别为带具体文案的 internal：
 * 属部署缺口，重试与核对都无法恢复，必须如实引导反馈，不能给「核对后重试」的假希望。
 *
 * 本模块必须是纯模块（前后端共用）：禁止 import prisma/next/server/服务端服务；
 * QuotaExceededError、ModelResponseTimeoutError 等服务端类按 name 识别（BFS，风格同 isProviderQuotaError）。
 */

import { ContentError } from "@/lib/content-errors"

export type ErrorCategory =
  | "quota_platform" // 平台墨滴耗尽（QuotaExceededError）
  | "quota_provider" // 供应商余额/配额耗尽（HTTP 402 或明确耗尽消息）
  | "rate_limited" // 429 / 供应商繁忙码 1305
  | "model_unavailable"
  | "network" // 5xx/断连/超时网络抖动
  | "content_filter" // 内容审核
  | "response_timeout" // 模型连接持续无数据
  | "generation_timeout" // 兼容历史 W1 超时预算（GenerationTimeoutError）
  | "internal" // 内部缺陷

/** request=请求层自动重试（退避）；turn=前端可自动重试整轮一次；none=不自动重试 */
export type ErrorRetryScope = "none" | "request" | "turn"
export type ErrorUserAction = "recharge" | "switch_model" | "edit_input" | "retry" | "wait_retry" | "feedback" | "check_state"

export interface ClassifiedError {
  category: ErrorCategory
  /** 落库与 wire 的 errorCode */
  code: string
  /** 用户文案（中文，可行动） */
  message: string
  retryScope: ErrorRetryScope
  userAction: ErrorUserAction
}

const CATEGORY_DEFAULTS: Record<ErrorCategory, ClassifiedError> = {
  model_unavailable: { category: "model_unavailable", code: "MODEL_UNAVAILABLE", message: "所选模型当前不可用，请在对话设置中切换其他可用模型", retryScope: "none", userAction: "switch_model" },
  quota_platform: { category: "quota_platform", code: "QUOTA_EXHAUSTED", message: "墨滴余额不足，充值或升级套餐后继续", retryScope: "none", userAction: "recharge" },
  quota_provider: { category: "quota_provider", code: "QUOTA_EXHAUSTED", message: "模型服务余额或配额不可用，自动重试无法恢复；请等待额度恢复，或在对话设置中切换其他可用模型", retryScope: "none", userAction: "switch_model" },
  rate_limited: { category: "rate_limited", code: "RATE_LIMITED", message: "模型服务请求受限，系统已自动等待重试；持续受限请稍候，也可切换其他可用模型", retryScope: "request", userAction: "wait_retry" },
  network: { category: "network", code: "NETWORK_RETRY_EXHAUSTED", message: "网络异常，自动重试后仍无法连接模型服务，请稍后重试", retryScope: "turn", userAction: "retry" },
  content_filter: { category: "content_filter", code: "CONTENT_FILTERED", message: "内容未通过审核，请调整相关设定或表述后重试", retryScope: "none", userAction: "edit_input" },
  response_timeout: { category: "response_timeout", code: "MODEL_RESPONSE_TIMEOUT", message: "模型服务长时间未返回数据，请稍后继续；已保存内容保留", retryScope: "none", userAction: "retry" },
  generation_timeout: { category: "generation_timeout", code: "GENERATION_TIMEOUT", message: "本次生成超出时长预算，可重试或降低思考强度；长篇内容建议分段生成", retryScope: "turn", userAction: "retry" },
  internal: { category: "internal", code: "STREAM_INTERRUPTED", message: "执行未完成，请核对状态后重试；持续出现请反馈", retryScope: "none", userAction: "check_state" },
}

/** 实现细节类工具错误码（W6 受众分级）：模型可自愈/自动对齐的内部摩擦，默认视图只显中性文案，技术原文留在展开区 */
export const INTERNAL_TOOL_ERROR_CODES: ReadonlySet<string> = new Set([
  "TOOL_INPUT_INVALID",
  "TOOL_REQUEST_CONFLICT",
  "TOOL_IN_PROGRESS",
  "EFFECTS_UNCONFIRMED",
  "RECONCILIATION_REQUIRED",
  "PLAN_STALE",
  "PLAN_ITEM_STALE",
  "VERSION_CONFLICT",
  "EXECUTION_REVOKED",
])

export function isInternalToolErrorCode(code: string | null | undefined): boolean {
  return code != null && INTERNAL_TOOL_ERROR_CODES.has(code)
}

/** 各调用点的统一兜底文案（保留各自上下文补充，如「已提交改动保留」） */
export const ERROR_TEXT = {
  /** 流式 onError 兜底（route.ts 工具错误透传） */
  operationIncomplete: "操作未完成",
  /** 工具执行异常且可能有部分提交（chat-tool-execution） */
  checkSavedChanges: "操作未完成，请核对已保存的改动",
  /** 终态 part 缺省错误（chat-turn finish） */
  terminalFallback: "执行未完成",
  /** 工具失败收尾（chat-stream finalize） */
  partialToolFailure: "部分操作未完成，请查看失败的工具",
  /** 未处理异常的 HTTP 兜底（errors.ts） */
  internalServer: "服务器内部错误，请稍后重试",
  /** 前端流错误文案不可用时的兜底（use-agent-chat） */
  streamRetryLater: "生成中断，请稍后重试",
  /** 前端连接中断类（use-agent-chat，可带上下文后缀） */
  connectionLostSaved: "连接已中断，部分输出已保留",
  connectionLostPending: "连接已中断，部分输出已保留；工具结果待确认",
  connectionReconciling: "连接已中断，正在等待核对",
} as const

// ---------------------------------------------------------------- 识别（BFS，沿 cause 链与 RetryError 列表逐层检查，带环保护）

interface MaybeErrorNode {
  name?: unknown
  message?: unknown
  statusCode?: unknown
  isRetryable?: unknown
  cause?: unknown
  errors?: unknown
  lastError?: unknown
  code?: unknown
  finishReason?: unknown
  idleMs?: unknown
  budgetMs?: unknown
}

function* walkErrorNodes(error: unknown): Generator<MaybeErrorNode> {
  if (error == null) return
  const seen = new Set<unknown>()
  const queue: unknown[] = [error]
  while (queue.length > 0) {
    const e = queue.shift()
    if (e == null || typeof e !== "object" || seen.has(e)) continue
    seen.add(e)
    const err = e as MaybeErrorNode
    yield err
    if (Array.isArray(err.errors)) queue.push(...err.errors)
    if (err.lastError != null) queue.push(err.lastError)
    if (err.cause != null) queue.push(err.cause)
  }
}

function findErrorNode(error: unknown, match: (err: MaybeErrorNode) => boolean): MaybeErrorNode | null {
  for (const err of walkErrorNodes(error)) if (match(err)) return err
  return null
}

/** 网络层可重试的 Node/undici 错误码（连接被拒、重置、超时、DNS、socket 中断等） */
const RETRYABLE_NODE_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETRESET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_DESTROYED",
])

/** undici/fetch 网络失败的消息特征（连接失败、流式响应被截断等） */
const RETRYABLE_MESSAGE_PATTERN =
  /fetch failed|failed to fetch|terminated|network|socket hang up|other side closed/i

/** APICallError 可重试的状态码（与 SDK 内建判定一致并补 425；isRetryable 标记优先） */
export function isRetryableStatusCode(statusCode: number): boolean {
  return (
    statusCode === 408 || // 请求超时
    statusCode === 409 || // 冲突（SDK 语义：可重试）
    statusCode === 425 || // Too Early
    statusCode === 429 || // 限流
    statusCode >= 500 // 网关/服务故障
  )
}

// 部分供应商用 429 或普通流错误表示账户额度耗尽。只识别明确的余额/资源包
// 或周配额耗尽措辞；不能把一般 limit、429、窗口大小或请求频率当成账户配额。
const PROVIDER_BALANCE_MESSAGE_PATTERN = /\binsufficient[ _-]+(?:balance|funds|credits?)\b|余额不足|无可用资源包/i
const PROVIDER_WEEKLY_QUOTA_MESSAGE_PATTERN = /\b(?:you(?:'ve| have)\s+)?(?:reached|exceeded)\s+(?:your\s+)?(?:weekly(?:\s*\(7[- ]day\))?|7[- ]day)\s+(?:usage\s+limit|quota)\b|\b(?:weekly(?:\s*\(7[- ]day\))?|7[- ]day)\s+(?:usage\s+limit|quota)\s+(?:(?:has been|is)\s+)?(?:reached|exceeded|exhausted|used up)\b/i

/**
 * 判定错误是否属于「模型账户余额/配额耗尽」（HTTP 402 或明确耗尽消息）。
 * 重试无意义（账户不恢复永远失败），必须如实告诉作者去充值/换模型，
 * 不能落入通用「请稍后重试」文案。沿 cause 链与 RetryError 列表逐层检查（带环保护）。
 */
export function isProviderQuotaError(error: unknown): boolean {
  return findErrorNode(error, err => err.statusCode === 402 ||
    (typeof err.message === "string" && (PROVIDER_BALANCE_MESSAGE_PATTERN.test(err.message) ||
      PROVIDER_WEEKLY_QUOTA_MESSAGE_PATTERN.test(err.message)))) != null
}

/** Prisma 结构漂移码：P2021 表不存在 / P2022 列不存在（迁移未应用或库选错） */
const SCHEMA_DRIFT_PRISMA_CODES: ReadonlySet<string> = new Set(["P2021", "P2022"])
/** 结构漂移属部署缺口：重试、核对、换模型都无法恢复，只能修复部署；如实说明，不引导反复操作 */
export const SCHEMA_DRIFT_MESSAGE = "数据存储结构未就绪（服务缺少数据库迁移），请反馈；重试与其他操作无法恢复"
export function isSchemaDriftError(error: unknown): boolean {
  return findErrorNode(error, err => typeof err.code === "string" && SCHEMA_DRIFT_PRISMA_CODES.has(err.code)) != null
}

/** 限流（HTTP 429）；供应商繁忙码 1305 经分类上下文（观测到的响应体错误码）传入 */
export function isRateLimitError(error: unknown): boolean {
  return findErrorNode(error, err => err.statusCode === 429) != null
}

/** AI SDK finishReason / 错误消息中的内容审核信号 */
const CONTENT_FILTER_FINISH_REASONS: ReadonlySet<string> = new Set(["content_filter", "content-filter", "safety", "prohibited_content"])
const CONTENT_FILTER_MESSAGE_PATTERN =
  /content[_ -]?filter|moderation|内容(未通过)?(审核|审查)|安全(策略|审核|审查)|blocked due to safety|responsible\s?ai|content policy/i

export function isContentFilterError(error: unknown): boolean {
  return findErrorNode(error, err =>
    (typeof err.finishReason === "string" && CONTENT_FILTER_FINISH_REASONS.has(err.finishReason.toLowerCase())) ||
    (typeof err.message === "string" && CONTENT_FILTER_MESSAGE_PATTERN.test(err.message))) != null
}

/** 兼容旧执行记录的总时长错误；新任务仅使用响应停滞错误 */
function findGenerationTimeoutNode(error: unknown): MaybeErrorNode | null {
  return findErrorNode(error, err => err.name === "GenerationTimeoutError")
}

/**
 * 判定错误是否属于「网络原因、值得自动重试」。
 * 沿 cause 链与 SDK RetryError 的错误列表逐层检查（带环保护）：
 * 任一节点命中可重试特征即判 true；AbortError（用户中断）节点跳过；
 * 明确不可重试的 4xx（400/401/403/404/422 等）在无其他网络证据时判 false。
 */
export function isRetryableNetworkError(error: unknown): boolean {
  for (const err of walkErrorNodes(error)) {
    if (err.message === "MODEL_NETWORK_ERROR" || err.code === "MODEL_NETWORK_ERROR") return true
    // 用户主动中断（停止按钮/断开页面）：不是网络故障，不重试
    if (err.name === "AbortError" || err.name === "ResponseAborted") continue
    // 读流/请求超时（SDK setAbortTimeout 与 undici 都用 TimeoutError）
    if (err.name === "TimeoutError") return true

    // AI SDK 的 APICallError：网关包好的 HTTP/连接失败
    if (err.name === "AI_APICallError" || err.isRetryable !== undefined || err.statusCode !== undefined) {
      if (err.isRetryable === true) return true
      if (typeof err.statusCode === "number") {
        if (isRetryableStatusCode(err.statusCode)) return true
        // 明确的客户端错误（4xx 不可重试段）：不再看消息特征，但继续查 cause 里的网络证据
      } else if (typeof err.message === "string" && /cannot connect to api/i.test(err.message)) {
        // SDK 把 fetch 连接失败包成无状态码的 APICallError（isRetryable 一般已置 true，这里兜底）
        return true
      }
      continue
    }

    // Node/undici 原始网络错误
    if (typeof err.code === "string" && RETRYABLE_NODE_ERROR_CODES.has(err.code)) return true
    if (err instanceof TypeError && typeof err.message === "string" && RETRYABLE_MESSAGE_PATTERN.test(err.message)) {
      return true
    }
  }
  return false
}

export function modelRetryMessage(retries: number, providerCodes: string[] = [], statuses: Record<string, number> = {}) {
  if (providerCodes.includes("1305")) return `模型服务暂时繁忙，已等待并重试 ${retries} 次。已保存进度保留，可稍后继续或选择其他可用模型`
  if (statuses["429"]) return `模型服务正在限流，已等待并重试 ${retries} 次。已保存进度保留，请稍后继续`
  return `网络异常，实际自动重试 ${retries} 次后仍无法连接模型服务，请稍后重试`
}

// ---------------------------------------------------------------- 分类

export interface ClassifyContext {
  /** 本轮已用网络重试次数（网络/限流文案计数） */
  retryUsed?: number
  /** 观测到的供应商错误码（响应体 error.code，如 1305） */
  providerCodes?: string[]
  /** 观测到的 HTTP 状态分布 */
  statuses?: Record<string, number>
}
const MODEL_CONFIGURATION_CODES = new Set(["AUTHORIZATION_REVOKED", "MODEL_UNAVAILABLE", "MODEL_NOT_SELECTED", "MODEL_NOT_CONFIGURED", "MODEL_KIND_MISMATCH", "MODEL_THINKING_UNSUPPORTED", "MODEL_NOT_FOUND", "MODEL_DISABLED", "MODEL_KEY_MISSING"])

/** 服务端异常 → 分类表唯一映射。识别顺序即优先级：配额 > 超时 > 审核 > 限流 > 网络 > 结构漂移 > 内部。 */
export function classifyError(err: unknown, context: ClassifyContext = {}): ClassifiedError {
  const modelFailure = findErrorNode(err, e => MODEL_CONFIGURATION_CODES.has(String(e.code ?? e.message)))
  if (modelFailure) return { ...CATEGORY_DEFAULTS.model_unavailable, code: String(modelFailure.code ?? modelFailure.message) }
  if (findErrorNode(err, e => e.name === "NoModelAvailableError")) return { ...CATEGORY_DEFAULTS.model_unavailable }
  const retryUsed = context.retryUsed ?? 0
  const providerCodes = context.providerCodes ?? []
  const statuses = context.statuses ?? {}
  if (findErrorNode(err, e => e.name === "QuotaExceededError")) {
    const message = err instanceof Error && /[一-鿿]/.test(err.message) ? err.message : CATEGORY_DEFAULTS.quota_platform.message
    return { ...CATEGORY_DEFAULTS.quota_platform, message }
  }
  if (isProviderQuotaError(err)) return { ...CATEGORY_DEFAULTS.quota_provider }
  const stalled = findErrorNode(err, e => e.name === "ModelResponseTimeoutError")
  if (stalled) {
    const idleMs = typeof stalled.idleMs === "number" && stalled.idleMs > 0 ? stalled.idleMs : null
    return { ...CATEGORY_DEFAULTS.response_timeout, ...(idleMs ? { message: `模型服务连续约 ${Math.max(1, Math.round(idleMs / 60_000))} 分钟未返回数据，请稍后继续；已保存内容保留` } : {}) }
  }
  const timeout = findGenerationTimeoutNode(err)
  if (timeout) {
    const budgetMs = typeof timeout.budgetMs === "number" && timeout.budgetMs > 0 ? timeout.budgetMs : null
    if (!budgetMs) return { ...CATEGORY_DEFAULTS.generation_timeout }
    const minutes = Math.max(1, Math.round(budgetMs / 60_000))
    return { ...CATEGORY_DEFAULTS.generation_timeout, message: `本次生成超出时长预算（约 ${minutes} 分钟），可重试或降低思考强度；长篇内容建议分段生成` }
  }
  if (isContentFilterError(err)) return { ...CATEGORY_DEFAULTS.content_filter }
  if (isRateLimitError(err) || providerCodes.includes("1305")) {
    const message = providerCodes.includes("1305") || statuses["429"] ? modelRetryMessage(retryUsed, providerCodes, statuses) : CATEGORY_DEFAULTS.rate_limited.message
    return { ...CATEGORY_DEFAULTS.rate_limited, message }
  }
  if (isRetryableNetworkError(err)) return { ...CATEGORY_DEFAULTS.network, message: modelRetryMessage(retryUsed, providerCodes, statuses) }
  if (isSchemaDriftError(err)) return { ...CATEGORY_DEFAULTS.internal, message: SCHEMA_DRIFT_MESSAGE, userAction: "feedback" }
  // 本地消息schema不合法是确定性缺陷；重发相同工具回执无法修复，不能误作断流反复计费。
  if (findErrorNode(err, e => e.name === "AI_InvalidPromptError")) {
    return { category: "internal", code: "INVALID_PROMPT", message: "模型请求的消息格式异常，已保存内容保留，请反馈修复后继续", retryScope: "none", userAction: "feedback" }
  }
  return { ...CATEGORY_DEFAULTS.internal }
}

/** 前端按 wire code + 服务端文案查同一张表（QUOTA_EXHAUSTED 由文案是否含「墨滴」区分平台/供应商两侧）。 */
export function classifyWireError(code: string | null | undefined, message?: string | null): ClassifiedError {
  const text = typeof message === "string" && /[一-鿿]/.test(message) ? message : null
  if (code && MODEL_CONFIGURATION_CODES.has(code)) return { ...CATEGORY_DEFAULTS.model_unavailable, code, message: text ?? CATEGORY_DEFAULTS.model_unavailable.message }
  if (code === "QUOTA_EXHAUSTED") {
    const base = text && text.includes("墨滴") ? CATEGORY_DEFAULTS.quota_platform : CATEGORY_DEFAULTS.quota_provider
    return { ...base, message: text ?? base.message }
  }
  const category: ErrorCategory =
    code === "RATE_LIMITED" ? "rate_limited"
      : code === "NETWORK_RETRY_EXHAUSTED" ? "network"
        : code === "CONTENT_FILTERED" ? "content_filter"
          : code === "MODEL_RESPONSE_TIMEOUT" ? "response_timeout"
            : code === "GENERATION_TIMEOUT" ? "generation_timeout"
            : "internal"
  if (code === "INVALID_PROMPT") return { category: "internal", code, message: text ?? "模型请求的消息格式异常，已保存内容保留，请反馈修复后继续", retryScope: "none", userAction: "feedback" }
  const base = CATEGORY_DEFAULTS[category]
  return { ...base, code: code ?? base.code, message: text ?? base.message }
}

/** 对话路由终态链：checkpointFailure / 作者中断两个前置分支 + ContentError 业务透传优先，其余由 classifyError 驱动。 */
export function chatTerminalError(input: {
  error: unknown
  checkpointFailure?: boolean
  aborted?: boolean
  writeStarted?: boolean
  retryUsed?: number
  providerCodes?: string[]
  statuses?: Record<string, number>
}): { code: string; message: string } {
  if (input.checkpointFailure) return { code: "PERSISTENCE_FAILED", message: "回复未完整保存；已提交的内容变更仍保留，请查看内容面板" }
  if (input.aborted) return { code: "EXECUTION_INTERRUPTED", message: "执行已停止，已保存的进度保留，可核对后继续" }
  if (input.error instanceof ContentError) return { code: input.error.code, message: input.error.message + (input.writeStarted ? "；已提交改动保留，请核对当前结果" : "") }
  const classified = classifyError(input.error, input)
  if (classified.category === "internal" && !isSchemaDriftError(input.error)) {
    return { code: classified.code, message: input.writeStarted ? "生成中断，工具结果待确认，请先核对已保存的改动" : classified.message }
  }
  const suffix = input.writeStarted && classified.category !== "network" && classified.category !== "rate_limited" ? "；已提交改动保留，请核对当前结果" : ""
  return { code: classified.code, message: classified.message + suffix }
}
