import type { DesktopBridge } from "@desktop/shared/ipc"
import {localBodyLimit} from "@desktop/shared/request-limits"
let installed = false
/** Retain the Web request/Response/SSE contract; only the transport becomes local IPC. */
export function installDesktopTransport(bridge: DesktopBridge) {
  if (installed) return
  installed = true
  const original = window.fetch.bind(window)
  const active = new Map<string, (error: Error) => void>()
  bridge.subscribe(event => { if (event.type === "service-disconnected") for (const fail of active.values()) fail(new Error("本地服务已断开，请重新打开应用")) })
  const ports = new Map<string, { resolve(port: MessagePort): void; reject(error: Error): void }>()
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.type !== "xaanink-response-port" || event.ports.length !== 1) return
    const pending = ports.get(event.data.id)
    if (pending) { ports.delete(event.data.id); pending.resolve(event.ports[0]) } else event.ports[0].close()
  })
  window.fetch = async (input, init) => {
    const request = new Request(typeof input === "string" || input instanceof URL ? new URL(input, location.href) : input, init)
    const url = new URL(request.url)
    if (url.origin !== location.origin) throw new Error("桌面界面不直接访问远程服务")
    if (!url.pathname.startsWith("/api/")) return original(request)
    if (request.signal.aborted) throw new DOMException("请求已取消", "AbortError")
    const id = crypto.randomUUID()
    const waiting = Promise.withResolvers<MessagePort>()
    const failed = Promise.withResolvers<never>(); void failed.promise.catch(() => undefined)
    const wait = <T,>(promise: Promise<T>) => Promise.race([promise, failed.promise])
    let bodyReader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let failure: Error | undefined; let port: MessagePort | undefined; let seq = 0; let pendingRead: { resolve(): void; reject(error: Error): void } | undefined
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    const cleanup = () => { active.delete(id); ports.delete(id); port?.close(); request.signal.removeEventListener("abort", abort) }
    const fail = (error: Error) => {
      if (failure) return
      failure = error
      failed.reject(error)
      void bodyReader?.cancel(error).catch(() => undefined)
      waiting.reject(error); pendingRead?.reject(error); pendingRead = undefined
      streamController?.error(error); cleanup(); void bridge.cancelRequest(id).catch(() => undefined)
    }
    const abort = () => fail(new DOMException("请求已取消", "AbortError"))
    ports.set(id, { resolve(received) { port = received; if (failure) received.close(); else waiting.resolve(received) }, reject: waiting.reject })
    active.set(id, fail)
    request.signal.addEventListener("abort", abort, { once: true })
    // Handle cancellation while request headers are still pending.
    void waiting.promise.catch(() => undefined)
    try {
      let bytes: Uint8Array<ArrayBuffer> | undefined
      if (request.body) {
        bodyReader = request.body.getReader()
        const chunks:Uint8Array[]=[];let length=0
        const limit=localBodyLimit(request.method,url.pathname+url.search,request.headers.get("content-type"))
        try {
          for (;;) {
            const chunk = await wait(bodyReader.read())
            if (chunk.done) break
            if (length + chunk.value.byteLength > limit) { void bodyReader.cancel().catch(() => undefined); throw new Error("本地请求正文过大") }
            chunks.push(chunk.value.slice());length+=chunk.value.byteLength
          }
          bytes=new Uint8Array(length);let offset=0
          for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
        } finally { bodyReader.releaseLock(); bodyReader = undefined }
      }
      if (failure) throw failure
      if (request.signal.aborted) throw new DOMException("请求已取消", "AbortError")
      const response = await wait(bridge.request({ version: 1, id, path: url.pathname + url.search, method: request.method as "GET", headers: Object.fromEntries(request.headers), body: bytes }))
      if (failure) throw failure
      port = await wait(waiting.promise)
      if (failure) throw failure
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
          port!.onmessage = ({ data }) => {
            if (!pendingRead || data.seq !== seq) { controller.error(new Error("本地响应帧顺序无效")); pendingRead?.reject(new Error("响应帧无效")); cleanup(); void bridge.cancelRequest(id).catch(() => undefined); return }
            const pending = pendingRead; pendingRead = undefined; seq++
            if (data.error) { controller.error(new Error(data.error)); cleanup() }
            else if (data.done) { controller.close(); cleanup() }
            else if (data.bytes instanceof Uint8Array && data.bytes.byteLength <= 65536) controller.enqueue(data.bytes)
            else { controller.error(new Error("本地响应帧无效")); cleanup(); void bridge.cancelRequest(id).catch(() => undefined) }
            pending.resolve()
          }
          port!.onmessageerror = () => fail(new Error("本地响应无法解码"))
          port!.start()
        },
        pull() { return new Promise<void>((resolve, reject) => { pendingRead = { resolve, reject }; port!.postMessage({ type: "pull", seq }) }) },
        async cancel() { cleanup(); await bridge.cancelRequest(id) },
      })
      if (response.status === 204 || response.status === 304) { await body.cancel(); return new Response(null, { status: response.status, headers: response.headers }) }
      return new Response(body, { status: response.status, headers: response.headers })
    } catch (error) { cleanup(); void bridge.cancelRequest(id).catch(() => undefined); throw error }
  }
}
