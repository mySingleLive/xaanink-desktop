// Native input is supplied through cua_repl. This harness only observes the
// actual offline workbench, bounds, CSS and screenshots in an isolated root.
import assert from 'node:assert/strict'
import { _electron } from 'playwright'
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const sourceFiles = ['src/app/desktop.css', 'src/components/layout/ChatPanel.tsx', 'src/components/layout/ContentTabs.tsx']
function validateNativeChecks(report, humanConfirmedDragAreas) {
  assert.deepEqual(report.errors, [])
  const unique = label => {
    const matches = report.checks.filter(check => check.label === label)
    assert.equal(matches.length, 1, `One native observation required: ${label}`)
    return matches[0]
  }
  for (const area of ['ai', 'right-rail', 'right-empty']) {
    const before = unique(`${area}-before`), maximized = unique(`${area}-maximized`), restored = unique(`${area}-restored`)
    assert.equal(before.kind, 'baseline')
    assert(!before.window.maximized && !before.window.fullscreen, 'Baseline must be a normal window')
    assert.equal(maximized.kind, 'maximize'); assert.equal(restored.kind, 'restore')
    assert.equal(maximized.before, before.label); assert.equal(restored.before, before.label)
    assert(report.checks.indexOf(before) < report.checks.indexOf(maximized) && report.checks.indexOf(maximized) < report.checks.indexOf(restored), 'Native double-click observations must be ordered')
    assert(maximized.window.maximized && !maximized.window.fullscreen)
    assert(!restored.window.maximized && !restored.window.fullscreen)
    assert.deepEqual(restored.window.bounds, before.window.bounds)
  }
  for (const label of ['tab-double-click-excluded', 'pane-button-double-click-excluded', 'composer-double-click-excluded']) {
    const check = unique(label), before = unique(check.before)
    assert.equal(check.kind, 'no-drag')
    assert(report.checks.indexOf(before) < report.checks.indexOf(check))
    assert.deepEqual(check.window, before.window)
  }
  assert.deepEqual(humanConfirmedDragAreas, ['ai', 'right-rail', 'right-empty'], 'All three native drag areas require explicit human confirmation when the driver cannot move the original sidebar')
}

// Recheck a completed observation report without launching or manipulating UI.
if (process.argv[2] === '--verify-report') {
  const report = JSON.parse(await readFile(resolve(process.argv[3]), 'utf8'))
  assert.equal(report.status, 'passed')
  validateNativeChecks(report, report.dragVerification?.areas)
  assert.deepEqual(Object.keys(report.sourceHashes), sourceFiles)
  for (const [file, hash] of Object.entries(report.sourceHashes)) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash, `Source changed since native verification: ${file}`)
  process.stdout.write('Native observation report verified against current source.\n')
  process.exit(0)
}

const directory = await realpath(resolve(process.argv[2] ?? ''))
assert(directory.startsWith('/private/tmp/xaanink-pane-drag-'), 'Explicit isolated fixture required')
const root = join(directory, 'data'), evidence = resolve('docs/evidence/implementation-44')
await mkdir(evidence, { recursive: true })
const report = { scope: 'macOS development Electron, full real React workbench, system mouse through cua_repl; Windows unexecuted', startedAt: new Date().toISOString(), sourceHashes: {}, checks: [] }
for (const file of sourceFiles) report.sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex')
const errors = [], observed = new Map()
let app, sequence = 0
async function inspect(page) {
  const window = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === '玄印写作'); return { bounds: w.getBounds(), normalBounds: w.getNormalBounds(), maximized: w.isMaximized(), fullscreen: w.isFullScreen() } })
  const regions = await page.evaluate(() => [...document.querySelectorAll('.desktop-sidebar-controls,.chatpane > .desktop-drag,.content-tabs > .desktop-drag,[role="tab"],.chatpane [contenteditable],.content-tabs > div:last-child')].map(el => {
    const r = el.getBoundingClientRect(); return { class: el.className, role: el.getAttribute('role'), text: el.getAttribute('aria-label'), region: getComputedStyle(el).getPropertyValue('-webkit-app-region'), x: r.x, y: r.y, width: r.width, height: r.height }
  }))
  return { window, regions }
}
try {
  app = await _electron.launch({ args: [resolve('.')], env: { ...process.env, XAANINK_TEST_ROOT: root }, timeout: 45000 })
  const page = await app.firstWindow({ timeout: 45000 })
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: '账号菜单' }).waitFor({ timeout: 45000 })
  assert.equal(page.url(), 'xaanink://app/')
  const bootstrap = await page.evaluate(() => window.desktop.bootstrap())
  assert.equal(bootstrap.dataRoot, root); assert.equal(bootstrap.models.length, 0)
  await writeFile(join(directory, 'native-window.json'), JSON.stringify({ ready: true, sequence, ...await inspect(page) }, null, 2))
  for (;;) {
    let request
    try { request = JSON.parse(await readFile(join(directory, 'native-request.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (!request || request.sequence <= sequence) { await new Promise(resolve => setTimeout(resolve, 100)); continue }
    sequence = request.sequence
    if (request.kind === 'finish') {
      validateNativeChecks({ ...report, errors }, request.humanConfirmedDragAreas)
      report.dragVerification = { driver: 'human physical mouse; confirmation received in chat', areas: request.humanConfirmedDragAreas, note: 'cua_repl drag could not move the original sidebar control; those attempts are not counted passed. Exclusion observations use the working double-click driver and prove no window toggle, not physical drag exclusions.' }
      report.status = 'passed'; report.completedAt = new Date().toISOString(); report.errors = errors
      await writeFile(join(evidence, 'pane-window-drag-native.json'), JSON.stringify(report, null, 2) + '\n')
      await writeFile(join(directory, 'native-window.json'), JSON.stringify({ sequence, finished: true }))
      break
    }
    const result = await inspect(page), before = observed.get(request.before)
    if (request.kind !== 'baseline') assert(before, 'A named baseline is required')
    if (request.kind === 'drag') {
      assert(!result.window.maximized && !result.window.fullscreen)
      assert(result.window.bounds.x !== before.window.bounds.x || result.window.bounds.y !== before.window.bounds.y, 'System drag must move actual window')
      assert.equal(result.window.bounds.width, before.window.bounds.width); assert.equal(result.window.bounds.height, before.window.bounds.height)
    } else if (request.kind === 'maximize') { assert(result.window.maximized); assert(!result.window.fullscreen) }
    else if (request.kind === 'restore') { assert(!result.window.maximized && !result.window.fullscreen); assert.deepEqual(result.window.bounds, before.window.bounds) }
    else if (request.kind === 'no-drag') assert.deepEqual(result.window, before.window)
    else assert.equal(request.kind, 'baseline')
    observed.set(request.label, result); report.checks.push({ label: request.label, kind: request.kind, before: request.before, ...result })
    await page.screenshot({ path: join(evidence, request.label.replace(/[^a-z0-9-]/g, '') + '.png') })
    await writeFile(join(directory, 'native-window.json'), JSON.stringify({ ready: true, sequence, ...result }, null, 2))
  }
} catch (error) {
  report.status = 'failed'; report.error = String(error); report.errors = errors
  await writeFile(join(evidence, 'pane-window-drag-native.json'), JSON.stringify(report, null, 2) + '\n')
  throw error
} finally { await app?.close().catch(() => {}) }
