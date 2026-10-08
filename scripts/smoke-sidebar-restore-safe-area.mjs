// Actual macOS Electron/workbench in a new empty data root. CUA supplies the
// native window screenshots and first restore-button click at the named gates.
import assert from 'node:assert/strict'
import { _electron } from 'playwright'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

assert.equal(process.platform, 'darwin', 'This is a real macOS-only acceptance harness')
// The owned-root boundary rejects symlink ancestors such as macOS /var. Use
// the canonical /private/tmp path, as the other strict native root harnesses do.
const directory = await mkdtemp('/private/tmp/xaanink-sidebar-safe-')
const root = join(directory, 'data'), evidence = resolve('docs/evidence/implementation-46')
await mkdir(evidence, { recursive: true })
const report = { scope: 'macOS development Electron; full original React workbench; actual native zoom; isolated empty root; Windows and installed package unexecuted', startedAt: new Date().toISOString(), checks: [], errors: [], sourceHashes: {} }
for (const file of ['src/components/layout/ChatPanel.tsx', 'desktop/main/index.ts', 'src/components/desktop/DesktopApp.tsx']) report.sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex')
let app, page
const restore = () => page.getByRole('button', { name: '显示左侧导航栏', exact: true })
const toggle = () => page.getByRole('button', { name: '展开或收起左侧导航栏', exact: true })
async function observe() {
  const window = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === '玄印写作')
    return { bounds: w.getBounds(), contentBounds: w.getContentBounds(), zoom: w.webContents.getZoomFactor(), trafficLightPosition: w.getWindowButtonPosition(), maximized: w.isMaximized(), fullscreen: w.isFullScreen() }
  })
  const layout = await page.evaluate(() => {
    const el = document.querySelector('button[aria-label="显示左侧导航栏"]'), pane = document.querySelector('.workspace-sidebar'), header = document.querySelector('.chatpane > .desktop-drag')
    const rect = el?.getBoundingClientRect(), side = pane.getBoundingClientRect()
    return { restore: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height, region: getComputedStyle(el).getPropertyValue('-webkit-app-region') } : null, sidebarWidth: side.width, headerRegion: getComputedStyle(header).getPropertyValue('-webkit-app-region'), rootFont: getComputedStyle(document.documentElement).fontSize }
  })
  return { window, layout }
}
async function waitCollapsed() {
  await restore().waitFor()
  await page.waitForFunction(() => document.querySelector('.workspace-sidebar').getBoundingClientRect().width < .1)
}
async function safe(label) {
  const state = await observe()
  assert(state.layout.restore)
  const nativeLeft = state.layout.restore.x * state.window.zoom
  assert(nativeLeft >= 84 && nativeLeft <= 96, `${label}: native restore left ${nativeLeft}`)
  assert.equal(state.layout.restore.region, 'no-drag'); assert.equal(state.layout.headerRegion, 'drag')
  assert(!state.window.fullscreen && !state.window.maximized)
  report.checks.push({ label, nativeLeft, ...state })
  await page.screenshot({ path: join(evidence, `${label}-renderer.png`) })
  return state
}
async function gate(label, action) {
  const state = await safe(label)
  await writeFile(join(directory, 'state.json'), JSON.stringify({ label, action, pid: app.process().pid, directory, ...state }, null, 2))
  console.log(`Native CUA gate: ${label}; control directory: ${directory}`)
  const deadline = Date.now() + 10 * 60_000
  for (;;) {
    let acknowledgement
    try { acknowledgement = JSON.parse(await readFile(join(directory, 'ack.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (acknowledgement?.label === label) {
      assert.equal(acknowledgement.driver, 'cua_repl')
      assert.equal(acknowledgement.action, action)
      const screenshot = await readFile(resolve(acknowledgement.screenshot))
      assert(screenshot.length > 1000)
      report.checks.push({ label: `${label}-native-cua`, action, screenshot: acknowledgement.screenshot, screenshotHash: createHash('sha256').update(screenshot).digest('hex') })
      break
    }
    assert(Date.now() < deadline, `Timed out at native gate ${label}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  if (action === 'restore-click') {
    await page.waitForFunction(() => document.querySelector('.workspace-sidebar').getBoundingClientRect().width >= 199)
    assert.equal(await restore().count(), 0)
    assert.deepEqual((await observe()).window, state.window, 'Restore click must not close or move the native window')
  }
}
async function launch() {
  app = await _electron.launch({ args: [resolve('.')], env: { ...process.env, XAANINK_TEST_ROOT: root }, timeout: 45000 })
  page = await app.firstWindow({ timeout: 45000 })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.context().setOffline(true)
  await page.getByRole('button', { name: '账号菜单' }).waitFor({ timeout: 45000 })
  assert.equal(page.url(), 'xaanink://app/')
  const bootstrap = await page.evaluate(() => window.desktop.bootstrap())
  assert.equal(bootstrap.dataRoot, root); assert.equal(bootstrap.models.length, 0)
  assert.deepEqual(await page.evaluate(async () => (await (await fetch('/api/novels')).json()).novels), [])
  // Keep the wide desktop layout even at 200% zoom; this is test setup only.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === '玄印写作').setBounds({ x: 80, y: 80, width: 2200, height: 1000 }))
}
async function appearance(zoom, font) {
  await page.evaluate(async ({ zoom, font }) => {
    const bootstrap = await window.desktop.bootstrap()
    await window.desktop.settings({ type: 'update', revision: bootstrap.revision, settings: { ...bootstrap.settings, appearance: { ...bootstrap.settings.appearance, zoom, uiFontSize: font } } })
  }, { zoom, font })
  await page.waitForFunction(font => Math.abs(parseFloat(getComputedStyle(document.documentElement).fontSize) - 16 * font / 14) < .01, font)
  const state = await observe(); assert.equal(state.window.zoom, zoom)
}
try {
  await launch()
  await toggle().click(); await waitCollapsed()
  await gate('default-collapsed', 'restore-click')
  for (let i = 0; i < 2; i++) {
    await toggle().click(); await waitCollapsed(); await safe(`repeated-collapse-${i}`)
    await restore().press('Enter')
    await page.waitForFunction(() => document.querySelector('.workspace-sidebar').getBoundingClientRect().width >= 199)
  }
  await toggle().click(); await waitCollapsed()
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) for (const font of [11, 24]) {
    await appearance(zoom, font); await safe(`zoom-${zoom}-font-${font}`)
    if (zoom === .75 && font === 11) await gate('minimum-zoom-font', 'observe')
    if (zoom === 2 && font === 24) await gate('maximum-zoom-font', 'observe')
  }
  await appearance(1, 14)
  await safe('before-restart-collapsed')
  await app.close(); app = null
  await launch(); await waitCollapsed(); await safe('persisted-collapse-after-restart')
  await restore().press('Enter')
  await page.waitForFunction(() => document.querySelector('.workspace-sidebar').getBoundingClientRect().width >= 199)
  assert.equal(await restore().count(), 0)
  assert.deepEqual(report.errors, [])
  await app.close(); app = null
  report.status = 'passed'; report.completedAt = new Date().toISOString()
  await writeFile(join(evidence, 'sidebar-restore-native.json'), JSON.stringify(report, null, 2) + '\n')
  console.log('Actual macOS sidebar restore acceptance passed.')
} catch (error) {
  report.status = 'failed'; report.error = String(error)
  await writeFile(join(evidence, 'sidebar-restore-native.json'), JSON.stringify(report, null, 2) + '\n')
  throw error
} finally {
  await app?.close().catch(() => {})
  await rm(directory, { recursive: true, force: true })
}
