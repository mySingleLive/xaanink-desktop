import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync,readdirSync } from "node:fs"
import { build } from "esbuild"
import { chromium, type Browser, type Page } from "playwright-core"

// Mount the current original shell and current RecoveryDialog, actual React,
// Base UI and installed react-resizable-panels. Business children, command
// dispatch, notifications and clipboard/export IPC are controlled substitutes.
const css = readdirSync(".next/static/chunks").filter(file=>file.endsWith(".css")).sort().map(file=>readFileSync(".next/static/chunks/"+file,"utf8")).join("\n")
const mocks: Record<string, string> = {
  ChatPanel: `import React from 'react';export function ChatPanel(p){return React.createElement('div',{'data-business':'chat'},React.createElement('button',{onClick:p.onShowContent},'打开内容'),React.createElement('button',{onClick:p.onShowSidebar},'打开侧栏'))}`,
  SidebarTree: `import React from 'react';export function SidebarTree(p){return React.createElement('button',{onClick:p.onToggleSidebar},'收起侧栏')}`,
  ContentTabs: `import React from 'react';export function ContentTabs(p){return React.createElement('div',{'data-business':'content'},React.createElement('button',{onClick:p.onToggleFullscreen},'切换内容全屏'),React.createElement('button',{onClick:p.onToggleContent},'收起内容'))}`,
  commands: `export function useDesktopCommands(commands){globalThis.shellCommands=commands}`,
  sonner: `export const toast={info:x=>globalThis.notifications.push(x),success:x=>globalThis.notifications.push(x),error:x=>globalThis.notifications.push(x)}`,
}
const bundle = build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {DashboardShell} from './src/components/layout/DashboardShell';
import {RecoveryDialog} from './src/components/desktop/RecoveryDialog';
import {desktopWorkspaceDraftSource} from './src/lib/desktop/workspace-draft-source';
import {desktopRecoveryStore} from './src/lib/desktop/draft-recovery';
import {desktopSaveCoordinator} from './src/lib/desktop/save-coordinator';
import {useDesktopStore} from './src/stores/desktop';
globalThis.notifications=[];window.desktop={};
globalThis.mountShell=(layout)=>{
 const tab={id:'theme:n1',type:'theme',novelId:'n1',title:'原内容'};
 desktopWorkspaceDraftSource.restore({version:1,tabs:layout.contentVisible?[tab]:[],activeTabId:layout.contentVisible?tab.id:null,subTabs:{},layout});
 let root=createRoot(document.getElementById('app'));
 const render=()=>flushSync(()=>root.render(React.createElement(DashboardShell,{user:{id:'local-author',name:'作者',email:''}})));
 render();return{read:()=>desktopWorkspaceDraftSource.read(),unmount:()=>flushSync(()=>root.unmount()),remount:()=>{root=createRoot(document.getElementById('app'));render()}};
};
globalThis.mountRecovery=()=>{
 desktopRecoveryStore.retain([{id:'one',source:'chat',path:'draft',reason:'CURRENT_DRAFT_CONFLICT',createdAt:'2026-10-08T00:00:00Z',value:'原稿 <script>danger()</script>'},{id:'two',source:'autosaves',path:'failed',reason:'AUTOSAVE_UNMATCHED',createdAt:'2026-10-08T00:00:00Z',value:{draft:'第二份保留稿',operationId:'must-not-replay'}}]);
 const release=desktopSaveCoordinator.registerSource('recovery',desktopRecoveryStore),exports=[],copies=[];
 let finish,reject;window.desktop={writeClipboardText:async text=>{copies.push(text)},exportDraft:async(id,snapshot)=>{exports.push({id,snapshot});return new Promise((yes,no)=>{finish=yes;reject=no})}};
 useDesktopStore.setState({bootstrap:{draftSessionId:'00000000-0000-4000-8000-000000000001'}});
 function App(){const[open,setOpen]=React.useState(true);return React.createElement(RecoveryDialog,{open,onOpenChange:setOpen})}
 const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(React.createElement(App)));
 return{exports,copies,finish:()=>finish(true),reject:()=>reject(Error('private-path-do-not-render')),read:()=>desktopRecoveryStore.read(),dispose:()=>{flushSync(()=>root.unmount());release()}};
};` }, bundle: true, platform: "browser", format: "iife", write: false, tsconfig: "tsconfig.json", plugins: [{ name: "controlled-business-children", setup(build) {
  build.onResolve({ filter: /^(\.\/(ChatPanel|ContentTabs|SidebarTree)|@\/lib\/desktop\/use-command-target|sonner)$/ }, args => {
    const name = args.path === "sonner" ? "sonner" : args.path.endsWith("use-command-target") ? "commands" : args.path.slice(2)
    return { path: name, namespace: "controlled" }
  })
  build.onLoad({ filter: /.*/, namespace: "controlled" }, args => ({ contents: mocks[args.path], loader: "js", resolveDir: process.cwd() }))
} }] }).then(result => result.outputFiles![0].text)

let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.XAANINK_TEST_CHROMIUM ? { executablePath: process.env.XAANINK_TEST_CHROMIUM } : {}) }) })
test.after(async () => { await browser?.close() })
const layout = { version: 1, narrowPane: "content", contentVisible: true, sidebarVisible: true, chatVisible: true, sizes: { sidebar: 20, chat: 35, content: 45 }, lastContentSize: 45, lastSidebarSize: 20, lastChatSize: 35 }
async function scenario(width: number, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width, height: 800 } })
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    await page.route("**/*", route => route.request().isNavigationRequest() ? route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }) : route.abort())
    await page.goto("http://127.0.0.1:1/recovery-isolated")
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: await bundle })
    await run(page); assert.deepEqual(errors, [])
  } finally { await page.close() }
}
async function settled(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }
async function paneWidths(page: Page) { return page.evaluate(() => Object.fromEntries(["sidebar", "chat", "content"].map(name => { const inner = document.querySelector(`.workspace-${name}`); return [name, inner?.parentElement?.getBoundingClientRect().width ?? 0] }))) }

test("REC56-L01: current DashboardShell and actual Group restore three pane widths and preserve them across unmount/remount", async () => scenario(1440, async page => {
  await page.evaluate(layout => { (window as any).f = (window as any).mountShell(layout) }, layout); await settled(page)
  const first = await paneWidths(page)
  for (const [name, percent] of Object.entries(layout.sizes)) assert.ok(Math.abs(first[name] / 1440 * 100 - percent) < 1, `${name} actual width follows the restored percentage`)
  const detached = await page.evaluate(() => { const f = (window as any).f, before = f.read().layout; f.unmount(); return { before, after: f.read().layout } })
  assert.deepEqual(detached.after.sizes, detached.before.sizes, "unmounted original Group must not replace its last visible pane widths with an empty map")
  await page.evaluate(() => (window as any).f.remount()); await settled(page)
  const second = await paneWidths(page)
  for (const name of Object.keys(first)) assert.ok(Math.abs(first[name] - second[name]) < 2, JSON.stringify({ name, first, second, detached }))
  const saved = await page.evaluate(() => (window as any).f.read().layout)
  assert.equal(saved.contentVisible, true); assert.equal(saved.narrowPane, "content")
}))

test("REC56-L02: restored fullscreen and original sidebar/content toggle callbacks settle to matching visible panes and stored sizes", async () => scenario(1440, async page => {
  const hidden = { ...layout, sidebarVisible: false, chatVisible: false, sizes: { sidebar: 0, chat: 0, content: 100 } }
  await page.evaluate(layout => { (window as any).f = (window as any).mountShell(layout) }, hidden); await settled(page)
  let widths = await paneWidths(page); assert.ok(widths.sidebar < 2 && widths.chat < 2); assert.ok(widths.content > 1430)
  await page.getByRole("button", { name: "切换内容全屏" }).click(); await page.waitForTimeout(650)
  const saved = await page.evaluate(() => (window as any).f.read().layout); widths = await paneWidths(page)
  assert.equal(saved.chatVisible, true); assert.equal(saved.sidebarVisible, false); assert.ok(widths.chat > 410); assert.ok(widths.content > 420)
  await page.getByRole("button", { name: "收起内容" }).click(); await page.waitForTimeout(550)
  const closed = await page.evaluate(() => (window as any).f.read().layout)
  assert.equal(closed.contentVisible, false); assert.equal(closed.chatVisible, true); assert.equal(closed.sizes.content, undefined)
  const detached = await page.evaluate(() => { const f = (window as any).f; f.unmount(); return f.read().layout })
  await page.evaluate(() => (window as any).f.remount()); await settled(page)
  assert.equal(await page.locator(".workspace-content").count(), 0); assert.ok((await paneWidths(page)).chat > 1430, JSON.stringify({ detached, actual: await paneWidths(page) }))
}))

test("REC56-L03: a restored narrow content pane uses original narrow controls while retaining the chat instance", async () => scenario(640, async page => {
  await page.evaluate(layout => { (window as any).f = (window as any).mountShell(layout) }, layout); await settled(page)
  assert.equal(await page.locator("[data-business=chat]").count(), 1); assert.equal(await page.locator("[data-business=content]").count(), 1)
  assert.ok((await paneWidths(page)).content > 630)
  await page.getByRole("button", { name: "返回对话" }).click(); await settled(page)
  assert.ok((await paneWidths(page)).chat > 630); assert.equal(await page.locator("[data-business=content]").count(), 1)
  const saved = await page.evaluate(() => (window as any).f.read().layout); assert.equal(saved.narrowPane, "chat"); assert.equal(saved.contentVisible, true)
}))

test("REC56-R01: current RecoveryDialog selects and copies readable retained prose, exports an inert snapshot, and preserves it on failure", async () => scenario(640, async page => {
  await page.evaluate(() => { (window as any).r = (window as any).mountRecovery() })
  const content = page.getByRole("textbox", { name: "保留的草稿内容" })
  await assert.equal(await content.inputValue(), "原稿 <script>danger()</script>")
  await page.getByRole("button", { name: /编辑草稿 2/ }).click(); assert.doesNotMatch(await content.inputValue(), /must-not-replay/)
  await page.getByRole("button", { name: "复制内容" }).click()
  const copy = await page.evaluate(() => (window as any).r.copies); assert.match(copy[0], /第二份保留稿/)
  await page.getByRole("button", { name: "导出草稿" }).click(); await page.getByRole("button", { name: "正在导出…" }).waitFor()
  assert.equal(await page.getByRole("button", { name: "正在导出…" }).isDisabled(), true)
  const sent = await page.evaluate(() => (window as any).r.exports); assert.equal(sent.length, 1); assert.equal(sent[0].id, "00000000-0000-4000-8000-000000000001"); assert.match(JSON.stringify(sent[0].snapshot), /must-not-replay/)
  await page.evaluate(() => (window as any).r.reject()); await page.getByRole("button", { name: "导出草稿" }).waitFor()
  const retained = await page.evaluate(() => (window as any).r.read()); assert.equal(retained.items.length, 2); assert.match(JSON.stringify(retained), /原稿/)
  assert.equal(await page.getByRole("button", { name: "导出草稿" }).isDisabled(), false)
  assert.deepEqual(await page.evaluate(() => (window as any).notifications), ["已复制草稿", "导出失败，原草稿仍保留在本机"])
  const rect = await page.getByRole("dialog").boundingBox(); assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= 641)
  await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" })
  await page.evaluate(() => (window as any).r.dispose())
}))
