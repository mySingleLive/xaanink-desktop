import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { setImmediate as tick } from "node:timers/promises"
import { ModelGateway } from "../../desktop/core/model-authorization"
import { defaultState } from "../../desktop/core/settings"
import { ModelConfigurationService, type ModelConfigurationOptions } from "../../desktop/main/model-configuration"
import { presetsFor, type ConfigurationDraft } from "../../desktop/shared/model-catalog"

const secret = "provider-test-key-main-only"
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function draft(provider: ConfigurationDraft["provider"], kind: ConfigurationDraft["kind"] = "TEXT", modelId = "test-model"): ConfigurationDraft {
  const preset = presetsFor(kind).find(p => p.id === provider)!
  return { provider, kind, protocol: preset.protocol ?? "openai", endpoint: (kind === "TEXT" ? preset.textEndpoint : preset.imageEndpoint)!, apiKey: secret, modelId }
}
function fixture(fetcher: typeof fetch, options: Partial<ModelConfigurationOptions> = {}) {
  let writes = 0
  const repository: ModelConfigurationOptions["repository"] = { read: async () => ({ revision: 0, models: [], settings: structuredClone(defaultState.settings) }), keyFor: async () => { throw Error("unexpected saved key") } }
  const gateway = new ModelGateway({ keyFor: repository.keyFor, fetch: fetcher })
  const service = new ModelConfigurationService({ repository, gateway, fetch: fetcher, timeoutMs: 500, ...options })
  return { service, writes: () => writes }
}
function failure(result: { ok: boolean; code?: string }, code: string) { assert.equal(result.ok, false); assert.equal(result.code, code) }

