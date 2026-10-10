import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import { build } from "esbuild"
import ts from "typescript"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { chromium, type Browser, type Page } from "playwright-core"

// Real header JSX, controls, ContentTabs and Group/Shell. Only unrelated
// business bodies, AI/recovery effects and command registration are omitted.
const source = ts.createSourceFile("ChatPanel.tsx", readFileSync("src/components/layout/ChatPanel.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let header = ""
function visit(node: ts.Node) {
  if (ts.isJsxElement(node)) {
    const attr = node.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === "className")
    if (attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isStringLiteral(attr.initializer) && /\bdesktop-drag\b/.test(attr.initializer.text) && /\bh-11\b/.test(attr.initializer.text)) header = node.getText(source)
  }
  ts.forEachChild(node, visit)
}
visit(source); assert(header)
// Keep the real caption a direct child of chatpane, as in ChatPanel. A
// display:contents wrapper changes app-region scope despite identical geometry.
assert(header.startsWith('<div ')); header = header.replace(/^<div /, '<div id="chat-header" ')
const cssPath = resolve("src/app/globals.css")
const stylesheet = postcss([tailwindcss()]).process(readFileSync(cssPath, "utf8"), { from: cssPath }).then(r => r.css + "\n" + readFileSync("src/app/desktop.css", "utf8"))
const chat = `import React from 'react';import {PanelLeft,PanelRight,MessageSquare} from 'lucide-react';import {useDesktopStore} from './src/stores/desktop';
export function ChatPanel({sidebarHidden=true,contentHidden=true,onShowSidebar,onShowContent}) {
 const desktopBootstrap=useDesktopStore(s=>s.bootstrap),messages=[{id:'isolated'}],currentConversation={title:'隔离会话'};
 return <div className='chatpane flex h-full flex-col'>${header}<div data-chat-body>正文夹具</div></div>;
}`
const sidebar = `import React from 'react';import {SidebarWindowControls} from './src/components/desktop/WindowControls';
export function SidebarTree({onToggleSidebar}){return <><SidebarWindowControls onToggleSidebar={onToggleSidebar}/><div data-sidebar-body>目录夹具</div></>}`
const bundle = build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {DashboardShell} from './src/components/layout/DashboardShell';
import {ContentTabs} from './src/components/layout/ContentTabs';
import {SidebarWindowControls,WindowsMenuControl} from './src/components/desktop/WindowControls';
import {ChatPanel} from 'caption-chat';import {useDesktopStore} from './src/stores/desktop';import {useTabsStore} from './src/stores/tabs';
import {desktopWorkspaceDraftSource} from './src/lib/desktop/workspace-draft-source';
import {mountDesktopNavigation} from './src/lib/desktop/navigation-runtime';
window.mountCaption=({platform,zoom,font,count,shell})=>{
 const calls=[];window.desktop={command:id=>{calls.push(id);return Promise.resolve()}};
 document.body.dataset.platform=platform??'web';document.documentElement.style.fontSize=(16*font/14)+'px';document.documentElement.style.setProperty('--desktop-caption-zoom',String(zoom));
 useDesktopStore.setState({bootstrap:platform?{platform,settings:{appearance:{zoom}}}:null});
 const snapshot={canBack:true,canForward:true,pending:false};mountDesktopNavigation({getSnapshot:()=>snapshot,subscribe:()=>()=>{},dispose(){}});
 window.addEventListener('desktop:navigate',e=>calls.push(e.detail));
 const tabs=Array.from({length:count},(_,i)=>({id:'theme:n'+i,type:'theme',novelId:'n'+i,title:'隔离面板 '+i}));
 const layout={version:1,narrowPane:'content',contentVisible:true,sidebarVisible:true,chatVisible:true,sizes:{sidebar:20,chat:35,content:45},lastContentSize:45,lastSidebarSize:20,lastChatSize:35};
 desktopWorkspaceDraftSource.restore({version:1,tabs,activeTabId:tabs[0]?.id??null,subTabs:{},layout:shell?layout:null});
 const query=new QueryClient({defaultOptions:{queries:{retry:false}}});query.setQueryData(['novels'],{novels:[],unavailableWorks:[]});
 const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(<QueryClientProvider client={query}>
 {shell?<DashboardShell user={{id:'isolated-author',name:'隔离作者',email:''}}/>:
 <div style={{display:'flex',height:500}}><div style={{width:'20%'}}><SidebarWindowControls onToggleSidebar={()=>calls.push('sidebar')}/></div>
 <div style={{width:'35%'}}><ChatPanel onShowSidebar={()=>calls.push('restore-sidebar')} onShowContent={()=>calls.push('restore-content')}/></div>
 <div style={{width:'45%'}}><ContentTabs fullscreen={false} onToggleFullscreen={()=>calls.push('fullscreen')} onToggleContent={()=>calls.push('hide-content')}/></div></div>}
 <WindowsMenuControl/></QueryClientProvider>));window.captionFixture={calls,state:()=>useTabsStore.getState()};
};` }, bundle: true, platform: "browser", format: "iife", write: false, tsconfig: "tsconfig.json", plugins: [{ name: "caption-business-boundaries", setup(api) {
  api.onResolve({ filter: /^(caption-chat|\.\/(ChatPanel|SidebarTree)|@\/lib\/desktop\/use-command-target|@\/components\/content\/(registry|StagedSaveSurface|StoryWorkflowPanel))$/ }, args => ({ path: args.path, namespace: "caption-fixture" }))
  api.onLoad({ filter: /.*/, namespace: "caption-fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "caption-chat" || args.path === "./ChatPanel" ? chat : args.path === "./SidebarTree" ? sidebar : args.path.endsWith("use-command-target") ? "export function useDesktopCommands(){}" : `import React from 'react';export const renderTabContent=tab=><p data-panel-body>{tab.title}</p>;export const StagedSaveSurface=({children})=>children;export const StagedInterceptionBootstrap=()=>null;export const StorySources=()=>null;export const StoryActivityBanner=()=>null;export const StoryLivePreview=()=>null;` }))
} }] }).then(r => r.outputFiles![0].text)
let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.XAANINK_TEST_CHROMIUM ? { executablePath: process.env.XAANINK_TEST_CHROMIUM } : {}) }) })
test.after(async () => { await browser?.close() })
async function scenario(platform: "win32" | "darwin" | null, zoom: number, font: number, count: number, shell: boolean, width: number, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: Math.round(width / zoom), height: 800 } }), errors: string[] = []
  page.on("pageerror", e => errors.push(e.message))
  try {
    await page.route("**/*", r => r.abort()); await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ content: await stylesheet }); await page.addScriptTag({ content: await bundle })
    await page.evaluate(args => (window as any).mountCaption(args), { platform, zoom, font, count, shell })
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
    await run(page); assert.deepEqual(errors, [])
  } finally { await page.close() }
}
async function aligned(page: Page, zoom: number, selector: string) {
  const result = await page.locator(selector).evaluateAll(els => els.filter(el => el.getBoundingClientRect().width > 0).map(el => {
    const r = el.getBoundingClientRect(), tab = el.closest('[role="tab"]'), button = el.closest('button')
    const expectedSize = el.tagName.toLowerCase() === 'svg' ? (tab ? button ? 12 : 14 : 16) : tab ? 15 : el.closest('.content-tabs') ? 24 : 28
    return { label: el.getAttribute("aria-label") ?? el.tagName, top: r.top, center: r.top + r.height / 2, width: r.width, height: r.height, expectedSize, expectedCenter: tab ? 22 : 16 }
  }))
  assert(result.length > 0, "Expected visible real controls")
  for (const r of result) {
    assert(r.top >= -.01, `Control clips above window: ${JSON.stringify(r)}`)
    assert(Math.abs(r.center * zoom - r.expectedCenter) <= .6, `Caption center mismatch: ${JSON.stringify({ ...r, zoom, dipCenter: r.center * zoom })}`)
    assert(Math.abs(r.width * zoom - r.expectedSize) < .1 && Math.abs(r.height * zoom - r.expectedSize) < .1, `Caption size changed: ${JSON.stringify({ ...r, zoom })}`)
    assert(Math.abs(r.top * zoom - (r.expectedCenter - r.expectedSize / 2)) <= .6, `Caption position changed: ${JSON.stringify({ ...r, zoom })}`)
  }
  return result.length
}
const controls = ".desktop-sidebar-controls button,.desktop-sidebar-controls svg,#chat-header button,#chat-header svg,.content-tabs > .desktop-drag button,.content-tabs > .desktop-drag svg,[data-desktop-menu-button],[data-desktop-menu-button] svg"
test("ALIGN-01 HEIGHT-01 real Windows headers share 44 DIP while every top button keeps its native position and size across zoom/fonts/Tab states", async () => {
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) for (const font of [11, 14, 24]) for (const count of [0, 1, 8])
    await scenario("win32", zoom, font, count, false, 1440, async page => {
      const total = await aligned(page, zoom, controls); assert(total >= 14)
      const heights = await page.locator(".desktop-sidebar-controls,#chat-header,.content-tabs > .desktop-drag").evaluateAll(els => els.map(el => el.getBoundingClientRect().height))
      assert.equal(heights.length, 3); assert(heights.every(h => Math.abs(h * zoom - 44) < .1), `Header height: ${JSON.stringify({ heights, zoom })}`)
      const bodyTops = await page.locator('[data-chat-body],.content-tabs > .min-h-0').evaluateAll(els => els.map(el => el.getBoundingClientRect().top))
      assert.equal(bodyTops.length, 2); assert(bodyTops.every(top => Math.abs(top * zoom - 44) < .1), `Body starts before header bottom: ${JSON.stringify({ bodyTops, zoom })}`)
      const tabGeometry = await page.locator('[role="tab"]').evaluateAll(els => els.map(el => el.getBoundingClientRect().height))
      assert.equal(tabGeometry.length, count); assert(tabGeometry.every(h => Math.abs(h * zoom - 32) < .1))
      const overflow = await page.locator('[role="tablist"] > div').evaluateAll(els => els.map(el => ({ scroll: el.scrollHeight, client: el.clientHeight })))
      assert(overflow.every(r => r.scroll <= r.client + 1), `Tab vertical overflow: ${JSON.stringify(overflow)}`)
    })
})
test("ALIGN-02 original narrow Shell switches workspaces without pushing the visible caption row down", async () => {
  for (const [width, zoom] of [[760, 1], [1440, 2]]) await scenario("win32", zoom, 14, 1, true, width, async page => {
    const nav = page.getByRole("navigation", { name: "创作工作区" })
    assert((await nav.boundingBox())!.y > 700)
    await aligned(page, zoom, controls)
    for (const [label, pane] of [["作品目录", "sidebar"], ["返回对话", "chat"], ["查看内容", "content"]]) {
      await nav.getByRole("button", { name: label, exact: true }).click()
      await page.locator(`.dashboard-shell[data-narrow-pane=${pane}]`).waitFor()
      await aligned(page, zoom, controls)
    }
  })
})
test("ALIGN-03 aligned controls retain navigation, menu, fullscreen, panel hide and Tab close handlers", () => scenario("win32", 1.5, 24, 1, false, 1440, async page => {
  for (const label of ["后退", "前进", "展开或收起左侧导航栏", "显示左侧导航栏", "显示内容面板", "进入全屏", "显示 / 隐藏内容面板", "应用程序菜单"])
    await page.getByRole("button", { name: label, exact: true }).click()
  await page.getByRole("button", { name: "应用程序菜单", exact: true }).press("Enter")
  await page.getByRole("button", { name: "应用程序菜单", exact: true }).press("Space")
  assert.deepEqual(await page.evaluate(() => (window as any).captionFixture.calls), [-1, 1, "sidebar", "restore-sidebar", "restore-content", "fullscreen", "hide-content", "app.menu", "app.menu", "app.menu"])
  await page.getByRole("button", { name: "关闭 隔离面板 0", exact: true }).click()
  assert.equal(await page.getByRole("tab").count(), 0)
  await aligned(page, 1.5, controls)
  const regions = await page.locator("button").evaluateAll(els => els.map(el => getComputedStyle(el).getPropertyValue("-webkit-app-region")))
  assert(regions.every(r => r === "no-drag"))
}))
for (const platform of [null, "darwin"] as const) test(`ALIGN-04 ${platform ?? "Web"} retains original 44 CSS px rows`, () => scenario(platform, 1, 14, 0, false, 1440, async page => {
  const heights = await page.locator(".desktop-sidebar-controls,#chat-header,.content-tabs > .desktop-drag").evaluateAll(els => els.map(el => el.getBoundingClientRect().height))
  assert.deepEqual(heights, [44, 44, 44]); assert.equal(await page.locator("[data-desktop-menu-button]").count(), 0)
}))
