import { waitWithAbort } from "@/lib/abortable-stream"

const lanes = new Map<string, Promise<void>>()
/** 免费端点按凭证串行，直到响应体完整消费/取消才放行，避免工具内评审与主回复争用并发。 */
export function serializedModelFetch(identity: string, fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const previous = lanes.get(identity) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => gate)
    lanes.set(identity, tail)
    let released = false
    const done = () => {
      if (released) return
      released = true; release()
      init?.signal?.removeEventListener("abort", done)
      if (lanes.get(identity) === tail) void tail.then(() => { if (lanes.get(identity) === tail) lanes.delete(identity) })
    }
    try {
      await waitWithAbort(previous, init?.signal ?? undefined)
      init?.signal?.throwIfAborted()
      init?.signal?.addEventListener("abort", done, { once: true })
      const response = await fetcher(input, init)
      if (!response.body) { done(); return response }
      const reader = response.body.getReader()
      let canceled = false
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          // 网络体独立排空，避免 SDK 收到工具调用后等待其执行，而嵌套评审等待同一网络队列。
          // 总量有上限，异常无限流不能持续占用内存。
          void (async () => {
            let size = 0
            try {
              while (!canceled) {
                const part = await reader.read()
                if (part.done) { if (!canceled) controller.close(); break }
                size += part.value.byteLength
                if (size > 16 * 1024 * 1024) throw new Error("模型响应超过单次安全上限，请缩小本批任务后继续")
                if (!canceled) controller.enqueue(part.value)
              }
            } catch (error) { if (!canceled) { controller.error(error); await reader.cancel(error).catch(() => {}) } }
            finally { done(); reader.releaseLock() }
          })()
        },
        async cancel(reason) { canceled = true; try { await reader.cancel(reason) } finally { done() } },
      })
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    } catch (error) { done(); throw error }
  }
}
