// Design-only preview. Temporary DOM/CSS changes never reach product sources.
import assert from 'node:assert/strict'
import { _electron } from 'playwright'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const directory = resolve('design/workspace-surfaces')
const isolated = await mkdtemp(join(tmpdir(), 'xaanink-surface-design-'))
const env = { ...process.env, XAANINK_TEST_ROOT: join(isolated, 'data') }
delete env.ELECTRON_RUN_AS_NODE
await mkdir(directory, { recursive: true })
let application
try {
  application = await _electron.launch({ args: [resolve('.')], env, timeout: 90000 })
  const page = await application.firstWindow({ timeout: 90000 })
  await page.context().setOffline(true)
  await page.getByRole('button', { name: '应用程序菜单', exact: true }).waitFor({ timeout: 90000 })
  const state = await page.evaluate(() => window.desktop.bootstrap())
  assert.equal(state.dataRoot, join(isolated, 'data'))
  assert.equal(state.models.length, 0)
  assert.equal(state.settings.appearance.theme, 'paper')
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setBounds({ width: 1440, height: 900 })
    window.center()
  })
  await page.getByRole('button', { name: '显示内容面板', exact: true }).click()
  await page.locator('.workspace-content').waitFor()
  await page.waitForFunction(() => document.querySelector('.workspace-content')?.getBoundingClientRect().width > 300)
  await page.waitForTimeout(700)
  const inspect = () => page.evaluate(() => {
    const color = selector => getComputedStyle(document.querySelector(selector)).backgroundColor
    const separators = [...document.querySelectorAll('.workspace-group > [data-separator]')].map(element => ({
      width: element.getBoundingClientRect().width,
      fill: getComputedStyle(element).backgroundColor,
      children: [...element.children].map(child => ({ width: child.getBoundingClientRect().width, fill: getComputedStyle(child).backgroundColor })),
    }))
    return { url: location.href, classes: document.documentElement.className, viewport: { width: innerWidth, height: innerHeight }, sidebar: color('.workspace-sidebar > div'), chat: color('.chatpane'), content: color('.content-tabs'), headerDivider: getComputedStyle(document.querySelector('.chatpane > .desktop-drag')).borderBottomColor, separators }
  })
  const before = await inspect()
  assert.equal(before.sidebar, 'rgb(239, 230, 207)')
  assert.equal(before.chat, 'rgb(240, 231, 209)')
  assert.equal(before.content, 'rgb(249, 244, 228)')
  assert.equal(before.separators.length, 2)
  assert.equal(before.separators[0].children.length, 0)
  await page.screenshot({ path: join(directory, 'before.png') })
  await page.addStyleTag({ content: '.paper .workspace-sidebar { --sidebar: #e9dec5; }' })
  await page.evaluate(() => {
    const separator = document.querySelector('.workspace-group > [data-separator]')
    const line = document.createElement('div')
    line.setAttribute('data-design-preview-line', '')
    line.style.cssText = 'height:100%;width:1px;background:var(--border);'
    separator.appendChild(line)
  })
  const proposed = await inspect()
  assert.equal(proposed.sidebar, 'rgb(233, 222, 197)')
  assert.equal(proposed.chat, before.chat)
  assert.equal(proposed.content, before.content)
  assert.equal(proposed.separators[0].children[0].fill, before.separators[1].children[0].fill)
  assert.equal(proposed.separators[0].children[0].fill, before.headerDivider)
  await page.screenshot({ path: join(directory, 'proposed.png') })
  const hashes = {}
  for (const path of ['src/app/globals.css', 'src/app/desktop.css', 'src/components/layout/DashboardShell.tsx']) hashes[path] = createHash('sha256').update(await readFile(path)).digest('hex')
  await writeFile(join(directory, 'preview-observations.json'), JSON.stringify({ scope: 'UI design preview only; existing Windows Electron React workbench, empty isolated root, temporary DOM/CSS override, renderer offline. Screenshots omit native caption controls. No product implementation or acceptance claim.', before, proposed, sourceHashes: hashes }, null, 2) + '\n')
  console.log(JSON.stringify({ scope: 'design-preview-only', before, proposed, output: directory }))
} finally {
  await application?.close()
}
