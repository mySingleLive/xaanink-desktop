import {BusinessGate} from "../../desktop/main/business-gate"
import {staticUiResponse} from "../../desktop/main/static-ui"
import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { join, sep } from "node:path"
import { tmpdir } from "node:os"
import sharp from "sharp"
import ts from "typescript"
import { transformSync } from "esbuild"
import { localImageRequest } from "../../desktop/shared/local-images"
import { localBodyLimit, MAX_LOCAL_BODY_BYTES } from "../../desktop/shared/request-limits"
import { requestSchema, type DesktopBridge, type LocalRequest } from "../../desktop/shared/ipc"
import { installDesktopTransport } from "../../src/lib/desktop/transport"

test("IMG60-01: exact upload-route quotas agree between the shared limit and actual IPC schema, including aliases and malformed routes", () => {
  const routes = ["cover", "characters/person", "items/item", "scenes/scene"].map(entity => `/api/novels/book/${entity}/images`)
  const ordinary = 8 * 1024 * 1024, expanded = new Uint8Array(MAX_LOCAL_BODY_BYTES)
  for (const path of routes) {
    assert.equal(localBodyLimit("POST", path, "Multipart/Form-Data; boundary=test"), MAX_LOCAL_BODY_BYTES)
    const request = { version: 1, id: randomUUID(), method: "POST", path, headers: { "CoNtEnT-TyPe": "Multipart/Form-Data; boundary=test" }, body: expanded }
    assert.equal(requestSchema.safeParse(request).success, true)
    for (const change of [{ method: "PATCH" }, { method: "GET" }, { path: path + "?scope=other" }, { path: path + "/" }, { path: path.replace("/book/", "/../") }, { path: path.replace("/book/", "/book%2fother/") }, { path: path.replace("/book/", "/" + "a".repeat(201) + "/") }, { headers: { "content-type": "application/json" } }, { headers: { "content-type": "multipart/form-data" } }, { body: new Uint8Array(MAX_LOCAL_BODY_BYTES + 1) }]) assert.equal(requestSchema.safeParse({ ...request, ...change }).success, false)
    assert.equal(requestSchema.safeParse({ ...request, headers: { "content-type": request.headers["CoNtEnT-TyPe"], "Content-Type": request.headers["CoNtEnT-TyPe"] } }).success, false)
  }
  assert.equal(localBodyLimit("POST", "/api/chat", "multipart/form-data; boundary=test"), ordinary)
  assert.equal(localImageRequest("/_desktop/assets/" + randomUUID() + "/" + randomUUID() + ".png?x=1"), null)
})

test("IMG60-02: actual streamed renderer transport cancels quota overflow before IPC and forwards valid multipart bytes without array expansion", async () => {
  const previous = ["window", "location"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  const forwarded: LocalRequest[] = [], window = { fetch: async (_input: RequestInfo | URL, _init?: RequestInit) => { throw Error("unexpected network") }, addEventListener() {} }
  let cancelled = false, pull = 0
  const bridge = { subscribe: () => () => {}, request: async (input: LocalRequest) => { forwarded.push(input); throw Error("isolated wire received") }, cancelRequest: async () => {} } as unknown as DesktopBridge
  Object.defineProperty(globalThis, "window", { configurable: true, value: window }); Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://local.invalid/") })
  try {
    installDesktopTransport(bridge)
    const body = new ReadableStream<Uint8Array>({ pull(controller) { if (pull++ === 0) controller.enqueue(new Uint8Array(8 * 1024 * 1024)); else controller.enqueue(new Uint8Array(3 * 1024 * 1024)) }, cancel() { cancelled = true } })
    const request = new Request("https://local.invalid/api/novels/book/items/item/images", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=fixture" }, body, duplex: "half" } as RequestInit & { duplex: "half" })
    await assert.rejects(window.fetch(request), /正文过大/)
    assert.equal(cancelled, true); assert.equal(forwarded.length, 0)
    const payload = new Uint8Array(9 * 1024 * 1024); payload[1] = 19; payload[payload.length - 1] = 63
    const form = new FormData(); form.append("file", new File([payload], "bounded.png", { type: "image/png" }))
    await assert.rejects(window.fetch(new Request("https://local.invalid/api/novels/book/characters/person/images", { method: "POST", body: form })), /isolated wire received/)
    assert.equal(forwarded.length, 1); const received = forwarded[0]
    assert.ok(received.body instanceof Uint8Array); assert.equal(Array.isArray(received.body), false)
    const parsed = await new Request("https://local.invalid/", { method: "POST", headers: received.headers, body: new Uint8Array(received.body) }).formData()
    assert.deepEqual(new Uint8Array(await (parsed.get("file") as File).arrayBuffer()), payload)
  } finally { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) } }
})