test("Alibaba native authenticated catalog follows total/page_no and real output metadata", async () => {
  const calls: string[] = []
  const f = fixture(async (url, init) => {
    const parsed = new URL(String(url)); calls.push(parsed.href)
    assert.equal(parsed.origin, "https://dashscope.aliyuncs.com"); assert.equal(parsed.pathname, "/api/v1/models")
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${secret}`)
    assert.equal(parsed.searchParams.get("page_no"), String(calls.length))
    return json({ success: true, output: { total: 3, page_no: calls.length, page_size: 100, models: calls.length === 1 ? [
      { model: "arbitrary-text", name: "文本", inference_metadata: { response_modality: ["Text"] }, model_info: { context_window: 262144, max_output_tokens: 32768 } },
      { model: "arbitrary-image", inference_metadata: { response_modality: ["Image"] } },
    ] : [{ model: "unclassified", inference_metadata: {} }] } })
  })
  try {
    const result = await f.service.discover("w", randomUUID(), draft("alibaba")); assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.models.map(m => m.id), ["arbitrary-text"]); assert.equal(result.models[0].contextWindow, 262144)
    assert.equal(result.models[0].maxOutputTokens, 32768); assert.equal(result.models[0].thinkingLevels, undefined)
    assert.deepEqual(result.unknownCapabilityIds, ["unclassified"]); assert.equal(result.complete, false); assert.equal(calls.length, 2)
    assert.equal(JSON.stringify(result).includes(secret), false); assert.equal(f.writes(), 0)
  } finally { await f.service.close() }
})
test("Alibaba total changes, repeated page, empty early page and page bound fail closed", async () => {
  for (const mode of ["total", "page", "empty", "bound"]) {
    let calls = 0; const f = fixture(async () => { calls++; return json({ success: true, output: {
      total: mode === "total" && calls > 1 ? 4 : 3, page_no: mode === "page" ? 1 : calls,
      models: mode === "empty" ? [] : [{ model: `m${calls}`, inference_metadata: { response_modality: ["Text"] } }],
    } }) }, mode === "bound" ? { maxPages: 1 } : {})
    try { failure(await f.service.discover("w", randomUUID(), draft("alibaba")), "CATALOG_INCOMPLETE") } finally { await f.service.close() }
  }
})
test("Tencent authorized lists stay on selected site/Key and classify exact official output families", async () => {
  const calls: string[] = []; const f = fixture(async (url, init) => {
    calls.push(String(url)); assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${secret}`)
    return json({ object: "list", data: [{ id: "hy3", status: "online" }, { id: "hy-image-v3", status: "online" }, { id: "kinfra-text-embedding-4b", status: "online" }, { id: "hy-image-v3-future", status: "online" }] })
  })
  try {
    for (const kind of ["TEXT", "IMAGE"] as const) {
      const result = await f.service.discover("w", randomUUID(), draft("tencent", kind)); assert.equal(result.ok, true)
      if (result.ok) { assert.deepEqual(result.models.map(m => m.id), [kind === "TEXT" ? "hy3" : "hy-image-v3"]); assert.deepEqual(result.unknownCapabilityIds, ["hy-image-v3-future"]); assert.equal(result.complete, false) }
    }
    assert.deepEqual(calls, ["https://tokenhub.tencentmaas.com/v1/models", "https://tokenhub-intl.tencentcloudmaas.com/v1/models"])
  } finally { await f.service.close() }
})
test("catalog authentication errors cannot become static success or cross-site retries", async () => {
  for (const provider of ["alibaba", "tencent"] as const) {
    let calls = 0; const f = fixture(async () => { calls++; return json({ message: secret }, 401) })
    try { failure(await f.service.discover("w", randomUUID(), draft(provider)), "AUTHENTICATION_FAILED"); assert.equal(calls, 1) } finally { await f.service.close() }
  }
})
test("Google image test is one nonstored native interaction with bounded numeric usage and no image return", async () => {
  let calls = 0; const f = fixture(async (url, init) => {
    calls++; assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/interactions")
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), secret)
    const body = JSON.parse(String(init?.body)); assert.equal(body.model, "gemini-3.1-flash-image")
    assert.deepEqual(body.response_format, { type: "image", aspect_ratio: "1:1", image_size: "512", delivery: "inline" })
    assert.equal(body.store, false); assert.equal(body.background, false); assert.equal(body.stream, false)
    assert.equal(body.input.length, 1); assert.equal(body.input[0].type, "text"); assert.equal(body.previous_interaction_id, undefined)
    return json({ status: "completed", steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: "aW1hZ2U=" }] }], usage: { total_input_tokens: 5, total_output_tokens: 12, total_tokens: 17, total_cached_tokens: 0 } })
  })
  try {
    const result = await f.service.test("w", randomUUID(), draft("google", "IMAGE", "gemini-3.1-flash-image"), { authorizeCharge: true }); assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual((result as typeof result & { usage?: unknown }).usage, { inputTokens: 5, outputTokens: 12, totalTokens: 17, imagesGenerated: 1 })
    assert.equal(calls, 1); assert.equal(JSON.stringify(result).includes("aW1hZ2U="), false); assert.equal(f.writes(), 0)
  } finally { await f.service.close() }
})
test("Google image success requires completed one model-output image, excludes echo/input images", async () => {
  for (const body of [
    { status: "incomplete", steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: "aW1hZ2U=" }] }] },
    { status: "completed", steps: [{ type: "user_input", content: [{ type: "image", mime_type: "image/png", data: "aW1hZ2U=" }] }] },
    { status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "OK" }] }] },
    { status: "completed", steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: "aW1hZ2U=" }, { type: "image", mime_type: "image/png", data: "aW1hZ2U=" }] }] },
  ]) {
    const f = fixture(async () => json(body))
    try { failure(await f.service.test("w", randomUUID(), draft("google", "IMAGE", "gemini-3.1-flash-image"), { authorizeCharge: true }), "INVALID_RESPONSE") } finally { await f.service.close() }
  }
})
test("Google cancellation during response body clears operation and never retries paid generation", async () => {
  let calls = 0; let release!: () => void
  const f = fixture(async () => { calls++; return new Response(new ReadableStream({ start(controller) { release = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ status: "completed", steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: "aW1hZ2U=" }] }] }))); controller.close() } } })) })
  try {
    const id = randomUUID(); const request = f.service.test("w", id, draft("google", "IMAGE", "gemini-3.1-flash-image"), { authorizeCharge: true })
    await tick(); assert.equal(calls, 1); f.service.cancel("w", id); failure(await request, "CANCELLED")
    await tick(); assert.throws(release, { code: "ERR_INVALID_STATE" }); assert.equal(calls, 1)
  } finally { await f.service.close() }
})

