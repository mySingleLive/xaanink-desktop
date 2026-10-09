import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider"
import { createOpenAI } from "@ai-sdk/openai"
import { authorizeModelOutput, nonStreamingModel, authorizedNonStreamingModel } from "../../src/lib/ai/nonstreaming-model"
import { toolCompatibleModel } from "../../src/lib/ai/tool-compatible-model"
import { instantiateModel } from "../../src/lib/ai/provider"
import { configureModelTransport, localModelRecord } from "../../desktop/service/models"
import { ModelGateway } from "../../desktop/core/model-authorization"
import { ModelService } from "../../desktop/main/model-service"
import type { PublicModel } from "../../desktop/core/settings"

async function collect(stream: ReadableStream<LanguageModelV4StreamPart>) { const reader = stream.getReader(); const parts: LanguageModelV4StreamPart[] = []; try { for (;;) { const next = await reader.read(); if (next.done) return parts; parts.push(next.value) } } finally { reader.releaseLock() } }
const params = { prompt: [{ role: "user" as const, content: [{ type: "text" as const, text: "test" }] }], maxOutputTokens: 2048 }
function response(model = "gpt-5.5-pro") {
  return Response.json({ id: "resp_fixture", object: "response", created_at: 1, model, status: "completed", error: null, incomplete_details: null,
    output: [
      { id: "rs_fixture", type: "reasoning", summary: [{ type: "summary_text", text: "Reasoning" }] },
      { id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] },
      { id: "fc_fixture", type: "function_call", call_id: "call_fixture", name: "review", arguments: "{}", status: "completed" },
    ], usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 1 } } })
}
const model = (): PublicModel => ({ id: randomUUID(), name: "公开测试模型", provider: "openai", protocol: "openai", endpoint: "https://api.openai.com/v1", modelId: "gpt-5.5-pro", kind: "TEXT", contextWindow: 1050000, enabled: true, authRevision: 1, keyMask: "••••", thinkingLevels: ["medium", "high", "xhigh"], defaultThinking: "high" })
test("B18: production SDK chooses Responses and maps one nonstream request's text/reasoning/tool/usage", async () => {
  const snapshot = model(); let requests = 0, assertions = 0
  configureModelTransport(async method => { assert.equal(method, "model.assert"); assertions++; return true as never })
  const resolved = instantiateModel(localModelRecord(snapshot), { fetch: async (url, init) => {
    requests++; assert.equal(String(url), snapshot.endpoint + "/responses")
    const body = JSON.parse(String(init?.body)); assert.notEqual(body.stream, true); assert.equal(body.store, false)
    return response()
  } })
  const result = await (resolved.model as LanguageModelV4).doStream({ ...params, providerOptions: resolved.providerOptions })
  const parts = await collect(result.stream)
  assert.equal(requests, 1); assert.ok(assertions > 1)
  assert.ok(parts.some(p => p.type === "text-delta" && p.delta === "OK"))
  assert.ok(parts.some(p => p.type === "reasoning-delta" && p.delta === "Reasoning"))
  assert.ok(parts.some(p => p.type === "tool-call" && p.toolName === "review"))
  const finish = parts.find(p => p.type === "finish"); assert.equal(finish?.usage.inputTokens.total, 7); assert.equal(finish?.usage.outputTokens.total, 3)
})
test("B18: GPT6.1Sol uses Responses for tools without falling back to Chat", async () => {
  const snapshot = { ...model(), modelId: "gpt-6.1-sol", thinkingLevels: ["low", "medium", "high", "xhigh", "max"], defaultThinking: "medium" }
  let calls = 0
  const resolved = instantiateModel(localModelRecord(snapshot), { fetch: async (url, init) => { calls++; assert.equal(String(url), snapshot.endpoint + "/responses"); assert.ok(JSON.parse(String(init?.body)).tools); return response(snapshot.modelId) } })
  const result = await (resolved.model as LanguageModelV4).doGenerate({ ...params, providerOptions: resolved.providerOptions, tools: [{ type: "function", name: "review", inputSchema: { type: "object", properties: {} } }] })
  assert.ok(result.content.some(p => p.type === "tool-call")); assert.equal(calls, 1)
})
test("B13: exact approved Cyber model automatically sends the required access program", async () => {
  const snapshot = { ...model(), modelId: "gpt-5.6-cyber", thinkingLevels: [], defaultThinking: "default" }
  const resolved = instantiateModel(localModelRecord(snapshot), { fetch: async (url, init) => {
    assert.equal(String(url), snapshot.endpoint + "/responses")
    assert.deepEqual(JSON.parse(String(init?.body)).access_programs, { cyber: "daybreak_red" })
    return response(snapshot.modelId)
  } })
  const result = await (resolved.model as LanguageModelV4).doGenerate({ ...params, providerOptions: resolved.providerOptions })
  assert.ok(result.content.some(p => p.type === "text" && p.text === "OK"))
})
test("B19/B20: cancellation or changed authority after HTTP completion emits no queued output", async () => {
  for (const reason of ["cancel", "rotate", "disable", "delete"]) {
    let calls = 0, authorized = true
    const controller = new AbortController()
    const adapter = createOpenAI({ apiKey: "public-fixture", fetch: async () => { calls++; return response() } }).responses("gpt-5.5-pro")
    const wrapped = authorizedNonStreamingModel(adapter, async () => { if (!authorized) throw Error("AUTHORIZATION_REVOKED") })
    const result = await wrapped.doStream({ ...params, abortSignal: controller.signal })
    if (reason === "cancel") controller.abort(); else authorized = false
    await assert.rejects(async () => { const reader = result.stream.getReader(); try { await reader.read(); assert.fail("no event may escape") } finally { reader.releaseLock() } })
    assert.equal(calls, 1)
  }
})
test("B26: custom Anthropic base URLs normalize /v1 exactly once for the actual SDK", async () => {
  for (const endpoint of ["https://api.deepseek.com/anthropic", "https://api.deepseek.com/anthropic/v1"]) {
    const snapshot = { ...model(), provider: "custom", protocol: "anthropic" as const, endpoint, modelId: "deepseek-flash", thinkingLevels: [], defaultThinking: "default" }
    const resolved = instantiateModel(localModelRecord(snapshot), { fetch: async url => {
      assert.equal(String(url), "https://api.deepseek.com/anthropic/v1/messages")
      return Response.json({ id: "msg_fixture", type: "message", role: "assistant", model: snapshot.modelId, content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 7, output_tokens: 3 } })
    } })
    const result = await (resolved.model as LanguageModelV4).doGenerate(params)
    assert.ok(result.content.some(p => p.type === "text" && p.text === "OK"))
  }
})
test("B06/B13: MiniMax Preview's selected official effort reaches the actual SDK", async () => {
  const snapshot = { ...model(), provider: "minimax", endpoint: "https://api.minimax.cn/v1", modelId: "MiniMax-M3.1-Flash-Preview", thinkingLevels: ["low", "medium", "high", "xhigh", "max"], defaultThinking: "max" }
  let calls = 0
  const resolved = instantiateModel(localModelRecord(snapshot), { thinkingEffort: "low", fetch: async (url, init) => {
    calls++; assert.equal(String(url), snapshot.endpoint + "/chat/completions")
    assert.equal(JSON.parse(String(init?.body)).reasoning_effort, "low")
    return Response.json({ id: "fixture", object: "chat.completion", created: 1, model: snapshot.modelId, choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } })
  } })
  const result = await (resolved.model as LanguageModelV4).doGenerate({ ...params, providerOptions: resolved.providerOptions })
  assert.ok(result.content.some(p => p.type === "text" && p.text === "OK")); assert.equal(calls, 1)
})
test("B19: cancellation during nonstream waiting does not release late generation", async () => {
  const controller = new AbortController(), waiting = Promise.withResolvers<Response>(), entered = Promise.withResolvers<void>()
  let calls = 0
  const adapter = createOpenAI({ apiKey: "public-fixture", fetch: async () => { calls++; entered.resolve(); return waiting.promise } }).responses("gpt-5.5-pro")
  const wrapped = authorizedNonStreamingModel(adapter, async () => {})
  const pending = wrapped.doStream({ ...params, abortSignal: controller.signal })
  await entered.promise; controller.abort(); waiting.resolve(response())
  await assert.rejects(Promise.resolve(pending)); assert.equal(calls, 1)
})
test("B19/B20: outer authority guard blocks text and tool events already queued by compatibility decoding", async () => {
  for (const reason of ["cancel", "rotate", "disable", "delete"]) {
    let authorized = true, calls = 0
    const controller = new AbortController()
    const adapter = createOpenAI({ apiKey: "public-fixture", fetch: async () => {
      calls++
      return Response.json({ id: "resp_fixture", created_at: 1, status: "completed", error: null, incomplete_details: null, output: [{ id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: 'Before<novel_tool>{"name":"review","input":{}}</novel_tool>', annotations: [] }] }], usage: { input_tokens: 7, output_tokens: 3 } })
    } }).responses("gpt-5.5-pro")
    const compatible = toolCompatibleModel(nonStreamingModel(adapter), randomUUID(), true)
    const guarded = authorizeModelOutput(compatible, async () => { if (!authorized) throw Error("AUTHORIZATION_REVOKED") })
    const result = await guarded.doStream({ ...params, abortSignal: controller.signal, tools: [{ type: "function", name: "review", inputSchema: { type: "object", properties: {} } }] })
    const reader = result.stream.getReader()
    try {
      for (;;) { const next = await reader.read(); assert.equal(next.done, false); if (next.value?.type === "text-start") break }
      if (reason === "cancel") controller.abort(); else authorized = false
      await assert.rejects(reader.read(), "queued text-delta and tool-call must not escape")
      assert.equal(calls, 1)
    } finally { reader.releaseLock() }
  }
})
test("B20: main assertion rejects old revision, disable and delete without opening a network request", () => {
  const snapshot = model(), gateway = new ModelGateway({ keyFor: async () => "fixture", fetch: async () => { assert.fail("read-only assertion must never fetch") } })
  const service = new ModelService({} as never, gateway), input = { modelId: snapshot.id, authRevision: 1, kind: "TEXT" }
  gateway.replace(snapshot); assert.equal(service.assertAuthorization(input), true)
  gateway.replace({ ...snapshot, authRevision: 2 }); assert.throws(() => service.assertAuthorization(input))
  gateway.replace({ ...snapshot, enabled: false, authRevision: 3 }); assert.throws(() => service.assertAuthorization(input))
  gateway.remove(snapshot.id); assert.throws(() => service.assertAuthorization(input))
})
