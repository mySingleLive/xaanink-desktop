import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { build } from "esbuild"
import { chromium, type Browser, type Page } from "playwright-core"

// Actual current Controller, dispatcher, registry, scope/targets, input adapter,
// React and installed Base UI. Only native clipboard and main IPC are observed
// in memory; no user window, network, system clipboard or Electron is used.
const css = readFileSync(".next/static/chunks/2g1tpo-0aaw7s.css", "utf8")
const bundle = build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React,{useEffect,useRef,useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {AlertDialog} from '@base-ui/react/alert-dialog';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './src/components/ui/dialog';
import {DesktopCommandController} from './src/components/desktop/DesktopCommandController';
import {registerDesktopCommandTarget,rememberDesktopCommandTarget} from './src/lib/desktop/command-runtime';
import {useDesktopStore} from './src/stores/desktop';import {defaultState} from './desktop/core/settings';
globalThis.commandCalls=[];globalThis.nativeEdits=[];globalThis.notifications=[];
window.desktop={command:async id=>{globalThis.commandCalls.push(id)},readClipboardText:async()=>'',settings:async()=>{throw Error('unexpected settings write')}};
useDesktopStore.setState({bootstrap:{...defaultState,platform:'darwin'}});
function App(){
 const [kind,setKind]=useState(null),background=useRef(null);
 useEffect(()=>registerDesktopCommandTarget({owner:background,accepts:target=>!!background.current?.contains(target),commands:{'file.save':()=>{globalThis.commandCalls.push('file.save')}}}),[]);
 return <><DesktopCommandController/><main><div ref={background} className='desktop-markdown-editor'><input aria-label='背景正文' defaultValue='background text'/></div><button onClick={()=>setKind('dialog')}>打开普通对话框</button><button onClick={()=>setKind('alert')}>打开确认对话框</button></main>
 <Dialog open={kind==='dialog'} onOpenChange={open=>{if(!open)setKind(null)}}><DialogContent><DialogTitle>实际普通对话框</DialogTitle><DialogDescription>原BaseUI配置。</DialogDescription><input aria-label='对话框输入' defaultValue='dialog text'/><button>对话框按钮</button></DialogContent></Dialog>
 <AlertDialog.Root open={kind==='alert'} onOpenChange={open=>{if(!open)setKind(null)}}><AlertDialog.Portal><AlertDialog.Backdrop className='fixed inset-0'/><AlertDialog.Popup className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'><AlertDialog.Title>实际确认对话框</AlertDialog.Title><AlertDialog.Description>原BaseUI确认层。</AlertDialog.Description><input aria-label='确认框输入' defaultValue='alert text'/><AlertDialog.Close>取消确认</AlertDialog.Close></AlertDialog.Popup></AlertDialog.Portal></AlertDialog.Root></>;
}
const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(<App/>));
globalThis.menu=id=>window.dispatchEvent(new CustomEvent('desktop:command',{detail:id}));
globalThis.rememberBackground=()=>rememberDesktopCommandTarget(document.querySelector('[aria-label="背景正文"]'));
globalThis.shortcutOverrides=overrides=>useDesktopStore.setState(state=>({bootstrap:{...state.bootstrap,settings:{...state.bootstrap.settings,shortcuts:{...state.bootstrap.settings.shortcuts,darwin:overrides}}}}));
globalThis.dispose=()=>flushSync(()=>root.unmount());` }, bundle: true, write: false, platform: "browser", format: "iife", tsconfig: "tsconfig.json", plugins: [{ name: "memory-native-boundaries", setup(build) {
  build.onResolve({ filter: /^(sonner|@\/lib\/desktop\/native-text-edits)$/ }, args => ({ path: args.path, namespace: "memory" }))
  build.onLoad({ filter: /.*/, namespace: "memory" }, args => ({ contents: args.path === "sonner" ? `export const toast={info:x=>globalThis.notifications.push(x),error:x=>globalThis.notifications.push(x)}` : `export function nativeTextEdits(){return{run:(id,control)=>{globalThis.nativeEdits.push({id,value:control.value});return true},dispose(){}}}`, loader: "js" }))
} }] }).then(result => result.outputFiles![0].text)

let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.XAANINK_TEST_CHROMIUM ? { executablePath: process.env.XAANINK_TEST_CHROMIUM } : {}) }) })
test.after(async () => { await browser?.close() })
async function scenario(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } }), errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    await page.route("**/*", route => route.request().isNavigationRequest() ? route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }) : route.abort())
    await page.goto("http://127.0.0.1:1/modal-isolated")
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: await bundle })
    await page.getByRole("textbox", { name: "背景正文" }).focus()
    await run(page); assert.deepEqual(errors, [])
  } finally { await page.close() }
}
async function settle(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }

test("MOD60-01: Escape reaches actual BaseUI Dialog from its popup button rather than an unavailable global AI command", async () => scenario(async page => {
  await page.getByRole("button", { name: "打开普通对话框" }).click(); await page.getByRole("dialog").waitFor(); await settle(page)
  await page.getByRole("button", { name: "对话框按钮" }).focus(); await page.keyboard.press("Escape"); await settle(page)
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 1000 })
  assert.equal(await page.getByRole("dialog").count(), 0, "Escape should close the same installed BaseUI popup")
  assert.deepEqual(await page.evaluate(() => (window as any).commandCalls), [])
}))

test("MOD60-02: Escape from a dialog input with no cancel owner dismisses the popup instead of consuming a disabled input.cancel binding", async () => scenario(async page => {
  await page.getByRole("button", { name: "打开普通对话框" }).click(); await page.getByRole("dialog").waitFor(); await settle(page)
  await page.getByRole("textbox", { name: "对话框输入" }).focus(); await page.keyboard.press("Escape"); await settle(page)
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 1000 })
  assert.equal(await page.getByRole("dialog").count(), 0)
  assert.deepEqual(await page.evaluate(() => (window as any).commandCalls), [])
}))

for (const [id, kind, role, opener] of [["MOD60-03", "dialog", "dialog", "打开普通对话框"], ["MOD60-04", "alert", "alertdialog", "打开确认对话框"]] as const) {
  test(`${id}: actual ${kind} popup blocks menu commands for the previously remembered background editor and global native actions`, async () => scenario(async page => {
    await page.evaluate(() => (window as any).menu("file.save")); await settle(page)
    assert.deepEqual(await page.evaluate(() => (window as any).commandCalls), ["file.save"], "the same background owner is actionable before opening a modal")
    await page.evaluate(() => { (window as any).commandCalls = [] })
    await page.getByRole("button", { name: opener }).click(); await page.getByRole(role).waitFor(); await settle(page)
    await page.evaluate(() => { (window as any).menu("file.save"); (window as any).menu("file.open") }); await settle(page)
    assert.deepEqual(await page.evaluate(() => (window as any).commandCalls), [], "native menus must not save/open behind this actual BaseUI modal")
  }))
}

for (const [id, role, opener, input] of [["MOD60-05", "dialog", "打开普通对话框", "对话框输入"], ["MOD60-06", "alertdialog", "打开确认对话框", "确认框输入"]] as const) {
  test(`${id}: ${role} retains its own input menu copy but never copies a stale remembered background input`, async () => scenario(async page => {
    await page.getByRole("button", { name: opener }).click(); await page.getByRole(role).waitFor(); await settle(page)
    await page.getByRole("textbox", { name: input }).focus()
    await page.getByRole("textbox", { name: input }).evaluate((element: HTMLInputElement) => element.setSelectionRange(0, element.value.length))
    await page.evaluate(() => (window as any).menu("text.copy")); await settle(page)
    const expected = { id: "text.copy", value: role === "dialog" ? "dialog text" : "alert text" }
    assert.deepEqual(await page.evaluate(() => (window as any).nativeEdits), [expected])
    await page.evaluate(() => { (window as any).rememberBackground(); (window as any).menu("text.copy") }); await settle(page)
    assert.deepEqual(await page.evaluate(() => (window as any).nativeEdits), [expected], "a stale editor target must not bypass the actual modal")
  }))
}

test("MOD60-07: removing an unowned ordinary-input cancel binding does not remove BaseUI Dialog's independent Escape dismissal", async () => scenario(async page => {
  await page.evaluate(() => (window as any).shortcutOverrides({ "input.cancel": [] }))
  await page.getByRole("button", { name: "打开普通对话框" }).click(); await page.getByRole("dialog").waitFor(); await settle(page)
  await page.getByRole("textbox", { name: "对话框输入" }).focus(); await page.keyboard.press("Escape")
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 1000 })
  assert.deepEqual(await page.evaluate(() => (window as any).commandCalls), [])
}))
