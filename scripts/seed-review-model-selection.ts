// Artificial old task only. Never accepts a user's application root.
import assert from 'node:assert/strict'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Workspaces } from '../desktop/service/workspaces'
import { directoryIdentity } from '../desktop/core/root-ownership'
import { freezeTaskDefaults } from '../desktop/shared/task-defaults'
import { runWithTaskDefaults } from '../desktop/service/task-defaults'
import { beginChatRequest, finishChatAttempt, scopeFor } from '../src/lib/services/chat-turn'
import { createPlan } from '../src/lib/sop/plan'
async function main() {
  const base = await realpath(resolve(process.argv[2])); assert(basename(base).startsWith('xaanink-review-selection-'))
  const works = new Workspaces(join(base, 'data'), resolve('prisma/migrations'))
  try {
    await works.initialize()
    const path = join(base, 'work'); await mkdir(path)
    const work = await works.create(await directoryIdentity(path), { title: '专项模型测试作品', requestId: randomUUID() })
    const fixture = await works.run(work.id, async () => {
      const snapshot = freezeTaskDefaults({ textModelId: null, reviewModelId: null, imageModelId: null, mode: 'standard', thinking: 'default' }, 0)
      const binding = await runWithTaskDefaults(snapshot, () => beginChatRequest('local-author', { clientRequestId: randomUUID(), novelId: work.novelId, message: '专项旧计划会话' }))
      await finishChatAttempt(scopeFor(binding.conversation, binding.turn, binding.attempt), { status: 'failed', errorCode: 'MODEL_NOT_SELECTED', errorMessage: '未选择审核模型' })
      const plan = await createPlan({ novelId: work.novelId, conversationId: binding.conversation.id, title: '专项旧计划', items: [{ nodeId: 'theme', label: '专项计划审核' }], defaultsSnapshot: snapshot })
      return { root: works.root, conversationId: binding.conversation.id, turnId: binding.turn.id, attemptId: binding.attempt.id, novelId: work.novelId, planId: plan.id, snapshot }
    })
    await writeFile(join(base, 'fixture.json'), JSON.stringify(fixture))
    console.log('Synthetic old plan task seeded, no configured model and no provider request.')
  } finally { await works.close() }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
