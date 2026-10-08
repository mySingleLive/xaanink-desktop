import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { ModelGateway } from "../../desktop/core/model-authorization"
import { ModelConfigurationService, type ModelConfigurationOptions } from "../../desktop/main/model-configuration"
import { defaultState } from "../../desktop/core/settings"
import { PROVIDER_PRESETS, type ConfigurationDraft, type ConfigurationProviderId } from "../../desktop/shared/model-catalog"

const secret = "independent-review-fixture-key"
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
function draft(provider: ConfigurationProviderId, kind: "TEXT" | "IMAGE", modelId = "fixture-model"): ConfigurationDraft {
  const preset = PROVIDER_PRESETS.find(p => p.id === provider)!
  return { provider, kind, protocol: preset.protocol!, endpoint: (kind === "TEXT" ? preset.textEndpoint : preset.imageEndpoint)!, apiKey: secret, modelId }
}
function fixture(fetcher: typeof fetch, overrides: Partial<ModelConfigurationOptions> = {}) {
  const gateway = new ModelGateway({ keyFor: async () => secret, fetch: fetcher })
  const service = new ModelConfigurationService({ gateway, repository: { read: async () => ({ revision: 0, ...structuredClone(defaultState) }), keyFor: async () => secret }, fetch: fetcher, timeoutMs: 1000, pollIntervalMs: 1, ...overrides })
  return { service, gateway }
}
function failure(result: { ok: boolean; code?: string }, code: string) { assert.equal(result.ok, false); assert.equal(result.code, code); assert.equal(JSON.stringify(result).includes(secret), false) }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const googleImage = () => ({ status: "completed", steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: "aW1hZ2U=" }] }], usage: { total_input_tokens: 5, total_output_tokens: 747, total_tokens: 752 } })

test("provider catalog rejects an explicit HTTP-200 Tencent business error even with stale valid rows", async () => {
  for (const marker of [{ error: { message: secret } }, { code: "upstream_failed", message: secret }, { success: false }]) {
    const f = fixture(async () => json({ ...marker, data: [{ id: "hy3", status: "online" }] }))
    try { failure(await f.service.discover("review", randomUUID(), draft("tencent", "TEXT")), "HTTP_ERROR") } finally { await f.service.close() }
  }
})

test("Google minimal image probe uses the documented 512px option for the model that supports it", async () => {
  let posts = 0
  const f = fixture(async (url, init) => {
    posts++; assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/interactions")
    const body = JSON.parse(String(init?.body)); assert.equal(body.response_format.image_size, "512")
    assert.equal(body.store, false); assert.equal(body.background, false); assert.equal(body.stream, false)
    return json(googleImage())
  })
  try { assert.equal((await f.service.test("review", randomUUID(), draft("google", "IMAGE", "gemini-3.1-flash-image"), { authorizeCharge: true })).ok, true); assert.equal(posts, 1) } finally { await f.service.close() }
})

test("Google fixed-size legacy image probe avoids an unverified size override while newer 1K models keep their minimum", async () => {
  for (const model of ["gemini-2.5-flash-image", "gemini-nano-banana-2.1", "gemini-3.1-flash-lite-image", "gemini-3-pro-image"]) {
    let posts = 0; const f = fixture(async (_url, init) => {
      posts++; const body = JSON.parse(String(init?.body)); assert.equal(body.response_format.aspect_ratio, "1:1")
      assert.equal(body.response_format.image_size, model === "gemini-2.5-flash-image" ? undefined : "1K")
      return json(googleImage())
    })
    try { assert.equal((await f.service.test("review", randomUUID(), draft("google", "IMAGE", model), { authorizeCharge: true })).ok, true); assert.equal(posts, 1) } finally { await f.service.close() }
  }
})

test("new native image adapters reject wrong category endpoints or protocols before any HTTP", async () => {
  let requests = 0; const f = fixture(async () => { requests++; return json({}) })
  try {
    for (const provider of ["google", "alibaba", "tencent", "bytedance"] as const) {
      const input = draft(provider, "IMAGE")
      failure(await f.service.test("review", randomUUID(), { ...input, protocol: "anthropic" }, { authorizeCharge: true }), "INVALID_DRAFT")
    }
    failure(await f.service.test("review", randomUUID(), { ...draft("tencent", "IMAGE", "hy-image-v3"), endpoint: PROVIDER_PRESETS.find(p => p.id === "tencent")!.textEndpoint! }, { authorizeCharge: true }), "INVALID_DRAFT")
    assert.equal(requests, 0)
  } finally { await f.service.close() }
})

