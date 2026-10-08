import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Workspaces } from "../../desktop/service/workspaces"
import { ModelRepository, type ModelDraft } from "../../desktop/main/model-repository"
import { ModelService } from "../../desktop/main/model-service"
import { ModelGateway } from "../../desktop/core/model-authorization"
import { configureModelTransport, localModelFetch } from "../../desktop/service/models"
import { runWithNewTaskDefaults } from "../../desktop/service/task-defaults"
import { prisma } from "../../src/lib/db"
import { PROMPT_TEMPLATES } from "../../prisma/seed-templates"
import { POST } from "../../desktop/handlers/chat/route"

test("DEFAULT-15/16: retained chat handler uses accepted task model and mode, with keyless accepted-default event", async t => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-chat-defaults-"))
  const works = new Workspaces(join(root, "app"), join(process.cwd(), "prisma/migrations"))
  const draft: ModelDraft = { name: "fixture", provider: "custom", protocol: "openai", modelId: "fixture-text", endpoint: "https://fixture.invalid/v1", kind: "TEXT", contextWindow: 128000, enabled: true, thinkingLevels: [], defaultThinking: "default", apiKey: "private-main-fixture" }
  let repo!: ModelRepository; const sent: { tools?: { function: { name: string } }[] }[] = []
  const gateway = new ModelGateway({ keyFor: (id, rev) => repo.keyFor(id, rev), fetch: async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer " + draft.apiKey)
    const body = JSON.parse(String(init?.body)); sent.push(body)
    return new Response(`data: ${JSON.stringify({ id: "fixture", created: 1, model: draft.modelId, choices: [{ index: 0, delta: { role: "assistant", content: "受控回复" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", created: 1, model: draft.modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
  } })
  const protection = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() }
  repo = new ModelRepository(join(root, "state.json"), protection, gateway); const service = new ModelService(repo, gateway)
  configureModelTransport(async (method, value) => {
    if (method === "model.defaults") return service.defaults() as never
    if (method === "model.resolve") return service.resolve(value) as never
    if (method === "model.start") return service.start(value) as never
    if (method === "model.read") return service.read(value) as never
    if (method === "model.cancel") return service.cancel(value) as never
    throw Error("Unexpected transport method")
  })
  const originalFetch = globalThis.fetch; globalThis.fetch = localModelFetch
  const request = (body: object) => POST(new Request("https://local.invalid/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
  try {
    await works.initialize(); let state = await repo.saveModel(0, draft); const id = state.models[0].id
    state.settings.agent.textModelId = id; state.settings.agent.mode = "plan"; state = await repo.updateSettings(state.revision, state.settings)
    await works.runWithGlobal("inbox", async () => {
      for (const template of PROMPT_TEMPLATES) await prisma.promptTemplate.create({ data: { ...template, version: 1, enabled: true } })
      await t.test("DEFAULT-15: explicitly unselected accepted conversation produces MODEL_NOT_SELECTED without any HTTP", () => runWithNewTaskDefaults(async () => {
        const before = sent.length
        const response = await request({ clientRequestId: randomUUID(), message: "模型明确未选", modelId: null })
        assert.equal(response.status, 200)
        const sse = await response.text()
        assert.equal(sent.length, before)
        assert.match(sse, /MODEL_NOT_SELECTED/)
        const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: response.headers.get("x-conversation-id")! } })
        assert.equal(conversation.modelId, null)
      }))
      await t.test("DEFAULT-16: omitted new mode adopts frozen plan default and reports actual accepted choices before model output", () => runWithNewTaskDefaults(async () => {
        const before = sent.length
        const response = await request({ clientRequestId: randomUUID(), message: "使用新会话默认模式" })
        const sse = await response.text()
        assert.equal(sent.length, before + 1)
        const tools = sent[before].tools?.map(tool => tool.function.name) ?? []
        assert.ok(tools.includes("proposePlan")); assert.equal(tools.includes("startNovelFromChat"), false)
        const first = sse.split("\n\n").find(part => part.startsWith("data: {"))!
        const event = JSON.parse(first.slice(6))
        assert.equal(event.type, "data-conversation"); assert.equal(event.data.modelId, id); assert.equal(event.data.thinkingEffort, null)
        assert.equal(event.data.defaultsSnapshot.mode, "plan"); assert.equal(event.data.defaultsSnapshot.textModelId, id)
        assert.equal(JSON.stringify(event).includes(draft.apiKey), false)
      }))
    })
  } finally { globalThis.fetch = originalFetch; await service.close(); await works.close(); await rm(root, { recursive: true, force: true }) }
})