test("ByteDance official snapshot is dated and permission unknown without pretending authenticated discovery", async () => {
  let calls = 0; const f = fixture(async () => { calls++; throw Error("no guessed API") })
  try {
    for (const kind of ["TEXT", "IMAGE"] as const) {
      const result = await f.service.discover("w", randomUUID(), draft("bytedance", kind)); assert.equal(result.ok, true)
      if (result.ok) { assert.equal(result.complete, false); assert.equal(result.permission, "unknown"); assert.ok(result.sources.some(s => s.includes("docs.volcengine.com"))); assert.ok(result.warnings.join(" ").includes("2026-10-07")); assert.ok(result.models.some(m => m.id === (kind === "TEXT" ? "doubao-seed-2-1-pro-260915" : "doubao-seedream-5-0-flash-260915"))) }
    }
    assert.equal(calls, 0)
  } finally { await f.service.close() }
})
test("Alibaba Qwen one-image test uses native synchronous messages and legal model-specific sizes", async () => {
  const bodies: Record<string, any>[] = []; const f = fixture(async (url, init) => {
    assert.equal(String(url), "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation")
    const body = JSON.parse(String(init?.body)); bodies.push(body); assert.equal(body.parameters.n, 1); assert.equal(body.input.messages.length, 1)
    return json({ output: { choices: [{ message: { content: [{ image: "https://result.invalid/image.png", type: "image" }] } }] }, usage: { image_count: 1 } })
  })
  try {
    for (const model of ["qwen-image-3.0-pro", "qwen-image-2.0-pro", "qwen-image-max"]) {
      const result = await f.service.test("w", randomUUID(), draft("alibaba", "IMAGE", model), { authorizeCharge: true }); assert.equal(result.ok, true)
    }
    assert.deepEqual(bodies.map(b => b.parameters.size), ["512*512", "512*512", "1328*1328"])
  } finally { await f.service.close() }
})
test("Alibaba Wan async submits only once and polls selected task with single final image/usage", async () => {
  const calls: string[] = []; const f = fixture(async (url, init) => {
    calls.push(String(url)); if (init?.method === "POST") {
      assert.equal(String(url), "https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation")
      assert.equal(new Headers(init.headers).get("x-dashscope-async"), "enable")
      const body = JSON.parse(String(init.body)); assert.equal(body.parameters.n, 1); assert.equal(body.parameters.enable_sequential, false); assert.equal(body.parameters.size, "768*768")
      return json({ output: { task_id: "task-fixed-123", task_status: "PENDING" } })
    }
    assert.equal(String(url), "https://dashscope.aliyuncs.com/api/v1/tasks/task-fixed-123")
    return calls.length === 2 ? json({ output: { task_id: "task-fixed-123", task_status: "RUNNING" } }) : json({ output: { task_id: "task-fixed-123", task_status: "SUCCEEDED", choices: [{ message: { content: [{ image: "https://result.invalid/one.png", type: "image" }] } }] }, usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8, image_count: 1 } })
  }, { pollIntervalMs: 1 } as Partial<ModelConfigurationOptions>)
  try { const result = await f.service.test("w", randomUUID(), draft("alibaba", "IMAGE", "wan2.7-image-pro"), { authorizeCharge: true }); assert.equal(result.ok, true); if (result.ok) assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 3, totalTokens: 8, imagesGenerated: 1 }); assert.equal(calls.length, 3) } finally { await f.service.close() }
})
test("async image task IDs/statuses and business errors cannot become success or repeat a paid submission", async () => {
  for (const mode of ["path", "failure", "mismatch", "bound"]) {
    let posts = 0; const f = fixture(async (_url, init) => {
      if (init?.method === "POST") { posts++; return json({ output: { task_id: mode === "path" ? "../../models" : "fixed-task", task_status: "PENDING" } }) }
      return json({ output: { task_id: mode === "mismatch" ? "wrong-task" : "fixed-task", task_status: mode === "bound" ? "RUNNING" : "FAILED", message: secret } })
    }, { pollIntervalMs: 1, maxPolls: 1 } as Partial<ModelConfigurationOptions>)
    try { const result = await f.service.test("w", randomUUID(), draft("alibaba", "IMAGE", "wan2.7-image-pro"), { authorizeCharge: true }); failure(result, mode === "failure" ? "HTTP_ERROR" : mode === "bound" ? "TIMEOUT" : "INVALID_RESPONSE"); assert.equal(posts, 1); assert.equal(JSON.stringify(result).includes(secret), false) } finally { await f.service.close() }
  }
})
test("async cancellation during polling delay sends no second generation or late poll", async () => {
  let calls = 0; const f = fixture(async () => { calls++; return json({ output: { task_id: "fixed-task", task_status: "PENDING" } }) }, { pollIntervalMs: 20 } as Partial<ModelConfigurationOptions>)
  try { const id = randomUUID(); const pending = f.service.test("w", id, draft("alibaba", "IMAGE", "wan2.7-image-pro"), { authorizeCharge: true }); await tick(); assert.equal(calls, 1); f.service.cancelOwner("w"); failure(await pending, "CANCELLED"); await new Promise(r => setTimeout(r, 25)); assert.equal(calls, 1) } finally { await f.service.close() }
})
test("Tencent Hy 3 and 3.5 select documented independent paths and final output only", async () => {
  const paths: string[] = []; const f = fixture(async (url, init) => {
    paths.push(new URL(String(url)).pathname); const body = JSON.parse(String(init?.body)); assert.equal(body.n, undefined)
    assert.equal(new URL(String(url)).origin, "https://tokenhub-intl.tencentcloudmaas.com")
    return body.model === "hy-image-v3" ? json({ data: [{ url: "https://result.invalid/image.png" }], tokenhub_usage: { total_tokens: 1024 } }) : json({ choices: [{ delta: { type: "image", image: { url: "https://result.invalid/image35.png" } } }], assembled_history: [{ role: "tool", content: [{ image_url: { url: "https://result.invalid/intermediate.png" } }] }], tokenhub_usage: { total_tokens: 2048 } })
  })
  try {
    for (const model of ["hy-image-v3", "hy-image-v3.5-preview"]) { const result = await f.service.test("w", randomUUID(), draft("tencent", "IMAGE", model), { authorizeCharge: true }); assert.equal(result.ok, true); if (result.ok) assert.equal(result.usage?.imagesGenerated, 1) }
    assert.deepEqual(paths, ["/v1/wand/hunyuan-image/v3-generation", "/v1/wand/hunyuan-image/v35-generation"])
  } finally { await f.service.close() }
})
test("ByteDance Seedream generation respects latest single-only vs older sequential parameter contracts", async () => {
  const bodies: Record<string, any>[] = []; const f = fixture(async (url, init) => {
    assert.equal(String(url), "https://ark.cn-beijing.volces.com/api/v3/images/generations")
    bodies.push(JSON.parse(String(init?.body))); return json({ data: [{ url: "https://result.invalid/image.png" }], usage: { generated_images: 1, output_tokens: 16384, total_tokens: 16384 } })
  })
  try {
    for (const model of ["doubao-seedream-5-0-pro-260628", "doubao-seedream-5-0-flash-260915", "doubao-seedream-5-0-260128", "doubao-seedream-4-0-250828"]) {
      const result = await f.service.test("w", randomUUID(), draft("bytedance", "IMAGE", model), { authorizeCharge: true }); assert.equal(result.ok, true)
      if (result.ok) assert.deepEqual(result.usage, { outputTokens: 16384, totalTokens: 16384, imagesGenerated: 1 })
    }
    assert.deepEqual(bodies.map(b => b.sequential_image_generation), [undefined, undefined, "disabled", "disabled"]); assert.deepEqual(bodies.map(b => b.size), ["1K", "1K", "2K", "2K"]); assert.ok(bodies.every(b => b.n === undefined && b.tools === undefined && b.stream === false))
  } finally { await f.service.close() }
})