test("saved authorization revoked during an Alibaba poll cancels the body and cannot resubmit or continue polling", async () => {
  const entered = deferred<void>(); let polls = 0; let posts = 0; let cancelled = false; let pollSignal: AbortSignal | undefined
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method === "POST") { posts++; return json({ output: { task_id: "revocation-fixture", task_status: "PENDING" } }) }
    polls++; pollSignal = init?.signal ?? undefined
    return new Response(new ReadableStream<Uint8Array>({ start() { entered.resolve() }, cancel() { cancelled = true } }))
  }
  const gateway = new ModelGateway({ keyFor: async () => secret, fetch: fetcher }); const input = { ...draft("alibaba", "IMAGE", "wan2.7-image"), id: randomUUID(), apiKey: "" }
  const state = { revision: 0, ...structuredClone(defaultState) }; const row = { id: input.id, provider: input.provider, kind: input.kind, protocol: input.protocol, endpoint: input.endpoint, authRevision: 1, enabled: true }
  state.models = [row as typeof state.models[number]]; gateway.replace(row)
  const f = fixture(fetcher, { gateway, repository: { read: async () => state, keyFor: async () => secret } })
  try {
    const running = f.service.test("review", randomUUID(), input, { authorizeCharge: true }); await entered.promise
    gateway.remove(input.id); failure(await running, "AUTHORIZATION_REVOKED")
    await new Promise<void>(r => setImmediate(r)); assert.equal(pollSignal?.aborted, true); assert.equal(cancelled, true); assert.equal(posts, 1); assert.equal(polls, 1)
  } finally { await f.service.close() }
})

test("owner isolation and cancellation stop Tencent queued work without another paid submission", async () => {
  const submitted = deferred<void>(); let posts = 0; let polls = 0
  const f = fixture(async (_url, init) => {
    if (init?.method === "POST") { posts++; submitted.resolve(); return json({ task_id: "cancel-fixture" }) }
    polls++; return json({ task_id: "cancel-fixture", status: "completed", data: [{ url: "https://result.invalid/one.png" }] })
  }, { pollIntervalMs: 30 })
  try {
    const id = randomUUID(); const running = f.service.test("review", id, draft("tencent", "IMAGE", "wand-vega-image-lite"), { authorizeCharge: true }); await submitted.promise
    f.service.cancel("wrong-owner", id); f.service.cancel("review", id); failure(await running, "CANCELLED")
    await new Promise(r => setTimeout(r, 40)); assert.equal(posts, 1); assert.equal(polls, 0)
    assert.equal((await f.service.test("review", randomUUID(), draft("tencent", "IMAGE", "wand-vega-image-lite"), { authorizeCharge: true })).ok, true)
    assert.equal(posts, 2); assert.equal(polls, 1)
  } finally { await f.service.close() }
})

test("global timeout bounds an unfinished native polling response and releases its source reader", async () => {
  let posts = 0; let polls = 0; let cancelled = false; let source!: ReadableStream<Uint8Array>
  const f = fixture(async (_url, init) => {
    if (init?.method === "POST") { posts++; return json({ output: { task_id: "timeout-fixture", task_status: "PENDING" } }) }
    polls++; source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"output":')) }, cancel() { cancelled = true } }); return new Response(source)
  }, { timeoutMs: 50 })
  try {
    failure(await f.service.test("review", randomUUID(), draft("alibaba", "IMAGE", "wan2.7-image"), { authorizeCharge: true }), "TIMEOUT")
    await new Promise<void>(r => setImmediate(r)); assert.equal(posts, 1); assert.equal(polls, 1); assert.equal(cancelled, true); assert.equal(source.locked, false)
  } finally { await f.service.close() }
})

test("new image adapters sanitize provider errors and reject invalid numeric usage without retry", async () => {
  for (const provider of ["google", "alibaba", "tencent", "bytedance"] as const) {
    let posts = 0; const f = fixture(async () => { posts++; return json({ error: { message: secret }, code: "upstream_failed", message: secret }, 200) })
    const model = { google: "gemini-3.1-flash-image", alibaba: "qwen-image-2.1-pro", tencent: "hy-image-v3", bytedance: "doubao-seedream-5-0-pro-260628" }[provider]
    try { failure(await f.service.test("review", randomUUID(), draft(provider, "IMAGE", model), { authorizeCharge: true }), "HTTP_ERROR"); assert.equal(posts, 1) } finally { await f.service.close() }
  }
  for (const total of [-1, "10", 1_000_000_001]) {
    const f = fixture(async () => json({ ...googleImage(), usage: { total_tokens: total } }))
    try { failure(await f.service.test("review", randomUUID(), draft("google", "IMAGE", "gemini-3.1-flash-image"), { authorizeCharge: true }), "INVALID_RESPONSE") } finally { await f.service.close() }
  }
})

