import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PGlite } from '@electric-sql/pglite'
import { Prisma, PrismaClient } from '../../src/generated/prisma/client'
import { LocalPGliteAdapter } from '../../desktop/service/database/pglite-adapter'
import { loadMigrations, migrateDatabase } from '../../desktop/service/database/migrations'
import { Workspaces } from '../../desktop/service/workspaces'
import { ModelRepository, type ModelDraft } from '../../desktop/main/model-repository'
import { ModelService } from '../../desktop/main/model-service'
import { ModelGateway } from '../../desktop/core/model-authorization'
import { configureModelTransport } from '../../desktop/service/models'
import { runWithTaskDefaults } from '../../desktop/service/task-defaults'
import { freezeTaskDefaults, type TaskDefaults } from '../../desktop/shared/task-defaults'
import { prisma } from '../../src/lib/db'
import { beginChatRequest, finishChatAttempt, scopeFor, nextChatAttempt } from '../../src/lib/services/chat-turn'
import { runInChatExecution } from '../../src/lib/chat-execution'
import { generateText } from '../../src/lib/ai/generate'
import { startRun } from '../../src/lib/services/subagent-run'
import { createPlan } from '../../src/lib/sop/plan'
import { PATCH } from '../../desktop/handlers/chat/conversations/[id]/route'
import { captureConversationBundle, copyConversationBundle } from '../../desktop/service/conversation-bundle'

