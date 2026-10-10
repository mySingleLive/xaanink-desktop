import assert from 'node:assert/strict'
import { _electron } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir, release, arch } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'

assert.equal(process.platform, 'win32', 'Actual Windows is required for this evidence')
const label = process.argv[2] ?? 'target-01'
assert(/^[a-z0-9-]+$/.test(label), 'Safe evidence label required')
const directory = await mkdtemp(join(tmpdir(), 'xaanink-tabs-')), root = join(directory, 'data')
const evidence = resolve('docs/evidence/content-tabs', label + '-electron')
const report = {
  scope: 'ContentTabs TABS-01..12 only; actual current Windows Electron with complete real React workspace, isolated synthetic data, zero models and offline renderer. Playwright/CDP synthesized pointer/keyboard; no physical OS mouse, native window dragging, Windows IME, macOS, installer or full regression acceptance.',
  startedAt: new Date().toISOString(), checks: [], errors: [], sourceHashes: {}, bundleHashes: {},
  operatingSystem: { platform: process.platform, release: release(), architecture: arch() },
}
await mkdir(evidence, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
for (const file of ['src/components/layout/ContentTabs.tsx', 'src/components/layout/useContentTabStrip.ts', 'src/components/desktop/DesktopCommandController.tsx', 'src/components/desktop/DesktopNavigation.tsx', 'desktop/shared/commands.json', 'src/stores/tabs.ts', 'src/app/desktop.css', 'scripts/seed-content-tabs.ts', 'scripts/verify-content-tabs.mjs', 'package-lock.json']) report.sourceHashes[file] = hash(await readFile(file))
async function built(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await built(path)
    else if (/\.(css|js|cjs)$/.test(entry.name)) report.bundleHashes[relative(resolve('.'), path).replaceAll('\\', '/')] = hash(await readFile(path))
  }
}
await built(resolve('dist')); await built(resolve('.next/static'))
report.electronExecutableHash = hash(await readFile(resolve('node_modules/electron/dist/electron.exe')))
const env = { ...process.env, XAANINK_TEST_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE
let app, page, editorHandle, editor, initialEditorText, currentDraftText
const track = () => page.locator('.content-tabs-track')
const tabs = () => track().locator('.content-tab[data-tab-id]')
const selected = () => track().locator('.content-tab[aria-selected=true]')
const menuTrigger = () => page.locator('.content-tabs-menu-trigger')
async function order() { return tabs().evaluateAll(elements => elements.map(el => el.dataset.tabId)) }
async function active() { return selected().getAttribute('data-tab-id') }
async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.waitForTimeout(180) }
async function launch() {
  console.log('ContentTabs target: launching isolated Windows Electron.')
  app = await _electron.launch({ args: [resolve('.')], env, timeout: 90000 })
  page = await app.firstWindow({ timeout: 90000 }); page.on('pageerror', error => report.errors.push(error.message))
  await page.context().setOffline(true)
  await page.getByRole('button', { name: '账号菜单', exact: true }).waitFor({ timeout: 90000 })
  assert.equal(page.url(), 'xaanink://app/')
  const bootstrap = await page.evaluate(() => window.desktop.bootstrap())
  assert.equal(bootstrap.dataRoot, root); assert.equal(bootstrap.models.length, 0)
  assert.equal(await page.evaluate(() => navigator.onLine), false)
  report.runtime = await app.evaluate(() => ({ platform: process.platform, electron: process.versions.electron, node: process.versions.node, chromium: process.versions.chrome }))
  report.isolation = { freshTemporaryRoot: true, restoredFixtureThrough: 'DraftJournal workspace source at startup', models: 0, rendererOffline: true, protocol: page.url(), httpListenerStartedByScript: false }
}
async function bounds(width, height = 1000) {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setBounds(size), { width, height })
  await settle()
  const switcher = page.getByRole('navigation', { name: '创作工作区' })
  if (await switcher.isVisible()) await switcher.getByRole('button', { name: '查看内容', exact: true }).click()
  await settle()
}
async function appearance(patch) {
  await page.evaluate(async patch => { const state = await window.desktop.bootstrap(); await window.desktop.settings({ type: 'update', revision: state.revision, settings: { ...state.settings, appearance: { ...state.settings.appearance, ...patch } } }) }, patch)
  if (patch.theme) await page.waitForFunction(theme => document.documentElement.classList.contains(theme), patch.theme)
  if (patch.zoom) assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), patch.zoom)
  await settle()
}
async function screenshot(name) {
  const path = join(evidence, name + '.png'); await page.screenshot({ path })
  report.checks.push({ label: name + ' screenshot', file: relative(resolve('.'), path).replaceAll('\\', '/'), sha256: hash(await readFile(path)) })
}
async function inspect(name, theme = 'paper') {
  const zoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
  const result = await page.evaluate(() => {
    const rect = element => element.getBoundingClientRect().toJSON()
    const caption = document.querySelector('.content-tabs-caption'), viewport = document.querySelector('.content-tabs-viewport')
    const tab = document.querySelector('.content-tabs-track .content-tab[aria-selected=true]')
    const styles = getComputedStyle(tab), viewportStyle = getComputedStyle(viewport), captionStyle = getComputedStyle(caption)
    const title = tab.querySelector('.content-tab-title'), close = tab.querySelector('.content-tab-close')
    const divider = getComputedStyle(caption, '::after')
    const fixedTabWidth = [...tab.children].filter(child => child !== title).reduce((total, child) => { const style = getComputedStyle(child); return total + child.getBoundingClientRect().width + parseFloat(style.marginLeft || '0') + parseFloat(style.marginRight || '0') }, 0) + parseFloat(styles.columnGap || '0') * (tab.children.length - 1) + parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight) + parseFloat(styles.borderLeftWidth) + parseFloat(styles.borderRightWidth)
    const tools = [...document.querySelectorAll('.content-tabs-tools button')].filter(el => el.getBoundingClientRect().width > 0).map(el => ({ label: el.getAttribute('aria-label'), rect: rect(el), cursor: getComputedStyle(el).cursor, appRegion: getComputedStyle(el).getPropertyValue('-webkit-app-region') }))
    const appMenu = document.querySelector('[data-desktop-menu-button]')
    return { viewportWidth: innerWidth, caption: rect(caption), viewport: rect(viewport), tab: rect(tab), close: rect(close), fixedTabWidth, closeCursor: getComputedStyle(close).cursor, titleCursor: getComputedStyle(title).cursor, divider: { content: divider.content, height: divider.height, left: divider.left, right: divider.right, bottom: divider.bottom, color: divider.backgroundColor, expectedColor: captionStyle.getPropertyValue('--border').trim() }, appMenu: appMenu ? rect(appMenu) : null, tools, bodyBackground: getComputedStyle(document.querySelector('.content-tabs')).backgroundColor, tabBackground: styles.backgroundColor, borderColor: styles.borderColor, color: styles.color, radius: styles.borderRadius, shadow: styles.boxShadow, cursor: styles.cursor, appRegion: styles.getPropertyValue('-webkit-app-region'), captionAppRegion: captionStyle.getPropertyValue('-webkit-app-region'), overflowX: viewportStyle.overflowX, overflowY: viewportStyle.overflowY, clientHeight: viewport.clientHeight, scrollHeight: viewport.scrollHeight, clientWidth: viewport.clientWidth, scrollWidth: viewport.scrollWidth, scrollLeft: viewport.scrollLeft, title: { overflow: title.dataset.overflow, textOverflow: getComputedStyle(title).textOverflow, mask: getComputedStyle(title).maskImage }, tabWidths: [...document.querySelectorAll('.content-tabs-track .content-tab')].map(el => rect(el).width) }
  })
  assert(Math.abs(result.caption.height * zoom - 44) < .2, name + ': caption 44 DIP')
  assert(Math.abs(result.tab.height * zoom - 32) < .2, name + ': tab 32 DIP')
  assert(Math.abs((result.tab.top - result.caption.top) * zoom - 6) < .2, name + ': top gap 6 DIP')
  assert(Math.abs((result.caption.bottom - result.tab.bottom) * zoom - 6) < .2, name + ': bottom gap 6 DIP')
  assert(Math.abs(parseFloat(result.radius) * zoom - 6) < .2, name + ': radius 6 DIP')
  assert(result.tabWidths.every(width => width * zoom <= 208.3), name + ': max width 208 DIP')
  assert.equal(result.overflowX, 'hidden'); assert.equal(result.overflowY, 'hidden'); assert.equal(result.scrollHeight, result.clientHeight)
  assert.equal(result.cursor, 'default'); assert.equal(result.appRegion, 'no-drag'); assert.equal(result.captionAppRegion, 'drag'); assert.equal(result.shadow, 'none')
  assert.equal(result.closeCursor, 'default'); assert.equal(result.titleCursor, 'default')
  assert(Math.abs(result.close.width * zoom - 15) < .2, name + ': close size 15 DIP')
  if (result.viewport.width >= result.fixedTabWidth - .1) assert(result.close.right <= result.tab.right + .1, name + ': close entry retained inside sufficiently wide tab')
  else {
    // The approved extreme-narrow boundary prioritizes native safe area and
    // tools, allowing a zero-width strip. Its independent menu close action
    // must remain reachable even when fixed tab decorations cannot fit.
    assert(await menuTrigger().isVisible(), name + ': extreme-narrow menu remains reachable')
    const id = await active()
    await menuTrigger().click(); await page.getByRole('menuitemradio').first().waitFor()
    const menuClose = page.locator('.content-tabs-menu-row[data-tab-id="' + id + '"]').getByRole('menuitem')
    await menuClose.scrollIntoViewIfNeeded(); assert(await menuClose.isVisible()); assert(await menuClose.isEnabled())
    await page.keyboard.press('Escape'); await page.waitForFunction(() => document.querySelector('.content-tabs-menu-trigger') === document.activeElement)
    report.checks.push({ label: name + ': approved extreme-narrow independent close action reachable in menu', viewportCssPixels: result.viewport.width, requiredFixedTabCssPixels: result.fixedTabWidth })
  }
  assert.equal(result.divider.height, '1px'); assert.equal(result.divider.left, '0px'); assert.equal(result.divider.right, '0px'); assert.equal(result.divider.bottom, '0px'); assert.notEqual(result.divider.color, 'rgba(0, 0, 0, 0)')
  assert.equal(result.title.textOverflow, 'clip')
  assert(result.tab.left >= result.viewport.left - .5 && result.tab.right <= result.viewport.right + .5, name + ': active visible')
  for (const tool of result.tools) {
    assert(Math.abs(tool.rect.width * zoom - 24) < .2, name + ': tool size')
    assert(Math.abs((tool.rect.top + tool.rect.height / 2 - result.caption.top) * zoom - 16) < .6, name + ': tool center 16 DIP')
    assert.equal(tool.cursor, 'default'); assert.equal(tool.appRegion, 'no-drag')
    if (result.appMenu) assert(tool.rect.right <= result.appMenu.left + .2, name + ': tools before fixed app menu')
  }
  if (result.appMenu) assert(result.appMenu.right * zoom <= result.viewportWidth * zoom - 138 + .5, name + ': native caption safe area')
  if (theme === 'paper') assert.equal(result.tabBackground, result.bodyBackground)
  else { assert.equal(result.tabBackground, 'rgb(42, 40, 38)'); assert.equal(result.borderColor, 'rgb(75, 70, 64)'); assert.equal(result.color, 'rgb(236, 231, 225)'); assert.notEqual(result.tabBackground, result.bodyBackground) }
  report.checks.push({ label: name, theme, zoom, ...result }); return result
}
async function choose(id) {
  await menuTrigger().click()
  await page.getByRole('menuitemradio').first().waitFor()
  // The row itself carries the id; selecting through its real radio menu item
  // uses the normal activate path and does not write product state.
  await page.locator('.content-tabs-menu-row[data-tab-id="' + id + '"]').getByRole('menuitemradio').click()
  // Automatic dismissal is part of the normal tab selection behavior. Do not
  // use Escape here because it would conceal a failure to close the menu.
  await page.getByRole('menuitemradio').first().waitFor({ state: 'hidden' })
  await settle(); assert.equal(await active(), id)
  report.checks.push({ label: 'real menu selection automatically closes popup', selectedId: id, dismissalDriver: 'radio click only; no Escape' })
}
async function editorRetained(label) {
  assert.equal(await editorHandle.evaluate(element => element.isConnected), true, label + ': same real Monaco element')
  if (!await editor.isVisible()) {
    report.checks.push({ label, sameMonacoElement: true, editorHidden: true, modelVerificationDeferredUntilReactivation: true })
    return
  }
  // Monaco virtualizes view-lines when a kept-mounted panel is hidden; verify
  // the rendered model after reactivation rather than reading its zero-height
  // hidden DOM as if that were the complete document.
  await page.waitForFunction(expected => document.querySelector('.workspace-content .monaco-editor .view-lines')?.textContent === expected, currentDraftText)
  assert.equal(await editor.locator('.view-lines').textContent(), currentDraftText, label + ': draft retained')
  report.checks.push({ label, sameMonacoElement: true, draftTextHash: hash(Buffer.from(currentDraftText)) })
}
async function start(id) {
  const tab = track().locator('.content-tab[data-tab-id="' + id + '"]'), rect = await tab.boundingBox()
  assert(rect)
  const offset = { x: Math.min(29, rect.width / 3), y: 8 }
  const point = { x: rect.x + offset.x, y: rect.y + offset.y }
  await page.mouse.move(point.x, point.y); await page.mouse.down()
  return { id, offset, point, rect }
}
async function movePreview(state, x, y, label) {
  await page.mouse.move(x, y, { steps: 5 })
  const preview = page.locator('.content-tab-drag-preview'); await preview.waitFor()
  const rect = await preview.boundingBox()
  assert(Math.abs(rect.x - (x - state.offset.x)) < .8, label + ': x follows grab offset')
  assert(Math.abs(rect.y - (y - state.offset.y)) < .8, label + ': y follows grab offset')
  assert.equal(await preview.getAttribute('aria-hidden'), 'true')
  assert.equal(await preview.getAttribute('role'), null)
  return rect
}
async function cleared() { await page.locator('.content-tab-drag-preview').waitFor({ state: 'detached' }); assert.equal(await track().locator('.content-tab-drag-source').count(), 0) }
async function windowBounds() { return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()) }
async function seed() {
  await new Promise((resolveSeed, rejectSeed) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/seed-content-tabs.ts', directory], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const timeout = setTimeout(() => { child.kill(); rejectSeed(new Error('Isolated ContentTabs seed timed out after 180 seconds; ' + output.slice(-1200))) }, 180000)
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { const text = bytes.toString(); output += text; process.stdout.write(text) })
    child.once('error', error => { clearTimeout(timeout); rejectSeed(error) })
    child.once('close', code => { clearTimeout(timeout); if (code === 0) resolveSeed(); else rejectSeed(new Error('Isolated ContentTabs seed exit ' + code + '; ' + output.slice(-1200))) })
  })
}

