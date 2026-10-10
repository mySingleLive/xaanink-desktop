import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { _electron } from 'playwright-core'
const evidence = resolve(process.argv[2] || 'docs/evidence/review-model-selection/target-01')
await mkdir(evidence, { recursive: true })
const base = await mkdtemp(join(tmpdir(), 'xaanink-review-selection-'))
const seeded = spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/seed-review-model-selection.ts'), base], { encoding: 'utf8' })
assert.equal(seeded.status, 0, seeded.stderr)
const fixture = JSON.parse(await readFile(join(base, 'fixture.json'), 'utf8'))
const report = { status: 'running', checks: [], errors: [], sourceHashes: {}, isolation: { syntheticData: true, actualUserDataAccessed: false, rendererOffline: true, providerRequests: 0, httpListenerStarted: false }, limitations: ['Model-required notice is injected by the test with a synthetic invocation identity; actual invocation identity and SDK provider model are independently verified by scoped tests.', 'No actual DeepSeek call, physical OS clicks, macOS, installation package or full regression.'] }
for (const file of ['src/lib/services/chat-turn.ts', 'desktop/service/models.ts', 'desktop/main/model-service.ts', 'desktop/main/model-guidance.ts', 'desktop/shared/model-task.ts', 'desktop/shared/task-defaults.ts', 'desktop/shared/ipc.ts', 'src/components/desktop/ReviewModelSelection.tsx', 'src/components/desktop/ModelRequiredDialog.tsx', 'desktop/handlers/chat/conversations/[id]/route.ts', 'prisma/schema.prisma', 'prisma/migrations/20261010090000_review_attempt_selection/migration.sql', 'scripts/seed-review-model-selection.ts', 'scripts/verify-review-model-selection.mjs', 'dist/main/index.cjs', 'dist/service/index.cjs']) report.sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex')
const env = { ...process.env, XAANINK_TEST_ROOT: fixture.root }; delete env.ELECTRON_RUN_AS_NODE
let app, page, reviewId
const check = label => report.checks.push({ label })
async function launch() {
  app = await _electron.launch({ args: [resolve('.')], env, timeout: 90000 })
  page = await app.firstWindow({ timeout: 90000 }); page.on('pageerror', error => report.errors.push(error.message))
  await page.context().setOffline(true)
  await page.getByRole('button', { name: '账号菜单', exact: true }).waitFor({ timeout: 90000 })
  const bootstrap = await page.evaluate(() => window.desktop.bootstrap())
  assert.equal(bootstrap.dataRoot, fixture.root); assert.equal(page.url(), 'xaanink://app/')
  report.runtime = await app.evaluate(() => ({ platform: process.platform, electron: process.versions.electron, node: process.versions.node }))
}
async function close() {
  const closed = app.waitForEvent('close', { timeout: 45000 })
  await page.evaluate(() => { void window.desktop.command('app.quit') }); await closed; app = undefined
}
async function detail() { return page.evaluate(async id => { const res = await fetch('/api/chat/conversations/' + id); assertResponse(res); return res.json(); function assertResponse(res) { if (!res.ok) throw Error('fixture read failed') } }, fixture.conversationId) }
async function shot(name) { const path = join(evidence, name + '.png'); await page.screenshot({ path }); check(name); report.checks.at(-1).sha256 = createHash('sha256').update(await readFile(path)).digest('hex') }
try {
  console.log('Review model: isolated Windows Electron and actual local authorization.')
  await launch()
  reviewId = await page.evaluate(async () => {
    let state = await window.desktop.bootstrap()
    state = await window.desktop.settings({ type: 'save-model', revision: state.revision, model: { name: '专项审核模型', provider: 'custom', protocol: 'openai', modelId: 'fixture-review-only', endpoint: 'https://fixture.invalid/v1', kind: 'TEXT', enabled: true, contextWindow: 0, thinkingLevels: [], defaultThinking: 'default', apiKey: 'synthetic-electron-only-key' } })
    const id = state.models[0].id; state.settings.agent.reviewModelId = id
    await window.desktop.settings({ type: 'update', revision: state.revision, settings: state.settings }); return id
  })
  check('real main vault saves synthetic model and committed review default')
  const before = await detail(); assert.equal(before.conversation.reviewModelId, null)
  assert.deepEqual(before.turnState.turn.defaultsSnapshot, fixture.snapshot)
  check('saving global default alone preserves historical task and explicit null')
  await page.getByText('专项模型测试作品', { exact: true }).first().click()
  await page.getByText('专项旧计划会话', { exact: true }).first().click()
  await page.waitForFunction(id => [...document.querySelectorAll('[data-sop-plan]')].some(el => el.dataset.sopPlan === id), fixture.planId)
  const notice = { type: 'model-required', role: 'review', code: 'MODEL_NOT_SELECTED', task: { conversationId: fixture.conversationId, turnId: fixture.turnId, attemptId: fixture.attemptId } }
  await app.evaluate(({ BrowserWindow }, notice) => BrowserWindow.getAllWindows()[0].webContents.send('desktop:event', notice), notice)
  await page.getByRole('button', { name: '应用到当前任务', exact: true }).waitFor()
  await shot('review-selection-ready')
  await page.getByRole('button', { name: '应用到当前任务', exact: true }).click()
  await page.getByText('审核模型已应用，请手动重新执行任务。', { exact: true }).waitFor()
  check('real React dialog applies exact invocation target through PATCH IPC without automatic send')
  const selected = await detail()
  assert.equal(selected.conversation.reviewModelId, reviewId)
  assert.equal(selected.turnState.attempts.length, before.turnState.attempts.length)
  assert.deepEqual(selected.turnState.turn.defaultsSnapshot, fixture.snapshot)
  assert.deepEqual(selected.turnState.attempts[0].defaultsSnapshot, fixture.snapshot)
  check('actual database records explicit choice and preserves old turn/attempt')
  await shot('review-selection-applied'); await page.getByRole('button', { name: '取消', exact: true }).click(); await close()
  await launch()
  const reopened = await detail(); assert.equal(reopened.conversation.reviewModelId, reviewId)
  check('normal quit and cold Electron launch retain the author selection')
  const sse = await page.evaluate(async fixture => {
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientRequestId: fixture.requestId, conversationId: fixture.conversationId, retryOfTurnId: fixture.turnId }) })
    if (!res.ok) throw Error('retry request failed'); return res.text()
  }, { ...fixture, requestId: randomUUID() })
  assert.match(sse, /MODEL_NOT_SELECTED/)
  const retried = await detail(), actual = retried.turnState.attempts.at(-1)
  assert.equal(actual.defaultsSnapshot.reviewModelId, reviewId); assert.equal(actual.defaultsSnapshot.textModelId, null)
  assert.deepEqual(retried.turnState.turn.defaultsSnapshot, fixture.snapshot)
  check('new manual request snapshots selected review while preserving explicit null text and blocking HTTP')
  await close(); assert.deepEqual(report.errors, []); report.status = 'passed'
} catch (error) { report.status = 'failed'; report.failure = String(error); process.exitCode = 1; await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {}) }
finally {
  if (app) await close().catch(() => app?.close().catch(() => {}))
  report.completedAt = new Date().toISOString(); await writeFile(join(evidence, 'windows-electron.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, errors: report.errors, failure: report.failure }))
}
