import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Workspaces } from "../../desktop/service/workspaces"
import { configureModelTransport } from "../../desktop/service/models"
import { runWithNewTaskDefaults, currentTaskDefaults } from "../../desktop/service/task-defaults"
import { defaultState, type PublicModel } from "../../desktop/core/settings"
import { ModelService } from "../../desktop/main/model-service"
import { ModelGateway } from "../../desktop/core/model-authorization"
import type { ModelRepository } from "../../desktop/main/model-repository"
import { getModelForUser } from "../../src/lib/ai/provider"
import { resolveImageModel } from "../../src/lib/ai/image"
import { beginChatRequest, scopeFor } from "../../src/lib/services/chat-turn"
import { runInChatExecution } from "../../src/lib/chat-execution"
import { startRun } from "../../src/lib/services/subagent-run"
import { prisma } from "../../src/lib/db"
import { runCheckpointLoop } from "../../src/lib/sop/runner"
import { createPlan } from "../../src/lib/sop/plan"
import { appendScenarioTurn } from "../../src/lib/services/scenario-lab"
import { beginContentImprovement } from "../../src/lib/services/content-improvement"
import { triggerCascade } from "../../src/lib/services/cascade"
import { PROMPT_TEMPLATES } from "../../prisma/seed-templates"
import { GET as textCatalog } from "../../desktop/handlers/models/route"
import { GET as imageCatalog } from "../../desktop/handlers/image-models/route"

