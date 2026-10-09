import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import { build } from "esbuild"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { chromium, type Browser, type Page } from "playwright-core"

const cssPath = resolve("src/app/globals.css")
const desktopStyles = readFileSync("src/app/desktop.css", "utf8")
const stylesheet = postcss([tailwindcss()]).process(readFileSync(cssPath, "utf8"), { from: cssPath }).then(result => result.css + "\n" + desktopStyles)
// Actual ContentTabs and desktop window controls; only unrelated business bodies are
// stubbed. Full shell animations/persistence are exercised in real Electron.
const bundle = build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ContentTabs} from './src/components/layout/ContentTabs';
import {WindowsMenuControl,SidebarWindowControls} from './src/components/desktop/WindowControls';
import {useTabsStore} from './src/stores/tabs';import {useDesktopStore} from './src/stores/desktop';
window.mountEmpty=(platform,width,count)=>{
 const calls=[];
 const appearance=(zoom,font)=>{document.documentElement.style.fontSize=(16*font/14)+'px';useDesktopStore.setState({bootstrap:platform?{platform,settings:{appearance:{zoom}}}:null})};
 appearance(1,14);
 const tabs=Array.from({length:count},(_,i)=>({id:'tab-'+i,title:'隔离面板 '+i,type:'theme',novelId:'isolated'}));
 useTabsStore.setState({tabs,activeTabId:tabs[0]?.id??null});
 const query=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});query.setQueryData(['novels'],[]);
 function App(){const [visible,setVisible]=useState(true);return <QueryClientProvider client={query}>
  <button id='fixture-restore' style={{position:'fixed',bottom:0}} onClick={()=>setVisible(true)}>夹具恢复</button>
  {visible&&<div id='content' style={{marginLeft:'auto',width,height:500}}><ContentTabs fullscreen={false} onToggleFullscreen={()=>calls.push('fullscreen')} onToggleContent={()=>{calls.push('hide');setVisible(false)}}/></div>}
  <WindowsMenuControl/>
  <div style={{position:'absolute',left:0,top:0,width:260}}><SidebarWindowControls onToggleSidebar={()=>{}}/></div>
 </QueryClientProvider>}
 const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(<App/>));
 window.fixture={calls,appearance:(zoom,font)=>flushSync(()=>appearance(zoom,font)),state:()=>useTabsStore.getState(),unmount:()=>root.unmount()};
};` }, bundle: true, platform: "browser", format: "iife", write: false, tsconfig: "tsconfig.json", plugins: [{ name: "unrelated-panel-content", setup(api) {
  api.onResolve({ filter: /^@\/components\/content\/(registry|StagedSaveSurface|StoryWorkflowPanel)$/ }, args => ({ path: args.path, namespace: "panel-fixture" }))
  api.onLoad({ filter: /.*/, namespace: "panel-fixture" }, () => ({ loader: "tsx", resolveDir: process.cwd(), contents: `import React from 'react';export const renderTabContent=tab=><p data-panel-body>{tab.title}</p>;export const StagedSaveSurface=({children})=>children;export const StagedInterceptionBootstrap=()=>null;export const StorySources=()=>null;export const StoryActivityBanner=()=>null;export const StoryLivePreview=()=>null;` }))
} }] }).then(result => result.outputFiles![0].text)

let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.XAANINK_TEST_CHROMIUM ? { executablePath: process.env.XAANINK_TEST_CHROMIUM } : {}) }) })
test.after(async () => { await browser?.close() })
async function scenario(platform: "darwin" | "win32" | null, width: number, count: number, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 600 } }), errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    await page.route("**/*", route => route.abort())
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ content: await stylesheet }); await page.addScriptTag({ content: await bundle })
    await page.evaluate(({ platform, width, count }) => (window as any).mountEmpty(platform, width, count), { platform, width, count })
    await run(page); assert.deepEqual(errors, [])
  } finally { await page.close() }
}
const hide = (page: Page) => page.getByRole("button", { name: "隐藏内容面板", exact: true })
async function geometry(page: Page) {
  assert.equal(await hide(page).count(), 1, "The empty pane must expose one accessible hide button")
  assert(await hide(page).isVisible())
  return hide(page).evaluate(el => {
    const pane = el.closest(".content-tabs")!, header = el.parentElement!, r = el.getBoundingClientRect(), p = pane.getBoundingClientRect(), h = header.getBoundingClientRect()
    const menu = document.querySelector("[data-desktop-menu-button]")?.getBoundingClientRect()
    const icon = el.querySelector("svg")!.getBoundingClientRect(), sidebarIcon = document.querySelector('button[aria-label="展开或收起左侧导航栏"] svg')!.getBoundingClientRect()
    return { button: { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, pane: { x: p.x, right: p.right }, header: { y: h.y, bottom: h.bottom, height: h.height }, menuLeft: menu?.x, buttonRegion: getComputedStyle(el).getPropertyValue("-webkit-app-region"), headerRegion: getComputedStyle(header).getPropertyValue("-webkit-app-region"), viewportWidth: innerWidth, icon: { x: icon.x, y: icon.y, right: icon.right, bottom: icon.bottom, width: icon.width, height: icon.height }, sidebarIcon: { width: sidebarIcon.width, height: sidebarIcon.height }, rootRem: parseFloat(getComputedStyle(document.documentElement).fontSize) }
  })
}
async function contained(page: Page) {
  const g = await geometry(page)
  assert(g.button.x >= g.pane.x - .1 && g.button.right <= g.pane.right + .1, "Button must remain inside the right pane")
  assert(g.button.y >= g.header.y && g.button.bottom <= g.header.bottom)
  assert.equal(g.header.y, 0); assert.equal(g.buttonRegion, "no-drag"); assert.equal(g.headerRegion, "drag")
  assert.deepEqual({ width: g.icon.width, height: g.icon.height }, g.sidebarIcon, "The empty content hide icon must match the real sidebar hide icon")
  assert(Math.abs(g.icon.width - g.rootRem) < .05 && Math.abs(g.icon.height - g.rootRem) < .05, "Both icons must track the same root rem size")
  assert(Math.abs(g.button.width - 1.5 * g.rootRem) < .05 && Math.abs(g.button.height - 1.5 * g.rootRem) < .05, "The existing button target must keep its size")
  assert(g.icon.x >= g.button.x && g.icon.y >= g.button.y && g.icon.right <= g.button.right && g.icon.bottom <= g.button.bottom, "The icon must fit inside its button")
  return g
}

for (const platform of ["darwin", null] as const) test(`EMPTY-01 ${platform ?? "Web"} empty hide is accessible at the top right`, () => scenario(platform, 440, 0, async page => {
  const g = await contained(page)
  assert.equal(g.header.height, 44); assert.equal(g.pane.right - g.button.right, 8)
  assert.equal(await hide(page).getAttribute("type"), "button")
  assert.equal(await hide(page).getAttribute("title"), "隐藏内容面板")
  assert.equal(await hide(page).evaluate(el => el.closest('[aria-hidden="true"]') !== null), false)
  assert(await page.getByText("从左侧树中选择小说或内容节点，在这里开始创作", { exact: true }).isVisible())
  assert.equal(await page.getByRole("tablist").count(), 0)
}))

test("EMPTY-02 mouse, Enter and Space hide the pane and restore remains usable", () => scenario("darwin", 440, 0, async page => {
  for (const key of [null, "Enter", "Space"]) {
    await contained(page)
    if (key) {
      // Restore was clicked in the previous iteration: real Tab navigation
      // must reach the product button, with a visible keyboard focus ring.
      await page.keyboard.press("Tab")
      assert.equal(await hide(page).evaluate(el => el === document.activeElement), true)
      assert(await hide(page).evaluate(el => { const s = getComputedStyle(el); return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 1 }))
      await page.keyboard.press(key)
    } else await hide(page).click()
    assert.equal(await page.locator("#content").count(), 0)
    await page.locator("#fixture-restore").click()
  }
  assert.deepEqual(await page.evaluate(() => (window as any).fixture.calls), ["hide", "hide", "hide"])
  await contained(page)
}))

for (const width of [280, 320, 440]) test(`EMPTY-03 Windows fallback avoids caption/menu across live zoom/font (${width}px pane)`, () => scenario("win32", width, 0, async page => {
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) for (const font of [11, 14, 24]) {
    await page.evaluate(({ zoom, font }) => (window as any).fixture.appearance(zoom, font), { zoom, font })
    const g = await contained(page)
    assert(g.button.right <= g.viewportWidth - 138 / zoom, "Caption reservation must survive native zoom")
    assert(g.menuLeft !== undefined && g.button.right <= g.menuLeft - 5.9, "Hide button must also clear the fixed app menu")
  }
}))

test("EMPTY-04 Windows supplied titlebar geometry clears both controls in narrow/wide panes", async () => {
  for (const width of [320, 440]) await scenario("win32", width, 0, async page => {
    await contained(page)
    assert.match(await page.locator(".content-tabs > .desktop-drag").evaluate(el => (el as HTMLElement).style.paddingRight), /env\(titlebar-area-width,/)
    // Chromium has no native Windows overlay. Inject only env's result into the
    // actual current CSS expressions; never label this native Windows evidence.
    const menuRule = desktopStyles.match(/^\.desktop-windows-menu\s*\{[^}]+\}/m)?.[0]
    assert(menuRule, "Actual app-menu rule must exist")
    assert(menuRule.includes("env(titlebar-area-width,"), "Actual app-menu titlebar expression must exist")
    await page.addStyleTag({ content: menuRule.replace("env(titlebar-area-width,", "var(--fixture-titlebar-width,") })
    for (const zoom of [.75, 1, 2]) for (const font of [11, 24]) for (const captionWidth of [106, 138, 184, 216]) {
      await page.evaluate(({ zoom, font, captionWidth }) => {
        (window as any).fixture.appearance(zoom, font)
        document.documentElement.style.setProperty("--fixture-titlebar-width", `${innerWidth - captionWidth}px`)
        const header = document.querySelector<HTMLDivElement>(".content-tabs > .desktop-drag")!
        // React does not rewrite unchanged style props on the next caption
        // sample; an already injected read is left intact, while zoom changes
        // produce a new, current production expression.
        header.style.paddingRight = header.style.paddingRight.replace("env(titlebar-area-width,", "var(--fixture-titlebar-width,")
      }, { zoom, font, captionWidth })
      const g = await contained(page)
      assert(g.button.right <= g.viewportWidth - Math.max(captionWidth, 138 / zoom))
      assert(g.menuLeft !== undefined && g.button.right <= g.menuLeft - 5.9)
    }
  })
})

test("EMPTY-05 populated rail retains existing controls; closing last tab exposes empty hide", () => scenario("darwin", 440, 3, async page => {
  assert.equal(await hide(page).count(), 0)
  assert.equal(await page.getByRole("button", { name: "显示 / 隐藏内容面板", exact: true }).count(), 1)
  await page.getByRole("button", { name: "进入全屏", exact: true }).click()
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: `关闭 隔离面板 ${i}`, exact: true }).click()
  assert.equal(await page.getByRole("tablist").count(), 0)
  await contained(page); await hide(page).click(); await page.locator("#fixture-restore").click()
  await contained(page)
  assert.equal(await page.getByRole("tab").count(), 0)
  assert.deepEqual(await page.evaluate(() => (window as any).fixture.calls), ["fullscreen", "hide"])
}))