try {
  await launch(); await bounds(1800)
  await page.getByRole('button', { name: '显示内容面板', exact: true }).click(); await settle()
  const emptyCaption = await page.locator('.content-tabs > [data-desktop-caption=win32]').boundingBox()
  assert(Math.abs(emptyCaption.height - 44) < .2)
  await page.getByRole('button', { name: '隐藏内容面板', exact: true }).click()
  await page.locator('.workspace-content').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '显示内容面板', exact: true }).click()
  await page.getByRole('button', { name: '隐藏内容面板', exact: true }).waitFor()
  report.checks.push({ label: 'real empty content hide and restore', captionHeight: emptyCaption.height })
  await app.close(); app = null
  await seed()
  const fixture = JSON.parse(await readFile(join(directory, 'fixture.json'), 'utf8')), originalId = fixture.activeTabId
  await launch(); await bounds(1800)
  await tabs().first().waitFor({ timeout: 60000 }); assert.equal(await tabs().count(), 20); assert.equal(await active(), originalId)
  await inspect('paper-20-tabs')
  assert(await menuTrigger().isVisible())
  const titleDetails = await track().locator('.content-tab-title').evaluateAll(elements => elements.map(el => ({ text: el.textContent, actualOverflow: el.scrollWidth > el.clientWidth + 1, fade: el.dataset.overflow, mask: getComputedStyle(el).maskImage })))
  assert(titleDetails.some(title => title.actualOverflow && title.fade === 'true' && title.mask !== 'none'))
  assert(titleDetails.some(title => !title.actualOverflow && title.fade !== 'true' && title.mask === 'none'))
  report.checks.push({ label: 'real long title fade and short title without fade', titleDetails })
  const content = page.locator('.workspace-content')
  await content.getByRole('button', { name: '编辑', exact: true }).click()
  editor = content.locator('.monaco-editor').first(); await editor.waitFor({ timeout: 60000 }); editorHandle = await editor.elementHandle()
  initialEditorText = await editor.locator('.view-lines').textContent()
  await editor.getByRole('textbox', { name: 'Editor content', exact: true }).focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('【标签排序草稿】')
  await page.waitForFunction(() => document.querySelector('.workspace-content .monaco-editor .view-lines')?.textContent.includes('【标签排序草稿】'))
  currentDraftText = await editor.locator('.view-lines').textContent()
  const originalOrder = await order()
  await menuTrigger().click()
  await page.getByRole('menuitemradio').first().waitFor()
  const menuRows = page.locator('.content-tabs-menu-row')
  assert.equal(await page.getByRole('menuitemradio').count(), 20)
  assert.equal(await page.locator('.content-tabs-menu-close[role=menuitem]').count(), 20)
  const menuOrder = await menuRows.evaluateAll(elements => elements.map(el => el.dataset.tabId)); assert.deepEqual(menuOrder, originalOrder)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.content-tabs-menu-trigger') === document.activeElement)
  report.checks.push({ label: 'real overflow menu exposes 20 switch and 20 independent close items in strip order; Escape returns trigger', menuOrder })
  await choose(originalOrder.at(-1)); await inspect('last-tab-revealed'); await editorRetained('menu activation retains hidden real editor')
  await choose(originalId)
  await editorRetained('reactivated original editor retains input after menu switching')
  await selected().focus()
  assert.equal(await active(), originalId)
  assert.equal(await selected().evaluate(el => el === document.activeElement), true, 'real selected tab owns keyboard focus before Alt reorder')
  await selected().press('Alt+ArrowLeft'); await settle()
  const frontOrder = [originalId, originalOrder[0], ...originalOrder.slice(2)]
  assert.deepEqual(await order(), frontOrder); assert.equal(await active(), originalId); await editorRetained('Alt reorder retains active real editor and input')
  const boundsBeforeDrag = await windowBounds(), state = await start(originalId)
  await movePreview(state, state.point.x + 65, state.point.y + 52, 'diagonal down outside strip')
  await movePreview(state, state.point.x + 96, state.point.y - 4, 'diagonal up')
  await movePreview(state, state.point.x + 48, state.point.y + 92, 'down outside strip continues following')
  await screenshot('real-xy-drag-preview')
  const second = await tabs().nth(1).boundingBox()
  await page.mouse.move(second.x + second.width - 8, state.point.y, { steps: 5 }); await page.mouse.up(); await settle(); await cleared()
  assert.deepEqual(await order(), originalOrder); assert.equal(await active(), originalId); await editorRetained('pointer reorder preserves real editor and draft')
  assert.deepEqual(await windowBounds(), boundsBeforeDrag)
  report.checks.push({ label: 'real selected tab drag XY grab-offset and valid strip commit', input: 'Electron CDP synthetic pointer', windowPositionUnchanged: true, physicalOSWindowDragNotExecuted: true })
  const inactiveId = (await order())[2], inactiveState = await start(inactiveId)
  const first = await tabs().first().boundingBox()
  await movePreview(inactiveState, first.x + 5, state.point.y, 'inactive to first')
  await page.mouse.up(); await settle(); await cleared()
  assert.deepEqual(await order(), [inactiveId, ...originalOrder.filter(id => id !== inactiveId)]); assert.equal(await active(), originalId); await editorRetained('inactive tab reorder retains active content')
  const beforeCancel = await order(), canceled = await start(originalId)
  await movePreview(canceled, canceled.point.x + 80, canceled.point.y + 80, 'invalid outside drop')
  await page.mouse.up(); await settle(); await cleared(); assert.deepEqual(await order(), beforeCancel)
  const escaped = await start(originalId); await movePreview(escaped, escaped.point.x + 50, escaped.point.y + 50, 'Escape cancel')
  await page.keyboard.press('Escape'); await page.mouse.up(); await cleared(); assert.deepEqual(await order(), beforeCancel)
  report.checks.push({ label: 'real outside drop and Escape cancel clear preview and retain order', driver: 'Electron CDP synthetic pointer/keyboard' })
  await appearance({ theme: 'ink' }); await inspect('ink-highlight-20-tabs', 'ink'); await screenshot('real-ink-tabs'); await editorRetained('ink theme retains real editor')
  await appearance({ theme: 'paper' }); await bounds(3200, 1200)
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) { await appearance({ zoom }); await inspect('zoom-' + zoom) }
  await appearance({ zoom: 1 }); await bounds(980, 900); await inspect('narrow-window'); await screenshot('real-narrow-tabs')
  await bounds(760, 900); await inspect('real-narrow-content-pane')
  await bounds(1800); await editorRetained('window and zoom changes retain real editor')
  // Start at the first item through normal keyboard sorting, then exercise
  // automatic hidden-strip scrolling with real full-workspace nodes.
  await choose(originalId); await selected().focus()
  for (let index = (await order()).indexOf(originalId); index > 0; index--) await selected().press('Alt+ArrowLeft')
  await settle(); const beforeEdge = await order(), edgeState = await start(originalId)
  const viewport = await page.locator('.content-tabs-viewport').boundingBox()
  await page.mouse.move(viewport.x + viewport.width - 3, edgeState.point.y, { steps: 8 })
  await page.waitForFunction(() => { const el = document.querySelector('.content-tabs-viewport'); return el.scrollLeft >= el.scrollWidth - el.clientWidth - 1 }, undefined, { timeout: 15000 })
  const endScroll = await page.locator('.content-tabs-viewport').evaluate(el => el.scrollLeft)
  assert(endScroll > 300); await page.mouse.up(); await settle(); await cleared()
  assert.deepEqual(await order(), [...beforeEdge.filter(id => id !== originalId), originalId]); assert.equal(await active(), originalId); await editorRetained('right edge auto-scroll reorder preserves real editor')
  const reverse = await start(originalId)
  await page.mouse.move(viewport.x + 3, reverse.point.y, { steps: 8 })
  await page.waitForFunction(() => document.querySelector('.content-tabs-viewport').scrollLeft <= 1, undefined, { timeout: 15000 })
  await page.mouse.up(); await settle(); await cleared(); assert.equal((await order())[0], originalId)
  report.checks.push({ label: 'actual 20 tabs right/left edge auto-scroll reorder', rightScrollCssPixels: endScroll, leftScrollCssPixels: await page.locator('.content-tabs-viewport').evaluate(el => el.scrollLeft), driver: 'Electron CDP synthetic pointer' })
  await editor.getByRole('textbox', { name: 'Editor content', exact: true }).focus(); await page.keyboard.press('Control+z')
  await page.waitForFunction(() => !document.querySelector('.workspace-content .monaco-editor .view-lines')?.textContent.includes('【标签排序草稿】'))
  assert.equal(await editor.locator('.view-lines').textContent(), initialEditorText)
  report.checks.push({ label: 'real editor undo survives selected/inactive reorder, edge reorder, themes and zoom', originalModelRestored: true, sameElement: await editorHandle.evaluate(el => el.isConnected) })
  await screenshot('real-paper-tabs')
  await page.getByRole('button', { name: '进入全屏', exact: true }).click(); await settle()
  await page.waitForFunction(() => document.querySelector('.workspace-chat').getBoundingClientRect().width * devicePixelRatio <= 1)
  await page.getByRole('button', { name: '退出全屏', exact: true }).click(); await settle()
  await page.getByRole('button', { name: '显示 / 隐藏内容面板', exact: true }).click(); await page.locator('.workspace-content').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '显示内容面板', exact: true }).click(); await tabs().first().waitFor()
  report.checks.push({ label: 'related real fullscreen, hide and restore tools' })
  await choose(originalId)
  const beforeClose = await order(), closeIndex = beforeClose.indexOf(originalId), expectedNeighbor = beforeClose[closeIndex - 1] ?? beforeClose[closeIndex + 1]
  await selected().getByRole('button', { name: /^关闭 / }).click(); await settle()
  assert.equal(await active(), expectedNeighbor); assert.equal(await tabs().count(), 19)
  report.checks.push({ label: 'close selected chooses neighbor in current reordered array', expectedNeighbor, finalOrder: await order() })
  assert.deepEqual(report.errors, []); report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.failure = String(error); report.failureStack = error.stack
  report.failureGeometry = await page?.evaluate(() => [...document.querySelectorAll('.content-tabs-caption,.content-tabs-viewport,.content-tabs-tools,.content-tabs-track .content-tab[aria-selected=true]')].map(el => ({ className: el.className, rect: el.getBoundingClientRect().toJSON(), style: el.getAttribute('style') }))).catch(() => null)
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {}); report.completedAt = new Date().toISOString()
  await writeFile(join(evidence, 'windows-electron.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failure: report.failure, errors: report.errors }))
}
