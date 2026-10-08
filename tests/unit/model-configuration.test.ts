import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setImmediate as tick } from "node:timers/promises"
import { ModelGateway } from "../../desktop/core/model-authorization"
import { ModelRepository } from "../../desktop/main/model-repository"
import { ModelConfigurationService, type ModelConfigurationOptions } from "../../desktop/main/model-configuration"
import { presetsFor, type ConfigurationDraft } from "../../desktop/shared/model-catalog"

const secret = "fixture-key-main-only"
const protection = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (s: Buffer) => s.toString() }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
function draft(provider: ConfigurationDraft["provider"] = "deepseek", kind: ConfigurationDraft["kind"] = "TEXT"): ConfigurationDraft {
  const preset = presetsFor(kind).find(p => p.id === provider)!
  return { provider, kind, protocol: preset.protocol ?? "openai", endpoint: (kind === "TEXT" ? preset.textEndpoint : preset.imageEndpoint) ?? "https://fixture.invalid/v1", apiKey: secret, modelId: "fixture-model" }
}
async function fixture(fetcher: typeof fetch, overrides: Partial<ModelConfigurationOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "xuanxiang-config-")); let repository!: ModelRepository
  const gateway = new ModelGateway({ keyFor: (id, rev) => repository.keyFor(id, rev), fetch: fetcher })
  const path = join(dir, "state.json"); repository = new ModelRepository(path, protection, gateway)
  const service = new ModelConfigurationService({ repository, gateway, fetch: fetcher, timeoutMs: 500, ...overrides })
  return { service, gateway, repository, path, close: async () => { await service.close(); await rm(dir, { recursive: true, force: true }) } }
}
function failure(result: { ok: boolean; code?: string }, code: string) { assert.equal(result.ok, false); assert.equal(result.code, code) }
async function save(f: Awaited<ReturnType<typeof fixture>>, input: ConfigurationDraft) {
  const state = await f.repository.read()
  return f.repository.saveModel(state.revision, { ...input, name: "测试模型", modelId: input.modelId!, contextWindow: 0, enabled: true, thinkingLevels: [], defaultThinking: "default" })
}