test('RMS: explicit review selection repairs new plan attempts while retaining historical model choices', async t => {
  const root = await mkdtemp(join(tmpdir(), 'xaanink-review-selection-'))
  const works = new Workspaces(join(root, 'data'), join(process.cwd(), 'prisma/migrations'))
  const draft: ModelDraft = { name: '隔离审核模型', provider: 'custom', protocol: 'openai', modelId: 'fixture-text', endpoint: 'https://fixture.invalid/v1', kind: 'TEXT', enabled: true, contextWindow: 0, thinkingLevels: [], defaultThinking: 'default', apiKey: 'synthetic-main-only-key' }
  let repo!: ModelRepository
  const sent: string[] = [], resolutions: unknown[] = []
  const gateway = new ModelGateway({ keyFor: (id, revision) => repo.keyFor(id, revision), fetch: async (_url, init) => {
    const model = JSON.parse(String(init?.body)).model; sent.push(model)
    return new Response(`data: ${JSON.stringify({ id: 'fixture', created: 1, model, choices: [{ index: 0, delta: { role: 'assistant', content: model }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'fixture', created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  } })
  repo = new ModelRepository(join(root, 'settings.json'), { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() }, gateway)
  const service = new ModelService(repo, gateway)
  configureModelTransport(async (method, value) => {
    if (method === 'model.defaults') return service.defaults() as never
    if (method === 'model.resolve') { resolutions.push(value); return service.resolve(value) as never }
    if (method === 'model.start') return service.start(value) as never
    if (method === 'model.read') return service.read(value) as never
    if (method === 'model.cancel') return service.cancel(value) as never
    throw Error('unexpected model method')
  })
  try {
    await works.initialize()
    let state = await repo.saveModel(0, draft); const text = state.models[0].id
    state = await repo.saveModel(state.revision, { ...draft, modelId: 'fixture-review-A' }); const review = state.models[1].id
    state = await repo.saveModel(state.revision, { ...draft, modelId: 'fixture-review-B' }); const other = state.models[2].id
    state.settings.agent.textModelId = text; state.settings.agent.reviewModelId = review
    state = await repo.updateSettings(state.revision, state.settings)
    const frozen = (reviewModelId: string | null = null, textModelId: string | null = text): TaskDefaults => freezeTaskDefaults({ ...state.settings.agent, reviewModelId, textModelId }, state.revision)
    await works.runWithGlobal('inbox', async () => {
      const novel = await prisma.novel.create({ data: { title: '隔离计划作品', userId: 'local-author' } })
      const failed = async (defaults = frozen()) => {
        const binding = await runWithTaskDefaults(defaults, () => beginChatRequest('local-author', { clientRequestId: randomUUID(), novelId: novel.id, message: '执行隔离计划' }))
        await finishChatAttempt(scopeFor(binding.conversation, binding.turn, binding.attempt), { status: 'failed', errorCode: 'MODEL_NOT_SELECTED', errorMessage: '未选择审核模型' })
        return binding
      }
      const apply = async (binding: Awaited<ReturnType<typeof failed>>, modelId = review, changes = {}) => {
        const response = await PATCH(new Request('https://local.invalid', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'review-selection', modelId, turnId: binding.turn.id, attemptId: binding.attempt.id, ...changes }) }), { params: Promise.resolve({ id: binding.conversation.id }) })
        assert(response); return response
      }
      await t.test('RMS-01/02: explicit apply sends nothing, actual retry uses review A and preserves original plan/turn/attempt', async () => {
        const binding = await failed(), original = structuredClone(binding.turn.defaultsSnapshot)
        const plan = await runWithTaskDefaults(frozen(), () => createPlan({ novelId: novel.id, conversationId: binding.conversation.id, title: '隔离计划', items: [{ nodeId: 'theme', label: '检查主题' }] }))
        const before = sent.length, response = await apply(binding)
        assert.equal(response.status, 200); assert.equal(sent.length, before)
        const retry = await beginChatRequest('local-author', { clientRequestId: randomUUID(), conversationId: binding.conversation.id, retryOfTurnId: binding.turn.id })
        const scope = scopeFor(retry.conversation, retry.turn, retry.attempt)
        assert.equal(scope.taskDefaults!.reviewModelId, review)
        await runInChatExecution(scope, async () => {
          const result = await generateText({ userId: 'local-author', action: 'fixture.plan.review', role: 'review', prompt: '隔离计划审核' })
          assert.equal(result.text, 'fixture-review-A')
          const child = await startRun({ novelId: novel.id, conversationId: binding.conversation.id, agentKind: 'judge', task: '隔离审核' })
          assert.deepEqual(child.defaultsSnapshot, scope.taskDefaults)
        })
        assert.deepEqual(sent.slice(before), ['fixture-review-A'])
        const usage = await prisma.usageRecord.findFirstOrThrow({ where: { action: 'fixture.plan.review' } })
        assert.equal(usage.modelId, review); assert.equal(JSON.stringify(usage).includes(draft.apiKey), false)
        assert.deepEqual((await prisma.chatTurn.findUniqueOrThrow({ where: { id: binding.turn.id } })).defaultsSnapshot, original)
        assert.deepEqual((await prisma.chatAttempt.findUniqueOrThrow({ where: { id: binding.attempt.id } })).defaultsSnapshot, original)
        assert.deepEqual((await prisma.sopPlan.findUniqueOrThrow({ where: { id: plan.id } })).defaultsSnapshot, plan.defaultsSnapshot)
        const key = randomUUID()
        await finishChatAttempt(scope, { status: 'failed' })
        state.settings.agent.reviewModelId = other; state = await repo.updateSettings(state.revision, state.settings)
        await prisma.conversation.update({ where: { id: binding.conversation.id }, data: { reviewModelId: other } })
        const again = await beginChatRequest('local-author', { clientRequestId: key, conversationId: binding.conversation.id, retryOfTurnId: binding.turn.id })
        assert.equal(scopeFor(again.conversation, again.turn, again.attempt).taskDefaults!.reviewModelId, review)
        const replay = await beginChatRequest('local-author', { clientRequestId: key, conversationId: binding.conversation.id, retryOfTurnId: binding.turn.id })
        assert.equal(replay.replay, true); assert.equal(replay.attempt.id, again.attempt.id)
        assert.deepEqual(replay.attempt.defaultsSnapshot, again.attempt.defaultsSnapshot)
        await prisma.conversation.update({ where: { id: binding.conversation.id }, data: { reviewModelId: review } })
        const network = await nextChatAttempt(scopeFor(again.conversation, again.turn, again.attempt), 1, { content: '', toolCalls: [], parts: [], seq: 0 })
        assert.equal(scopeFor(network.conversation, network.turn, network.attempt).taskDefaults!.reviewModelId, review)
        await finishChatAttempt(scopeFor(network.conversation, network.turn, network.attempt), { status: 'succeeded' })
        const next = await beginChatRequest('local-author', { clientRequestId: randomUUID(), conversationId: binding.conversation.id, message: '继续计划' })
        assert.equal(scopeFor(next.conversation, next.turn, next.attempt).taskDefaults!.reviewModelId, review)
        await finishChatAttempt(scopeFor(next.conversation, next.turn, next.attempt), { status: 'succeeded' })
        const context = (await import('../../desktop/service/context')).getDatabaseContext()
        const bundle = await captureConversationBundle(context.database, 'inbox', binding.conversation.id)
        assert.equal(bundle.tables.Conversation[0].reviewModelId, review)
        assert.ok(bundle.tables.ChatAttempt.some(row => row.id === retry.attempt.id && JSON.stringify(row.defaultsSnapshot).includes(review)))
        const engine = await PGlite.create(), target = new PrismaClient({ adapter: new LocalPGliteAdapter(engine) })
        try {
          const migrations = await loadMigrations(join(process.cwd(), 'prisma/migrations'))
          await migrateDatabase(engine, migrations.filter(item => item.id !== '20261010090000_review_attempt_selection'))
          await target.user.create({ data: { id: 'local-author', name: '隔离作者', email: 'fixture@local.invalid', passwordHash: '' } })
          await engine.query('INSERT INTO "Conversation" (id,"userId",title,"updatedAt") VALUES ($1,$2,$3,now())', ['legacy-upgrade', 'local-author', '升级前会话'])
          await engine.query('INSERT INTO "ChatTurn" (id,"userId","conversationId","userMessageId","clientRequestId","updatedAt") VALUES ($1,$2,$3,$4,$5,now())', ['legacy-turn', 'local-author', 'legacy-upgrade', 'legacy-message', 'legacy-request'])
          await engine.query('INSERT INTO "ChatAttempt" (id,"turnId","attemptNo","assistantMessageId","executionEpoch") VALUES ($1,$2,1,$3,1)', ['legacy-attempt', 'legacy-turn', 'legacy-assistant'])
          await migrateDatabase(engine, migrations)
          assert.equal((await target.conversation.findUniqueOrThrow({ where: { id: 'legacy-upgrade' } })).reviewModelId, null)
          assert.equal((await target.chatAttempt.findUniqueOrThrow({ where: { id: 'legacy-attempt' } })).defaultsSnapshot, null)
          await target.conversation.delete({ where: { id: 'legacy-upgrade' } })
          await copyConversationBundle(target, bundle, null, 'rms-transfer')
          assert.equal((await target.conversation.findUniqueOrThrow({ where: { id: binding.conversation.id } })).reviewModelId, review)
          assert.deepEqual((await target.chatAttempt.findUniqueOrThrow({ where: { id: retry.attempt.id } })).defaultsSnapshot, retry.attempt.defaultsSnapshot)
          const old = structuredClone(bundle)
          old.columns.Conversation = old.columns.Conversation.filter(name => name !== 'reviewModelId')
          delete old.tables.Conversation[0].reviewModelId
          old.columns.ChatAttempt = old.columns.ChatAttempt.filter(name => name !== 'defaultsSnapshot')
          old.tables.ChatAttempt.forEach(row => { delete row.defaultsSnapshot })
          const sourceBefore = await captureConversationBundle(context.database, 'inbox', binding.conversation.id)
          const countBefore = await target.chatAttempt.count()
          const receiptsBefore = await target.systemConfig.findMany({ orderBy: { key: 'asc' } })
          await assert.rejects(copyConversationBundle(target, old, null, 'old-frozen-journal'), { code: 'CONVERSATION_SCHEMA_MISMATCH' })
          assert.equal(await target.chatAttempt.count(), countBefore)
          assert.deepEqual(await captureConversationBundle(context.database, 'inbox', binding.conversation.id), sourceBefore)
          assert.deepEqual(await target.systemConfig.findMany({ orderBy: { key: 'asc' } }), receiptsBefore)
        } finally { await target.$disconnect(); await engine.close() }
      })
      await t.test('RMS-03: legacy null text stays unselected, only explicit review is captured', async () => {
        const binding = await failed(frozen(null, null))
        await prisma.conversation.update({ where: { id: binding.conversation.id }, data: { defaultsSnapshot: Prisma.DbNull } })
        await prisma.chatTurn.update({ where: { id: binding.turn.id }, data: { defaultsSnapshot: Prisma.DbNull } })
        await prisma.chatAttempt.update({ where: { id: binding.attempt.id }, data: { defaultsSnapshot: Prisma.DbNull } })
        assert.equal((await apply(binding)).status, 200)
        const retry = await beginChatRequest('local-author', { clientRequestId: randomUUID(), conversationId: binding.conversation.id, retryOfTurnId: binding.turn.id })
        const scope = scopeFor(retry.conversation, retry.turn, retry.attempt)
        assert.equal(scope.taskDefaults!.textModelId, null); assert.equal(scope.taskDefaults!.reviewModelId, review)
        await runInChatExecution(scope, async () => assert.rejects(generateText({ userId: 'local-author', action: 'fixture.text', prompt: '文本仍阻断' }), { code: 'MODEL_NOT_SELECTED' }))
        await finishChatAttempt(scope, { status: 'failed' })
      })
      await t.test('RMS-04: nonempty frozen review A cannot be replaced by default B', async () => {
        const binding = await failed(frozen(review))
        assert.equal((await apply(binding, other)).status, 409)
        const retry = await beginChatRequest('local-author', { clientRequestId: randomUUID(), conversationId: binding.conversation.id, retryOfTurnId: binding.turn.id })
        assert.equal(scopeFor(retry.conversation, retry.turn, retry.attempt).taskDefaults!.reviewModelId, review)
        await finishChatAttempt(scopeFor(retry.conversation, retry.turn, retry.attempt), { status: 'failed' })
      })
      await t.test('RMS-05: stale target, foreign turn, active execution and invalid model reject without mutation or HTTP', async () => {
        const binding = await failed(), stranger = await failed(), before = sent.length
        for (const change of [{ attemptId: randomUUID() }, { turnId: stranger.turn.id }]) assert.equal((await apply(binding, review, change)).status, 409)
        assert.equal((await apply(binding, randomUUID())).status, 428)
        const running = await beginChatRequest('local-author', { clientRequestId: randomUUID(), conversationId: binding.conversation.id, message: '下一任务' })
        assert.equal((await apply(running, review)).status, 409)
        assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: binding.conversation.id } })).reviewModelId, null)
        assert.equal(sent.length, before)
        await finishChatAttempt(scopeFor(running.conversation, running.turn, running.attempt), { status: 'failed' })
      })
      await t.test('RMS-01: changing defaults without explicit apply leaves failed retry unselected and records trustworthy invocation identity', async () => {
        const binding = await failed()
        const retry = await beginChatRequest('local-author', { clientRequestId: randomUUID(), conversationId: binding.conversation.id, retryOfTurnId: binding.turn.id })
        const scope = scopeFor(retry.conversation, retry.turn, retry.attempt), before = sent.length
        await runInChatExecution(scope, async () => assert.rejects(generateText({ userId: 'local-author', action: 'fixture.review', role: 'review', prompt: '需要明确选择' }), { code: 'MODEL_NOT_SELECTED' }))
        assert.equal(sent.length, before)
        assert.deepEqual((resolutions.at(-1) as any).task, { conversationId: binding.conversation.id, turnId: binding.turn.id, attemptId: retry.attempt.id })
        await finishChatAttempt(scope, { status: 'failed' })
      })
      await t.test('RMS-04/05: disabled, wrong-kind and missing-key selections fail closed without invocation', async () => {
        const binding = await failed(), before = sent.length
        state = await repo.saveModel(state.revision, { ...draft, id: review, modelId: 'fixture-review-A', enabled: false, apiKey: '' })
        let response = await apply(binding); assert.equal(response.status, 428); assert.equal((await response.json()).code, 'MODEL_DISABLED')
        state = await repo.saveModel(state.revision, { ...draft, id: review, modelId: 'fixture-review-A', apiKey: '' })
        state = await repo.saveModel(state.revision, { ...draft, kind: 'IMAGE', modelId: 'fixture-image' })
        response = await apply(binding, state.models.at(-1)!.id); assert.equal(response.status, 428); assert.equal((await response.json()).code, 'MODEL_KIND_MISMATCH')
        const keyFor = repo.keyFor.bind(repo)
        repo.keyFor = async () => { throw Error('synthetic-vault-failure') }
        try { response = await apply(binding); assert.equal(response.status, 428); assert.equal((await response.json()).code, 'MODEL_KEY_MISSING') }
        finally { repo.keyFor = keyFor }
        assert.equal(sent.length, before)
        assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: binding.conversation.id } })).reviewModelId, null)
      })
      await t.test('RMS-05: explicit review repair never bypasses external effects reconciliation on retry', async () => {
        const binding = await failed(), before = sent.length
        const tool = await prisma.chatToolExecution.create({ data: { turnId: binding.turn.id, attemptId: binding.attempt.id, toolCallId: randomUUID(), toolName: 'fixture-write', operationId: randomUUID(), requestHash: 'fixture', input: {}, status: 'unknown', hasExternalEffects: true } })
        assert.equal((await apply(binding)).status, 200)
        const retry = (resume = false) => beginChatRequest('local-author', { clientRequestId: randomUUID(), conversationId: binding.conversation.id, retryOfTurnId: binding.turn.id, resume })
        await assert.rejects(retry(), { code: 'EFFECTS_UNCONFIRMED' })
        await prisma.chatToolExecution.update({ where: { id: tool.id }, data: { status: 'succeeded' } })
        await prisma.chatWriteEffect.create({ data: { toolExecutionId: tool.id, targetModel: 'fixture', targetId: 'fixture', operation: 'update', receipt: { version: 1 } } })
        await assert.rejects(retry(), { code: 'RECONCILIATION_REQUIRED' })
        const resumed = await retry(true)
        assert.equal(scopeFor(resumed.conversation, resumed.turn, resumed.attempt).taskDefaults!.reviewModelId, review)
        assert.equal(sent.length, before)
        await finishChatAttempt(scopeFor(resumed.conversation, resumed.turn, resumed.attempt), { status: 'succeeded' })
      })
    })
  } finally { await service.close(); await works.close(); await rm(root, { recursive: true, force: true }) }
})