test("native adapters reject cross-origin redirects and unimplemented exact IDs without guessing paid routes", async () => {
  let requests = 0; const f = fixture(async () => { requests++; return new Response(null, { status: 307, headers: { location: "https://untrusted.invalid/redirect" } }) })
  try {
    failure(await f.service.test("review", randomUUID(), draft("alibaba", "IMAGE", "qwen-image-2.1-pro"), { authorizeCharge: true }), "NETWORK_ERROR"); assert.equal(requests, 1)
    for (const provider of ["alibaba", "tencent", "bytedance", "google"] as const) failure(await f.service.test("review", randomUUID(), draft(provider, "IMAGE", "future-image-not-in-exact-table"), { authorizeCharge: true }), "UNSUPPORTED_TEST")
    assert.equal(requests, 1)
  } finally { await f.service.close() }
})

test("Wan2.7 and Hy3.5 minimal probes use the lowest documented valid square dimensions", async () => {
  for (const model of ["wan2.7-image", "wan2.7-image-pro"]) {
    let posts = 0; let polls = 0
    const f = fixture(async (_url, init) => {
      if (init?.method === "POST") {
        posts++; const body = JSON.parse(String(init.body)); assert.equal(body.parameters.size, "768*768"); assert.equal(body.parameters.n, 1); assert.equal(body.parameters.enable_sequential, false); assert.equal(body.parameters.thinking_mode, false)
        return json({ output: { task_id: "minimum-fixture", task_status: "PENDING" } })
      }
      polls++; return json({ output: { task_id: "minimum-fixture", task_status: "SUCCEEDED", choices: [{ finish_reason: "stop", message: { content: [{ image: "https://result.invalid/one.png" }] } }] }, usage: { image_count: 1 } })
    })
    try { assert.equal((await f.service.test("review", randomUUID(), draft("alibaba", "IMAGE", model), { authorizeCharge: true })).ok, true); assert.equal(posts, 1); assert.equal(polls, 1) } finally { await f.service.close() }
  }
  let posts = 0; const f = fixture(async (_url, init) => {
    posts++; const body = JSON.parse(String(init?.body)); assert.equal(body.size, "256x256")
    return json({ choices: [{ finish_reason: null, delta: { type: "image", image: { url: "https://result.invalid/one.png" } } }], tokenhub_usage: { total_tokens: 512 } })
  })
  try { assert.equal((await f.service.test("review", randomUUID(), draft("tencent", "IMAGE", "hy-image-v3.5-preview"), { authorizeCharge: true })).ok, true); assert.equal(posts, 1) } finally { await f.service.close() }
})

test("Qwen3 documented output_image_count must agree with exactly one observed result", async () => {
  for (const model of ["qwen-image-3.0", "qwen-image-3.0-pro"]) {
    for (const count of [0, 2, "1", -1]) {
      let posts = 0; const f = fixture(async () => { posts++; return json({ output: { choices: [{ finish_reason: "stop", message: { content: [{ image: "https://result.invalid/one.png" }] } }] }, usage: { input_image_count: 0, output_image_count: count } }) })
      try { failure(await f.service.test("review", randomUUID(), draft("alibaba", "IMAGE", model), { authorizeCharge: true }), "INVALID_RESPONSE"); assert.equal(posts, 1) } finally { await f.service.close() }
    }
    const f = fixture(async () => json({ output: { choices: [{ finish_reason: "stop", message: { content: [{ image: "https://result.invalid/one.png" }] } }] }, usage: { input_image_count: 0, output_image_count: 1 } }))
    try { const result = await f.service.test("review", randomUUID(), draft("alibaba", "IMAGE", model), { authorizeCharge: true }); assert.equal(result.ok, true); if (result.ok) assert.equal(result.usage?.imagesGenerated, 1) } finally { await f.service.close() }
  }
})

test("Alibaba text probes cap combined reasoning and reply rather than only final answer tokens", async () => {
  for (const model of ["qwen3.8-max", "deepseek-r1"]) {
    let posts = 0; const f = fixture(async (url, init) => {
      posts++; assert.equal(String(url), "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions")
      const body = JSON.parse(String(init?.body)); assert.equal(body.max_completion_tokens, 256); assert.equal(body.max_tokens, undefined)
      assert.equal(body.model, model); assert.equal(body.stream, false); assert.equal(body.enable_thinking, undefined)
      return json({ choices: [{ message: { content: "OK" } }] })
    })
    try { assert.equal((await f.service.test("review", randomUUID(), draft("alibaba", "TEXT", model), { authorizeCharge: true })).ok, true); assert.equal(posts, 1) } finally { await f.service.close() }
  }
})
