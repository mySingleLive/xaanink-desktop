import assert from "node:assert/strict"
import { test } from "node:test"
import type { DesktopBridge, DesktopEvent } from "../../desktop/shared/ipc"
import { installDesktopTransport } from "../../src/lib/desktop/transport"

test("IPC-02: abort and service loss promptly reject body/header waits without requiring their completion", async () => {
  let calls = 0
  let message!: (event: unknown) => void
  let requestImpl: DesktopBridge["request"] = async () => { calls++; return new Promise(() => {}) }
  let receive!: (event: DesktopEvent) => void
  const fakeWindow = { fetch: globalThis.fetch, addEventListener(_name: string, listener: typeof message) { message = listener } }
  Object.assign(globalThis, { window: fakeWindow, location: new URL("https://local.invalid/") })
  const bridge = { subscribe: (listener: typeof receive) => { receive = listener; return () => {} }, request: (request: Parameters<DesktopBridge["request"]>[0]) => requestImpl(request), cancelRequest: async () => {} } as unknown as DesktopBridge
  installDesktopTransport(bridge)
  async function promptlyRejected(result: Promise<unknown>, message: RegExp) {
    const settled = await Promise.race([result.then(() => "resolved", error => error), new Promise(resolve => setTimeout(() => resolve("pending"), 100))])
    assert.ok(settled instanceof Error, String(settled))
    assert.match(settled.message, message)
  }
  for (const reason of ["abort", "disconnected"] as const) {
    const abort = new AbortController()
    const stream = new ReadableStream<Uint8Array>() // deliberately never closes
    const request = new Request("https://local.invalid/api/novels", { method: "POST", body: stream, signal: abort.signal, duplex: "half" } as RequestInit)
    const result = fakeWindow.fetch(request)
    if (reason === "abort") abort.abort(); else receive({ type: "service-disconnected" })
    await promptlyRejected(result, /取消|断开/)
    assert.equal(calls, 0)
  }
  const headers = fakeWindow.fetch("https://local.invalid/api/novels")
  assert.equal(calls, 1)
  receive({ type: "service-disconnected" })
  await promptlyRejected(headers, /断开/)
  for (let steps = 0; steps <= 5; steps++) {
    const abort = new AbortController(); let closed = false; let started = false
    const port = { close() { closed = true }, start() { started = true }, postMessage() {}, onmessage: null }
    requestImpl = async input => {
      message({ source: fakeWindow, data: { type: "xaanink-response-port", id: input.id }, ports: [port] })
      const later = (remaining: number) => { if (remaining === 0) abort.abort(); else queueMicrotask(() => later(remaining - 1)) }
      later(steps)
      return { id: input.id, status: 200, headers: {} }
    }
    const result = fakeWindow.fetch("https://local.invalid/api/novels", { signal: abort.signal })
    await promptlyRejected(result.then(response => response.text()), /取消/)
    assert.equal(closed, true, `early delivered port closed at microtask ${steps}; started=${started}`)
  }
})
