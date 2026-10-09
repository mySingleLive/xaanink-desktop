import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { ModelConfigurationService } from "../../desktop/main/model-configuration"
import { ModelGateway } from "../../desktop/core/model-authorization"
import { presetsFor, type ConfigurationDraft } from "../../desktop/shared/model-catalog"
import { officialModel } from "../../desktop/shared/provider-capabilities"
import { isValidThinkingEffort, thinkingEffortOptionsFor } from "../../src/lib/ai/thinking-effort"

const key = "byok-public-fixture-key"
const json = (value: unknown, status = 200) => Response.json(value, { status })
function draft(provider: ConfigurationDraft["provider"], kind: ConfigurationDraft["kind"] = "TEXT", modelId = "fixture"): ConfigurationDraft {
  const preset = presetsFor(kind).find(p => p.id === provider)!
  return { provider, kind, modelId, protocol: preset.protocol ?? "openai", endpoint: (kind === "TEXT" ? preset.textEndpoint : preset.imageEndpoint) ?? "https://fixture.invalid/v1", apiKey: key }
}
async function run(fetcher: typeof fetch, work: (s: ModelConfigurationService) => Promise<void>) {
  const service = new ModelConfigurationService({ repository: { read: async () => ({ models: [] }) as never, keyFor: async () => { throw Error("must not read saved credentials") } }, gateway: new ModelGateway({ keyFor: async () => key, fetch: fetcher }), fetch: fetcher, timeoutMs: 1000 })
  try { await work(service) } finally { await service.close() }
}
const discover = (s: ModelConfigurationService, d: ConfigurationDraft) => s.discover("byok", randomUUID(), d)
const invoke = (s: ModelConfigurationService, d: ConfigurationDraft) => s.test("byok", randomUUID(), d, { authorizeCharge: true })

test("B06/B17: saved MiniMax subscription credentials are checked under current authorization", async () => {
  for (const subscribed of [true, false]) {
    let requests = 0, reads = 0
    const input = { ...draft("minimax", "TEXT", "MiniMax-M3.1-Flash-Preview"), id: randomUUID(), apiKey: "" }
    const row = { ...input, authRevision: 1, enabled: true }
    const fetcher: typeof fetch = async () => { requests++; return json({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] }) }
    const gateway = new ModelGateway({ keyFor: async () => "unused", fetch: fetcher }); gateway.replace(row)
    const service = new ModelConfigurationService({ gateway, fetch: fetcher, repository: { read: async () => ({ models: [row] }) as never, keyFor: async () => { reads++; return subscribed ? "sk-cp-saved-public-fixture" : key } } })
    try {
      const result = await invoke(service, input)
      assert.equal(result.ok, subscribed); assert.ok(reads > 0)
      if (!result.ok) assert.equal(result.code, "MODEL_UNAVAILABLE")
      assert.equal(requests, subscribed ? 1 : 0)
      assert.equal(JSON.stringify(result).includes("sk-cp-saved-public-fixture"), false)
    } finally { await service.close() }
  }
})

test("B06/B17: revocation during saved subscription classification never sends a request", async () => {
  for (const revocation of ["remove", "disable", "rotate"] as const) {
    let resolveKey!: (key: string) => void, entered!: () => void, requests = 0
    const started = new Promise<void>(resolve => { entered = resolve })
    const input = { ...draft("minimax", "TEXT", "MiniMax-M3.1-Flash-Preview"), id: randomUUID(), apiKey: "" }
    const row = { ...input, authRevision: 1, enabled: true }
    const fetcher: typeof fetch = async () => { requests++; throw Error("must not send") }
    const gateway = new ModelGateway({ keyFor: async () => "unused", fetch: fetcher }); gateway.replace(row)
    const service = new ModelConfigurationService({ gateway, fetch: fetcher, repository: { read: async () => ({ models: [row] }) as never, keyFor: () => { entered(); return new Promise<string>(resolve => { resolveKey = resolve }) } } })
    try {
      const running = invoke(service, input); await started
      if (revocation === "remove") gateway.remove(input.id)
      else gateway.replace({ ...row, enabled: revocation !== "disable", authRevision: 2 })
      const result = await running; assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.code, "AUTHORIZATION_REVOKED")
      resolveKey("sk-cp-late-public-fixture"); await new Promise<void>(resolve => setImmediate(resolve))
      assert.equal(requests, 0); assert.equal(service.activeCount, 0)
      assert.equal(JSON.stringify(result).includes("sk-cp-late-public-fixture"), false)
    } finally { await service.close() }
  }
})