test("DEFAULT-07..12: real local records and shared model entry preserve task defaults without global fallback", async t => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-task-defaults-"))
  const works = new Workspaces(join(root, "app"), join(process.cwd(), "prisma/migrations"))
  const ids = Array.from({ length: 6 }, () => randomUUID())
  const record = (id: string, index: number): PublicModel => ({ id, name: `fixture-${index}`, provider: "openai", modelId: `gpt-5-fixture-${index}`, protocol: "openai", endpoint: "https://fixture.invalid/v1", kind: index % 3 === 2 ? "IMAGE" : "TEXT", enabled: true, authRevision: 1, keyMask: "••••••••", contextWindow: 0, thinkingLevels: index % 3 === 2 ? [] : ["low", "high"], defaultThinking: "default" })
  const state = { revision: 3, settings: structuredClone(defaultState.settings), models: ids.map(record) }
  state.settings.agent = { textModelId: ids[0], mode: "plan", thinking: "low", reviewModelId: ids[1], imageModelId: ids[2] }
  const repository = { read: async () => structuredClone(state), keyFor: async () => "private-fixture-key" } as unknown as ModelRepository
  let http = 0; const transportMethods: string[] = []
  const gateway = new ModelGateway({ keyFor: async () => "private-fixture-key", fetch: async () => { http++; throw Error("no network expected") } })
  const service = new ModelService(repository, gateway)
  configureModelTransport(async (method, value) => {
    transportMethods.push(method)
    if (method === "model.defaults") return service.defaults() as never
    if (method === "model.catalog") return structuredClone(state) as never
    if (method === "model.resolve") return service.resolve(value) as never
    throw Error("Unexpected transport method")
  })
  try {
    await works.initialize()
    await works.runWithGlobal("inbox", async () => {
      await t.test("DEFAULT-07: text/review/image reuse one task snapshot after committed defaults change", () => runWithNewTaskDefaults(async () => {
        const captured = currentTaskDefaults()!
        state.settings.agent = { textModelId: ids[3], mode: "standard", thinking: "high", reviewModelId: ids[4], imageModelId: ids[5] }; state.revision++
        assert.equal((await getModelForUser("local-author")).modelRecord.id, ids[0])
        assert.equal((await getModelForUser("local-author", { role: "review", ignoreChatSession: true })).modelRecord.id, ids[1])
        assert.equal((await resolveImageModel()).modelRecord.id, ids[2])
        assert.equal(captured.mode, "plan"); assert.equal(captured.thinking, "low"); assert.equal(captured.revision, 3)
      }))
      await t.test("DEFAULT-08: a new conversation and turn persist all five defaults with explicit choices winning", () => runWithNewTaskDefaults(async () => {
        const binding = await beginChatRequest("local-author", { clientRequestId: randomUUID(), message: "新会话默认值" })
        const snapshot = (binding.turn as unknown as { defaultsSnapshot: { textModelId: string; reviewModelId: string; imageModelId: string; mode: string; thinking: string } }).defaultsSnapshot
        assert.equal(binding.conversation.modelId, ids[3]); assert.equal(binding.conversation.thinkingEffort, "high")
        assert.equal(snapshot.textModelId, ids[3]); assert.equal(snapshot.reviewModelId, ids[4]); assert.equal(snapshot.imageModelId, ids[5]); assert.equal(snapshot.mode, "standard"); assert.equal(snapshot.thinking, "high")
        const explicit = await beginChatRequest("local-author", { clientRequestId: randomUUID(), message: "作者明确选择", modelId: ids[0], thinkingEffort: null, mode: "plan" })
        assert.equal(explicit.conversation.modelId, ids[0]); assert.equal(scopeFor(explicit.conversation, explicit.turn, explicit.attempt).taskDefaults!.thinking, "default")
        assert.equal(scopeFor(explicit.conversation, explicit.turn, explicit.attempt).taskDefaults!.mode, "plan")
      }))
      await t.test("DEFAULT-09: settings changes never rewrite old conversation defaults or failed-turn retry", () => runWithNewTaskDefaults(async () => {
        const original = await beginChatRequest("local-author", { clientRequestId: randomUUID(), message: "保留初始配置" })
        await prisma.chatTurn.update({ where: { id: original.turn.id }, data: { status: "failed" } })
        await prisma.chatAttempt.update({ where: { id: original.attempt.id }, data: { status: "failed" } })
        await prisma.conversation.update({ where: { id: original.conversation.id }, data: { activeAttemptId: null } })
        state.settings.agent.textModelId = ids[0]; state.settings.agent.reviewModelId = ids[1]; state.settings.agent.imageModelId = ids[2]; state.settings.agent.mode = "plan"; state.settings.agent.thinking = "low"; state.revision++
        const retry = await runWithNewTaskDefaults(() => beginChatRequest("local-author", { clientRequestId: randomUUID(), conversationId: original.conversation.id, retryOfTurnId: original.turn.id, modelId: ids[0], thinkingEffort: "low", mode: "plan" }))
        assert.equal(retry.turn.id, original.turn.id)
        assert.deepEqual((retry.turn as unknown as { defaultsSnapshot: unknown }).defaultsSnapshot, (original.turn as unknown as { defaultsSnapshot: unknown }).defaultsSnapshot)
        const scope = scopeFor(retry.conversation, retry.turn, retry.attempt)
        assert.equal(scope.taskDefaults!.textModelId, ids[3]); assert.equal(scope.taskDefaults!.mode, "standard"); assert.equal(scope.taskDefaults!.thinking, "high")
        assert.equal(retry.conversation.modelId, ids[3])
        await runInChatExecution(scope, async () => {
          assert.equal((await getModelForUser("local-author", { role: "review", ignoreChatSession: true })).modelRecord.id, ids[4])
        })
      }))
      await t.test("DEFAULT-10: a legacy null conversation remains unselected instead of adopting the new text default", () => runWithNewTaskDefaults(async () => {
        const conversation = await prisma.conversation.create({ data: { userId: "local-author", title: "旧会话未选模型", modelId: null } })
        const binding = await beginChatRequest("local-author", { clientRequestId: randomUUID(), conversationId: conversation.id, message: "旧会话" })
        const scope = scopeFor(binding.conversation, binding.turn, binding.attempt)
        assert.equal(scope.taskDefaults!.textModelId, null); assert.equal(scope.taskDefaults!.reviewModelId, null)
        await runInChatExecution(scope, () => assert.rejects(getModelForUser("local-author"), { code: "MODEL_NOT_SELECTED" }))
      }))
      await t.test("DEFAULT-11: explicit null blocks and removed frozen IDs never pick remaining records", () => runWithNewTaskDefaults(async () => {
        const binding = await beginChatRequest("local-author", { clientRequestId: randomUUID(), message: "明确未选", modelId: null })
        const scope = scopeFor(binding.conversation, binding.turn, binding.attempt)
        await runInChatExecution(scope, () => assert.rejects(getModelForUser("local-author"), { code: "MODEL_NOT_SELECTED" }))
        const modelId = currentTaskDefaults()!.textModelId!; const prior = state.models
        state.models = state.models.filter(model => model.id !== modelId)
        try { await assert.rejects(getModelForUser("local-author"), { code: "MODEL_NOT_FOUND" }) } finally { state.models = prior }
      }))
      await t.test("DEFAULT-12: a subagent run stores the inherited five defaults and never plaintext credentials", () => runWithNewTaskDefaults(async () => {
        const captured = currentTaskDefaults()!
        const run = await startRun({ novelId: "fixture-no-real-work", agentKind: "reader", task: "真实本地档案验证" })
        assert.deepEqual((run as unknown as { defaultsSnapshot: unknown }).defaultsSnapshot, captured)
        assert.equal(JSON.stringify(run).includes("private-fixture-key"), false)
      }))
      const novel = await prisma.novel.create({ data: { userId: "local-author", title: "隔离任务夹具" } })
      const volume = await prisma.volume.create({ data: { novelId: novel.id, index: 1, title: "隔离卷", summary: "隔离卷概要" } })
      const chapter = await prisma.chapter.create({ data: { volumeId: volume.id, index: 1, title: "隔离章", outline: "控制大纲", content: "正文控制夹具。" } })
      await t.test("DEFAULT-18: SOP node records inherit five defaults throughout a controlled checkpoint loop", () => runWithNewTaskDefaults(async () => {
        const captured = currentTaskDefaults()!
        const result = await runCheckpointLoop({ novelId: novel.id, nodeId: "world", produce: async () => ({ summary: "fixture" }), check: async () => ({ score: 100, summary: "fixture", feedback: "fixture" }) })
        const row = await prisma.sopNodeRun.findUniqueOrThrow({ where: { id: result.nodeRunId } })
        assert.deepEqual((row as unknown as { defaultsSnapshot: unknown }).defaultsSnapshot, captured)
      }))
      await t.test("DEFAULT-19: a stored SOP plan keeps its creation defaults when later settings or plan labels change", () => runWithNewTaskDefaults(async () => {
        const captured = currentTaskDefaults()!
        const conversation = await prisma.conversation.create({ data: { userId: "local-author", novelId: novel.id, title: "隔离计划会话" } })
        const created = await createPlan({ novelId: novel.id, conversationId: conversation.id, title: "原计划", items: [{ nodeId: "world", label: "创建世界" }] })
        state.revision++; state.settings.agent.thinking = "default"
        const updated = await runWithNewTaskDefaults(() => createPlan({ novelId: novel.id, conversationId: conversation.id, title: "更新标签", items: [{ nodeId: "world", label: "完善世界" }] }))
        assert.equal(updated.id, created.id)
        assert.deepEqual((updated as unknown as { defaultsSnapshot: unknown }).defaultsSnapshot, captured)
      }))
      await t.test("DEFAULT-20: scenario turn records store the defaults used to produce their retained output", () => runWithNewTaskDefaults(async () => {
        const captured = currentTaskDefaults()!
        await appendScenarioTurn("fixture-lab", { kind: "beat", narrative: "受控输出", beats: [] })
        const row = await prisma.scenarioTurn.findFirstOrThrow({ where: { labId: "fixture-lab" } })
        assert.deepEqual((row as unknown as { defaultsSnapshot: unknown }).defaultsSnapshot, captured)
      }))
      await t.test("DEFAULT-21: idempotent content improvement preserves the original five defaults and content baseline", () => runWithNewTaskDefaults(async () => {
        const captured = currentTaskDefaults()!
        const input = { userId: "local-author", novelId: novel.id, chapterId: chapter.id, expectedVersion: chapter.version, operationId: randomUUID(), authorInstructions: "按原稿修订" }
        const first = await beginContentImprovement(input)
        state.revision++; state.settings.agent.textModelId = ids[3]
        const again = await runWithNewTaskDefaults(() => beginContentImprovement(input))
        assert.equal(again.run.id, first.run.id); assert.equal(again.created, false)
        assert.equal(again.run.baseContent, chapter.content)
        assert.deepEqual((again.run as unknown as { defaultsSnapshot: unknown }).defaultsSnapshot, captured)
      }))
      await t.test("DEFAULT-22: a queued cascade stores its creation defaults independently from its later result", () => runWithNewTaskDefaults(async () => {
        const captured = currentTaskDefaults()!
        const template = PROMPT_TEMPLATES.find(row => row.key === "cascade.revise")!
        await prisma.promptTemplate.create({ data: { ...template, version: 1, enabled: true } })
        const job = await triggerCascade({ novelId: novel.id, triggerType: "SETTING", triggerId: "fixture-setting", changeDescription: "受控变更" })
        assert.ok(job)
        // The fixture transport rejects generation; wait for the retained
        // error results so no detached local writes outlive this database.
        let settled = false
        for (let n = 0; n < 100; n++) { const row = await prisma.cascadeJob.findUniqueOrThrow({ where: { id: job.id } }); if (row.status !== "RUNNING") { settled = true; break } await new Promise(resolve => setTimeout(resolve, 10)) }
        assert.equal(settled, true)
        const row = await prisma.cascadeJob.findUniqueOrThrow({ where: { id: job.id } })
        assert.deepEqual((row as unknown as { defaultsSnapshot: unknown }).defaultsSnapshot, captured)
      }))
      await t.test("DEFAULT-24: undefined new-request mode is omitted just like its serialized JSON representation", () => runWithNewTaskDefaults(async () => {
        const binding = await beginChatRequest("local-author", { clientRequestId: randomUUID(), message: "未指定模式", mode: undefined })
        assert.equal(scopeFor(binding.conversation, binding.turn, binding.attempt).taskDefaults!.mode, currentTaskDefaults()!.mode)
      }))
      await t.test("DEFAULT-26: both background model catalogs use main metadata without invoking a model or exposing keys", async () => {
        const from = transportMethods.length
        const text = await (await textCatalog()).json(); const image = await (await imageCatalog()).json()
        assert.deepEqual(text.models.map((row: { id: string }) => row.id), state.models.filter(row => row.kind === "TEXT" && row.enabled).map(row => row.id))
        assert.deepEqual(image.models.map((row: { id: string }) => row.id), state.models.filter(row => row.kind === "IMAGE" && row.enabled).map(row => row.id))
        assert.equal(text.defaultModelId, state.settings.agent.textModelId); assert.equal(image.defaultModelId, state.settings.agent.imageModelId)
        assert.deepEqual(transportMethods.slice(from), ["model.catalog", "model.catalog"])
        assert.equal(JSON.stringify({ text, image }).includes("private-fixture-key"), false)
      })
      assert.equal(http, 0)
    })
  } finally { await service.close(); await works.close(); await rm(root, { recursive: true, force: true }) }
})