test("ByteDance public catalog includes all 20 text and 6 image IDs from the 2026-09-28 official table, still without Key permission claims", async () => {
  const f = fixture(async () => { throw Error("public snapshot must not guess management API") })
  try {
    const text = await f.service.discover("w", randomUUID(), draft("bytedance"))
    assert.equal(text.ok, true); if (!text.ok) return
    assert.equal(text.models.length, 20)
    for (const id of ["doubao-seed-2-0-code-preview-260215", "doubao-seed-character-251128", "doubao-seed-translation-250915", "glm-5-3-flash-260828", "deepseek-v4-pro-260425"]) assert.ok(text.models.some(m => m.id === id), id)
    assert.equal(text.complete, false); assert.equal(text.permission, "unknown")
    assert.ok(text.warnings.join(" ").includes("2026-09-28"))
    const image = await f.service.discover("w", randomUUID(), draft("bytedance", "IMAGE"))
    assert.equal(image.ok, true); if (image.ok) assert.equal(image.models.length, 6)
  } finally { await f.service.close() }
})
test("Alibaba Wan 2.6 sync overrides the four-image default with exactly one legal minimum-size image", async () => {
  let calls = 0; const f = fixture(async (url, init) => {
    calls++; assert.equal(new URL(String(url)).pathname, "/api/v1/services/aigc/multimodal-generation/generation")
    assert.equal(new Headers(init?.headers).get("x-dashscope-async"), null)
    const body = JSON.parse(String(init?.body)); assert.equal(body.parameters.n, 1); assert.equal(body.parameters.size, "1280*1280"); assert.equal(body.parameters.prompt_extend, false)
    return json({ output: { finished: true, choices: [{ finish_reason: "stop", message: { content: [{ image: "https://result.invalid/image.png", type: "image" }] } }] }, usage: { image_count: 1, input_tokens: 0, output_tokens: 0, total_tokens: 0 } })
  })
  try { const result = await f.service.test("w", randomUUID(), draft("alibaba", "IMAGE", "wan2.6-t2i"), { authorizeCharge: true }); assert.equal(result.ok, true); if (result.ok) assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0, totalTokens: 0, imagesGenerated: 1 }); assert.equal(calls, 1) } finally { await f.service.close() }
})
test("Alibaba six older Wan models use legacy asynchronous text2image, one submission and results array", async () => {
  for (const model of ["wan2.5-t2i-preview", "wan2.2-t2i-flash", "wan2.2-t2i-plus", "wanx2.1-t2i-turbo", "wanx2.1-t2i-plus", "wanx2.0-t2i-turbo"]) {
    let posts = 0; const f = fixture(async (url, init) => {
      if (init?.method === "POST") {
        posts++; assert.equal(new URL(String(url)).pathname, "/api/v1/services/aigc/text2image/image-synthesis")
        assert.equal(new Headers(init.headers).get("x-dashscope-async"), "enable")
        const body = JSON.parse(String(init.body)); assert.equal(typeof body.input.prompt, "string"); assert.equal(body.input.messages, undefined); assert.equal(body.parameters.n, 1); assert.equal(body.parameters.size, model === "wan2.5-t2i-preview" ? "1280*1280" : "512*512")
        return json({ output: { task_id: "old-wan-task", task_status: "PENDING" } })
      }
      assert.equal(new URL(String(url)).pathname, "/api/v1/tasks/old-wan-task")
      return json({ output: { task_id: "old-wan-task", task_status: "SUCCEEDED", results: [{ url: "https://result.invalid/image.png" }], task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 } }, usage: { image_count: 1 } })
    }, { pollIntervalMs: 1 })
    try { assert.equal((await f.service.test("w", randomUUID(), draft("alibaba", "IMAGE", model), { authorizeCharge: true })).ok, true); assert.equal(posts, 1) } finally { await f.service.close() }
  }
})
test("legacy async final image error or inconsistent task metrics is never a connection-test success", async () => {
  for (const mode of ["image-code", "metrics"]) {
    let posts = 0; const f = fixture(async (_url, init) => {
      if (init?.method === "POST") { posts++; return json({ output: { task_id: "old-wan-task", task_status: "PENDING" } }) }
      return json({ output: { task_id: "old-wan-task", task_status: "SUCCEEDED", results: [{ url: "https://result.invalid/image.png", ...(mode === "image-code" ? { code: "DataInspectionFailed", message: secret } : {}) }], task_metrics: { TOTAL: 1, SUCCEEDED: mode === "metrics" ? 0 : 1, FAILED: mode === "metrics" ? 1 : 0 } }, usage: { image_count: 1 } })
    }, { pollIntervalMs: 1 })
    try { failure(await f.service.test("w", randomUUID(), draft("alibaba", "IMAGE", "wan2.2-t2i-flash"), { authorizeCharge: true }), "INVALID_RESPONSE"); assert.equal(posts, 1) } finally { await f.service.close() }
  }
})
test("Tencent Vidu polls documented states and accepts a final creations result without an undocumented task_id echo", async () => {
  let posts = 0; let polls = 0; const f = fixture(async (url, init) => {
    if (init?.method === "POST") {
      posts++; assert.equal(new URL(String(url)).pathname, "/v1/wand/vidu-image/generation")
      const body = JSON.parse(String(init.body)); assert.equal(body.model, "vidu-image-q2"); assert.equal(body.resolution, "1080p"); assert.equal(body.aspect_ratio, "1:1"); assert.equal(body.images, undefined); assert.equal(body.callback_url, undefined); assert.equal(body.n, undefined)
      return json({ task_id: "123-WandImage-task", state: "created" })
    }
    polls++; assert.equal(new URL(String(url)).pathname, "/v1/wand/vidu-image/tasks/123-WandImage-task")
    return polls <= 2 ? json({ state: polls === 1 ? "queueing" : "processing" }) : json({ state: "success", model: "vidu-image-q2", creations: [{ url: "https://result.invalid/image.png" }], tokenhub_usage: { total_tokens: 1024 } })
  }, { pollIntervalMs: 1 })
  try { const result = await f.service.test("w", randomUUID(), draft("tencent", "IMAGE", "vidu-image-q2"), { authorizeCharge: true }); assert.equal(result.ok, true); if (result.ok) assert.deepEqual(result.usage, { totalTokens: 1024, imagesGenerated: 1 }); assert.equal(posts, 1); assert.equal(polls, 3) } finally { await f.service.close() }
})
test("Tencent Vidu failure, mismatched optional identity, multi-image and polling bound fail without resubmission", async () => {
  for (const mode of ["failed", "identity", "model", "multi", "bound"]) {
    let posts = 0; const f = fixture(async (_url, init) => {
      if (init?.method === "POST") { posts++; return json({ task_id: "vidu-task", state: "created" }) }
      return json({ state: mode === "failed" ? "failed" : mode === "bound" ? "processing" : "success", ...(mode === "identity" ? { task_id: "wrong-task" } : {}), model: mode === "model" ? "wrong-model" : "vidu-image-q2", creations: Array.from({ length: mode === "multi" ? 2 : 1 }, () => ({ url: "https://result.invalid/image.png" })), message: secret })
    }, { pollIntervalMs: 1, maxPolls: 1 })
    try { const result = await f.service.test("w", randomUUID(), draft("tencent", "IMAGE", "vidu-image-q2"), { authorizeCharge: true }); failure(result, mode === "failed" ? "HTTP_ERROR" : mode === "bound" ? "TIMEOUT" : "INVALID_RESPONSE"); assert.equal(posts, 1); assert.equal(JSON.stringify(result).includes(secret), false) } finally { await f.service.close() }
  }
})
test("Tencent Vidu cancellation during queued polling clears the operation without a late poll", async () => {
  let calls = 0; const f = fixture(async () => { calls++; return json({ task_id: "vidu-task", state: "created" }) }, { pollIntervalMs: 20 })
  try { const id = randomUUID(); const pending = f.service.test("w", id, draft("tencent", "IMAGE", "vidu-image-q2"), { authorizeCharge: true }); await tick(); assert.equal(calls, 1); f.service.cancel("w", id); failure(await pending, "CANCELLED"); await new Promise(r => setTimeout(r, 25)); assert.equal(calls, 1) } finally { await f.service.close() }
})
test("Tencent Wand image async one-image test submits once and waits for the documented final data", async () => {
  let posts = 0; let polls = 0; const f = fixture(async (url, init) => {
    if (init?.method === "POST") { posts++; assert.equal(new URL(String(url)).pathname, "/v1/wand/vega-images/generations"); assert.equal(JSON.parse(String(init.body)).model, "wand-vega-image-lite"); return json({ task_id: "vega-task", status: "queued" }) }
    polls++; assert.equal(new URL(String(url)).pathname, "/v1/wand/vega-images/tasks/vega-task")
    return polls === 1 ? json({ task_id: "vega-task", status: "in_progress" }) : json({ task_id: "vega-task", status: "completed", data: [{ url: "https://result.invalid/image.png" }], usage: { total_tokens: 1024 } })
  }, { pollIntervalMs: 1 })
  try { assert.equal((await f.service.test("w", randomUUID(), draft("tencent", "IMAGE", "wand-vega-image-lite"), { authorizeCharge: true })).ok, true); assert.equal(posts, 1); assert.equal(polls, 2) } finally { await f.service.close() }
})

