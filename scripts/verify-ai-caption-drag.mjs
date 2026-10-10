// Actual Windows Electron observer. OS inputs are supplied separately by the
// computer-use skill; this harness never synthesizes native dragging.
import assert from 'node:assert/strict'
import { _electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

assert.equal(process.platform, 'win32')
const label = process.argv[2] ?? 'red'
assert(/^[a-z0-9-]+$/.test(label))
const evidence = resolve('docs/evidence/ai-caption-drag', label)
await mkdir(evidence, { recursive: true })
const directory = await mkdtemp(join(tmpdir(), 'xaanink-surfaces-'))
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed-workspace-surfaces.ts', directory], { cwd: resolve('.'), windowsHide: true })
const env = { ...process.env, XAANINK_TEST_ROOT: join(directory, 'data') }; delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({ args: [resolve('.')], env, timeout: 90000 })
const page = await app.firstWindow(), report = { label, driver: 'computer-use sky OS mouse; harness observes bounds and DOM', checks: [], errors: [], sourceHashes: {} }
page.on('pageerror', e => report.errors.push(e.message))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
for (const file of ['src/app/desktop.css', 'src/components/layout/ContentTabs.tsx', 'src/components/layout/useContentTabStrip.ts', 'src/components/layout/ChatPanel.tsx', 'dist/main/index.cjs', 'out/index.html']) report.sourceHashes[file] = hash(await readFile(file))
report.bundleHashes = {}
async function built(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) await built(file)
    else if (/\.(css|js|cjs)$/.test(file)) report.bundleHashes[file.slice(resolve('.').length + 1).replaceAll('\\', '/')] = hash(await readFile(file))
  }
}
await built(resolve('out')); await built(resolve('dist'))
await page.context().setOffline(true)
await page.getByRole('button', { name: '账号菜单', exact: true }).waitFor({ timeout: 90000 })
const bootstrap = await page.evaluate(() => window.desktop.bootstrap())
assert.equal(bootstrap.dataRoot, join(directory, 'data')); assert.equal(bootstrap.models.length, 0)
report.runtime = await app.evaluate(() => ({ platform: process.platform, versions: process.versions }))
report.isolation = { freshRoot: true, models: 0, rendererOffline: await page.evaluate(() => !navigator.onLine) }
await app.evaluate(({ BrowserWindow }, label) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 180, y: 160, width: 1440, height: 900 }); w.setTitle('Xaanink isolated drag ' + label) }, label)
const requestFile = join(evidence, 'request.json'), resultFile = join(evidence, 'response.json')
async function observe(label, input) {
  const window = await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; return { bounds: w.getBounds(), contentBounds: w.getContentBounds(), maximized: w.isMaximized(), scale: screen.getDisplayMatching(w.getBounds()).scaleFactor, zoom: w.webContents.getZoomFactor() } })
  const layout = await page.evaluate(() => {
    const rect = el => el.getBoundingClientRect().toJSON(), viewport = document.querySelector('.content-tabs-viewport')
    return { title: rect(document.querySelector('.chatpane > .desktop-drag')), viewport: rect(viewport), scrollLeft: viewport.scrollLeft, tabs: [...document.querySelectorAll('.content-tab')].map(el => ({ id: el.dataset.tabId, rect: rect(el), region: getComputedStyle(el).getPropertyValue('-webkit-app-region') })), regions: [...document.querySelectorAll('*')].filter(el => getComputedStyle(el).getPropertyValue('-webkit-app-region') === 'no-drag').map(el => ({ tag: el.tagName, role: el.getAttribute('role'), rect: rect(el) })) }
  })
  const result = { label, input, window, layout }; report.checks.push(result)
  await page.screenshot({ path: join(evidence, `${report.checks.length}.png`) })
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  return result
}
await writeFile(resultFile, JSON.stringify({ ready: true, ...await observe('initial') }))
console.log('Observer ready: ' + resultFile)
let last = '', done = false
try {
  while (!done) {
    await new Promise(resolve => setTimeout(resolve, 150))
    let input; try { input = await readFile(requestFile, 'utf8') } catch { continue }
    if (input === last) continue; last = input
    const request = JSON.parse(input)
    if (request.kind === 'last-tab') await page.getByRole('tab').last().click()
    else if (request.kind === 'first-tab') await page.getByRole('tab').first().click()
    else if (request.kind === 'zoom') await page.evaluate(async zoom => { const s = await window.desktop.bootstrap(); await window.desktop.settings({ type: 'update', revision: s.revision, settings: { ...s.settings, appearance: { ...s.settings.appearance, zoom } } }) }, request.zoom)
    else if (request.kind === 'stop') done = true
    else assert.equal(request.kind, 'observe')
    await page.waitForTimeout(250)
    await writeFile(resultFile, JSON.stringify({ requestId: request.id, ...await observe(request.label, request.input) }))
  }
} finally { await app.close(); report.completedAt = new Date().toISOString(); await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2)) }
