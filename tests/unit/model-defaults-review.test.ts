import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { generateText } from "ai"
import { ModelService } from "../../desktop/main/model-service"
import { ModelGateway } from "../../desktop/core/model-authorization"
import type { ModelRepository } from "../../desktop/main/model-repository"
import { defaultState, type PublicModel } from "../../desktop/core/settings"
import { configureModelTransport } from "../../desktop/service/models"
import { runInDatabaseContext } from "../../desktop/service/context"
import { runWithTaskDefaults } from "../../desktop/service/task-defaults"
import { freezeTaskDefaults } from "../../desktop/shared/task-defaults"
import type { PrismaClient } from "../../src/generated/prisma/client"
import { getModelByIdForUser, getModelForUser } from "../../src/lib/ai/provider"

function fixture() {
  const model: PublicModel = { id: randomUUID(), name: "review fixture", provider: "openai", modelId: "gpt-5-fixture", protocol: "openai", endpoint: "https://fixture.invalid/v1", kind: "TEXT", enabled: true, authRevision: 1, keyMask: "••••••••", contextWindow: 16000, thinkingLevels: ["low", "high"], defaultThinking: "low" }
  const state = { revision: 1, settings: structuredClone(defaultState.settings), models: [model] }
  state.settings.agent.textModelId = model.id
  let afterKey: () => void = () => {}
  let http = 0
  const repository = { read: async () => structuredClone(state), keyFor: async () => { afterKey(); return "public-fake-key" } } as unknown as ModelRepository
  const gateway = new ModelGateway({ keyFor: async () => "public-fake-key", fetch: async () => { http++; throw Error("Unexpected HTTP") } })
  const service = new ModelService(repository, gateway)
  return { model, state, service, setAfterKey: (run: () => void) => { afterKey = run }, http: () => http }
}

test("MR45-01: successful delayed credential resolution cannot return a revoked selection", async () => {
  const f = fixture()
  f.setAfterKey(() => { f.state.models[0].authRevision++; f.state.revision++ })
  try {
    await assert.rejects(f.service.resolve({ role: "text", id: f.model.id, intent: "selection" }), { message: "AUTHORIZATION_REVOKED" })
    assert.equal(f.http(), 0)
  } finally { await f.service.close() }
})

test("MR45-02: disable or delete during successful credential resolution cannot return a usable model", async t => {
  for (const action of ["disable", "delete"] as const) await t.test(action, async () => {
    const f = fixture()
    f.setAfterKey(() => { if (action === "disable") f.state.models[0].enabled = false; else f.state.models = []; f.state.revision++ })
    try {
      await assert.rejects(f.service.resolve({ role: "text", id: f.model.id, intent: "invoke" }), { message: "AUTHORIZATION_REVOKED" })
      assert.equal(f.http(), 0)
    } finally { await f.service.close() }
  })
})

test("MR45-03: model-default thinking stays default in the task record but resolves to the saved model effort in SDK HTTP", async () => {
  const f = fixture(); const snapshot = freezeTaskDefaults(f.state.settings.agent, f.state.revision)
  configureModelTransport(async (method, value) => {
    if (method === "model.resolve") return f.service.resolve(value) as never
    throw Error(`Unexpected method: ${method}`)
  })
  const sent: Record<string, unknown>[] = []
  const fetcher: typeof fetch = async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)))
    return Response.json({ id: "fixture", created: 1, model: f.model.modelId, choices: [{ index: 0, message: { role: "assistant", content: "controlled response" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
  }
  try {
    // Resolution and SDK construction require the trusted local scope, but
    // this test never issues a database query or a live network request.
    await runInDatabaseContext({ workspaceId: "inbox", database: {} as PrismaClient }, () => runWithTaskDefaults(snapshot, async () => {
      const resolved = await getModelForUser("local-author", { fetch: fetcher })
      const output = await generateText({ model: resolved.model, providerOptions: resolved.providerOptions, prompt: "Controlled fixture", maxRetries: 0 })
      assert.equal(output.text, "controlled response")
      for (const effort of [null, "default", "high"] as const) {
        const explicit = await getModelByIdForUser("local-author", f.model.id, { fetch: fetcher, thinkingEffort: effort })
        await generateText({ model: explicit.model, providerOptions: explicit.providerOptions, prompt: "Controlled explicit fixture", maxRetries: 0 })
      }
    }))
    assert.equal(snapshot.thinking, "default")
    assert.equal(sent.length, 4)
    assert.deepEqual(sent.map(body => body.reasoning_effort), ["low", "low", "low", "high"])
  } finally { await f.service.close() }
})

test("MR45-05: an unsupported persisted explicit effort blocks before SDK HTTP instead of silently sending it", async () => {
  const f = fixture(); f.state.models[0].thinkingLevels = ["low"]
  const snapshot = freezeTaskDefaults({ ...f.state.settings.agent, thinking: "high" }, f.state.revision)
  configureModelTransport(async (method, value) => {
    if (method === "model.resolve") return f.service.resolve(value) as never
    throw Error(`Unexpected method: ${method}`)
  })
  let sent = 0
  const fetcher: typeof fetch = async () => { sent++; throw Error("No HTTP expected") }
  try {
    await runInDatabaseContext({ workspaceId: "inbox", database: {} as PrismaClient }, () => runWithTaskDefaults(snapshot, async () => {
      await assert.rejects(getModelForUser("local-author", { fetch: fetcher }))
      await assert.rejects(getModelByIdForUser("local-author", f.model.id, { fetch: fetcher, thinkingEffort: "high" }))
    }))
    assert.equal(sent, 0)
    assert.equal(snapshot.thinking, "high", "a historical task is never silently rewritten")
  } finally { await f.service.close() }
})

test("MR45-06: declared thinking with no implemented request mapping must not silently degrade to provider default", async () => {
  const f = fixture()
  Object.assign(f.state.models[0], { provider: "anthropic", protocol: "anthropic", modelId: "declared-effort-fixture", thinkingLevels: ["xhigh"], defaultThinking: "default" })
  const snapshot = freezeTaskDefaults({ ...f.state.settings.agent, thinking: "xhigh" }, f.state.revision)
  configureModelTransport(async (method, value) => {
    if (method === "model.resolve") return f.service.resolve(value) as never
    throw Error(`Unexpected method: ${method}`)
  })
  let sent = 0
  const fetcher: typeof fetch = async () => { sent++; throw Error("No HTTP expected") }
  try {
    await runInDatabaseContext({ workspaceId: "inbox", database: {} as PrismaClient }, () => runWithTaskDefaults(snapshot, async () => {
      await assert.rejects(getModelForUser("local-author", { fetch: fetcher }), { code: "MODEL_THINKING_UNSUPPORTED" })
      await assert.rejects(getModelByIdForUser("local-author", f.model.id, { fetch: fetcher, thinkingEffort: "xhigh" }), { code: "MODEL_THINKING_UNSUPPORTED" })
    }))
    assert.equal(sent, 0)
    assert.equal(snapshot.thinking, "xhigh")
  } finally { await f.service.close() }
})
