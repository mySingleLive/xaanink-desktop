import assert from "node:assert/strict"
import { test } from "node:test"
import { saveDesktopExport } from "../../src/lib/desktop/export"
import type { FileExportBridge, FileExportRequest, FileExportResult } from "../../desktop/shared/file-export"
import { MAX_EXPORT_BYTES } from "../../desktop/shared/file-export"
import { downloadManuscript } from "../../src/lib/manuscript-export"
const saved = (request: FileExportRequest): FileExportResult => ({ status: "saved", id: request.id, bytesWritten: request.bytes.length, sha256: "a".repeat(64) })
const bridge = (run: FileExportBridge["exportFile"]): FileExportBridge => ({ exportFile: run, cancelFileExport: async () => {} })

test("DX16-01 generated Blob uses a typed byte-only bridge and waits for the actual saved receipt", async () => {
  const gate = Promise.withResolvers<FileExportResult>(), entered = Promise.withResolvers<void>(); let request!: FileExportRequest, settled = false
  const target = bridge(async input => { request = input; entered.resolve(); return gate.promise })
  const flight = saveDesktopExport(new Blob(["源文 **中文**"]), "chapter.md", { bridge: target }).then(result => { settled = true; return result })
  await entered.promise; assert.equal(settled, false); assert.equal(request.format, "md"); assert.equal(new TextDecoder().decode(request.bytes), "源文 **中文**"); assert.deepEqual(Object.keys(request).sort(), ["bytes", "filename", "format", "id"])
  gate.resolve(saved(request)); assert.equal(await flight, true)
})
test("DX16-02 cancelled dialog reports false rather than a success", async () => { let sent = false; assert.equal(await saveDesktopExport(new Blob(["a"]), "a.txt", { bridge: bridge(async request => { sent = true; return { id: request.id, status: "cancelled" } }) }), false); assert.equal(sent, true) })
test("DX16-03 an aborted pending save cancels only its original operation and ignores a late saved result", async () => {
  const gate = Promise.withResolvers<FileExportResult>(), entered = Promise.withResolvers<void>(), controller = new AbortController(); let request!: FileExportRequest; const cancelled: string[] = []
  const target: FileExportBridge = { exportFile: async input => { request = input; entered.resolve(); return gate.promise }, cancelFileExport: async id => { cancelled.push(id) } }
  const flight = saveDesktopExport(new Blob(["a"]), "a.md", { bridge: target, signal: controller.signal }); await entered.promise; controller.abort(); assert.equal(await flight, false); assert.deepEqual(cancelled, [request.id]); gate.resolve(saved(request))
})
test("DX16-04 duplicate renderer request cannot open another save dialog", async () => {
  const gate = Promise.withResolvers<FileExportResult>(), entered = Promise.withResolvers<void>(); let calls = 0, request!: FileExportRequest
  const target = bridge(async input => { calls++; request = input; entered.resolve(); return gate.promise }), first = saveDesktopExport(new Blob(["a"]), "a.md", { bridge: target })
  await entered.promise; await assert.rejects(saveDesktopExport(new Blob(["b"]), "b.md", { bridge: target }), /正在保存/); assert.equal(calls, 1); gate.resolve(saved(request)); assert.equal(await first, true)
})
test("DX16-05 oversized blobs fail before any byte allocation or IPC, and pre-cancelled saves do nothing", async () => {
  let calls = 0; const target = bridge(async request => { calls++; return saved(request) }), oversized = new Blob([new Uint8Array(MAX_EXPORT_BYTES + 1)])
  await assert.rejects(saveDesktopExport(oversized, "a.md", { bridge: target }), /32MiB/); const controller = new AbortController(); controller.abort(); assert.equal(await saveDesktopExport(new Blob(["a"]), "a.md", { bridge: target, signal: controller.signal }), false); assert.equal(calls, 0)
})
test("DX16-06 mismatched ACK and unsafe rejection do not masquerade as saved or leak raw errors", async () => {
  await assert.rejects(saveDesktopExport(new Blob(["a"]), "a.md", { bridge: bridge(async request => ({ ...saved(request), id: crypto.randomUUID() })) }), /保存回执/)
  await assert.rejects(saveDesktopExport(new Blob(["a"]), "a.md", { bridge: bridge(async () => { throw Error("secret private-path") }) }), error => error instanceof Error && !/secret|private-path/.test(error.message))
})
test("DX16-07 an ordinary HTTP Web page keeps its original objectURL download and cleanup", async t => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window"), oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document"); let clicked = 0, removed = 0, appended = 0, revoked = ""
  const anchor = { href: "", download: "", click: () => { clicked++ }, remove: () => { removed++ } }
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { protocol: "http:" } } }); Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => anchor, body: { appendChild: () => { appended++ } } } })
  t.mock.method(URL, "createObjectURL", () => "blob:controlled-web"); t.mock.method(URL, "revokeObjectURL", (url: string) => { revoked = url }); t.mock.timers.enable({ apis: ["setTimeout"] })
  try { assert.equal(await downloadManuscript(new Blob(["Web正文"]), "web.md"), true); assert.equal(anchor.download, "web.md"); assert.equal(anchor.href, "blob:controlled-web"); assert.equal(clicked, 1); assert.equal(appended, 1); assert.equal(removed, 1); t.mock.timers.tick(60000); assert.equal(revoked, "blob:controlled-web") }
  finally { t.mock.restoreAll(); t.mock.timers.reset(); for (const [key, descriptor] of [["window", oldWindow], ["document", oldDocument]] as const) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) } }
})
