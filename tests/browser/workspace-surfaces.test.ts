import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import { build } from "esbuild"
import ts from "typescript"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { chromium, type Browser, type Page } from "playwright-core"

// Scope: real DashboardShell / Group, ContentTabs, Windows controls, original
// ChatPanel header JSX, original Sidebar root/account classes, UI components and
// product CSS. Data requests, command registration and unrelated business bodies
// are fixtures. Planning/scene/scenario/Monaco below are CSS probes, not mounted real
// business panels or Monaco instances. CSS zoom is a browser approximation;
// native Electron zoom, persistence, editor state and full workflows need the
// separate isolated Windows validation. No proposed CSS is injected here.
const chatSource = ts.createSourceFile("ChatPanel.tsx", readFileSync("src/components/layout/ChatPanel.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let header = ""
function findHeader(node: ts.Node) {
  if (ts.isJsxElement(node)) {
    const attr = node.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(chatSource) === "className")
    if (attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isStringLiteral(attr.initializer) && /\bdesktop-drag\b/.test(attr.initializer.text) && /\bh-11\b/.test(attr.initializer.text)) header = node.getText(chatSource)
  }
  ts.forEachChild(node, findHeader)
}
findHeader(chatSource)
assert(header, "Original ChatPanel caption JSX must remain available")
const sidebarSource = readFileSync("src/components/layout/SidebarTree.tsx", "utf8")
const sidebarClass = sidebarSource.match(/className="([^"]*flex h-full flex-col bg-sidebar[^"]*)"/)?.[1]
const accountClass = sidebarSource.match(/className="([^"]*border-t border-sidebar-border[^"]*)"/)?.[1]
assert(sidebarClass && accountClass, "Original Sidebar container/account classes must remain available")
const editorSource = ts.createSourceFile("MarkdownEditor.tsx", readFileSync("src/components/editor/MarkdownEditor.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let splitOpening = "", splitDivider = ""
function findSplit(node: ts.Node) {
  if (ts.isJsxElement(node) && node.openingElement.getText(editorSource).includes('"grid min-h-0 flex-1"')) {
    splitOpening = node.openingElement.getText(editorSource).replace("<div", "<div data-split-probe")
    for (const child of node.children) if (ts.isJsxExpression(child) && child.expression && ts.isBinaryExpression(child.expression) && /mode\s*===\s*"split"/.test(child.expression.left.getText(editorSource)) && ts.isJsxSelfClosingElement(child.expression.right)) splitDivider = child.expression.right.getText(editorSource)
  }
  ts.forEachChild(node, findSplit)
}
findSplit(editorSource)
assert(splitOpening && splitDivider, "Original MarkdownEditor split structure must remain available")
const planningRoot = postcss.parse(readFileSync("src/components/content/planning/planning.module.css", "utf8")).nodes.find(n => n.type === "rule" && n.selector === ".workspace")
assert(planningRoot?.type === "rule")
// Only rename the module selector; keep the real declarations and fallback.
const planningCss = planningRoot.toString().replace(/^\.workspace/, ".surface-planning-workspace")
const cssPath = resolve("src/app/globals.css")
const stylesheet = postcss([tailwindcss()]).process(readFileSync(cssPath, "utf8"), { from: cssPath }).then(r => [
  r.css, readFileSync("src/app/desktop.css", "utf8"), planningCss,
  readFileSync("src/components/content/scene/scene.css", "utf8"),
  readFileSync("node_modules/monaco-editor/esm/vs/editor/browser/widget/codeEditor/editor.css", "utf8"),
  readFileSync("node_modules/monaco-editor/esm/vs/editor/browser/viewParts/margin/margin.css", "utf8"),
].join("\n"))
const chat = `import React from 'react';import {PanelLeft,PanelRight,MessageSquare} from 'lucide-react';import {useDesktopStore} from './src/stores/desktop';
export function ChatPanel({sidebarHidden=true,contentHidden=true,onShowSidebar,onShowContent}) {
 const desktopBootstrap=useDesktopStore(s=>s.bootstrap),messages=[],currentConversation=null;
 return <div className='chatpane flex h-full flex-col bg-chat-bg'><div data-chat-header className='contents'>${header}</div>
 <div data-chat-body><div data-ai-surface className='bg-chat-surface'>AI 表面 CSS 夹具</div>
 <div data-ai-editor className='monaco-editor'><div className='monaco-editor-background'>AI 编辑器 CSS 夹具</div><div className='margin'>行号</div></div></div></div>;
}`
const sidebar = `import React from 'react';import {SidebarWindowControls} from './src/components/desktop/WindowControls';
export function SidebarTree({onToggleSidebar}){return <div data-sidebar-root className=${JSON.stringify(sidebarClass)}>
 <SidebarWindowControls onToggleSidebar={onToggleSidebar}/><div className='flex-1'>目录数据夹具</div>
 <div data-sidebar-account className=${JSON.stringify(accountClass)}>隔离作者</div></div>}`
const business = `import React from 'react';
import {cn} from './src/lib/utils';
import {Separator} from './src/components/ui/separator';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator} from './src/components/ui/dropdown-menu';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem,SelectSeparator} from './src/components/ui/select';
function SplitCssProbe(){const mode='split';return <div className='desktop-markdown-editor' style={{height:70,display:'flex',flexDirection:'column'}}>${splitOpening}<div data-split-editor style={{minWidth:0}}>编辑 CSS 夹具</div>${splitDivider}<div data-split-preview style={{minWidth:0}}>预览 CSS 夹具</div></div></div>}
export const renderTabContent=tab=><div data-business-fixture>
 <div data-ordinary className='bg-editor'>普通面板 CSS 夹具</div>
 <div data-planning className='surface-planning-workspace'>规划 CSS 夹具</div>
 <div data-scenario className='scpane bg-chat-bg'>情景沙盘 CSS 夹具</div>
 <div data-scene className='scene-workspace'><div data-scene-content className='scene-content'>场景面板 CSS 夹具</div></div>
 <div data-content-editor className='monaco-editor'><div className='monaco-editor-background'>正文 CSS 夹具</div><div className='margin'>行号</div></div>
 <SplitCssProbe/>
 <div data-business-border className='border-b border-border'>普通业务结构边框</div>
 <Separator data-probe-horizontal/><div style={{display:'flex',height:24}}><Separator orientation='vertical' data-probe-vertical/></div>
 <div className='markdown-body'><hr data-probe-hr/></div>
 <DropdownMenu><DropdownMenuTrigger>组件菜单</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>一</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem>二</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
 <Select defaultValue='a'><SelectTrigger aria-label='选择夹具'><SelectValue/></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectItem value='a'>一</SelectItem><SelectSeparator/><SelectItem value='b'>二</SelectItem></SelectContent></Select>
 </div>;
export const StagedSaveSurface=({children})=>children;export const StagedInterceptionBootstrap=()=>null;
export const StorySources=()=>null;export const StoryActivityBanner=()=>null;export const StoryLivePreview=()=>null;`
const bundle = build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {DashboardShell} from './src/components/layout/DashboardShell';import {WindowsMenuControl} from './src/components/desktop/WindowControls';
import {useDesktopStore} from './src/stores/desktop';import {desktopWorkspaceDraftSource} from './src/lib/desktop/workspace-draft-source';
import {mountDesktopNavigation} from './src/lib/desktop/navigation-runtime';
window.mountSurfaces=({zoom,font,theme,count})=>{
 const calls=[];window.desktop={command:id=>{calls.push(id);return Promise.resolve()}};
 document.body.dataset.platform='win32';document.body.style.zoom=String(zoom);document.documentElement.className=theme;
 document.documentElement.style.fontSize=(16*font/14)+'px';document.documentElement.style.setProperty('--desktop-caption-zoom',String(zoom));
 // CSS probe defaults represent the unchanged paper Monaco registration.
 document.documentElement.style.setProperty('--vscode-editor-background','#f9f4e4');document.documentElement.style.setProperty('--vscode-editorGutter-background','#f9f4e4');
 useDesktopStore.setState({bootstrap:{platform:'win32',settings:{appearance:{zoom}}}});
 const snapshot={canBack:true,canForward:true,pending:false};mountDesktopNavigation({getSnapshot:()=>snapshot,subscribe:()=>()=>{},dispose(){}});
 const tabs=Array.from({length:count},(_,i)=>({id:'theme:n'+i,type:'theme',novelId:'n'+i,title:'隔离面板 '+i}));
 const layout={version:1,narrowPane:'content',contentVisible:true,sidebarVisible:true,chatVisible:true,sizes:{sidebar:20,chat:35,content:45},lastContentSize:45,lastSidebarSize:20,lastChatSize:35};
 desktopWorkspaceDraftSource.restore({version:1,tabs,activeTabId:tabs[0]?.id??null,subTabs:{},layout});
 const query=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});query.setQueryData(['novels'],{novels:[],unavailableWorks:[]});
 const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(<QueryClientProvider client={query}><DashboardShell user={{id:'isolated-author',name:'隔离作者',email:''}}/><WindowsMenuControl/>
 <div data-outside-settings className='desktop-settings-nav' style={{position:'fixed',left:-500,top:0}}>设置 CSS 夹具</div>
 <div data-outside-planning className='surface-planning-workspace' style={{position:'fixed',left:-500,top:200}}>独立规划 CSS 夹具</div></QueryClientProvider>));
 window.surfaceFixture={calls,layout:()=>desktopWorkspaceDraftSource.read().layout,pending:()=>desktopWorkspaceDraftSource.layoutPending};
};` }, bundle: true, platform: "browser", format: "iife", write: false, tsconfig: "tsconfig.json", plugins: [{ name: "surface-data-boundaries", setup(api) {
  api.onResolve({ filter: /^(\.\/(ChatPanel|SidebarTree)|@\/lib\/desktop\/use-command-target|@\/components\/content\/(registry|StagedSaveSurface|StoryWorkflowPanel))$/ }, args => ({ path: args.path, namespace: "surface-fixture" }))
  api.onLoad({ filter: /.*/, namespace: "surface-fixture" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "./ChatPanel" ? chat : args.path === "./SidebarTree" ? sidebar : args.path.endsWith("use-command-target") ? "export function useDesktopCommands(){}" : business }))
} }] }).then(r => r.outputFiles![0].text)

let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.XAANINK_TEST_CHROMIUM ? { executablePath: process.env.XAANINK_TEST_CHROMIUM } : {}) }) })
test.after(async () => { await browser?.close() })
type Options = { dpr?: number; zoom?: number; font?: number; theme?: "paper" | "ink"; count?: number; width?: number }
async function scenario(options: Options, run: (page: Page) => Promise<void>) {
  const { dpr = 1, zoom = 1, font = 14, theme = "paper", count = 1, width = 1680 } = options
  const context = await browser.newContext({ viewport: { width: Math.round(width * zoom), height: Math.round(900 * zoom) }, deviceScaleFactor: dpr })
  const page = await context.newPage(), errors: string[] = []
  page.on("pageerror", e => errors.push(e.message))
  try {
    await page.route("**/*", r => r.abort()); await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ content: await stylesheet }); await page.addScriptTag({ content: await bundle })
    await page.evaluate(args => (window as any).mountSurfaces(args), { zoom, font, theme, count })
    await page.waitForFunction(() => !(window as any).surfaceFixture.pending())
    await frames(page)
    await run(page); assert.deepEqual(errors, [], "No fixture rendering errors")
  } finally { await context.close() }
}
async function frames(page: Page) { await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))) }
const paper = { sidebar: "rgb(245, 238, 220)", chat: "rgb(250, 246, 232)", content: "rgb(248, 243, 228)", border: "rgb(216, 203, 166)" }
const panelSelectors = ["[data-sidebar-root]", ".workspace-chat .chatpane", ".workspace-content .content-tabs"]
async function panelColors(page: Page) {
  return Promise.all(panelSelectors.map(selector => page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor)))
}
async function line(page: Page, selector: string, side: "left" | "top" | "bottom" | "right") {
  return page.locator(selector).evaluate((el, edge) => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect()
    const cap = edge[0].toUpperCase() + edge.slice(1)
    return { stroke: parseFloat(s.getPropertyValue(`border-${edge}-width`)), color: s.getPropertyValue(`border-${edge}-color`), style: s.getPropertyValue(`border-${edge}-style`), width: parseFloat(s.width), height: parseFloat(s.height), rectWidth: r.width, rectHeight: r.height, background: s.backgroundColor, image: s.backgroundImage, children: el.children.length, boxSizing: s.boxSizing, edge: cap }
  }, side)
}
async function equalLines(page: Page, zoom: number) {
  const reference = await line(page, "[data-business-border]", "bottom")
  assert(reference.stroke > 0, "Visible standard structure border is the thickness reference")
  assert.equal(reference.color, paper.border)
  const handles = page.locator(".workspace-group [data-separator]")
  assert.equal(await handles.count(), 2)
  for (let i = 0; i < 2; i++) {
    const s = await handles.nth(i).evaluate(el => {
      const style = getComputedStyle(el), r = el.getBoundingClientRect()
      const previous = el.previousElementSibling!.getBoundingClientRect(), next = el.nextElementSibling!.getBoundingClientRect()
      return { rectWidth: r.width, contentWidth: parseFloat(style.width), stroke: parseFloat(style.borderLeftWidth), color: style.borderLeftColor, background: style.backgroundColor, children: el.children.length, boxSizing: style.boxSizing, image: style.backgroundImage, leftGap: r.left - previous.right, rightGap: next.left - r.right }
    })
    assert.equal(s.children, 0, "A divider must not retain the secondary child line")
    assert.equal(s.contentWidth, 0, "A divider must have zero content width")
    assert.equal(s.boxSizing, "content-box")
    assert.equal(s.background, "rgba(0, 0, 0, 0)"); assert.equal(s.image, "none")
    assert.equal(s.color, paper.border)
    assert(Math.abs(s.stroke - reference.stroke) < .02, `Vertical and normal horizontal borders must be equally thin: ${JSON.stringify(s)}`)
    assert(Math.abs(s.rectWidth - reference.stroke * zoom) < .03, "Only the border occupies the divider width")
    assert(Math.abs(s.leftGap) < .03 && Math.abs(s.rightGap) < .03, "Adjacent panels must touch the border without a bright gutter")
  }
  for (const [selector, side] of [["[data-chat-header] > div", "bottom"], ["[data-sidebar-account]", "top"], ["[data-probe-horizontal]", "top"], ["[data-probe-vertical]", "left"], ["[data-probe-hr]", "top"], ["[data-outside-settings]", "right"], ["[data-split-probe] > :nth-child(2)", "left"]] as const) {
    const s = await line(page, selector, side)
    assert(Math.abs(s.stroke - reference.stroke) < .02, `${selector} must match ordinary UI border thickness: ${JSON.stringify(s)}`)
    assert.equal(s.color, paper.border, selector); assert.equal(s.style, "solid", selector)
    if (selector.startsWith("[data-probe-")) {
      assert.equal(s.background, "rgba(0, 0, 0, 0)", selector); assert.equal(s.image, "none", selector)
      assert.equal(side === "left" ? s.width : s.height, 0, `${selector} must have only a border, with zero content size`)
    }
  }
  // The approved rectangular tab strip paints its divider with ::after; the
  // role=tablist is now the inner scroll viewport, not the caption border.
  const captionLine = await page.locator('.content-tabs-caption').evaluate(el => {
    const s = getComputedStyle(el, '::after')
    return { content: s.content, height: s.height, bottom: s.bottom, left: s.left, right: s.right, color: s.backgroundColor }
  })
  assert.notEqual(captionLine.content, 'none')
  assert.equal(captionLine.height, '1px'); assert.equal(captionLine.bottom, '0px')
  assert.equal(captionLine.left, '0px'); assert.equal(captionLine.right, '0px'); assert.equal(captionLine.color, paper.border)
  const split = await page.locator('[data-split-probe]').evaluate(el => {
    const [editor, divider, preview] = Array.from(el.children).map(child => child.getBoundingClientRect())
    return { editorWidth: editor.width, previewWidth: preview.width, dividerWidth: divider.width, leftGap: divider.left - editor.right, rightGap: preview.left - divider.right }
  })
  assert(split.editorWidth > 10 && split.previewWidth > 10, "Both real split grid columns retain space")
  assert(Math.abs(split.editorWidth - split.previewWidth) < .03, "The editor keeps balanced minmax columns")
  assert(Math.abs(split.dividerWidth - reference.stroke * zoom) < .03, "Split column occupies only the same thin border")
  assert(Math.abs(split.leftGap) < .03 && Math.abs(split.rightGap) < .03, "Split middle track leaves no extra bright gap")
}

test("SURF-01 approved fixed paper colors and surface scopes preserve global and AI-editor backgrounds", () => scenario({}, async page => {
  assert.deepEqual(await panelColors(page), [paper.sidebar, paper.chat, paper.content])
  const backgrounds = await Promise.all(['[data-ai-surface]', '.content-tabs-caption', '[role="tablist"]', '.content-tab[data-active="true"]', '[data-ordinary]', '[data-planning]', '[data-scenario]', '[data-content-editor]', '[data-content-editor] .monaco-editor-background', '[data-content-editor] .margin', '[data-ai-editor]', '[data-ai-editor] .monaco-editor-background', '[data-ai-editor] .margin', '[data-outside-settings]', '[data-outside-planning]'].map(selector => page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor)))
  assert.deepEqual(backgrounds, ["rgb(252, 248, 238)", paper.sidebar, "rgba(0, 0, 0, 0)", paper.content, paper.content, paper.content, paper.content, paper.content, paper.content, paper.content, "rgb(249, 244, 228)", "rgb(249, 244, 228)", "rgb(249, 244, 228)", "rgb(239, 230, 207)", "rgb(244, 237, 218)"])
  const tokens = await page.locator("html").evaluate(el => { const s = getComputedStyle(el); return [s.getPropertyValue("--background").trim(), s.getPropertyValue("--border").trim(), s.getPropertyValue("--editor-bg").trim()] })
  assert.deepEqual(tokens, ["#f4edda", "#d8cba6", "#f9f4e4"])
}))

test("SURF-05 real ScenePanel stylesheet paints the content background separately from ScenarioLab", () => scenario({}, async page => {
  const sceneRoot = await page.locator('[data-scene]').evaluate(el => getComputedStyle(el).backgroundColor)
  const sceneContent = await page.locator('[data-scene-content]').evaluate(el => getComputedStyle(el).backgroundColor)
  assert.equal(sceneRoot, paper.content, "ScenePanel scene-workspace must use the approved right-column background")
  // The original scene-content has an undefined --editor alias and is
  // transparent; its visible backdrop comes from scene-workspace.
  assert.equal(sceneContent, "rgba(0, 0, 0, 0)", "Original scene-content transparency preserves the root backdrop")
  assert.equal(await page.locator('[data-scenario]').evaluate(el => getComputedStyle(el).backgroundColor), paper.content, "ScenarioLab scpane is a distinct CSS branch")
}))

test("SURF-02/03 DPR × CSS zoom representatives keep border-only panel adjacency, common UI thickness and approved Windows caption geometry", async () => {
  const zooms = [.75, 1, 1.25, 1.5, 2], fonts = [11, 14, 24]
  for (const [dprIndex, dpr] of [1, 1.5, 2].entries()) for (const [zoomIndex, zoom] of zooms.entries()) {
    const font = fonts[(dprIndex + zoomIndex) % fonts.length]
    await scenario({ dpr, zoom, font }, async page => {
      await equalLines(page, zoom)
      const rows = await page.locator('.desktop-sidebar-controls,[data-chat-header] > div,.content-tabs-caption').evaluateAll(els => els.map(el => el.getBoundingClientRect().height))
      assert.equal(rows.length, 3); assert(rows.every(h => Math.abs(h - 44) < .12), `44 DIP caption approximation: ${JSON.stringify({ rows, zoom, dpr, font })}`)
      const controls = await page.locator('.desktop-sidebar-controls button,[data-chat-header] > div > button,.content-tabs-tools > button').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { center: r.top + r.height / 2, width: r.width, height: r.height, content: !!el.closest(".content-tabs") } }))
      assert.equal(controls.filter(r => r.content).length, 2, "Both actual content caption tools are checked")
      for (const r of controls) {
        assert(Math.abs(r.center - 16) <= .65, `Original control center: ${JSON.stringify({ r, zoom, dpr, font })}`)
        assert(Math.abs(r.width - (r.content ? 24 : 28)) < .12 && Math.abs(r.height - (r.content ? 24 : 28)) < .12, "Original caption control dimensions")
      }
    })
  }
})

test("SURF-02 real menu/select separators use the same thin border as section dividers", () => scenario({ dpr: 1.5 }, async page => {
  const reference = await line(page, "[data-business-border]", "bottom")
  await page.getByRole("button", { name: "组件菜单", exact: true }).click()
  await page.locator('[data-slot="dropdown-menu-separator"]').waitFor({ state: "visible" })
  const menu = await line(page, '[data-slot="dropdown-menu-separator"]', "top")
  await page.keyboard.press("Escape")
  await page.getByRole("combobox", { name: "选择夹具", exact: true }).click()
  await page.locator('[data-slot="select-separator"]').waitFor({ state: "visible" })
  const select = await line(page, '[data-slot="select-separator"]', "top")
  for (const s of [menu, select]) {
    assert.equal(s.color, paper.border); assert.equal(s.style, "solid")
    assert(Math.abs(s.stroke - reference.stroke) < .02, "Menu/select line matches a normal structure border")
    assert.equal(s.height, 0); assert.equal(s.background, "rgba(0, 0, 0, 0)"); assert.equal(s.image, "none")
  }
}))

test("SURF-04 actual Group edge hit range, pointer/keyboard resize and hover/active preserve the divider width", () => scenario({}, async page => {
  const handles = page.locator(".workspace-group [data-separator]")
  for (const index of [0, 1]) {
    const handle = handles.nth(index), before = (await handle.boundingBox())!, y = before.y + 240
    const pane = page.locator(index === 0 ? ".workspace-sidebar" : ".workspace-chat")
    const paneBefore = (await pane.boundingBox())!.width
    // 3 CSS px outside the painted border exercises the library's invisible
    // fine-pointer extension, rather than clicking a wide visual gutter.
    await page.mouse.move(before.x + before.width + 3, y)
    await page.waitForFunction(i => document.querySelectorAll('.workspace-group [data-separator]')[i]?.getAttribute("data-separator") === "hover", index)
    assert(Math.abs((await handle.boundingBox())!.width - before.width) < .03, "Hover must not widen the line")
    await page.mouse.down()
    await page.waitForFunction(i => document.querySelectorAll('.workspace-group [data-separator]')[i]?.getAttribute("data-separator") === "active", index)
    assert(Math.abs((await handle.boundingBox())!.width - before.width) < .03, "Active drag must not widen the line")
    await page.mouse.move(before.x + before.width + 55, y, { steps: 5 }); await page.mouse.up(); await frames(page)
    assert(Math.abs((await pane.boundingBox())!.width - paneBefore) > 25, "Pointer resize changes the real Group layout")
    const keyboardBefore = (await pane.boundingBox())!.width
    await handle.focus(); await handle.press("ArrowRight"); await frames(page)
    assert(Math.abs((await pane.boundingBox())!.width - keyboardBefore) > 2, "Keyboard resize changes the real Group layout")
    assert(Math.abs((await handle.boundingBox())!.width - before.width) < .03, "Resizing retains the thin border")
  }
}))

test("SURF-04 original Shell hide/restore, content fullscreen, two-column and empty ContentTabs handlers retain approved surfaces", () => scenario({}, async page => {
  await page.getByRole("button", { name: "展开或收起左侧导航栏", exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.workspace-sidebar')!.getBoundingClientRect().width < .1)
  await page.getByRole("button", { name: "显示左侧导航栏", exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.workspace-sidebar')!.getBoundingClientRect().width > 200)
  await page.getByRole("button", { name: "进入全屏", exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.workspace-chat')!.getBoundingClientRect().width < .1)
  assert.equal(await page.locator('.workspace-content .content-tabs').evaluate(el => getComputedStyle(el).backgroundColor), paper.content)
  await page.getByRole("button", { name: "退出全屏", exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.workspace-chat')!.getBoundingClientRect().width >= 420)
  await page.getByRole("button", { name: "显示 / 隐藏内容面板", exact: true }).click()
  await page.locator('.workspace-content').waitFor({ state: "detached" })
  assert.equal(await page.locator('.workspace-group [data-separator]').count(), 1)
  assert.deepEqual((await panelColorsTwo(page)), [paper.sidebar, paper.chat])
  await page.getByRole("button", { name: "显示内容面板", exact: true }).click()
  await page.waitForFunction(() => (document.querySelector('.workspace-content')?.getBoundingClientRect().width ?? 0) > 300)
  assert.deepEqual(await panelColors(page), [paper.sidebar, paper.chat, paper.content])
  await page.getByRole("button", { name: "关闭 隔离面板 0", exact: true }).click()
  await page.locator('.workspace-content').waitFor({ state: "detached" })
  await page.getByRole("button", { name: "显示内容面板", exact: true }).click()
  await page.getByRole("button", { name: "隐藏内容面板", exact: true }).waitFor({ state: "visible" })
  assert.equal(await page.getByRole("tab").count(), 0)
  assert.equal(await page.locator('.workspace-content .content-tabs').evaluate(el => getComputedStyle(el).backgroundColor), paper.content)
}))
async function panelColorsTwo(page: Page) { return Promise.all(panelSelectors.slice(0, 2).map(selector => page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor))) }

test("SURF-01/04 original narrow workspace switching and ink palette survive theme changes", async () => {
  // Original globals.css uses two breakpoints: below 900 the directory can
  // replace the workspace; below 680 chat/content become individual panes.
  for (const width of [760, 640]) await scenario({ width }, async page => {
    const nav = page.getByRole("navigation", { name: "创作工作区" })
    for (const [label, pane, selector, color] of [["作品目录", "sidebar", panelSelectors[0], paper.sidebar], ["返回对话", "chat", panelSelectors[1], paper.chat], ["查看内容", "content", panelSelectors[2], paper.content]]) {
      await nav.getByRole("button", { name: label, exact: true }).click(); await frames(page)
      assert.equal(await page.locator('.dashboard-shell').getAttribute("data-narrow-pane"), pane)
      assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor), color)
      const geometry = await page.evaluate(() => {
        const [sidebar, chat, content] = ['.workspace-sidebar', '.workspace-chat', '.workspace-content'].map(selector => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width } })
        const dividers = Array.from(document.querySelectorAll('.workspace-group [data-separator]')).map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width } }).filter(r => r.width > 0)
        return { sidebar, chat, content, dividers }
      })
      if (pane === "sidebar" || width < 680) {
        assert(Math.abs(geometry[pane as "sidebar" | "chat" | "content"].width - width) < .1, "Original single-pane layout fills the workspace")
        for (const inactive of ["sidebar", "chat", "content"] as const) if (inactive !== pane) assert.equal(geometry[inactive].width, 0, "Other panes leave no occupied gap")
        assert.equal(geometry.dividers.length, 0, "A single pane has no visible split line")
      } else {
        assert.equal(geometry.sidebar.width, 0, "The directory is hidden at the original 900px breakpoint")
        assert(geometry.chat.width > 150 && geometry.content.width > 150, "Original 680–899px layout keeps both chat and content visible")
        assert.equal(geometry.dividers.length, 1)
        const divider = geometry.dividers[0]
        assert(Math.abs(geometry.chat.left) < .03 && Math.abs(geometry.content.right - width) < .03, "Two panes occupy the full original narrow workspace")
        assert(Math.abs(divider.left - geometry.chat.right) < .03 && Math.abs(geometry.content.left - divider.right) < .03, "The approved thin line leaves no bright gutter between narrow panes")
        const reference = await line(page, "[data-business-border]", "bottom")
        assert(Math.abs(divider.width - reference.stroke) < .03, "Narrow two-pane divider remains equally thin")
      }
    }
  })
  await scenario({ theme: "ink" }, async page => {
    assert.deepEqual(await panelColors(page), ["rgb(16, 13, 12)", "rgb(13, 11, 10)", "rgb(16, 13, 12)"])
    await page.locator("html").evaluate(el => { el.setAttribute("class", "paper") }); await frames(page)
    assert.deepEqual(await panelColors(page), [paper.sidebar, paper.chat, paper.content])
    await page.locator("html").evaluate(el => { el.setAttribute("class", "ink") }); await frames(page)
    assert.deepEqual(await panelColors(page), ["rgb(16, 13, 12)", "rgb(13, 11, 10)", "rgb(16, 13, 12)"])
  })
})
