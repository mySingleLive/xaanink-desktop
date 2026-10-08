/** 响应体被取消时同时撤销供应商请求，reader 正常/异常/取消路径均释放。 */
export function abortableStream<T>(source: ReadableStream<T>, abort: AbortController): ReadableStream<T> {
  const reader = source.getReader()
  let released = false
  const release = () => { if (!released) { released = true; reader.releaseLock() } }
  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) { release(); controller.close() }
        else controller.enqueue(value)
      } catch (error) { release(); controller.error(error) }
    },
    async cancel(reason) {
      abort.abort()
      try { await reader.cancel(reason) } finally { release() }
    },
  })
}

/** SDK 或远端未结束 promise 时，本地仍按中止信号释放等待；迟到结果有处理器，不会抛未处理异常。 */
export function waitWithAbort<T>(operation: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(operation)
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener("abort", aborted); reject(signal.reason ?? new DOMException("操作已中止", "AbortError")) }
    signal.addEventListener("abort", aborted, { once: true })
    Promise.resolve(operation).then(value => { signal.removeEventListener("abort", aborted); resolve(value) }, error => { signal.removeEventListener("abort", aborted); reject(error) })
    if (signal.aborted) aborted()
  })
}
