import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { streamText } from "ai"
import { Workspaces } from "../../desktop/service/workspaces"
import { configureModelTransport } from "../../desktop/service/models"
import { ModelService } from "../../desktop/main/model-service"
import { ModelRepository, type ModelDraft } from "../../desktop/main/model-repository"
import { ModelGateway } from "../../desktop/core/model-authorization"
import { generateText, streamGeneration } from "../../src/lib/ai/generate"
import { getModelByIdForUser, getAutoModelForUser, resolveModelForUser } from "../../src/lib/ai/provider"
import { getDatabaseContext } from "../../desktop/service/context"
import { prisma } from "../../src/lib/db"
const draft: ModelDraft = { name: "作者的模型", provider: "custom", protocol: "openai", modelId: "fixture-text", endpoint: "https://fixture.invalid/v1", kind: "TEXT", contextWindow: 128000, enabled: true, thinkingLevels: [], defaultThinking: "default", apiKey: "fixture-does-not-exist-main-key" }
const protection = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }

test("DESK-M12/M13: original text generation runs through SDK and main gateway, saves keyless references and immutable usage, never substitutes a model", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-model-sdk-"))
  const works = new Workspaces(join(root, "app"), join(process.cwd(), "prisma/migrations"))
  let repo!: ModelRepository; let calls = 0; let failNext = false
  const gateway = new ModelGateway({ keyFor: (id, rev) => repo.keyFor(id, rev), fetch: async (url, init) => {
    assert.equal(String(url), draft.endpoint + "/chat/completions")
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer " + draft.apiKey)
    assert.equal(JSON.parse(String(init?.body)).model, draft.modelId)
    calls++
    if (failNext) { failNext = false; throw new TypeError("fetch failed") }
    const chunks = [
      { id: "fixture", created: 1, model: draft.modelId, choices: [{ index: 0, delta: { role: "assistant", content: "本地创作测试" }, finish_reason: null }] },
      { id: "fixture", created: 1, model: draft.modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } },
    ]
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  } })
  repo = new ModelRepository(join(root, "state.json"), protection, gateway); const service = new ModelService(repo, gateway)
  configureModelTransport(async (method, input) => {
    if (method === "model.defaults") return service.defaults() as never
    if (method === "model.resolve") return service.resolve(input) as never
    if (method === "model.start") return service.start(input) as never
    if (method === "model.read") return service.read(input) as never
    if (method === "model.cancel") return service.cancel(input) as never
    throw new Error("Unexpected main call")
  })
  try {
    await works.initialize()
    let state = await repo.saveModel(0, draft); const id = state.models[0].id
    await works.runWithGlobal("inbox", async () => {
      await assert.rejects(generateText({ userId: "local-author", prompt: "test", action: "fixture" }), { code: "MODEL_NOT_SELECTED" })
      assert.equal(calls, 0)
      state.settings.agent.textModelId = id; state = await repo.updateSettings(state.revision, state.settings)
      assert.equal((await getAutoModelForUser("local-author")).modelRecord.id, id, "legacy default caller resolves text, never review")
      await prisma.user.update({ where: { id: "local-author" }, data: { tokenQuota: 0 } })
      failNext = true
      const result = await generateText({ userId: "local-author", prompt: "test", action: "fixture" })
      assert.equal(calls, 2, "network failure was retried through main with the same authorization");
      assert.equal(result.text, "本地创作测试"); assert.equal(result.promptTokens, 12); assert.equal(result.completionTokens, 8)
      const reference = await prisma.aIModel.findUniqueOrThrow({ where: { id } })
      assert.equal(reference.apiKeyEncrypted, ""); assert.equal(reference.enabled, false)
      const usage = await prisma.usageRecord.findFirstOrThrow()
      assert.equal((usage.modelSnapshot as { priceConfigured: boolean }).priceConfigured, false)
      assert.equal((usage.modelSnapshot as { authRevision: number }).authRevision, 1)
      assert.equal(JSON.stringify(usage).includes(draft.apiKey), false)
      await assert.rejects(resolveModelForUser("local-author"), { code: "MODEL_NOT_SELECTED" })
      const old = await getModelByIdForUser("local-author", id)
      state = await repo.saveModel(state.revision, { ...draft, id, apiKey: "rotated-fixture" })
      const stale = streamText({ model: old.model, prompt: "do not send", maxRetries: 0, onError() {} })
      await assert.rejects(Promise.resolve(stale.text))
      assert.equal(calls, 2)
      await repo.removeModel(state.revision, id)
      await assert.rejects(getModelByIdForUser("local-author", id), { code: "MODEL_NOT_FOUND" })
      assert.equal(await prisma.usageRecord.count(), 1)
    })
    state = await repo.read(); state = await repo.saveModel(state.revision, draft)
    state.settings.agent.textModelId = state.models[0].id; state = await repo.updateSettings(state.revision, state.settings)
    const writing = Promise.withResolvers<void>(); const allowWrite = Promise.withResolvers<void>()
    let restore!: () => void
    const stream = await works.runWithGlobal("inbox", async () => {
      const db = getDatabaseContext().database
      const original = db.$transaction.bind(db)
      db.$transaction = (async (...args: unknown[]) => { writing.resolve(); await allowWrite.promise; return Reflect.apply(original, db, args) }) as typeof db.$transaction
      restore = () => { db.$transaction = original }
      return streamGeneration({ userId: "local-author", prompt: "stream", action: "fixture.stream" })
    })
    const consuming = stream.consumeStream()
    await writing.promise
    try { await assert.rejects(works.close(), /任务运行/, "stream finishReason is not proof that onFinish writes settled") }
    finally { allowWrite.resolve(); await consuming; restore() }
    await works.close()
  } finally { await service.close(); await works.close(); await rm(root, { recursive: true, force: true }) }
})
