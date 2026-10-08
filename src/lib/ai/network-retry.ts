/**
 * AI 模型调用的网络断连重试机制（2026-09）。
 *
 * 适用故障：连接不上（ECONNREFUSED/DNS）、流式中途断开（terminated/socket）、
 * 网关/限流类 HTTP 错误（408/409/429/5xx）、读取超时（TimeoutError）。
 * 不适用：用户主动中断（AbortError）、参数/鉴权/配额类 4xx——这两类立即抛错。
 *
 * 对话路由（/api/chat）的两层重试（共享同一计数预算，每次重试都经
 * data-network-retry 通知前端「网络重试 N/M」）：
 * 1. 请求层（createNetworkRetryFetch 包装模型供应商的 fetch）：单次模型调用的
 *    连接失败/429/5xx/调用级超时。只重发该次 HTTP 请求、不触碰已执行的步骤，
 *    任何时刻都安全（写工具门控不适用）。
 * 2. 整轮层（路由内的尝试循环）：流式中途断开（响应体流到一半被截断）时才整轮
 *    重跑；本轮一旦执行过写工具则不再整轮重跑（防重复落库），直接报错。
 * 一次性生成（generate.ts 的 generateText/generateJSON）走 runWithNetworkRetry
 * 透明重试（无工具调用、整次调用可安全重跑），无 UI 通道。
 *
 * 最大重试次数走后台「设置」页配置（SystemConfig 表），缺省 5 次；
 * AI SDK 内建重试统一关闭（maxRetries: 0），计数只此一处，全部可见。
 */

import { globalPrisma as prisma } from "@/lib/db"
import { classifyError, isRetryableStatusCode } from "@/lib/ai/error-classification"

/** 识别与文案已收敛到 error-classification.ts（全站唯一错误翻译入口）；此处保留转出口以兼容既有引用。 */
export { isProviderQuotaError, isRetryableNetworkError, isRetryableStatusCode, modelRetryMessage } from "@/lib/ai/error-classification"

/** SystemConfig key：AI 生成的最大网络重试次数 */
const MAX_NETWORK_RETRIES_CONFIG_KEY = "chat.network.maxNetworkRetries"

/** 默认最大重试次数（后台未配置/读取失败时生效） */
export const DEFAULT_MAX_NETWORK_RETRIES = 5
/** 后台可配置范围（0=关闭自动重试，首次失败即报错） */
export const MIN_MAX_NETWORK_RETRIES = 0
export const MAX_MAX_NETWORK_RETRIES = 20

/** 读取配置的最大网络重试次数；配置缺失/非法/读库失败一律回退默认值（绝不让配置故障阻断对话） */
export async function getMaxNetworkRetries(): Promise<number> {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: MAX_NETWORK_RETRIES_CONFIG_KEY },
    })
    const value = row?.value
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= MIN_MAX_NETWORK_RETRIES &&
      value <= MAX_MAX_NETWORK_RETRIES
    ) {
      return value
    }
  } catch (err) {
    console.warn("[network-retry] 读取最大重试次数失败，按默认值处理：", err)
  }
  return DEFAULT_MAX_NETWORK_RETRIES
}

/** 写入最大网络重试次数（后台「设置」页；入参须已校验在允许范围内） */
export async function setMaxNetworkRetries(value: number): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: MAX_NETWORK_RETRIES_CONFIG_KEY },
    update: { value },
    create: { key: MAX_NETWORK_RETRIES_CONFIG_KEY, value },
  })
}

/** 重试退避：第 N 次重试前等待 1s/2s/4s/8s…，封顶 10s（指数退避，不给故障中的网关添压） */
export function networkRetryDelayMs(retryNumber: number): number {
  const exp = Math.min(Math.max(retryNumber, 1), 5)
  return Math.min(1000 * 2 ** (exp - 1), 10_000)
}

/** 尊重服务端Retry-After；免费端点未给提示的429也留出冷却时间。 */
export function responseRetryDelayMs(response: Response, fallback: number, now = Date.now()) {
  const header = response.headers.get("retry-after")
  const requested = header ? /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now : 0
  return Math.max(fallback, Number.isFinite(requested) && requested > 0 ? Math.min(requested, 120_000) : response.status === 429 ? 15_000 : 0)
}