test("configuration presets expose 12 text/8 image providers plus custom, isolated Tencent endpoints", () => {
  assert.equal(presetsFor("TEXT").length, 13); assert.equal(presetsFor("IMAGE").length, 9)
  assert.equal(presetsFor("IMAGE").some(p => p.id === "anthropic"), false)
  assert.equal(draft("tencent").endpoint, "https://tokenhub.tencentmaas.com/v1")
  assert.notEqual(draft("tencent").endpoint, draft("tencent", "IMAGE").endpoint)
})
test("DeepSeek discovery reads real capability metadata, never guesses names/capacity or saves Key", async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  const f = await fixture(async (url, init) => { calls.push({ url: String(url), init }); return json({ data: [
    { id: "fixture-output-text", name: "真实元数据名称", output_modalities: ["text"], input_modalities: ["image"], context_window: 1048576, max_output_tokens: 8192, effort: { supported_levels: ["low", "high"], default_level: "low" } },
    { id: "image-sounding-name", output_modalities: ["text"] }, { id: "deepseek-v4-pro-new", input_modalities: ["image"] },
  ] }) })
  try {
    const result = await f.service.discover("window", randomUUID(), draft())
    assert.equal(result.ok, true); if (!result.ok) return
    assert.deepEqual(result.models.map(m => m.id), ["fixture-output-text", "image-sounding-name"])
    assert.equal(result.models[0].contextWindow, 1048576); assert.equal(result.models[1].contextWindow, undefined)
    assert.deepEqual(result.models[0].thinkingLevels, ["low", "high"]); assert.equal(result.models[0].defaultThinking, "low")
    assert.deepEqual(result.unknownCapabilityIds, ["deepseek-v4-pro-new"]); assert.equal(result.complete, false)
    assert.equal(result.permission, "listed-unverified"); assert.equal(calls[0].url, "https://api.deepseek.com/models")
    assert.equal(new Headers(calls[0].init?.headers).get("authorization"), `Bearer ${secret}`)
    assert.equal(JSON.stringify(result).includes(secret), false); assert.equal((await f.repository.read()).revision, 0)
    await assert.rejects(readFile(f.path), { code: "ENOENT" })
  } finally { await f.close() }
})
test("Anthropic follows all bounded cursor pages and maps declared effort without assuming default", async () => {
  const urls: string[] = []; const f = await fixture(async (url, init) => {
    urls.push(String(url)); assert.equal(new Headers(init?.headers).get("x-api-key"), secret)
    assert.equal(new Headers(init?.headers).get("authorization"), null)
    return urls.length === 1 ? json({ data: [{ id: "first", display_name: "First", max_input_tokens: 200000, capabilities: { effort: { supported: true, low: { supported: true }, high: { supported: false } } } }], has_more: true, last_id: "cursor/value" }) : json({ data: [{ id: "second" }], has_more: false })
  })
  try {
    const result = await f.service.discover("window", randomUUID(), draft("anthropic")); assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.complete, true); assert.equal(result.models.length, 2)
    assert.deepEqual(result.models[0].thinkingLevels, ["low"]); assert.equal(result.models[0].defaultThinking, undefined)
    assert.equal(new URL(urls[1]).searchParams.get("after_id"), "cursor/value")
  } finally { await f.close() }
})
test("xAI text/image resource paths isolate output capability even for image-only input", async () => {
  const paths: string[] = []; const f = await fixture(async url => { paths.push(new URL(String(url)).pathname); return json({ models: [{ id: "arbitrary-id", input_modalities: ["image"], ...(paths.at(-1) === "/v1/language-models" ? { output_modalities: ["text"] } : {}) }] }) })
  try {
    const text = await f.service.discover("a", randomUUID(), draft("xai"))
    const image = await f.service.discover("a", randomUUID(), draft("xai", "IMAGE"))
    assert.equal(text.ok, true); assert.equal(image.ok, true); assert.deepEqual(paths, ["/v1/language-models", "/v1/image-generation-models"])
    if (text.ok && image.ok) { assert.equal(text.models[0].kind, "TEXT"); assert.equal(image.models[0].kind, "IMAGE") }
  } finally { await f.close() }
})
test("Google native discovery paginates, uses Key header and does not treat generateContent as proof of image output", async () => {
  const urls: string[] = []; const f = await fixture(async (url, init) => {
    urls.push(String(url)); assert.equal(new Headers(init?.headers).get("x-goog-api-key"), secret)
    return urls.length === 1 ? json({ models: [{ name: "models/gemini-3.1-flash-image", displayName: "Image", inputTokenLimit: 32768, supportedGenerationMethods: ["generateContent"] }, { name: "models/new-unclassified", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "next/page" }) : json({ models: [] })
  })
  try {
    const result = await f.service.discover("a", randomUUID(), draft("google", "IMAGE")); assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.models.map(m => m.id), ["gemini-3.1-flash-image"])
    assert.deepEqual(result.unknownCapabilityIds, ["new-unclassified"]); assert.equal(result.complete, false)
    assert.equal(new URL(urls[0]).pathname, "/v1beta/models"); assert.equal(new URL(urls[1]).searchParams.get("pageToken"), "next/page")
    assert.equal(urls.some(u => u.includes(secret)), false)
  } finally { await f.close() }
})
test("cursor loops/page and entry bounds are explicit failures, never complete truncated catalog", async () => {
  for (const mode of ["loop", "pages", "models"]) {
    const f = await fixture(async () => json({ data: [{ id: "row" }], has_more: true, last_id: "same" }), mode === "models" ? { maxModels: 1 } : { maxPages: mode === "pages" ? 1 : 10 })
    try { failure(await f.service.discover("a", randomUUID(), draft("anthropic")), "CATALOG_INCOMPLETE") } finally { await f.close() }
  }
})
test("unsupported catalog adapters and static official catalogs never fall back to GET/models", async () => {
  let calls = 0; const f = await fixture(async () => { calls++; throw Error("must not fetch") })
  try {
    for (const [provider, kind] of [["bytedance", "TEXT"], ["bytedance", "IMAGE"]] as const) { const result = await f.service.discover("a", randomUUID(), draft(provider, kind)); assert.equal(result.ok, true); if (result.ok) { assert.equal(result.complete, false); assert.equal(result.permission, "unknown") } }
    for (const [provider, kind] of [["zai", "IMAGE"], ["minimax", "TEXT"], ["minimax", "IMAGE"]] as const) {
      const result = await f.service.discover("a", randomUUID(), draft(provider, kind)); assert.equal(result.ok, true)
      if (result.ok) { assert.ok(result.models.length); assert.equal(result.complete, false); assert.equal(result.permission, "unknown"); assert.ok(result.warnings.length) }
    }
    assert.equal(calls, 0)
  } finally { await f.close() }
})
test("OpenAI catalog capabilities come from exact official IDs, unknown names are never classified by prefix", async () => {
  const f = await fixture(async () => json({ data: [{ id: "gpt-6-sol" }, { id: "gpt-image-2.5-sunburst" }, { id: "gpt-image-future" }, { id: "gpt-6-private" }] }))
  try {
    const result = await f.service.discover("a", randomUUID(), draft("openai", "IMAGE")); assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.models.map(m => m.id), ["gpt-image-2.5-sunburst"])
    assert.deepEqual(result.unknownCapabilityIds, ["gpt-image-future", "gpt-6-private"]); assert.equal(result.complete, false)
  } finally { await f.close() }
})
test("tests require explicit charge authorization and one model, return scope without raw response body", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = []; const f = await fixture(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return json({ choices: [{ message: { content: secret } }] })
  })
  try {
    failure(await f.service.test("a", randomUUID(), draft(), { authorizeCharge: false }), "CHARGE_AUTHORIZATION_REQUIRED")
    failure(await f.service.test("a", randomUUID(), { ...draft(), modelId: "" }, { authorizeCharge: true }), "INVALID_DRAFT")
    assert.equal(calls.length, 0)
    const result = await f.service.test("a", randomUUID(), draft(), { authorizeCharge: true }); assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.scope, "single-model")
    assert.equal(calls.length, 1); assert.equal(calls[0].body.model, "fixture-model"); assert.equal(calls[0].body.stream, false)
    assert.equal(JSON.stringify(result).includes(secret), false); assert.equal((await f.repository.read()).revision, 0)
  } finally { await f.close() }
})
test("each verified synchronous image adapter submits exactly one image; no download or auto-save", async () => {
  for (const provider of ["openai", "xai", "zai", "minimax"] as const) {
    let calls = 0; let body: Record<string, unknown> = {}
    const f = await fixture(async (_url, init) => { calls++; body = JSON.parse(String(init?.body)); return provider === "minimax" ? json({ base_resp: { status_code: 0 }, data: { image_urls: ["https://fixture.invalid/image"] } }) : json({ data: [{ url: "https://fixture.invalid/image" }] }) })
    try {
      const input = draft(provider, "IMAGE"); input.modelId = provider === "zai" ? "glm-image" : provider === "minimax" ? "image-01" : "fixture-image"
      const result = await f.service.test("a", randomUUID(), input, { authorizeCharge: true }); assert.equal(result.ok, true)
      // Z.AI's documented synchronous request has no n: it returns one image by contract.
      if (provider === "zai") assert.equal(body.n, undefined); else assert.equal(body.n, 1)
      assert.equal(calls, 1); assert.equal((await f.repository.read()).revision, 0)
    } finally { await f.close() }
  }
})
test("HTTP-200 business error, empty text/image or asynchronous task id never count as success", async () => {
  for (const body of [{}, { choices: [] }, { error: { message: secret } }]) {
    const f = await fixture(async () => json(body)); try { failure(await f.service.test("a", randomUUID(), draft(), { authorizeCharge: true }), "error" in body ? "HTTP_ERROR" : "INVALID_RESPONSE") } finally { await f.close() }
  }
  for (const body of [{ data: [] }, { task_id: "accepted-not-complete" }]) {
    const f = await fixture(async () => json(body)); try { failure(await f.service.test("a", randomUUID(), draft("xai", "IMAGE"), { authorizeCharge: true }), "INVALID_RESPONSE") } finally { await f.close() }
  }
  const f = await fixture(async () => json({ base_resp: { status_code: 1004, status_msg: secret }, data: { image_urls: ["url"] } }))
  try { failure(await f.service.test("a", randomUUID(), { ...draft("minimax", "IMAGE"), modelId: "image-01" }, { authorizeCharge: true }), "HTTP_ERROR") } finally { await f.close() }
})
test("errors never echo vendor body, status text, thrown error or credential", async () => {
  for (const status of [401, 403, 429, 500]) {
    const f = await fixture(async () => new Response(secret, { status, statusText: secret }))
    try { const result = await f.service.discover("a", randomUUID(), draft()); failure(result, status === 401 ? "AUTHENTICATION_FAILED" : status === 403 ? "PERMISSION_DENIED" : "HTTP_ERROR"); assert.equal(JSON.stringify(result).includes(secret), false) } finally { await f.close() }
  }
  const f = await fixture(async () => { throw Error(secret) }); try { const result = await f.service.discover("a", randomUUID(), draft()); failure(result, "NETWORK_ERROR"); assert.equal(JSON.stringify(result).includes(secret), false) } finally { await f.close() }
})
test("invalid draft/protocol/preset endpoint and cross-origin redirects never forward credentials", async () => {
  let calls = 0; const f = await fixture(async () => { calls++; return new Response(null, { status: 307, headers: { location: "https://evil.invalid/models" } }) })
  try {
    for (const input of [{ ...draft(), endpoint: "https://evil.invalid/v1" }, { ...draft(), protocol: "anthropic" as const }, { ...draft("custom"), endpoint: "http://evil.invalid" }, { ...draft(), apiKey: "key\nheader" }]) failure(await f.service.discover("a", randomUUID(), input), "INVALID_DRAFT")
    assert.equal(calls, 0)
    failure(await f.service.discover("a", randomUUID(), draft()), "NETWORK_ERROR"); assert.equal(calls, 1)
  } finally { await f.close() }
})
test("saved blank Key reuses only exact saved scope and rejects unavailable/deleted authorization", async () => {
  let calls = 0; const f = await fixture(async (_url, init) => { calls++; assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${secret}`); return json({ data: [{ id: "one", output_modalities: ["text"] }] }) })
  try {
    const state = await save(f, draft()); const id = state.models[0].id; const input = { ...draft(), id, apiKey: "" }
    for (const changed of [{ ...input, provider: "custom" as const }, { ...input, endpoint: input.endpoint + "/" }, { ...input, kind: "IMAGE" as const }]) failure(await f.service.discover("a", randomUUID(), changed), "SAVED_SCOPE_MISMATCH")
    assert.equal(calls, 0); assert.equal((await f.service.discover("a", randomUUID(), input)).ok, true)
    await f.repository.removeModel(state.revision, id)
    failure(await f.service.discover("a", randomUUID(), input), "AUTHORIZATION_REVOKED"); assert.equal(calls, 1)
  } finally { await f.close() }
})
test("cancellation is owner-scoped, cancelled IDs remain guarded while active operation bounds apply", async () => {
  const gate = Promise.withResolvers<void>(); let calls = 0; let signal!: AbortSignal
  const f = await fixture(async (_url, init) => { calls++; signal = init!.signal!; await gate.promise; return json({ data: [{ id: "late", output_modalities: ["text"] }] }) }, { maxOperations: 1 })
  const id = randomUUID(); const pending = f.service.discover("owner-a", id, draft())
  try {
    await tick(); assert.equal(calls, 1)
    f.service.cancel("owner-b", id); assert.equal(signal.aborted, false)
    failure(await f.service.discover("owner-a", id, draft()), "OPERATION_DUPLICATE")
    failure(await f.service.discover("owner-a", randomUUID(), draft()), "OPERATION_LIMIT")
    f.service.cancel("owner-a", id); failure(await pending, "CANCELLED"); assert.equal(signal.aborted, true)
    failure(await f.service.discover("owner-a", id, draft()), "OPERATION_DUPLICATE")
    gate.resolve(); await tick()
  } finally { gate.resolve(); await pending; await f.close() }
})
test("timeout and cancellation interrupt blocked response reads and discard late queued bytes", async () => {
  let cancelled = false; const f = await fixture(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"data":')); }, cancel() { cancelled = true } })), { timeoutMs: 20 })
  try { failure(await f.service.discover("a", randomUUID(), draft()), "TIMEOUT"); await tick(); assert.equal(cancelled, true) } finally { await f.close() }
  const oversized = await fixture(async () => new Response("x".repeat(1025)), { maxResponseBytes: 1024 })
  try { failure(await oversized.service.discover("a", randomUUID(), draft()), "RESPONSE_TOO_LARGE") } finally { await oversized.close() }
})
test("saved authorization revoked during key read cannot send HTTP, even if decrypted Key arrives late", async () => {
  const gate = Promise.withResolvers<void>(); let entered = false; let calls = 0
  const f = await fixture(async () => { calls++; return json({ data: [] }) })
  const state = await save(f, draft()); const model = state.models[0]
  const blockingRepository = { read: () => f.repository.read(), keyFor: async (id: string, rev: number) => { entered = true; const key = await f.repository.keyFor(id, rev); await gate.promise; return key } }
  const service = new ModelConfigurationService({ repository: blockingRepository, gateway: f.gateway, fetch: async () => { calls++; return json({ data: [] }) }, timeoutMs: 500 })
  const pending = service.discover("a", randomUUID(), { ...draft(), id: model.id, apiKey: "" })
  try {
    for (let i = 0; i < 30 && !entered; i++) await tick()
    assert.equal(entered, true); await f.repository.removeModel(state.revision, model.id)
    failure(await pending, "AUTHORIZATION_REVOKED"); gate.resolve(); await tick(); assert.equal(calls, 0)
  } finally { gate.resolve(); await service.close(); await f.close() }
})
test("Key rotation invalidates pending saved body reads, fresh draft cancellation preserves saved Key and bytes", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>; let sent = false; let cancelled = false
  const f = await fixture(async () => { sent = true; return new Response(new ReadableStream({ start(c) { controller = c; c.enqueue(new TextEncoder().encode('{"data":')); }, cancel() { cancelled = true } })) })
  try {
    const state = await save(f, draft()); const model = state.models[0]; const input = { ...draft(), id: model.id, apiKey: "" }
    const pending = f.service.discover("a", randomUUID(), input)
    for (let i = 0; i < 30 && !sent; i++) await tick()
    assert.equal(sent, true)
    const next = await f.repository.saveModel(state.revision, { ...draft(), id: model.id, apiKey: "rotated-key", name: model.name, modelId: model.modelId, contextWindow: 0, enabled: true, thinkingLevels: [], defaultThinking: "default" })
    failure(await pending, "AUTHORIZATION_REVOKED"); await tick(); assert.equal(cancelled, true)
    assert.equal(next.models[0].authRevision, model.authRevision + 1)
    assert.throws(() => controller.enqueue(new TextEncoder().encode("late")))
    const before = await readFile(f.path, "utf8"); sent = false; const id = randomUUID()
    const independent = f.service.discover("a", id, { ...input, apiKey: "fresh-draft-key" })
    for (let i = 0; i < 30 && !sent; i++) await tick()
    f.service.cancel("a", id); failure(await independent, "CANCELLED")
    assert.equal(await readFile(f.path, "utf8"), before)
    assert.equal(await f.repository.keyFor(model.id, next.models[0].authRevision), "rotated-key")
  } finally { await f.close() }
})
test("cancelled/closed operations clear long deadline timers even when upstream ignores cancellation", async () => {
  const gate = Promise.withResolvers<void>(); let calls = 0; const timers = new Set<ReturnType<typeof setTimeout>>()
  const originalSet = globalThis.setTimeout; const originalClear = globalThis.clearTimeout
  // Track only this service's 120s deadline, without changing timer semantics.
  globalThis.setTimeout = ((fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => { const handle = originalSet(fn, delay, ...args); if (delay === 120_000) timers.add(handle); return handle }) as typeof setTimeout
  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => { timers.delete(handle); originalClear(handle) }) as typeof clearTimeout
  const f = await fixture(async () => { calls++; await gate.promise; return json({ data: [] }) }, { timeoutMs: 120_000 })
  const id = randomUUID(); const pending = f.service.discover("a", id, draft())
  try {
    await tick(); assert.equal(calls, 1); assert.equal(timers.size, 1)
    f.service.cancel("a", id); failure(await pending, "CANCELLED"); assert.equal(timers.size, 0)
    await f.service.close(); failure(await f.service.discover("a", randomUUID(), draft()), "CANCELLED")
  } finally { gate.resolve(); await tick(); await f.close(); globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear }
})
test("runtime malformed test draft is a safe failure, not a thrown TypeError", async () => {
  const f = await fixture(async () => { throw Error("must not fetch") })
  try { failure(await f.service.test("a", randomUUID(), { ...draft(), modelId: 7 } as unknown as ConfigurationDraft, { authorizeCharge: true }), "INVALID_DRAFT") } finally { await f.close() }
})
test("credential echoed in catalog identity, label or thinking metadata is never returned", async () => {
  for (const row of [{ id: secret }, { id: "one", name: secret }, { id: "one", effort: { supported_levels: ['key"\\secret'], default_level: 'key"\\secret' } }]) {
    const input = { ...draft(), apiKey: row.effort ? 'key"\\secret' : secret }
    const f = await fixture(async () => json({ data: [{ ...row, output_modalities: ["text"] }] }))
    try { const result = await f.service.discover("a", randomUUID(), input); failure(result, "INVALID_RESPONSE"); assert.equal(JSON.stringify(result).includes(input.apiKey), false) } finally { await f.close() }
  }
})
test("xAI catalog includes declared aliases as usable IDs and applies total entry bounds", async () => {
  const f = await fixture(async () => json({ models: [{ id: "canonical", aliases: ["alias-a", "alias-b"], output_modalities: ["text"] }] }))
  try {
    const result = await f.service.discover("a", randomUUID(), draft("xai")); assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.models.map(m => m.id), ["canonical", "alias-a", "alias-b"])
  } finally { await f.close() }
  const limited = await fixture(async () => json({ models: [{ id: "canonical", aliases: ["alias-a", "alias-b"] }] }), { maxModels: 2 })
  try { failure(await limited.service.discover("a", randomUUID(), draft("xai")), "CATALOG_INCOMPLETE") } finally { await limited.close() }
})
test("Anthropic/custom /v1 and Google compatibility text tests use correct protocol paths and sparse bodies", async () => {
  for (const input of [draft("anthropic"), { ...draft("custom"), protocol: "anthropic" as const }, { ...draft("custom"), protocol: "anthropic" as const, endpoint: "http://127.0.0.1:4321" }, draft("google")]) {
    let url = ""; let headers = new Headers(); let body: Record<string, unknown> = {}
    const f = await fixture(async (u, init) => { url = String(u); headers = new Headers(init?.headers); body = JSON.parse(String(init?.body)); return input.protocol === "anthropic" ? json({ content: [{ type: "text", text: "OK" }] }) : json({ choices: [{ message: { content: "OK" } }] }) })
    try {
      assert.equal((await f.service.test("a", randomUUID(), input, { authorizeCharge: true })).ok, true)
      assert.equal(new URL(url).pathname, input.protocol === "anthropic" ? "/v1/messages" : "/v1beta/openai/chat/completions")
      assert.equal(headers.get(input.protocol === "anthropic" ? "x-api-key" : "authorization"), input.protocol === "anthropic" ? secret : "Bearer " + secret)
      assert.equal(body.max_tokens, 256); assert.equal(body.thinking, undefined); assert.equal(body.reasoning_effort, undefined)
    } finally { await f.close() }
  }
})
test("pre-aborted signal and stale owner cancellation stop before HTTP; cancel-owner does not touch another window", async () => {
  let calls = 0; const gate = Promise.withResolvers<void>(); const f = await fixture(async () => { calls++; await gate.promise; return json({ data: [] }) })
  try {
    failure(await f.service.discover("a", randomUUID(), draft(), AbortSignal.abort()), "CANCELLED"); assert.equal(calls, 0)
    const a = f.service.discover("a", randomUUID(), draft()); const b = f.service.discover("b", randomUUID(), draft())
    await tick(); assert.equal(calls, 2); f.service.cancelOwner("a"); failure(await a, "CANCELLED")
    gate.resolve(); assert.equal((await b).ok, true)
  } finally { gate.resolve(); await f.close() }
})
test("Moonshot and Xiaomi enumerate documented live endpoints, with exact official text annotations and unknown output isolation", async () => {
  for (const provider of ["moonshot", "xiaomi"] as const) {
    let requested = ""; const known = provider === "moonshot" ? "kimi-k3" : "mimo-v2.6-pro"
    const f = await fixture(async (url, init) => { requested = String(url); assert.equal(new Headers(init?.headers).get("authorization"), "Bearer " + secret); return json({ data: [{ id: known, ...(provider === "moonshot" ? { context_length: 262144, supports_image_in: true } : {}) }, { id: "unclassified-future-model" }] }) })
    try {
      const result = await f.service.discover("a", randomUUID(), draft(provider)); assert.equal(result.ok, true)
      if (!result.ok) return
      assert.equal(requested, draft(provider).endpoint + "/models"); assert.deepEqual(result.models.map(m => m.id), [known])
      assert.deepEqual(result.unknownCapabilityIds, ["unclassified-future-model"]); assert.equal(result.complete, false)
      if (provider === "moonshot") assert.equal(result.models[0].contextWindow, 262144)
    } finally { await f.close() }
  }
})
test("Z.AI text directory is explicitly partial official documentation, with no assumed models API", async () => {
  let calls = 0; const f = await fixture(async () => { calls++; throw Error("must not fetch") })
  try {
    const result = await f.service.discover("a", randomUUID(), draft("zai")); assert.equal(result.ok, true)
    if (result.ok) { assert.ok(result.models.some(m => m.id === "glm-5.3")); assert.equal(result.complete, false); assert.equal(result.permission, "unknown") }
    assert.equal(calls, 0)
  } finally { await f.close() }
})
test("cancelled vendor requests never exhaust live operation slots, even if all upstream Promises remain pending", async () => {
  let calls = 0; const f = await fixture(async () => { calls++; return new Promise<Response>(() => undefined) }, { maxOperations: 2 })
  try {
    for (let i = 0; i < 20; i++) {
      const id = randomUUID(); const owner = i % 2 ? "new-window" : "original-window"; const pending = f.service.discover(owner, id, draft())
      await tick(); assert.equal(calls, i + 1)
      f.service.cancel(owner, id); failure(await pending, "CANCELLED")
      failure(await f.service.discover(owner, id, draft()), "OPERATION_DUPLICATE")
    }
  } finally { await f.close() }
})
test("Moonshot/Xiaomi short text probes use their current documented completion limit parameter", async () => {
  for (const provider of ["moonshot", "xiaomi"] as const) {
    let body: Record<string, unknown> = {}; const f = await fixture(async (_url, init) => { body = JSON.parse(String(init?.body)); return json({ choices: [{ message: { content: "OK" } }] }) })
    try {
      assert.equal((await f.service.test("a", randomUUID(), draft(provider), { authorizeCharge: true })).ok, true)
      assert.equal(body.max_completion_tokens, 256); assert.equal(body.max_tokens, undefined)
    } finally { await f.close() }
  }
})
