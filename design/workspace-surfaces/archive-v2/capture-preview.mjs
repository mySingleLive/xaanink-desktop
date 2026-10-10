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
      rect: element.getBoundingClientRect().toJSON(),
      fill: getComputedStyle(element).backgroundColor,
      children: [...element.children].map(child => ({ width: child.getBoundingClientRect().width, fill: getComputedStyle(child).backgroundColor })),
    }))
    return { url: location.href, classes: document.documentElement.className, viewport: { width: innerWidth, height: innerHeight }, sidebar: color('.workspace-sidebar > div'), chat: color('.chatpane'), chatSurface: getComputedStyle(document.querySelector('.chatpane')).getPropertyValue('--chat-surface').trim(), content: color('.content-tabs'), headerDivider: getComputedStyle(document.querySelector('.chatpane > .desktop-drag')).borderBottomColor, panels: ['sidebar','chat','content'].map(id => ({id, rect:document.querySelector('.workspace-'+id).getBoundingClientRect().toJSON()})), separators }
  })
  const before = await inspect()
  assert.equal(before.sidebar, 'rgb(239, 230, 207)')
  assert.equal(before.chat, 'rgb(240, 231, 209)')
  assert.equal(before.content, 'rgb(249, 244, 228)')
  assert.equal(before.separators.length, 2)
  assert.equal(before.separators[0].children.length, 0)
  await page.screenshot({ path: join(directory, 'before.png') })
  await page.addStyleTag({ content: `
    .paper .dashboard-shell { --workspace-divider: #b8a783; }
    .paper .workspace-chat .chatpane { --chat-bg: #f9f4e4; --chat-surface: #fcf8ee; --chat-overlay: #fefcf4; }
    .paper .workspace-content { --workspace-content-bg: #efe6cf; --editor-bg: var(--workspace-content-bg); }
    .paper .workspace-content .scpane { --chat-bg: var(--workspace-content-bg); }
    .paper .workspace-content .monaco-editor { --vscode-editor-background: var(--workspace-content-bg); --vscode-editorGutter-background: var(--workspace-content-bg); }
    .paper .workspace-group > [data-separator] { width:1px!important; min-width:1px!important; max-width:1px!important; flex:0 0 1px!important; background:var(--workspace-divider)!important; }
    .paper .workspace-group > [data-separator] > * { display:none!important; }
    .paper .workspace-chat .chatpane > .desktop-drag,
    .paper .workspace-sidebar > div > .border-t,
    .paper .workspace-content .content-tabs > [role=tablist],
    .paper .dashboard-shell > nav { border-color:var(--workspace-divider); }
  ` })
  await page.evaluate(() => {
    // The separator itself paints the line; no inset child or light gutter.
    for (const separator of document.querySelectorAll('.workspace-group > [data-separator]')) separator.replaceChildren()
  })
  await page.waitForTimeout(300)
  const proposed = await inspect()
  assert.equal(proposed.sidebar, 'rgb(239, 230, 207)')
  assert.equal(proposed.chat, 'rgb(249, 244, 228)')
  assert.equal(proposed.chatSurface, '#fcf8ee')
  assert.equal(proposed.content, proposed.sidebar)
  for (let index=0;index<2;index++) {
    const separator=proposed.separators[index]
    assert.equal(separator.width, 1)
    assert.equal(separator.children.length, 0)
    assert.equal(separator.fill, 'rgb(184, 167, 131)')
    assert.equal(separator.fill, proposed.headerDivider)
    assert(Math.abs(proposed.panels[index].rect.right-separator.rect.left)<0.01)
    assert(Math.abs(separator.rect.right-proposed.panels[index+1].rect.left)<0.01)
  }
  await page.screenshot({ path: join(directory, 'proposed-v2.png') })
  const hashes = {}
  for (const path of ['src/app/globals.css', 'src/app/desktop.css', 'src/components/layout/DashboardShell.tsx']) hashes[path] = createHash('sha256').update(await readFile(path)).digest('hex')
  const screenshotHashes={}
  for(const file of ['before.png','proposed-v2.png']) screenshotHashes[file]=createHash('sha256').update(await readFile(join(directory,file))).digest('hex')
  await writeFile(join(directory, 'preview-observations.json'), JSON.stringify({ revision:'v2', scope: 'UI design preview only; existing Windows Electron React workbench, empty isolated root, temporary DOM/CSS override, renderer offline. Screenshots omit native caption controls. Right planning/Monaco bodies and pointer-hit behavior not validated by this empty-state preview. No product implementation or acceptance claim.', before, proposed, sourceHashes: hashes, screenshotHashes }, null, 2) + '\n')
  console.log(JSON.stringify({ scope: 'design-preview-only', before, proposed, output: directory }))
} finally {
  await application?.close()
}