/** 可中断的等待：退避期间用户中断/请求关闭时以 AbortError 拒绝，重试循环立即终止 */
function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new DOMException("Aborted", "AbortError"))
    }
    const cleanup = () => signal?.removeEventListener("abort", onAbort)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export interface RunWithNetworkRetryOptions {
  /** 最大重试次数（0=不重试） */
  maxRetries: number
  /** 每次重试前回调（UI 通道/日志），retryNumber 从 1 起 */
  onRetry?: (info: { retryNumber: number; maxRetries: number; error: unknown }) => void | Promise<void>
  /** 中断信号：用户停止/连接关闭时终止重试 */
  signal?: AbortSignal | null
  /**
   * 额外重试门控（与网络可重试判定取与）：返回 false 即不再重试、原样抛错。
   * 对话路由用它实现「本轮已执行写工具则不再自动重试」（防重复落库）。
   */
  shouldRetry?: (error: unknown) => boolean
}

/**
 * 透明网络重试包装：fn 抛出可重试的网络错误时按指数退避重跑，
 * 重试次数耗尽或错误不可重试时原样抛出最后一次错误。
 */
export async function runWithNetworkRetry<T>(
  fn: () => Promise<T>,
  opts: RunWithNetworkRetryOptions
): Promise<T> {
  const maxRetries = Math.max(MIN_MAX_NETWORK_RETRIES, Math.floor(opts.maxRetries))
  let retryNumber = 0
  for (;;) {
    try {
      return await fn()
    } catch (error) {
      if (
        retryNumber >= maxRetries ||
        // 请求层重试判定收敛到错误分类：retryScope === "none"（配额/审核/内部缺陷等）不再重试
        classifyError(error).retryScope === "none" ||
        opts.signal?.aborted ||
        opts.shouldRetry?.(error) === false
      ) {
        throw error
      }
      retryNumber += 1
      await opts.onRetry?.({ retryNumber, maxRetries, error })
      await delay(networkRetryDelayMs(retryNumber), opts.signal)
    }
  }
}

// ---------------------------------------------------------------- 请求层重试（fetch 包装）

/** fetch 包装的重试信息回调 */
export interface NetworkRetryFetchHooks {
  /** 观测/测试注入：仍由本函数统一重试，不能增加计数预算。 */
  fetch?: typeof fetch
  /**
   * 一次重试即将发生（已计入共享预算）。实现方负责递增共享计数并通知 UI；
   * 返回 false 或 canRetry() 返回 false 时不再重试（错误/响应原样抛给 SDK）。
   */
  onRetry: (reason: { status?: number; error?: unknown }) => void
  /** 共享预算门控：返回 false 即不再重试 */
  canRetry: () => boolean
  /** 本次重试前的退避毫秒数（由共享计数决定，实现方通常返回 networkRetryDelayMs(used)） */
  nextDelayMs: () => number
  /** 外部中断信号（客户端断开）：中断后不再重试 */
  signal?: AbortSignal | null
}

/**
 * 包装全局 fetch，给模型供应商的 HTTP 调用加上可重试能力（AI SDK 供应商设置
 * 均接受自定义 fetch）。只重试「请求发出到响应头到达」阶段的失败：
 * - fetch 拒绝（连接失败/socket 中断/超时）
 * - 可重试状态码（408/409/425/429/5xx；读取响应体前判定，重试前取消响应体释放连接）
 * 响应体开始流动后的中途断开不在此层（fetch 已兑现），由对话路由的整轮层处理。
 *
 * 注意：若本次请求的 init.signal 已中止（SDK 调用级超时/用户中断），重试同一个
 * signal 只会立即再中止——不重试，原样抛出交由上层处理。
 */
export function createNetworkRetryFetch(hooks: NetworkRetryFetchHooks): typeof fetch {
  return async (input, init) => {
    for (;;) {
      let res: Response
      try {
        res = await (hooks.fetch ?? fetch)(input, init)
      } catch (error) {
        if (
          init?.signal?.aborted ||
          hooks.signal?.aborted ||
          classifyError(error).retryScope === "none" ||
          !hooks.canRetry()
        ) {
          throw error
        }
        hooks.onRetry({ error })
        await delay(hooks.nextDelayMs(), hooks.signal)
        continue
      }
      if (!isRetryableStatusCode(res.status) || init?.signal?.aborted || hooks.signal?.aborted || !hooks.canRetry()) {
        return res
      }
      // 释放本次响应占用的连接后重发（错误响应体对重试无价值）
      try {
        await res.body?.cancel()
      } catch {
        // 忽略释放失败
      }
      hooks.onRetry({ status: res.status })
      const signal = hooks.signal && init?.signal ? AbortSignal.any([hooks.signal, init.signal]) : hooks.signal ?? init?.signal
      await delay(responseRetryDelayMs(res, hooks.nextDelayMs()), signal)
    }
  }
}