test("B01/B12: China defaults and exact legacy official addresses", async () => {
  assert.equal(draft("zai").endpoint, "https://open.bigmodel.cn/api/paas/v4")
  assert.equal(draft("minimax").endpoint, "https://api.minimax.cn/v1")
  let calls = 0
  await run(async () => { calls++; return json({ data: [] }) }, async s => {
    assert.equal((await discover(s, { ...draft("zai"), endpoint: "https://api.z.ai/api/paas/v4" })).ok, true)
    assert.equal((await discover(s, { ...draft("minimax"), endpoint: "https://api.minimaxi.com/v1" })).ok, true)
    const rejected = await discover(s, { ...draft("zai"), endpoint: "https://open.bigmodel.cn.evil.invalid/api/paas/v4" })
    assert.equal(rejected.ok, false); assert.equal(calls, 2)
  })
})
test("B02/B03: exact OpenAI snapshots, lifecycle and unknown future IDs", async () => {
  await run(async () => json({ data: [
    { id: "gpt-4.1-mini-2025-04-14" }, { id: "gpt-5.5-pro-2026-04-23" },
    { id: "gpt-4o", shutdown_date: "2000-01-01" },
    { id: "gpt-4-turbo", shutdown_date: "2099-01-01" },
    { id: "text-embedding-3-large" }, { id: "gpt-future-2099-01-01" },
  ] }), async s => {
    const result = await discover(s, draft("openai")); assert.equal(result.ok, true); if (!result.ok) return
    for (const id of ["gpt-4.1-mini-2025-04-14", "gpt-5.5-pro-2026-04-23"]) assert.ok(result.models.some(m => m.id === id))
    assert.equal(result.models.some(m => m.id === "gpt-4o"), false)
    assert.equal(result.models.some(m => m.id === "text-embedding-3-large"), false)
    assert.deepEqual(result.unknownCapabilityIds, ["gpt-future-2099-01-01"])
    assert.equal(result.models.find(m => m.id === "gpt-4.1-mini-2025-04-14")?.contextWindow, 1047576)
    assert.ok(result.warnings.some(w => /下线|弃用/.test(w)))
  })
})
test("B02: canonical pages win alias collisions and unsupported official models stay excluded", async () => {
  const sol = officialModel("openai", "gpt-5.6-sol")!
  assert.equal(sol.deprecated, false); assert.equal(sol.wire, "chat")
  assert.equal(sol.source, "https://developers.openai.com/api/docs/models/gpt-5.6-sol")
  assert.deepEqual(sol.thinkingLevels, ["low", "medium", "high", "xhigh", "max"])
  assert.equal(officialModel("openai", "gpt-5.6-cyber")?.deprecated, false)
  await run(async () => json({ data: ["gpt-oss-120b", "gpt-oss-20b", "gpt-3.5-turbo-instruct", "computer-use-preview", "computer-use-preview-2025-03-11"].map(id => ({ id })) }), async s => {
    const result = await discover(s, draft("openai")); assert.equal(result.ok, true); if (!result.ok) return
    assert.deepEqual(result.unknownCapabilityIds, [])
    assert.equal(result.models.some(m => officialModel("openai", m.id)?.kind === "OTHER"), false)
    assert.ok(result.models.some(m => m.id === "gpt-5.6-sol"))
    assert.ok(result.models.some(m => m.id === "gpt-5.6-cyber"))
  })
})
test("B03: published shutdown dates override stale live search aliases and retain future lifecycle notes", async () => {
  assert.equal(officialModel("openai", "o3-pro")?.deprecated, true)
  assert.equal(officialModel("openai", "o3-pro")?.shutdownDate, "2026-12-11")
  await run(async () => json({ data: [{ id: "gpt-4o-search-preview" }, { id: "gpt-4o-mini-search-preview" }, { id: "gpt-4.1-nano" }] }), async s => {
    const result = await discover(s, draft("openai")); assert.equal(result.ok, true); if (!result.ok) return
    assert.equal(result.models.some(m => m.id === "gpt-4o-search-preview" || m.id === "gpt-4o-mini-search-preview"), false)
    assert.ok(result.models.find(m => m.id === "gpt-4.1-nano")?.notes?.some(n => n.includes("2026-10-23")))
    assert.equal(result.models.some(m => m.id === "o3-pro"), false, "unlisted deprecated candidates are not newly recommended")
  })
})
test("B04: DeepSeek official IDs work without optional modalities", async () => {
  await run(async () => json({ data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }, { id: "deepseek-future" }] }), async s => {
    const result = await discover(s, draft("deepseek")); assert.equal(result.ok, true); if (!result.ok) return
    assert.deepEqual(result.models.map(m => m.id), ["deepseek-flash", "deepseek-v4-pro"])
    assert.deepEqual(result.unknownCapabilityIds, ["deepseek-future"])
  })
})
test("B05/B06: authenticated CN catalogs merge complete public candidates and subscription limits", async () => {
  assert.deepEqual(thinkingEffortOptionsFor("minimax", "MiniMax-M3.1-Flash-Preview").map(o => o.value), ["low", "medium", "high", "xhigh", "max"])
  assert.equal(isValidThinkingEffort("minimax", "MiniMax-M3.1-Flash-Preview", "low"), true)
  assert.equal(isValidThinkingEffort("minimax", "MiniMax-M3.1-Flash-Preview", "max"), true)
  assert.deepEqual(thinkingEffortOptionsFor("minimax", "MiniMax-M3"), [])
  assert.deepEqual(thinkingEffortOptionsFor("minimax", "MiniMax-M2.7"), [])
  let calls = 0
  await run(async () => { calls++; return json({ data: [{ id: "glm-5.3" }] }) }, async s => {
    const result = await discover(s, draft("zai")); assert.equal(result.ok, true); if (!result.ok) return
    assert.ok(result.sources.every(source => typeof source === "string" && new URL(source).protocol === "https:"))
    for (const id of ["glm-5.3-flash", "glm-5.3-flashx", "glm-5-turbo", "glm-4-long", "glm-4-flash-250414", "glm-5v-turbo"]) assert.ok(result.models.some(m => m.id === id), id)
    assert.equal(result.models.find(m => m.id === "glm-5.3")?.permission, "listed-unverified")
    assert.equal(result.models.find(m => m.id === "glm-5v-turbo")?.permission, "unknown")
    const images = await discover(s, draft("zai", "IMAGE")); assert.equal(images.ok, true)
    if (images.ok) assert.ok(images.models.some(m => m.id === "cogview-3-flash"))
    assert.equal(calls, 2)
  })
  await run(async () => json({ data: [{ id: "MiniMax-M3" }] }), async s => {
    const result = await discover(s, draft("minimax")); assert.equal(result.ok, true); if (!result.ok) return
    assert.ok(result.sources.every(source => typeof source === "string" && new URL(source).protocol === "https:"))
    const preview = result.models.find(m => m.id === "MiniMax-M3.1-Flash-Preview")
    assert.equal(preview?.available, false); assert.ok(preview?.notes?.some(n => n.includes("订阅")))
    assert.deepEqual(preview?.thinkingLevels, ["low", "medium", "high", "xhigh", "max"])
    assert.equal(preview?.defaultThinking, "max"); assert.equal(preview?.contextWindow, 1000000)
    assert.equal(result.models.find(m => m.id === "MiniMax-M2.7")?.contextWindow, 204800)
    const subscribed = await discover(s, { ...draft("minimax"), apiKey: "sk-cp-public-fixture" }); assert.equal(subscribed.ok, true)
    if (subscribed.ok) assert.notEqual(subscribed.models.find(m => m.id === preview?.id)?.available, false)
  })
  await run(async () => { assert.fail("ordinary API Key must not generate subscription-only model") }, async s => {
    const result = await invoke(s, draft("minimax", "TEXT", "MiniMax-M3.1-Flash-Preview"))
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "MODEL_UNAVAILABLE")
  })
})
test("B07: Ark real metadata excludes historic IDs and image-edit-only", async () => {
  let calls = 0
  await run(async () => { calls++; return json({ data: [
    { id: "doubao-seed-2-1-pro-260915", modalities: { output_modalities: ["text"] }, task_type: ["TextGeneration"], token_limits: { context_window: 1048576, max_output_token_length: 262144 } },
    { id: "doubao-seedream-5-0-pro-260628", modalities: { output_modalities: ["image"] }, task_type: ["TextToImage"] },
    { id: "doubao-pro-32k-240515", modalities: { output_modalities: ["text"] }, task_type: ["TextGeneration"] },
  ] }) }, async s => {
    const result = await discover(s, draft("bytedance")); assert.equal(result.ok, true); if (!result.ok) return
    assert.equal(calls, 1); assert.equal(result.models.some(m => m.id === "doubao-pro-32k-240515"), false)
    assert.equal(result.models.find(m => m.id === "doubao-seed-2-1-pro-260915")?.contextWindow, 1048576)
  })
})
test("B07/B11: Ark duplicate capabilities conflict before filtering; identical rows deduplicate", async () => {
  const row = { id: "doubao-seed-2-1-pro-260915", modalities: { output_modalities: ["text"] }, task_type: ["TextGeneration"], token_limits: { context_window: 1048576, max_output_token_length: 262144 } }
  for (const other of [{ ...row, modalities: { output_modalities: ["image"] } }, { ...row, task_type: ["ImageToImage"] }, { ...row, token_limits: { ...row.token_limits, context_window: 1000 } }]) await run(async () => json({ data: [row, other] }), async s => {
    const result = await discover(s, draft("bytedance")); assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, "INVALID_RESPONSE")
  })
  await run(async () => json({ data: [row, structuredClone(row)] }), async s => {
    const result = await discover(s, draft("bytedance")); assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.models.filter(m => m.id === row.id).length, 1)
  })
})
test("B10: safe HTTP and business failures never echo provider credentials", async () => {
  for (const [status, value, code] of [
    [401, { error: { message: key } }, "AUTHENTICATION_FAILED"], [403, {}, "PERMISSION_DENIED"],
    [402, {}, "QUOTA_EXCEEDED"], [429, {}, "RATE_LIMITED"], [404, {}, "MODEL_UNAVAILABLE"],
    [429, { error: { code: "insufficient_quota", message: key } }, "QUOTA_EXCEEDED"],
    [429, { error: { code: "credit_balance_exhausted", message: key } }, "QUOTA_EXCEEDED"],
    [404, { error: { code: "ModelNotOpen", message: key } }, "PERMISSION_DENIED"],
    [200, { base_resp: { status_code: 1008, status_msg: key } }, "QUOTA_EXCEEDED"],
  ] as const) await run(async () => json(value, status), async s => {
    const result = await invoke(s, draft("minimax", "TEXT", "MiniMax-M3"))
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, code)
    assert.equal(JSON.stringify(result).includes(key), false)
  })
})
test("B13/B14: automatic wire API and fixed total budget, no paid retries", async () => {
  const requests: { path: string; body: any }[] = []
  await run(async (url, init) => {
    const path = new URL(String(url)).pathname, body = JSON.parse(String(init?.body)); requests.push({ path, body })
    return path.endsWith("/responses") ? json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }], usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 } }) : json({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] })
  }, async s => {
    for (const [provider, id] of [["openai", "gpt-5.5-pro"], ["openai", "gpt-6.1-sol"], ["openai", "gpt-4.1-mini"], ["zai", "glm-4v-flash"], ["custom", "unknown"]] as const) assert.equal((await invoke(s, draft(provider, "TEXT", id))).ok, true)
    assert.deepEqual(requests.map(r => r.path), ["/v1/responses", "/v1/responses", "/v1/chat/completions", "/api/paas/v4/chat/completions", "/v1/chat/completions"])
    assert.equal(requests[0].body.max_output_tokens, 2048); assert.equal(requests[0].body.store, false); assert.equal(requests[0].body.background, false)
    assert.equal(requests[2].body.max_completion_tokens, 2048); assert.equal(requests[3].body.max_tokens, 1024); assert.equal(requests[4].body.max_tokens, 1024)
    assert.equal(requests.length, 5)
  })
  for (const value of [{ choices: [{ finish_reason: "length", message: { content: "partial" } }] }, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }]) await run(async () => json(value), async s => {
    const result = await invoke(s, draft("openai", "TEXT", value.output ? "gpt-5.5-pro" : "gpt-4.1-mini")); assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, "OUTPUT_TRUNCATED")
  })
})