test("IMG60-03: actual main protocol callback returns exact image bytes and HEAD/security headers, with safe failures and no arbitrary RPC", async () => {
  const source = ts.createSourceFile("main.ts", readFileSync("desktop/main/index.ts", "utf8"), ts.ScriptTarget.Latest, true)
  let callback: ts.Expression | undefined
  function visit(node: ts.Node) { if (ts.isCallExpression(node) && node.expression.getText(source) === "protocol.handle" && node.arguments[0]?.getText(source) === '"xaanink"') callback = node.arguments[1]; ts.forEachChild(node, visit) }
  visit(source); assert.ok(callback)
  const code = transformSync(`export const handler=${callback.getText(source)}`, { loader: "ts", format: "cjs" }).code
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-protocol-review-")); await mkdir(join(root, "out"))
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: "#91806a" } }).png().toBuffer()
  const calls: unknown[] = [], url = `xaanink://app/_desktop/assets/${randomUUID()}/${randomUUID()}.png`
  let mode: "valid" | "mime" | "oversized" | "failure" = "valid"
  const module = { exports: {} as { handler: (request: Request) => Promise<Response> } }
  const dependencies = { businessGate:new BusinessGate(), staticUiResponse, localImageRequest, service: { call: async (method: string, path: string) => { calls.push({ method, path }); if (mode === "failure") throw Error("private/path/must-not-leak"); return { bytes: mode === "oversized" ? new Uint8Array(10 * 1024 * 1024 + 1) : new Uint8Array(bytes), mime: mode === "mime" ? "text/html" : "image/png" } } }, app: { getAppPath: () => root }, realpath, readFile, join, sep, avatarAssets: { readAsset: async () => { throw Error("not in work-image scope") } } }
  new Function("module", "exports", ...Object.keys(dependencies), code)(module, module.exports, ...Object.values(dependencies))
  try {
    const response = await module.exports.handler(new Request(url)); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
    assert.equal(response.headers.get("content-type"), "image/png"); assert.equal(response.headers.get("content-length"), String(bytes.length)); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("content-security-policy"), "default-src 'none'")
    assert.match(response.headers.get("cache-control")!, /private.*immutable/)
    const head = await module.exports.handler(new Request(url, { method: "HEAD" })); assert.equal(head.status, 200); assert.equal(head.body, null); assert.equal(head.headers.get("content-length"), String(bytes.length))
    const before = calls.length
    for (const invalid of [url + "?x=1", url.replace(".png", ".svg"), url.replace(".png", ".png%2f.."), url.replace("xaanink://app", "xaanink://untrusted")]) assert.ok((await module.exports.handler(new Request(invalid))).status >= 400)
    assert.equal((await module.exports.handler(new Request(url, { method: "POST" }))).status, 403)
    assert.equal(calls.length, before, "invalid requests do not call the asset RPC")
    for (const next of ["mime", "oversized", "failure"] as const) { mode = next; const failed = await module.exports.handler(new Request(url)); assert.equal(failed.status, 404); assert.equal(await failed.text(), "") }
    assert.deepEqual(calls[0], { method: "image-asset", path: new URL(url).pathname })
  } finally { await rm(root, { recursive: true, force: true }) }
})