test("Tencent catalog separates all eight official image models and four text-output vision models from embeddings/video/unknown IDs", async () => {
  const images = ["hy-image-v3", "hy-image-v3.5-preview", "vidu-image-q2", "wand-vega-image-lite", "wand-vega-image-flash", "wand-vega-image-pro", "seedream-image-v5.0-pro", "seedream-image-v5.0-lite"]
  const vision = ["youtu-vita", "hy-vision-2.0-instruct", "hunyuan-t1-vision-20250916", "hunyuan-turbos-vision-video-20250728"]
  const f = fixture(async () => json({ data: [...images, ...vision, "hy-video-v1.5", "kinfra-text-embedding-4b"].map(id => ({ id, status: "online" })) }))
  try {
    const text = await f.service.discover("w", randomUUID(), draft("tencent")); assert.equal(text.ok, true)
    if (text.ok) { assert.deepEqual(text.models.map(m => m.id), vision); assert.equal(text.complete, true) }
    const image = await f.service.discover("w", randomUUID(), draft("tencent", "IMAGE")); assert.equal(image.ok, true)
    if (image.ok) { assert.deepEqual(image.models.map(m => m.id), images); assert.equal(image.complete, true); assert.equal(image.models.find(m => m.id === "seedream-image-v5.0-pro")?.source, "https://intl.cloud.tencent.com/zh/document/product/1300/83710") }
  } finally { await f.service.close() }
})
test("Tencent Seedream uses its own path and model names, no layers/tools, and one-image contracts for pro/lite", async () => {
  const bodies: Record<string, unknown>[] = []; const f = fixture(async (url, init) => {
    assert.equal(String(url), "https://tokenhub-intl.tencentcloudmaas.com/v1/wand/si-image/generation")
    const body = JSON.parse(String(init?.body)); bodies.push(body)
    assert.equal(body.images, undefined); assert.equal(body.n, undefined); assert.equal(body.tools, undefined); assert.equal(body.layer_decomposition, undefined); assert.equal(body.response_format, "url")
    return json({ data: [{ url: "https://result.invalid/one.png" }], model: "doubao-seedream-5-0-pro-260628", tokenhub_usage: { total_tokens: 60000 } })
  })
  try {
    for (const model of ["seedream-image-v5.0-pro", "seedream-image-v5.0-lite"]) { const result = await f.service.test("w", randomUUID(), draft("tencent", "IMAGE", model), { authorizeCharge: true }); assert.equal(result.ok, true); if (result.ok) assert.deepEqual(result.usage, { totalTokens: 60000, imagesGenerated: 1 }) }
    assert.deepEqual(bodies.map(b => b.size), ["1K", "2K"]); assert.deepEqual(bodies.map(b => b.sequential_image_generation), [undefined, "disabled"])
  } finally { await f.service.close() }
})
test("ByteDance short text test bounds reasoning plus answer by max_completion_tokens; translation has documented max_tokens exception", async () => {
  const bodies: Record<string, unknown>[] = []; const f = fixture(async (url, init) => { assert.equal(String(url), "https://ark.cn-beijing.volces.com/api/v3/chat/completions"); bodies.push(JSON.parse(String(init?.body))); return json({ choices: [{ message: { content: "OK" } }] }) })
  try {
    for (const model of ["doubao-seed-2-1-pro-260915", "deepseek-v4-1-flash-260910", "doubao-seed-character-251128", "doubao-seed-translation-250915"]) assert.equal((await f.service.test("w", randomUUID(), draft("bytedance", "TEXT", model), { authorizeCharge: true })).ok, true)
    assert.deepEqual(bodies.map(b => b.max_completion_tokens), [256, 256, 256, undefined]); assert.deepEqual(bodies.map(b => b.max_tokens), [undefined, undefined, undefined, 256])
  } finally { await f.service.close() }
})

