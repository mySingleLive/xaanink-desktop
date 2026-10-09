// Actual macOS/full workbench acceptance. CUA supplies a native screenshot and
// the first system-mouse click; subsequent keyboard input uses Electron/CDP.
import assert from 'node:assert/strict'
import { _electron } from 'playwright'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFile, cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

assert.equal(process.platform, 'darwin', 'Native acceptance requires actual macOS')
const directory = await mkdtemp('/private/tmp/xaanink-empty-hide-'), root = join(directory, 'data')
const evidenceRoot = resolve(process.argv[2] ?? 'docs/evidence/implementation-47')
const evidence = join(evidenceRoot, basename(directory))
await mkdir(evidence, { recursive: true })
// CUA resolves apps by their bundle path. A separate copy of the already
// installed official runtime avoids selecting a user's older Electron window
// when two processes run from the same application bundle path.
const installedExecutable = createRequire(import.meta.url)('electron')
const isolatedBundle = join(directory, 'Electron.app')
await cp(dirname(dirname(dirname(installedExecutable))), isolatedBundle, { recursive: true, verbatimSymlinks: true })
const executablePath = join(isolatedBundle, 'Contents/MacOS/Electron')
const report = { scope: 'macOS development Electron; full real React workbench; CUA system mouse; CDP keyboard; native zoom; isolated data; Windows native and installed package unexecuted', startedAt: new Date().toISOString(), checks: [], errors: [], sourceHashes: {} }
for (const file of ['src/components/layout/ContentTabs.tsx', 'src/components/layout/DashboardShell.tsx', 'src/components/layout/ChatPanel.tsx', 'src/components/desktop/DesktopApp.tsx', 'desktop/main/index.ts', 'scripts/smoke-empty-content-hide.mjs', 'scripts/seed-electron-fixture.ts']) report.sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex')
let app, page, passed = false
const hide = () => page.getByRole('button', { name: '隐藏内容面板', exact: true })
const show = () => page.getByRole('button', { name: '显示内容面板', exact: true })
async function windowState() {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === '玄印写作')
    return { bounds: w.getBounds(), contentBounds: w.getContentBounds(), zoom: w.webContents.getZoomFactor(), maximized: w.isMaximized(), fullscreen: w.isFullScreen() }
  })
}
async function launch(empty = true) {
  app = await _electron.launch({ executablePath, args: [resolve('.')], env: { ...process.env, XAANINK_TEST_ROOT: root }, timeout: 45000 })
  page = await app.firstWindow({ timeout: 45000 })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.context().setOffline(true)
  await page.getByRole('button', { name: '账号菜单' }).waitFor({ timeout: 45000 })
  assert.equal(page.url(), 'xaanink://app/')
  const bootstrap = await page.evaluate(() => window.desktop.bootstrap())
  assert.equal(bootstrap.dataRoot, root); assert.equal(bootstrap.models.length, 0)
  if (empty) assert.deepEqual(await page.evaluate(async () => (await (await fetch('/api/novels')).json()).novels), [])
  await app.evaluate(({ app, BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === '玄印写作')
    w.setBounds({ x: 80, y: 80, width: 2200, height: 1000 }); app.focus({ steal: true }); w.focus()
  })
}
async function openEmpty() {
  await show().click()
  await hide().waitFor()
  await page.waitForFunction(() => {
    const p = document.querySelector('.workspace-content')?.getBoundingClientRect()
    return p && p.width > 200 && !document.querySelector('button[aria-label="显示内容面板"]')
  })
  await waitStable()
}
async function waitStable() {
  // Observe the spring/resize settling; the inner pane's private CSS does not
  // describe the outer resizable panel's animation or minSize state.
  await page.evaluate(() => { delete window.__emptyContentStable })
  await page.waitForFunction(() => {
    const r = document.querySelector('.workspace-content')?.getBoundingClientRect()
    if (!r) return false
    const previous = window.__emptyContentStable
    window.__emptyContentStable = { width: r.width, x: r.x, frames: previous && Math.abs(r.width - previous.width) < .001 && Math.abs(r.x - previous.x) < .001 ? previous.frames + 1 : 0 }
    return r.width > 200 && window.__emptyContentStable.frames >= 8
  }, null, { polling: 'raf' })
}
async function hidden(label, before) {
  await page.waitForFunction(() => !document.querySelector('.workspace-content'))
  assert.equal(await hide().count(), 0); assert(await show().isVisible())
  assert.deepEqual(await windowState(), before, 'Hiding content must not move or toggle the native window')
  report.checks.push({ label, contentUnmounted: true, restoreVisible: true, window: before })
}
async function inspect(label, screenshot = false) {
  await hide().waitFor()
  await waitStable()
  const window = await windowState()
  const layout = await hide().evaluate(el => {
    const rect = r => ({ x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom })
    const pane = el.closest('.content-tabs'), header = el.parentElement
    const icon = el.querySelector('svg'), sidebarIcon = document.querySelector('button[aria-label="展开或收起左侧导航栏"] svg')
    return { button: rect(el.getBoundingClientRect()), icon: rect(icon.getBoundingClientRect()), sidebarIcon: rect(sidebarIcon.getBoundingClientRect()), pane: rect(pane.getBoundingClientRect()), header: rect(header.getBoundingClientRect()), buttonRegion: getComputedStyle(el).getPropertyValue('-webkit-app-region'), headerRegion: getComputedStyle(header).getPropertyValue('-webkit-app-region'), rootFont: getComputedStyle(document.documentElement).fontSize, tabs: document.querySelectorAll('[role="tab"]').length }
  })
  assert.equal(layout.tabs, 0)
  assert(layout.button.x >= layout.pane.x && layout.button.right <= layout.pane.right)
  assert(layout.button.y >= layout.header.y && layout.button.bottom <= layout.header.bottom)
  assert.equal(layout.header.y, 0)
  assert.equal(layout.icon.width, layout.sidebarIcon.width)
  assert.equal(layout.icon.height, layout.sidebarIcon.height)
  assert(Math.abs(layout.icon.width - parseFloat(layout.rootFont)) < .05 && Math.abs(layout.icon.height - parseFloat(layout.rootFont)) < .05)
  assert(Math.abs(layout.button.width - 1.5 * parseFloat(layout.rootFont)) < .05 && Math.abs(layout.button.height - 1.5 * parseFloat(layout.rootFont)) < .05)
  assert(layout.icon.x >= layout.button.x && layout.icon.y >= layout.button.y && layout.icon.right <= layout.button.right && layout.icon.bottom <= layout.button.bottom)
  assert(Math.abs(layout.pane.right - layout.button.right - parseFloat(layout.rootFont) / 2) < .1)
  assert.equal(layout.buttonRegion, 'no-drag'); assert.equal(layout.headerRegion, 'drag')
  report.checks.push({ label, window, layout })
  if (screenshot) await page.screenshot({ path: join(evidence, `${label}-renderer.png`) })
  return { window, layout }
}
async function appearance(zoom, font) {
  await page.evaluate(async ({ zoom, font }) => {
    const state = await window.desktop.bootstrap()
    await window.desktop.settings({ type: 'update', revision: state.revision, settings: { ...state.settings, appearance: { ...state.settings.appearance, zoom, uiFontSize: font } } })
  }, { zoom, font })
  await page.waitForFunction(font => Math.abs(parseFloat(getComputedStyle(document.documentElement).fontSize) - 16 * font / 14) < .01, font)
  assert.equal((await windowState()).zoom, zoom)
}
async function nativeGate() {
  const state = await inspect('default-empty', true), label = 'default-empty-hide-click'
  await writeFile(join(directory, 'state.json'), JSON.stringify({ label, action: 'hide-click', pid: app.process().pid, directory, isolatedBundle, ...state }, null, 2))
  console.log(`Native CUA gate: ${label}; control directory: ${directory}`)
  const deadline = Date.now() + 10 * 60_000
  for (;;) {
    let ack
    try { ack = JSON.parse(await readFile(join(directory, 'ack.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (ack?.label === label) {
      assert.equal(ack.driver, 'cua_repl'); assert.equal(ack.action, 'hide-click')
      const bytes = await readFile(resolve(ack.screenshot)); assert(bytes.length > 1000)
      report.checks.push({ label: 'native-cua-screenshot-click', screenshot: ack.screenshot, screenshotHash: createHash('sha256').update(bytes).digest('hex') })
      break
    }
    assert(Date.now() < deadline, 'Native CUA gate timed out')
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  await hidden('native-mouse-hides', state.window)
}
try {
  await launch(); await openEmpty(); await nativeGate()
  for (const key of ['Enter', 'Space']) {
    await openEmpty(); const before = await windowState()
    await hide().focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
    assert.equal(await hide().evaluate(el => el === document.activeElement), true)
    assert(await hide().evaluate(el => { const s = getComputedStyle(el); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1 }))
    await page.keyboard.press(key); await hidden(`keyboard-${key}-hides`, before)
  }
  await openEmpty()
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) for (const font of [11, 24]) {
    await appearance(zoom, font); await inspect(`zoom-${zoom}-font-${font}`, zoom === .75 && font === 11 || zoom === 2 && font === 24)
  }
  await appearance(1, 14); await inspect('before-restart-visible', true)
  await app.close(); app = null
  // Existing recovery deliberately resets contentVisible when there are no
  // tabs (draft-recovery.ts); preserve that behavior, then restore the empty
  // pane through the real AI title button and check the new hide control.
  await launch()
  assert.equal(await page.locator('.workspace-content').count(), 0)
  assert(await show().isVisible())
  report.checks.push({ label: 'restart-empty-starts-collapsed', contentUnmounted: true, restoreVisible: true })
  await openEmpty(); await inspect('restored-empty-after-restart', true)
  const before = await windowState(); await hide().click(); await hidden('after-restart-hides', before)
  await app.close(); app = null
  // Existing helper creates only a real synthetic novel in this isolated root.
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed-electron-fixture.ts', directory], { encoding: 'utf8' })
  await launch(false)
  await page.getByText(/外观测试章/).last().click()
  await page.getByRole('tab').waitFor()
  const tabLabels = await page.getByRole('tab').evaluateAll(els => els.map(el => el.getAttribute('aria-label')))
  assert.equal(await hide().count(), 0)
  const populatedWindow = await windowState()
  for (const title of tabLabels) await page.getByRole('button', { name: `关闭 ${title}`, exact: true }).click()
  await hidden('last-tab-auto-hides', populatedWindow)
  await openEmpty(); await inspect('after-last-tab-empty', true)
  await hide().click(); await hidden('after-last-tab-empty-hides', populatedWindow)
  assert.deepEqual(report.errors, [])
  await app.close(); app = null
  report.status = 'passed'; report.completedAt = new Date().toISOString(); passed = true
  console.log('Actual macOS empty content hide acceptance passed.')
} catch (error) {
  report.status = 'failed'; report.error = String(error)
  await page?.screenshot({ path: join(evidence, 'native-failure-renderer.png') }).catch(() => {})
  throw error
} finally {
  await app?.close().catch(() => {})
  const reportPath = join(evidence, 'empty-content-hide-native.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  // Keep every run immutable and publish the final alias only after success.
  // A delayed failure from another run cannot overwrite successful evidence.
  if (passed) await copyFile(reportPath, join(evidenceRoot, 'empty-content-hide-native.json'))
  if (passed) await rm(directory, { recursive: true, force: true })
  else console.log(`Retained isolated fixture: ${directory}`)
}
