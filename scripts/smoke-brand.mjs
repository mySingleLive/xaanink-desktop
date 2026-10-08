import { _electron as electron } from 'playwright'
import { expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// This harness uses synthetic data only. The preparation step runs the actual
// pre-rename build; the verification step runs the newly packaged application.
const location = join(tmpdir(), 'xaanink-brand-native-location.json')
const prepare = process.argv.includes('--prepare-legacy')
const packaged = process.argv.includes('--packaged')
const legacyApplication = process.argv.find(value => value.startsWith('--legacy-app='))?.slice('--legacy-app='.length)
const evidence = resolve('docs/evidence/brand-rename')
const startedAt = new Date().toISOString(), checks = [], rendererErrors = []
let application, temporary
const launch = (root, legacy = false) => electron.launch({
  ...(legacy && legacyApplication ? { executablePath: join(resolve(legacyApplication), 'Contents/MacOS/玄香印'), args: [] } : packaged ? { executablePath: resolve('release/mac-arm64/玄印写作.app/Contents/MacOS/玄印写作'), args: [] } : { args: [resolve('.')] }),
  // Both historical and current builds must isolate even if the wrong build
  // was supplied. Neither can fall back to the author's home directory.
  env: { ...process.env, XUANXIANG_TEST_ROOT: root, XAANINK_TEST_ROOT: root }, timeout: 60000,
})
async function ready() {
  const page = await application.firstWindow({ timeout: 60000 })
  page.on('pageerror', error => rendererErrors.push(error.message))
  await page.getByRole('button', { name: '账号菜单' }).waitFor({ timeout: 60000 })
  return page
}
async function stop() { await application?.close(); application = undefined }
try {
  await mkdir(evidence, { recursive: true })
  if (prepare) {
    assert.equal(packaged, Boolean(legacyApplication))
    const oldBuild = await readFile(legacyApplication ? join(resolve(legacyApplication), 'Contents/Resources/app/dist/main/index.cjs') : resolve('dist/main/index.cjs'), 'utf8')
    assert(oldBuild.includes('process.env.XUANXIANG_TEST_ROOT') && oldBuild.includes('xuanxiang://app/'), 'prepare requires the actual historical build with explicit isolation support')
    if (legacyApplication) {
      assert(/\b(?:const|var) isolatedRoot = process\.env\.XUANXIANG_TEST_ROOT \?/.test(oldBuild), 'historical packaged bootstrap must honor explicit isolation')
      assert(/dataRoot = isolatedRoot \?\?/.test(oldBuild), 'historical packaged worker must honor the same explicit isolation')
    }
    temporary = await realpath(await mkdtemp(join(tmpdir(), 'xaanink-brand-upgrade-')))
    const root = join(temporary, 'legacy-data')
    application = await launch(root, true)
    const page = await ready()
    assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), root + '-bootstrap')
    assert.equal(page.url(), 'xuanxiang://app/')
    // Historical name is essential to the old OS encryption identity fixture.
    assert.equal(await application.evaluate(({ app }) => app.name), '玄香印')
    const state = await page.evaluate(() => window.desktop.bootstrap())
    assert.equal(state.dataRoot, root, 'actual historical worker root must be isolated before any settings or draft write')
    await page.evaluate(async revision => window.desktop.settings({ type: 'save-model', revision, model: {
      name: '隔离兼容测试模型', provider: 'custom', providerName: '隔离测试', protocol: 'openai', modelId: 'synthetic-brand-test',
      endpoint: 'https://example.invalid/v1', kind: 'TEXT', contextWindow: 0, enabled: true, thinkingLevels: [], defaultThinking: 'default', apiKey: 'public-brand-fixture-key',
    } }), state.revision)
    await page.locator('.chat-composer-editable').fill('改名后仍保留的隔离测试草稿')
    await expect.poll(async () => {
      try { return JSON.stringify(JSON.parse(await readFile(join(root, 'drafts.json'), 'utf8')).snapshot.sources.chat) }
      catch (error) { if (error.code === 'ENOENT') return ''; throw error }
    }, { timeout: 15000 }).toContain('改名后仍保留的隔离测试草稿')
    await stop()
    const stored = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'))
    assert.equal(JSON.stringify(stored).includes('public-brand-fixture-key'), false)
    await writeFile(location, JSON.stringify({ temporary, root, legacyFixture: legacyApplication ? 'Git HEAD pre-rename packaged source; only packaged test-root isolation enabled' : 'Pre-rename development Electron' }) + '\n')
    console.log('Legacy native encrypted settings and durable composer fixture prepared in isolated temporary storage.')
  } else {
    const prepared = JSON.parse(await readFile(location, 'utf8'))
    temporary = await realpath(prepared.temporary)
    const allowed = await realpath(tmpdir())
    assert(temporary.startsWith(join(allowed, 'xaanink-brand-upgrade-')))
    assert.equal(prepared.root, join(temporary, 'legacy-data'))
    application = await launch(prepared.root)
    let page = await ready()
    assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), prepared.root + '-bootstrap')
    assert.equal(page.url(), 'xaanink://app/')
    assert.equal(await application.evaluate(({ app }) => app.name), '玄印写作')
    await expect(page.locator('.chat-composer-editable')).toContainText('改名后仍保留的隔离测试草稿')
    const state = await page.evaluate(() => window.desktop.bootstrap())
    assert.equal(state.dataRoot, prepared.root)
    assert.equal(state.models.length, 1); assert.equal(state.models[0].name, '隔离兼容测试模型')
    const stored = JSON.parse(await readFile(join(prepared.root, 'state.json'), 'utf8'))
    assert.equal(await application.evaluate(({ safeStorage }, encoded) => safeStorage.decryptString(Buffer.from(encoded, 'base64')) === 'public-brand-fixture-key', stored.value.models[0].encryptedKey), true)
    assert.equal(JSON.stringify(state).includes('public-brand-fixture-key'), false)
    checks.push('real pre-rename macOS encrypted model configuration decrypts after rename; public state contains no key', 'durable composer draft restores across the actual custom-origin change', 'legacy root and pointer are retained without renaming author controls')
    await page.screenshot({ path: join(evidence, 'native-upgrade.png') })
    await stop()
    const root = join(temporary, 'fresh-data')
    application = await launch(root)
    page = await ready()
    assert.equal(page.url(), 'xaanink://app/'); assert.equal(await page.title(), '玄印写作')
    const fresh = await page.evaluate(() => window.desktop.bootstrap())
    assert.equal(fresh.dataRoot, root)
    assert.equal(fresh.models.length, 0); assert.deepEqual(await page.evaluate(async () => (await (await fetch('/api/novels')).json()).novels), [])
    const identity = JSON.parse(await readFile(join(root, 'xaanink-app.json'), 'utf8'))
    assert.equal(identity.app, 'XaanInk')
    const menus = await application.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(item => ({ label: item.label, children: item.submenu?.items.map(child => child.label) })))
    assert.deepEqual(menus.map(item => item.label), ['玄印', '文件', '编辑', '视图', '窗口', '帮助'])
    assert(menus[0].children.includes('关于玄印写作')); assert(menus[0].children.includes('退出玄印'))
    assert.equal(await application.evaluate(({ app }) => app.name), '玄印写作')
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox), true)
    await page.getByRole('button', { name: '账号菜单' }).click(); await page.getByRole('menuitem', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '关于我们', exact: true }).click()
    await expect(page.locator('.desktop-settings')).toContainText('玄印写作')
    await page.screenshot({ path: join(evidence, 'native-current-about.png') })
    checks.push('fresh native application starts with current app marker, no model and no sample work', 'real macOS menus and about settings display the approved name', 'sandboxed original workbench loads using the offline custom protocol')
    assert.deepEqual(rendererErrors, [])
    await stop()
    await writeFile(join(evidence, 'native-brand.json'), JSON.stringify({ scope: packaged ? 'Real macOS arm64 packaged application rename and legacy upgrade; not full business or Windows acceptance' : 'Real development Electron macOS rename and legacy upgrade', legacyFixture: prepared.legacyFixture, startedAt, completedAt: new Date().toISOString(), packaged, platform: process.platform, arch: process.arch, passed: true, checks, rendererErrors }, null, 2) + '\n')
    console.log('Native brand and legacy upgrade verification passed.')
    await rm(temporary, { recursive: true, force: true }); await rm(location)
  }
} finally {
  if (application) {
    const timer = setTimeout(() => application?.process().kill('SIGKILL'), 10000)
    try { await stop().catch(() => {}) } finally { clearTimeout(timer) }
  }
}
