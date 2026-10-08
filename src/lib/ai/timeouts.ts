import { globalPrisma as prisma } from "@/lib/db"
import { waitWithAbort } from "@/lib/abortable-stream"

/** 仅限制一次连接/读响应连续无数据的时间，不限制生成或业务任务总时长。 */
export const MODEL_RESPONSE_IDLE_TIMEOUT_MS = 5 * 60_000
const CONFIG_KEY = "ai.responseIdleTimeoutMs"
let cached: { value: number; at: number } | undefined

export class ModelResponseTimeoutError extends Error {
  constructor(readonly idleMs: number) {
    super(`模型服务连续 ${Math.round(idleMs / 1000)} 秒未返回数据，请稍后继续`)
    this.name = "ModelResponseTimeoutError"
  }
}

export async function modelResponseIdleTimeoutMs(): Promise<number> {
  if (cached && Date.now() - cached.at < 60_000) return cached.value
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } })
    const value = typeof row?.value === "number" && Number.isInteger(row.value) && row.value >= 5_000 && row.value <= 30 * 60_000 ? row.value : MODEL_RESPONSE_IDLE_TIMEOUT_MS
    cached = { value, at: Date.now() }
    return value
  } catch {
    return cached?.value ?? MODEL_RESPONSE_IDLE_TIMEOUT_MS
  }
}
export function clearModelResponseTimeoutCache() { cached = undefined }

/**
 * 在供应商 HTTP 层观察原始字节：正文、推理及 SSE 心跳均表示连接仍有响应。
 * 每次等待响应头/下一段数据单独计时；消费方处理工具或排队时不计时。
 * 位于模型串行队列内部，且保留调用方取消信号与原有网络重试包装。
 */
export function modelResponseTimeoutFetch(fetcher: typeof fetch, options: { idleTimeoutMs?: number } = {}): typeof fetch {
  return async (input, init) => {
    const idleMs = options.idleTimeoutMs ?? await modelResponseIdleTimeoutMs()
    const abort = new AbortController()
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const signal = callerSignal ? AbortSignal.any([callerSignal, abort.signal]) : abort.signal
    let timer: ReturnType<typeof setTimeout> | undefined
    const clear = () => { clearTimeout(timer); timer = undefined }
    const waiting = () => { clear(); timer = setTimeout(() => abort.abort(new ModelResponseTimeoutError(idleMs)), idleMs) }
    signal.throwIfAborted()
    let response: Response
    waiting()
    try {
      response = await waitWithAbort(Promise.resolve(fetcher(input, { ...init, signal })).then(response => {
        if (signal.aborted) { void response.body?.cancel().catch(() => {}); signal.throwIfAborted() }
        return response
      }), signal)
    } finally { clear() }
    if (!response.body) return response
    const reader = response.body.getReader()
    let closed = false
    const release = () => { clear(); reader.releaseLock() }
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        waiting()
        try {
          let part: ReadableStreamReadResult<Uint8Array>
          do { part = await waitWithAbort(reader.read(), signal) } while (!part.done && !part.value.byteLength)
          clear()
          if (closed) return
          if (part.done) { closed = true; release(); controller.close() }
          else controller.enqueue(part.value)
        } catch (error) {
          clear()
          if (!closed) {
            closed = true
            controller.error(error)
            void reader.cancel(error).catch(() => {}).finally(release)
          }
        }
      },
      async cancel(reason) {
        if (closed) return
        closed = true; clear(); abort.abort(reason)
        try { await reader.cancel(reason) } finally { release() }
      },
    }, { highWaterMark: 0 })
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}
