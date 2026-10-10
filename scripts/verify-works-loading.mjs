import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rename, lstat } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { _electron } from 'playwright-core'

const evidence = resolve(process.argv[2] || 'docs/evidence/works-loading/target-01')
await mkdir(evidence, { recursive: true })
const base = await mkdtemp(join(tmpdir(), 'xaanink-works-loading-'))
const seeded = spawnSync(process.execPath, ['--import', 'tsx', resolve('scripts/seed-works-loading.ts'), base], { encoding: 'utf8' })
assert.equal(seeded.status, 0, seeded.stderr); console.log(seeded.stdout.trim())
const fixture = JSON.parse(await readFile(join(base, 'fixture.json'), 'utf8'))
const [healthy, stale] = fixture.records
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const report = { status: 'running', checks: [], errors: [], sourceHashes: {}, bundleHashes: {}, isolation: { syntheticWorks: 2, staleLeases: 1, userDataAccessed: false, zeroModels: true, offlineRenderer: true, httpServerStarted: false }, limitations: ['Native confirmation response and relaunch request are controlled for this synthetic fixture; actual WorkLeaseHandoff/core filesystem recovery runs. Fresh Electron launch verifies reopening.', 'No physical OS clicks, user data repair, macOS, installer or full regression.'] }
for (const path of ['desktop/service/dispatcher.ts', 'desktop/service/workspaces.ts', 'desktop/shared/work-list.ts', 'src/lib/novel-list.ts', 'src/components/desktop/UnavailableWorks.tsx', 'src/components/layout/SidebarTree.tsx', 'src/components/layout/ChatPanel.tsx', 'src/components/layout/ContentTabs.tsx']) report.sourceHashes[path] = hash(await readFile(path))
async function built(path) { for (const file of await readdir(path, { withFileTypes: true })) { const entry = join(path, file.name); if (file.isDirectory()) await built(entry); else report.bundleHashes[relative(resolve('.'), entry).replaceAll('\\', '/')] = hash(await readFile(entry)) } }
await built(resolve('dist')); await built(resolve('.next/static'))
const catalogBefore = await readFile(join(fixture.root, 'catalog.json')), manifestBefore = await readFile(join(stale.path, 'xaanink-work.json')), ownerBefore = await readFile(join(stale.path, '.xaanink-lock', 'owner.json'))
let app, page
const env = { ...process.env, XAANINK_TEST_ROOT: fixture.root }; delete env.ELECTRON_RUN_AS_NODE
const check = label => report.checks.push({ label })
async function launch() {
  app = await _electron.launch({ args: [resolve('.')], env, timeout: 90000 })
  page = await app.firstWindow({ timeout: 90000 }); page.on('pageerror', error => report.errors.push(error.message))
  await page.context().setOffline(true)
  await page.getByRole('button', { name: '账号菜单', exact: true }).waitFor({ timeout: 90000 })
  const bootstrap = await page.evaluate(() => window.desktop.bootstrap())
  assert.equal(bootstrap.dataRoot, fixture.root); assert.equal(bootstrap.models.length, 0)
  assert.equal(page.url(), 'xaanink://app/'); assert.equal(await page.evaluate(() => navigator.onLine), false)
  report.runtime = await app.evaluate(() => ({ platform: process.platform, electron: process.versions.electron, node: process.versions.node }))
  await page.getByText('作品阁', { exact: true }).waitFor()
}
async function list() { return page.evaluate(async () => { const res = await fetch('/api/novels'); if (!res.ok) throw Error('list request failed'); return res.json() }) }
async function close() {
  const closed = app.waitForEvent('close', { timeout: 45000 })
  await page.evaluate(() => { void window.desktop.command('app.quit') })
  await closed; app = undefined
}
async function screenshot(name) { const path = join(evidence, name + '.png'); await page.screenshot({ path }); report.checks.push({ label: name, image: relative(resolve('.'), path).replaceAll('\\', '/'), sha256: hash(await readFile(path)) }) }
try {
  console.log('Works loading: isolated Windows Electron, mixed list.')
  await launch(); await page.getByRole('button', { name: '修复作品锁', exact: true }).waitFor()
  const partial = await list()
  assert.deepEqual(partial.novels.map(n => n.id), [healthy.novelId]); assert.equal(partial.unavailableWorks[0].reason, 'stale-lease')
  check('real local IPC lists healthy novel and explicit stale work')
  await page.getByText(healthy.title, { exact: true }).click(); await page.getByRole('tab', { name: healthy.title, exact: true }).waitFor()
  check('healthy real novel opens while another work is unavailable')
  assert.equal(await readFile(join(stale.path, '.xaanink-lock', 'owner.json'), 'utf8'), ownerBefore.toString())
  assert.deepEqual(await readFile(join(fixture.root, 'catalog.json')), catalogBefore)
  check('ordinary list/open preserves stale lease and catalog')
  await screenshot('mixed-list'); await close()
  await rename(healthy.path, healthy.path + '-absent')
  console.log('Works loading: all unavailable and directory retry.')
  await launch(); await page.getByRole('button', { name: '修复作品锁', exact: true }).waitFor()
  const all = await list(); assert.equal(all.novels.length, 0); assert.equal(all.unavailableWorks.length, 2)
  assert.doesNotMatch(await page.locator('body').innerText(), /还没有小说|作品加载失败/)
  check('all unavailable remains explicit, without false empty library')
  await screenshot('all-unavailable')
  await rename(healthy.path + '-absent', healthy.path)
  await page.getByRole('button', { name: '重新加载作品', exact: true }).click()
  await page.waitForFunction(title => [...document.querySelectorAll('[aria-label="暂不可用的作品"] span')].every(el => el.textContent !== title), healthy.title)
  assert.equal((await list()).novels.length, 1); check('native directory return and real retry restore healthy list')
  await page.waitForTimeout(700)
  const probePath = join(base, 'native-probe.json')
  await app.evaluate(({ app, dialog }, probePath) => {
    const fs = process.getBuiltinModule('node:fs'), probe = { confirmation: 0, notice: 0, relaunch: 0 }
    const original = dialog.showMessageBox.bind(dialog)
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1)
      if (options.title === '修复异常退出锁') { probe.confirmation++; return { response: 1, checkboxChecked: false } }
      if (options.title === '作品锁恢复结果') { probe.notice++; return { response: 0, checkboxChecked: false } }
      return original(...args)
    }
    app.relaunch = () => { probe.relaunch++; fs.writeFileSync(probePath, JSON.stringify(probe)) }
  }, probePath)
  console.log('Works loading: actual main handoff and filesystem recovery with controlled fixture confirmation.')
  const closed = app.waitForEvent('close', { timeout: 45000 })
  await page.getByRole('button', { name: '修复作品锁', exact: true }).click()
  await closed; app = undefined
  const probe = JSON.parse(await readFile(probePath, 'utf8')); assert.deepEqual(probe, { confirmation: 1, notice: 1, relaunch: 1 })
  check('real bridge start closes worker, confirms exact stale lease, recovers and requests one restart')
  await assert.rejects(lstat(join(stale.path, '.xaanink-lock')), { code: 'ENOENT' })
  const audit = JSON.parse(await readFile(join(stale.path, '.xaanink-lease-recovery.json'), 'utf8'))
  assert.equal(audit.payload.phase, 'recovered'); check('stale lease physically removed only by confirmed recovery; recovered audit persisted')
  assert.deepEqual(await readFile(join(fixture.root, 'catalog.json')), catalogBefore)
  assert.deepEqual(await readFile(join(stale.path, 'xaanink-work.json')), manifestBefore)
  check('recovery preserves original catalog and manifest bytes')
  await launch(); await page.waitForFunction(title => document.body.textContent.includes(title), stale.title)
  const restored = await list(); assert.equal(restored.novels.length, 2); assert.deepEqual(restored.unavailableWorks, [])
  const details = await page.evaluate(async work => (await fetch('/api/novels/' + work.novelId + '/chapters/' + work.chapterId)).json(), stale)
  assert.equal(details.chapter.content, '仅隔离测试使用的原作品内容'); assert.equal(details.chapter.id, stale.chapterId)
  check('cold launch reopens both original databases and verifies original business fields')
  assert.equal(await page.getByRole('button', { name: '修复作品锁', exact: true }).count(), 0)
  await screenshot('restored-list'); await close()
  assert.deepEqual(report.errors, []); report.status = 'passed'
} catch (error) { report.status = 'failed'; report.failure = String(error); report.stack = error.stack; process.exitCode = 1; await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {}) }
finally {
  if (app) await close().catch(() => app?.close().catch(() => {}))
  report.completedAt = new Date().toISOString()
  await writeFile(join(evidence, 'windows-electron.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, errors: report.errors, failure: report.failure }))
}