test("Alibaba Wan 2.6 interleave uses asynchronous pure-text input with max_images one, without requiring SSE", async () => {
  let posts = 0; const f = fixture(async (url, init) => {
    if (init?.method === "POST") {
      posts++; assert.equal(new URL(String(url)).pathname, "/api/v1/services/aigc/image-generation/generation")
      const headers = new Headers(init.headers); assert.equal(headers.get("x-dashscope-async"), "enable"); assert.equal(headers.get("x-dashscope-sse"), null)
      const body = JSON.parse(String(init.body)); assert.equal(body.parameters.n, 1); assert.equal(body.parameters.max_images, 1); assert.equal(body.parameters.enable_interleave, true); assert.equal(body.parameters.stream, undefined); assert.equal(body.parameters.size, "768*768"); assert.equal(body.input.messages[0].content.length, 1); assert.equal(body.input.messages[0].content[0].image, undefined)
      return json({ output: { task_id: "wan-interleave-task", task_status: "PENDING" } })
    }
    assert.equal(new URL(String(url)).pathname, "/api/v1/tasks/wan-interleave-task")
    return json({ output: { task_id: "wan-interleave-task", task_status: "SUCCEEDED", finished: true, choices: [{ finish_reason: "stop", message: { content: [{ type: "text", text: "A dot." }, { type: "image", image: "https://result.invalid/one.png" }] } }] }, usage: { image_count: 1, input_tokens: 0, output_tokens: 0, total_tokens: 0 } })
  }, { pollIntervalMs: 1 })
  try { assert.equal((await f.service.test("w", randomUUID(), draft("alibaba", "IMAGE", "wan2.6-image"), { authorizeCharge: true })).ok, true); assert.equal(posts, 1) } finally { await f.service.close() }
})
test("Alibaba interleaved successful task with no image does not validate an image model or cause another paid attempt", async () => {
  let posts = 0; const f = fixture(async (_url, init) => {
    if (init?.method === "POST") { posts++; return json({ output: { task_id: "wan-interleave-task", task_status: "PENDING" } }) }
    return json({ output: { task_id: "wan-interleave-task", task_status: "SUCCEEDED", choices: [{ finish_reason: "stop", message: { content: [{ type: "text", text: "No image" }] } }] }, usage: { image_count: 0 } })
  }, { pollIntervalMs: 1 })
  try { failure(await f.service.test("w", randomUUID(), draft("alibaba", "IMAGE", "wan2.6-image"), { authorizeCharge: true }), "INVALID_RESPONSE"); assert.equal(posts, 1) } finally { await f.service.close() }
})

