import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Workspaces } from "../../desktop/service/workspaces"
import { ModelRepository, type ModelDraft } from "../../desktop/main/model-repository"
import { ModelService } from "../../desktop/main/model-service"
import { ModelGateway } from "../../desktop/core/model-authorization"
import { configureModelTransport } from "../../desktop/service/models"
import { runWithNewTaskDefaults } from "../../desktop/service/task-defaults"
import { generateText } from "../../src/lib/ai/generate"
import { prisma } from "../../src/lib/db"

test("DEFAULT-14: real SDK generation selects frozen review defaults, saves review usage and blocks missing review without a text fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-review-default-"))
  const works = new Workspaces(join(root, "app"), join(process.cwd(), "prisma/migrations"))
  const draft: ModelDraft = { name: "fixture", provider: "custom", protocol: "openai", modelId: "fixture-text", endpoint: "https://fixture.invalid/v1", kind: "TEXT", contextWindow: 0, enabled: true, thinkingLevels: [], defaultThinking: "default", apiKey: "private-main-only-fixture" }
  const protection = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() }
  let repo!: ModelRepository; const sent: string[] = []
  const gateway = new ModelGateway({ keyFor: (id, rev) => repo.keyFor(id, rev), fetch: async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer " + draft.apiKey)
    const model = JSON.parse(String(init?.body)).model; sent.push(model)
    return new Response(`data: ${JSON.stringify({ id: "fixture", created: 1, model, choices: [{ index: 0, delta: { role: "assistant", content: model }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
  } })
  repo = new ModelRepository(join(root, "state.json"), protection, gateway); const service = new ModelService(repo, gateway)
  configureModelTransport(async (method, value) => {
    if (method === "model.defaults") return service.defaults() as never
    if (method === "model.resolve") return service.resolve(value) as never
    if (method === "model.start") return service.start(value) as never
    if (method === "model.read") return service.read(value) as never
    if (method === "model.cancel") return service.cancel(value) as never
    throw Error("Unexpected transport method")
  })
  try {
    await works.initialize()
    let state = await repo.saveModel(0, draft); const text = state.models[0].id
    state = await repo.saveModel(state.revision, { ...draft, modelId: "fixture-review" }); const review = state.models[1].id
    state.settings.agent.textModelId = text; state.settings.agent.reviewModelId = review
    state = await repo.updateSettings(state.revision, state.settings)
    await works.runWithGlobal("inbox", () => runWithNewTaskDefaults(async () => {
      state.settings.agent.reviewModelId = text; state = await repo.updateSettings(state.revision, state.settings)
      const result = await generateText({ userId: "local-author", action: "fixture.review", role: "review", prompt: "受控评审" })
      assert.equal(result.text, "fixture-review"); assert.deepEqual(sent, ["fixture-review"])
      const usage = await prisma.usageRecord.findFirstOrThrow()
      assert.equal(usage.modelId, review); assert.equal(JSON.stringify(usage).includes(draft.apiKey), false)
    }))
    state.settings.agent.reviewModelId = null; state = await repo.updateSettings(state.revision, state.settings)
    await works.runWithGlobal("inbox", () => runWithNewTaskDefaults(async () => {
      await assert.rejects(generateText({ userId: "local-author", action: "fixture.review", role: "review", prompt: "明确阻断" }), { code: "MODEL_NOT_SELECTED" })
      assert.deepEqual(sent, ["fixture-review"])
    }))
  } finally { await service.close(); await works.close(); await rm(root, { recursive: true, force: true }) }
})
