import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import { build } from "esbuild"
import ts from "typescript"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { chromium, type Browser, type Page } from "playwright-core"

// Execute the current, real header JSX without AI/recovery side effects. Full
// ChatPanel is separately checked in the native Electron acceptance harness.
const chatSource = ts.createSourceFile("ChatPanel.tsx", readFileSync("src/components/layout/ChatPanel.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let header = ""
function visit(node: ts.Node) {
  if (ts.isJsxElement(node)) {
    const attr = node.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(chatSource) === "className")
    if (attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isStringLiteral(attr.initializer) && /\bh-11\b/.test(attr.initializer.text)) header = node.getText(chatSource)
  }
  ts.forEachChild(node, visit)
}
visit(chatSource)
assert(header, "Actual ChatPanel header JSX missing")
const cssPath = resolve("src/app/globals.css")
const stylesheet = postcss([tailwindcss()]).process(readFileSync(cssPath, "utf8"), { from: cssPath }).then(result => result.css + "\n" + readFileSync("src/app/desktop.css", "utf8"))
const bundle = build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {PanelLeft,PanelRight,MessageSquare} from 'lucide-react';
import {ContentTabs} from './src/components/layout/ContentTabs';
import {SidebarWindowControls} from './src/components/desktop/WindowControls';
import {useTabsStore} from './src/stores/tabs'; import {useDesktopStore} from './src/stores/desktop';
window.mountPanes=(count=0)=>{
 const calls=[]; const messages=[{id:'fixture'}],currentConversation={title:'合成验收会话'};
 const desktopBootstrap={platform:'darwin',settings:{appearance:{zoom:1}}};
 const sidebarHidden=true,contentHidden=true,onShowSidebar=()=>calls.push('sidebar'),onShowContent=()=>calls.push('content');
 useDesktopStore.setState({bootstrap:{platform:'darwin'}});
 const tabs=Array.from({length:count},(_,i)=>({id:'tab-'+i,title:'验收面板 '+i,type:'theme',novelId:'isolated'}));
 useTabsStore.setState({tabs,activeTabId:tabs[0]?.id??null});
 const query=new QueryClient({defaultOptions:{queries:{retry:false}}});query.setQueryData(['novels'],[]);
 const root=createRoot(document.getElementById('app'));
 flushSync(()=>root.render(<QueryClientProvider client={query}><div style={{display:'flex',height:500}}>
 <div style={{width:230}}><SidebarWindowControls onToggleSidebar={()=>calls.push('toggle-sidebar')}/></div>
 <div id='chat' style={{width:300}}>${header}<div data-body>正文</div><div contentEditable suppressContentEditableWarning>输入</div></div>
 <div id='content' style={{width:440}}><ContentTabs fullscreen={false} onToggleFullscreen={()=>calls.push('fullscreen')} onToggleContent={()=>calls.push('hide-content')}/></div>
 </div></QueryClientProvider>));
 return {calls,state:()=>useTabsStore.getState(),unmount:()=>root.unmount()};
};` }, bundle: true, platform: "browser", format: "iife", write: false, tsconfig: "tsconfig.json", plugins: [{ name: "unrelated-panel-content", setup(api) {
  api.onResolve({ filter: /^@\/components\/content\/(registry|StagedSaveSurface|StoryWorkflowPanel)$/ }, args => ({ path: args.path, namespace: "panel-fixture" }))
  api.onLoad({ filter: /.*/, namespace: "panel-fixture" }, () => ({ loader: "tsx", resolveDir: process.cwd(), contents: `import React from 'react'; export const renderTabContent=tab=><p data-panel-body>{tab.title}</p>; export const StagedSaveSurface=({children})=>children; export const StagedInterceptionBootstrap=()=>null; export const StorySources=()=>null; export const StoryActivityBanner=()=>null; export const StoryLivePreview=()=>null;` }))
} }] }).then(result => result.outputFiles![0].text)

let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.XAANINK_TEST_CHROMIUM ? { executablePath: process.env.XAANINK_TEST_CHROMIUM } : {}) }) })
test.after(async () => { await browser?.close() })
async function scenario(count: number, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 600 } }), errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    await page.route("**/*", route => route.abort())
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ content: await stylesheet }); await page.addScriptTag({ content: await bundle })
    await page.evaluate(count => { (window as any).fixture = (window as any).mountPanes(count) }, count)
    await run(page); assert.deepEqual(errors, [])
  } finally { await page.close() }
}
async function region(page: Page, selector: string) { return page.locator(selector).evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region")) }
// A no-drag ancestor excludes all descendants' hit rectangles even if their
// own non-inherited app-region computed value is 'none'.
async function excluded(page: Page, selector: string) { return page.locator(selector).evaluate(el => { for (let node: Element | null = el; node; node = node.parentElement) { const value = getComputedStyle(node).getPropertyValue("-webkit-app-region"); if (value === "no-drag") return true; if (value === "drag") return false } return true }) }

test("DRAG-01 empty right pane and actual AI title align with sidebar and only top rows drag", () => scenario(0, async page => {
  assert.equal(await region(page, "#chat > div:first-child"), "drag")
  assert.equal(await region(page, ".content-tabs > div:first-child"), "drag")
  const rects = await page.locator(".desktop-sidebar-controls,#chat > div:first-child,.content-tabs > div:first-child").evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { y: r.y, height: r.height } }))
  assert.equal(rects.length, 3); assert(rects.every(r => r.y === rects[0].y && r.height === 44))
  assert.equal(await region(page, ".content-tabs"), "none")
  assert.equal(await region(page, "[data-body]"), "none")
  assert.equal(await region(page, "[contenteditable]"), "no-drag")
  assert.equal(await region(page, ".content-tabs > div:last-child"), "none")
  for (const button of await page.locator("#chat button").all()) assert.equal(await button.evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region")), "no-drag")
  await page.getByRole("button", { name: "显示左侧导航栏", exact: true }).click(); await page.getByRole("button", { name: "显示内容面板", exact: true }).click()
  assert.deepEqual(await page.evaluate(() => (window as any).fixture.calls), ["sidebar", "content"])
}))

test("DRAG-02 tab rail blank space drags; tabs, icons, labels and pane controls remain interactive", () => scenario(3, async page => {
  assert.equal(await region(page, '[role="tablist"]'), "drag")
  for (const tab of await page.getByRole("tab").all()) assert.equal(await tab.evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region")), "no-drag")
  assert(await excluded(page, '[role="tab"]:first-child span'))
  assert(await excluded(page, '[role="tab"]:first-child > svg'))
  for (const button of await page.locator('[role="tablist"] button').all()) assert.equal(await button.evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region")), "no-drag")
  await page.getByRole("tab", { name: "验收面板 1", exact: true }).click()
  assert.equal(await page.getByRole("tab", { name: "验收面板 1", exact: true }).getAttribute("aria-selected"), "true")
  await page.getByRole("tab", { name: "验收面板 2", exact: true }).press("Enter")
  assert.equal(await page.getByRole("tab", { name: "验收面板 2", exact: true }).getAttribute("aria-selected"), "true")
  await page.getByRole("button", { name: "关闭 验收面板 0", exact: true }).click()
  assert.equal(await page.getByRole("tab", { name: "验收面板 2", exact: true }).getAttribute("aria-selected"), "true")
  await page.getByRole("tab", { name: "验收面板 1", exact: true }).click({ button: "middle" })
  assert.equal(await page.getByRole("tab").count(), 1)
  await page.getByRole("button", { name: "进入全屏", exact: true }).click()
  await page.getByRole("button", { name: "显示 / 隐藏内容面板", exact: true }).click()
  assert.deepEqual(await page.evaluate(() => (window as any).fixture.calls), ["fullscreen", "hide-content"])
  assert.equal(await region(page, "[data-panel-body]"), "none")
  await page.getByRole("button", { name: "关闭 验收面板 2", exact: true }).click()
  assert.equal(await page.getByRole("tablist").count(), 0)
  assert.equal(await region(page, ".content-tabs > div:first-child"), "drag")
}))

test("DRAG-03 overflowing tabs preserve scroll and active tab reveal", () => scenario(14, async page => {
  const scroller = page.locator('[role="tablist"] > div:first-child')
  assert(await scroller.evaluate(el => el.scrollWidth > el.clientWidth))
  await page.evaluate(() => (window as any).fixture.state().activateTab("tab-13"))
  await page.waitForFunction(() => { const tab = document.querySelector('[role="tab"][aria-selected="true"]')!, parent = tab.parentElement!, r = tab.getBoundingClientRect(), p = parent.getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1 })
  assert.equal(await region(page, '[role="tablist"]'), "drag")
  assert.equal(await region(page, ".content-tabs > div:last-child"), "none")
}))
