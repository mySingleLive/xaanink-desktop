import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import { build } from "esbuild"
import ts from "typescript"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { chromium, type Browser, type Page } from "playwright-core"

// Real ChatPanel header, WindowsMenuControl and styles; this fixture does not
// claim full DashboardShell responsive or native Windows acceptance.
const tree = ts.createSourceFile("ChatPanel.tsx", readFileSync(process.env.XAANINK_CAPTION_HEADER_SOURCE ?? "src/components/layout/ChatPanel.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let header = ""
function visit(node: ts.Node) {
  if (ts.isJsxElement(node)) {
    const attr = node.openingElement.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(tree) === "className")
    if (attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isStringLiteral(attr.initializer) && /\bdesktop-drag\b/.test(attr.initializer.text) && /\bh-11\b/.test(attr.initializer.text)) header = node.getText(tree)
  }
  ts.forEachChild(node, visit)
}
visit(tree); assert(header)
const cssPath = resolve("src/app/globals.css")
const stylesheet = postcss([tailwindcss()]).process(readFileSync(cssPath, "utf8"), { from: cssPath }).then(result => result.css + "\n" + readFileSync("src/app/desktop.css", "utf8"))
const bundle = build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {PanelLeft,PanelRight,MessageSquare} from 'lucide-react';import {useDesktopStore} from './src/stores/desktop';
import {WindowsMenuControl} from './src/components/desktop/WindowControls';
window.mountTitle=(platform,zoom,font,sidebarHidden)=>{
 const calls=[];window.desktop={command:id=>{calls.push(id);return Promise.resolve()}};
 document.documentElement.style.fontSize=(16*font/14)+'px';
 document.documentElement.style.setProperty('--desktop-caption-zoom',String(zoom));document.body.dataset.platform=platform??'';
 useDesktopStore.setState({bootstrap:platform?{platform,settings:{appearance:{zoom}}}:null});
 function App(){const [contentHidden,setHidden]=useState(true),desktopBootstrap=useDesktopStore(state=>state.bootstrap);
  const messages=[],currentConversation=null,onShowSidebar=()=>calls.push('sidebar'),onShowContent=()=>{calls.push('content');setHidden(false)};
  window.hideContent=()=>flushSync(()=>setHidden(true));
  window.fixture={calls};
  return <><div id='chat'>${header}</div><WindowsMenuControl/></>;
 }
 const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(<App/>));
};` }, bundle: true, platform: "browser", format: "iife", write: false, tsconfig: "tsconfig.json" }).then(result => result.outputFiles![0].text)
let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.XAANINK_TEST_CHROMIUM ? { executablePath: process.env.XAANINK_TEST_CHROMIUM } : {}) }) })
test.after(async () => { await browser?.close() })
async function scenario(platform: "darwin" | "win32" | null, width: number, zoom: number, font: number, sidebar: boolean, caption: number | null, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: Math.round(width / zoom), height: 600 } }), errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    await page.route("**/*", route => route.abort()); await page.setContent('<div id="app"></div>')
    const css = await stylesheet
    await page.addStyleTag({ content: caption === null ? css : css.replaceAll("env(titlebar-area-width,", "var(--fixture-titlebar-width,") })
    await page.addScriptTag({ content: await bundle })
    await page.evaluate(({ platform, zoom, font, sidebar, caption }) => {
      if (caption !== null) document.documentElement.style.setProperty("--fixture-titlebar-width", `${innerWidth - caption}px`)
      ;(window as any).mountTitle(platform, zoom, font, sidebar)
      if (caption !== null) {
        // Substitute only the native env value in the real header inline style.
        const el = document.querySelector("#chat > div") as HTMLElement
        el.style.cssText = el.style.cssText.replaceAll("env(titlebar-area-width,", "var(--fixture-titlebar-width,")
      }
    }, { platform, zoom, font, sidebar, caption })
    await run(page); assert.deepEqual(errors, [])
  } finally { await page.close() }
}
const restore = (page: Page) => page.getByRole("button", { name: "显示内容面板", exact: true })
const menu = (page: Page) => page.getByRole("button", { name: "应用程序菜单", exact: true })
async function safe(page: Page, zoom: number, caption: number | null) {
  const bounds = await restore(page).boundingBox(), mb = await menu(page).boundingBox(); assert(bounds); assert(mb)
  const right = await page.evaluate(() => innerWidth) - Math.max(138 / zoom, caption ?? 0)
  assert(mb.x + mb.width <= right - 5, `Menu enters caption area: ${JSON.stringify({ mb, right, zoom })}`)
  assert(bounds.x + bounds.width <= mb.x - 5, `Restore overlaps menu/captions: ${JSON.stringify({ bounds, mb, right, zoom })}`)
  assert(bounds.y < 44 && bounds.y + bounds.height > 0)
}
test("WCO-S01 Windows restore and menu clear captions across window widths, zooms and fonts", async () => {
  for (const width of [760, 1440]) for (const zoom of [.75, 1, 1.25, 1.5, 2]) for (const font of [11, 14, 24]) for (const sidebar of [false, true])
    await scenario("win32", width, zoom, font, sidebar, null, page => safe(page, zoom, null))
})
test("WCO-S02 native env widths and unavailable env retain safe menu/restore gaps", async () => {
  for (const zoom of [.75, 1, 2]) for (const caption of [106, 138, 184, 216])
    await scenario("win32", 1440, zoom, 14, false, caption, page => safe(page, zoom, caption))
})

test("WCO-C03 compact Windows menu aligns with captions and retains mouse/keyboard commands", async () => {
  // CSS fixture geometry; Electron zoom and native menu activation are verified separately.
  for (const zoom of [.75, 1, 1.25, 1.5, 2]) {
    for (const font of [11, 14, 24]) await scenario("win32", 1440, zoom, font, false, null, async page => {
      await safe(page, zoom, null)
      const bounds = await menu(page).boundingBox(); assert(bounds)
      assert(Math.abs(bounds.y - 2 / zoom) < .05, `Menu top at zoom ${zoom}: ${bounds.y}`)
      assert(Math.abs(bounds.width * zoom - 28) < .05); assert(Math.abs(bounds.height * zoom - 28) < .05)
      assert(bounds.y >= 0)
      assert(Math.abs((bounds.y + bounds.height / 2) * zoom - 16) < .05)
      assert.equal(await menu(page).evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region")), "no-drag")
      await menu(page).click(); await menu(page).press("Enter"); await menu(page).press("Space")
      assert.deepEqual(await page.evaluate(() => (window as any).fixture.calls), ["app.menu", "app.menu", "app.menu"])
    })
  }
})
test("WCO-S03 restore mouse/Enter/Space work and reopening content releases reservation", () => scenario("win32", 1440, 1, 14, false, null, async page => {
  for (const key of [null, "Enter", "Space"]) {
    await safe(page, 1, null)
    if (key) await restore(page).press(key); else await restore(page).click()
    assert.equal(await restore(page).count(), 0)
    assert.equal(await page.locator("#chat > div").evaluate(el => getComputedStyle(el).paddingRight), "12px")
    await page.evaluate(() => (window as any).hideContent())
  }
  assert.deepEqual(await page.evaluate(() => (window as any).fixture.calls), ["content", "content", "content"])
  assert.equal(await restore(page).evaluate(el => getComputedStyle(el).getPropertyValue("-webkit-app-region")), "no-drag")
}))
for (const platform of [null, "darwin"] as const) test(`WCO-S03 ${platform ?? "Web"} retains original right padding`, async () => {
  for (const font of [11, 14, 24]) await scenario(platform, 1440, .75, font, true, null, async page => {
    const padding = await page.locator("#chat > div").evaluate(el => parseFloat(getComputedStyle(el).paddingRight))
    assert(Math.abs(padding - 12 * font / 14) < 1)
    assert.equal(await menu(page).count(), 0)
  })
})
