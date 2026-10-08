import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import { build } from "esbuild"
import ts from "typescript"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { chromium, type Browser, type Page } from "playwright-core"

// Only the current real ChatPanel title is isolated here. Native acceptance
// separately runs the full DashboardShell/ChatPanel and actual Electron zoom.
const source = ts.createSourceFile("ChatPanel.tsx", readFileSync("src/components/layout/ChatPanel.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let header = ""
function visit(node: ts.Node) {
  if (ts.isJsxElement(node)) {
    const attr = node.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === "className")
    if (attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isStringLiteral(attr.initializer) && /\bdesktop-drag\b/.test(attr.initializer.text) && /\bh-11\b/.test(attr.initializer.text)) header = node.getText(source)
  }
  ts.forEachChild(node, visit)
}
visit(source)
assert(header, "Actual ChatPanel title JSX missing")
const cssPath = resolve("src/app/globals.css")
const stylesheet = postcss([tailwindcss()]).process(readFileSync(cssPath, "utf8"), { from: cssPath }).then(result => result.css + "\n" + readFileSync("src/app/desktop.css", "utf8"))
const bundle = build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {PanelLeft,PanelRight,MessageSquare} from 'lucide-react';import {useDesktopStore} from './src/stores/desktop';
window.mountTitle=(platform='darwin',zoom=1,font=14,hidden=true,callback=true)=>{
 const calls=[];document.documentElement.style.fontSize=(16*font/14)+'px';
 const appearance=(platform,zoom)=>useDesktopStore.setState({bootstrap:platform?{platform,settings:{appearance:{zoom}}}:null});
 appearance(platform,zoom);
 function App(){
  const [sidebarHidden,setHidden]=useState(hidden),desktopBootstrap=useDesktopStore(state=>state.bootstrap);
  const messages=[],currentConversation=null,contentHidden=true;
  const onShowSidebar=callback?()=>{calls.push('sidebar');setHidden(false)}:undefined,onShowContent=()=>calls.push('content');
  window.hideSidebar=()=>flushSync(()=>setHidden(true));
  return <div id='chat'>${header}</div>;
 }
 const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(<App/>));
 window.fixture={calls,appearance:(platform,zoom,font)=>{document.documentElement.style.fontSize=(16*font/14)+'px';flushSync(()=>appearance(platform,zoom))},unmount:()=>root.unmount()};
};` }, bundle: true, platform: "browser", format: "iife", write: false, tsconfig: "tsconfig.json" }).then(result => result.outputFiles![0].text)

let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.XAANINK_TEST_CHROMIUM ? { executablePath: process.env.XAANINK_TEST_CHROMIUM } : {}) }) })
test.after(async () => { await browser?.close() })
async function scenario(platform: "darwin" | "win32" | null, hidden: boolean, callback: boolean, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 600 } }), errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    await page.route("**/*", route => route.abort())
    await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ content: await stylesheet }); await page.addScriptTag({ content: await bundle })
    await page.evaluate(({ platform, hidden, callback }) => (window as any).mountTitle(platform, 1, 14, hidden, callback), { platform, hidden, callback })
    await run(page); assert.deepEqual(errors, [])
  } finally { await page.close() }
}
const restore = (page: Page) => page.getByRole("button", { name: "显示左侧导航栏", exact: true })
async function safeLeft(page: Page, zoom: number) {
  const bounds = await restore(page).boundingBox()
  assert(bounds)
  const nativeLeft = bounds.x * zoom
  assert(nativeLeft >= 84 && nativeLeft <= 96, `Restore left ${nativeLeft}px must clear native window controls with a gap`)
}

test("SAFE-01 collapsed macOS restore clears native traffic lights", () => scenario("darwin", true, true, page => safeLeft(page, 1)))

test("SAFE-02 macOS safe gap survives live zoom and UI font changes", () => scenario("darwin", true, true, async page => {
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) for (const font of [11, 14, 24]) {
    await page.evaluate(({ zoom, font }) => (window as any).fixture.appearance("darwin", zoom, font), { zoom, font })
    await safeLeft(page, zoom)
  }
}))

for (const platform of ["win32", null] as const) test(`SAFE-03 ${platform ?? "Web"} retains original restore position`, () => scenario(platform, true, true, async page => {
  for (const font of [11, 14, 24]) {
    await page.evaluate(({ platform, font }) => (window as any).fixture.appearance(platform, .75, font), { platform, font })
    const bounds = await restore(page).boundingBox(); assert(bounds)
    assert(Math.abs(bounds.x - 6 * font / 14) < 1)
  }
}))

for (const platform of ["darwin", "win32", null] as const) test(`SAFE-03 ${platform ?? "Web"} expanded title has no restore reservation`, () => scenario(platform, false, true, async page => {
  assert.equal(await restore(page).count(), 0)
  assert.equal(await page.locator("#chat > div").evaluate(el => getComputedStyle(el).paddingLeft), "12px")
}))

test("SAFE-03 absent restore callback keeps title unreserved", () => scenario("darwin", true, false, async page => {
  assert.equal(await restore(page).count(), 0)
  assert.equal(await page.locator("#chat > div").evaluate(el => getComputedStyle(el).paddingLeft), "12px")
}))

test("SAFE-04 restore mouse/keyboard and repeated hide retain safe gap and drag contracts", () => scenario("darwin", true, true, async page => {
  assert.equal(await page.locator("#chat > div").evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region")), "drag")
  assert.equal(await restore(page).evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region")), "no-drag")
  await restore(page).click(); assert.equal(await restore(page).count(), 0)
  await page.evaluate(() => (window as any).hideSidebar()); await safeLeft(page, 1)
  await restore(page).press("Enter"); assert.equal(await restore(page).count(), 0)
  await page.evaluate(() => (window as any).hideSidebar()); await safeLeft(page, 1)
  await page.getByRole("button", { name: "显示内容面板", exact: true }).click()
  assert.deepEqual(await page.evaluate(() => (window as any).fixture.calls), ["sidebar", "sidebar", "content"])
}))
