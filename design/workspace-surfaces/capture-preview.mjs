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
  const runtime = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setBounds({ width: 1440, height: 900 })
    window.center()
    return { zoom: window.webContents.getZoomFactor(), electron: process.versions.electron }
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
      strokeWidth: getComputedStyle(element).borderLeftWidth,
      strokeColor: getComputedStyle(element).borderLeftColor,
      children: [...element.children].map(child => ({ width: child.getBoundingClientRect().width, fill: getComputedStyle(child).backgroundColor })),
    }))
    const horizontalDividers = [
      ['.workspace-chat .chatpane > .desktop-drag','bottom'],
      ['.workspace-sidebar > div > .border-t','top'],
      ['.workspace-content .content-tabs > [role=tablist]','bottom'],
      ['.dashboard-shell > nav','bottom'],
    ].flatMap(([selector,edge]) => {
      const element=document.querySelector(selector)
      if(!element||!element.getBoundingClientRect().width||!element.getBoundingClientRect().height)return []
      const style=getComputedStyle(element)
      return [{selector, edge, width:edge==='top'?style.borderTopWidth:style.borderBottomWidth, color:edge==='top'?style.borderTopColor:style.borderBottomColor}]
    })
    return { url: location.href, classes: document.documentElement.className, dpr:devicePixelRatio, viewport: { width: innerWidth, height: innerHeight }, sidebar: color('.workspace-sidebar > div'), chat: color('.chatpane'), chatSurface: getComputedStyle(document.querySelector('.chatpane')).getPropertyValue('--chat-surface').trim(), content: color('.content-tabs'), headerDivider: getComputedStyle(document.querySelector('.chatpane > .desktop-drag')).borderBottomColor, panels: ['sidebar','chat','content'].map(id => ({id, rect:document.querySelector('.workspace-'+id).getBoundingClientRect().toJSON()})), horizontalDividers, separators }
  })
  const before = await inspect()
  assert.equal(before.sidebar, 'rgb(239, 230, 207)')
  assert.equal(before.chat, 'rgb(240, 231, 209)')
  assert.equal(before.content, 'rgb(249, 244, 228)')
  assert.equal(before.separators.length, 2)
  assert.equal(before.separators[0].children.length, 0)
  await page.screenshot({ path: join(directory, 'before.png') })
  await page.addStyleTag({ content: `
    .paper .dashboard-shell { --workspace-divider: var(--border); --workspace-line-width: 1px; }
    .paper .workspace-sidebar { --sidebar: #f5eedc; }
    .paper .workspace-chat .chatpane { --chat-bg: #faf6e8; --chat-surface: #fcf8ee; --chat-overlay: #fefcf4; }
    .paper .workspace-content { --workspace-content-bg: #f8f3e4; --editor-bg: var(--workspace-content-bg); --sidebar: var(--workspace-content-bg); }
    .paper .workspace-content .scpane { --chat-bg: var(--workspace-content-bg); }
    .paper .workspace-content .monaco-editor { --vscode-editor-background: var(--workspace-content-bg); --vscode-editorGutter-background: var(--workspace-content-bg); }
    .paper .workspace-group > [data-separator] { width:0!important; min-width:0!important; max-width:none!important; flex:0 0 auto!important; box-sizing:content-box!important; background:none!important; border:0!important; border-left:var(--workspace-line-width) solid var(--workspace-divider)!important; }
    .paper .workspace-group > [data-separator] > * { display:none!important; }
    .paper .workspace-chat .chatpane > .desktop-drag,
    .paper .workspace-sidebar > div > .border-t,
    .paper .workspace-content .content-tabs > [role=tablist],
    .paper .dashboard-shell > nav { border-color:var(--workspace-divider); }
    .paper .workspace-chat .chatpane > .desktop-drag,
    .paper .workspace-content .content-tabs > [role=tablist],
    .paper .dashboard-shell > nav { border-bottom-width:var(--workspace-line-width); }
    .paper .workspace-sidebar > div > .border-t { border-top-width:var(--workspace-line-width); }
    .paper .workspace-content .content-tabs [role=tab] { border-top-width:var(--workspace-line-width); }
    .paper :is([data-slot=dropdown-menu-separator],[data-slot=select-separator],[data-slot=separator]:not([data-vertical])) { height:0!important; min-height:0!important; box-sizing:content-box!important; background:none!important; border:0!important; border-top:1px solid var(--border)!important; }
    .paper [data-slot=separator][data-vertical] { width:0!important; min-width:0!important; box-sizing:content-box!important; background:none!important; border:0!important; border-left:1px solid var(--border)!important; }
    .paper .markdown-body hr { height:0; background:none; border-top:1px solid var(--border); }
  ` })
  await page.evaluate(() => {
    // Same border stroke as other UI dividers; no filled gutter or inset child.
    for (const separator of document.querySelectorAll('.workspace-group > [data-separator]')) separator.replaceChildren()
  })
  await page.waitForTimeout(300)
  const proposed = await inspect()
  assert.equal(proposed.sidebar, 'rgb(245, 238, 220)')
  assert.equal(proposed.chat, 'rgb(250, 246, 232)')
  assert.equal(proposed.chatSurface, '#fcf8ee')
  assert.equal(proposed.content, 'rgb(248, 243, 228)')
  for (let index=0;index<2;index++) {
    const separator=proposed.separators[index]
    const usedWidth=parseFloat(proposed.horizontalDividers[0].width)
    assert(Math.abs(separator.width-usedWidth)<0.01)
    assert.equal(separator.children.length, 0)
    assert.equal(separator.fill, 'rgba(0, 0, 0, 0)')
    assert.equal(separator.strokeWidth, proposed.horizontalDividers[0].width)
    assert.equal(separator.strokeColor, 'rgb(216, 203, 166)')
    assert.equal(separator.strokeColor, proposed.headerDivider)
    assert(Math.abs(proposed.panels[index].rect.right-separator.rect.left)<0.01)
    assert(Math.abs(separator.rect.right-proposed.panels[index+1].rect.left)<0.01)
  }
  for(const divider of proposed.horizontalDividers) {
    assert.equal(divider.width,proposed.separators[0].strokeWidth)
    assert.equal(divider.color,proposed.headerDivider)
  }
  await page.screenshot({ path: join(directory, 'proposed-v3.png') })
  const hashes = {}
  for (const path of ['src/app/globals.css', 'src/app/desktop.css', 'src/components/layout/DashboardShell.tsx']) hashes[path] = createHash('sha256').update(await readFile(path)).digest('hex')
  const screenshotHashes={}
  for(const file of ['before.png','proposed-v3.png']) screenshotHashes[file]=createHash('sha256').update(await readFile(join(directory,file))).digest('hex')
  await writeFile(join(directory, 'preview-observations.json'), JSON.stringify({ revision:'v3', proposedDividerDeclaration:'1px border, zero content width, border-only occupancy', runtime, scope: 'UI design preview only; existing Windows Electron React workbench, empty isolated root, temporary DOM/CSS override, renderer offline. Screenshots omit native caption controls. Only visible layout divider strokes are measured. Menu/tablist/business/Markdown dividers, other zooms, right planning/Monaco bodies and pointer-hit behavior not validated by this empty-state preview. No product implementation or acceptance claim.', before, proposed, sourceHashes: hashes, screenshotHashes }, null, 2) + '\n')
  console.log(JSON.stringify({ scope: 'design-preview-only', before, proposed, output: directory }))
} finally {
  await application?.close()
}