test("Alibaba IMAGE kind excludes the eight officially image-edit-only IDs, while future names are never guessed", async () => {
  const editOnly = ["qwen-image-edit-max", "qwen-image-edit-max-2026-01-16", "qwen-image-edit-plus", "qwen-image-edit-plus-2025-12-15", "qwen-image-edit-plus-2025-10-30", "qwen-image-edit", "wan2.5-i2i-preview", "wanx2.1-imageedit"]
  const ids = [...editOnly, "qwen-image-2.1-pro", "arbitrary-edit-in-name"]
  const f = fixture(async () => json({ success: true, output: { total: ids.length, page_no: 1, models: ids.map(model => ({ model, inference_metadata: { request_modality: ["Text", "Image"], response_modality: ["Image"] } })) } }))
  try {
    const result = await f.service.discover("w", randomUUID(), draft("alibaba", "IMAGE")); assert.equal(result.ok, true)
    if (result.ok) { assert.deepEqual(result.models.map(m => m.id), ["qwen-image-2.1-pro", "arbitrary-edit-in-name"]); assert.ok(result.warnings.some(w => w.includes("图像编辑"))); assert.ok(result.sources.includes("https://help.aliyun.com/zh/model-studio/image-model")) }
  } finally { await f.service.close() }
})
test("Alibaba Qwen 2.1-pro uses documented native pure-text one-image minimum-size test", async () => {
  let posts = 0; const f = fixture(async (url, init) => {
    posts++; assert.equal(String(url), "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation")
    const body = JSON.parse(String(init?.body)); assert.equal(body.model, "qwen-image-2.1-pro"); assert.equal(body.parameters.size, "512*512"); assert.equal(body.parameters.n, 1); assert.equal(body.parameters.prompt_extend, false); assert.equal(body.input.messages[0].content[0].image, undefined)
    return json({ output: { choices: [{ finish_reason: "stop", message: { content: [{ image: "https://result.invalid/one.png" }] } }] }, usage: { image_count: 1 } })
  })
  try { assert.equal((await f.service.test("w", randomUUID(), draft("alibaba", "IMAGE", "qwen-image-2.1-pro"), { authorizeCharge: true })).ok, true); assert.equal(posts, 1) } finally { await f.service.close() }
})
