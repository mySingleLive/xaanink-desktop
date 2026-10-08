import assert from "node:assert/strict"
import { test } from "node:test"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { build } from "esbuild"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { chromium, type Browser, type Page } from "playwright-core"
import type { RootMaintenanceState } from "../../desktop/shared/root-maintenance"

// Actual React, installed BaseUI Button and current semantic CSS. Only the
// restricted maintenance preload is controlled. No workbench bridge, native
// application, real data root, disk migration or paid model is opened.
const stylesheet = (async () => {
  const path = resolve("src/app/globals.css")
  const css = await postcss([tailwindcss()]).process(await readFile(path, "utf8"), { from: path })
  return css.css + "\n" + await readFile("src/app/desktop.css", "utf8")
})()
const bundle = build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {RootMaintenanceScreen} from './src/components/desktop/RootMaintenanceScreen';
globalThis.mountMaintenance=(initial,options={})=>{
 const listeners=new Set(),past=[],calls=[],commands=[];let resolveState,rejectState,resolveCommand,rejectCommand,unsubscribes=0;
 const first=new Promise((yes,no)=>{resolveState=yes;rejectState=no});
 window.desktopMaintenance={
  subscribe:listener=>{calls.push('subscribe');listeners.add(listener);past.push(listener);if(options.subscribeEvent)listener(options.subscribeEvent);return()=>{unsubscribes++;listeners.delete(listener)}},
  state:()=>{calls.push('state');return options.holdInitial?first:Promise.resolve(initial)},
  command:command=>{commands.push(command);return new Promise((yes,no)=>{resolveCommand=yes;rejectCommand=no})},
 };
 const root=createRoot(document.getElementById('app'));
 flushSync(()=>root.render(options.strict?React.createElement(React.StrictMode,null,React.createElement(RootMaintenanceScreen)):React.createElement(RootMaintenanceScreen)));
 return{calls,commands,emit:state=>flushSync(()=>listeners.forEach(listener=>listener(state))),late:state=>flushSync(()=>past.forEach(listener=>listener(state))),
 resolveState:state=>resolveState(state),rejectState:()=>rejectState(Error('private-state-key-do-not-render')),
 resolveCommand:()=>resolveCommand(),rejectCommand:()=>rejectCommand(Error('private-command-key-do-not-render')),
 unsubscribes:()=>unsubscribes,unmount:()=>flushSync(()=>root.unmount())};
};
globalThis.mountWithoutBridge=()=>{delete window.desktopMaintenance;window.desktop={command:()=>{throw Error('workbench bridge must stay unused')}};const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(React.createElement(RootMaintenanceScreen)));return()=>flushSync(()=>root.unmount())};
` }, bundle: true, platform: "browser", format: "iife", write: false, tsconfig: "tsconfig.json" }).then(result => result.outputFiles![0].text)

let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.XAANINK_TEST_CHROMIUM ? { executablePath: process.env.XAANINK_TEST_CHROMIUM } : {}) }) })
test.after(async () => { await browser?.close() })
const initial: RootMaintenanceState = { version: 1, revision: 1, phase: "preparing", theme: "paper", sourcePath: "/Volumes/写作/旧数据", targetPath: "/Volumes/写作/新数据", copiedFiles: 0, totalFiles: null, canCancel: true, canContinue: false, pendingCount: 0 }
async function scenario(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 820, height: 620 } }), errors: string[] = []
  page.setDefaultTimeout(1500)
  page.on("pageerror", error => errors.push(error.message))
  try {
    await page.route("**/*", route => route.request().isNavigationRequest() ? route.fulfill({ contentType: "text/html", body: '<div id="app"></div>' }) : route.abort())
    await page.goto("http://127.0.0.1:1/maintenance-isolated")
    await page.addStyleTag({ content: await stylesheet }); await page.addScriptTag({ content: await bundle })
    await run(page); assert.deepEqual(errors, [])
  } finally { await page.close() }
}
async function mount(page: Page, state: RootMaintenanceState = initial, options: Record<string, unknown> = {}) {
  await page.evaluate(({state,options}) => { (window as any).f = (window as any).mountMaintenance(state, options) }, {state,options})
}
async function emit(page: Page, state: Partial<RootMaintenanceState> & Pick<RootMaintenanceState, "revision">) {
  await page.evaluate(state => (window as any).f.emit(state), { ...initial, ...state })
}

test("RUI12-01: subscription precedes initial read and newer progress suppresses late initial, old and equal revisions", async () => scenario(async page => {
  await mount(page, initial, { holdInitial: true })
  assert.deepEqual(await page.evaluate(() => (window as any).f.calls), ["subscribe", "state"])
  await emit(page, {revision: 7, phase: "verifying", copiedFiles: 5, totalFiles: 5})
  await page.getByRole("status").filter({hasText: "校验"}).waitFor()
  await page.evaluate(initial => (window as any).f.resolveState(initial), initial)
  await emit(page, {revision: 6, phase: "copying"}); await emit(page, {revision: 7, phase: "failed"})
  assert.match(await page.getByRole("status").innerText(), /校验/)
  assert.doesNotMatch(await page.getByRole("status").innerText(), /迁移失败/)
}))

test("RUI12-02: all six real stages show their correct label and indeterminate progress never fabricates totals", async () => scenario(async page => {
  await mount(page)
  const phases = [["preparing","准备"],["validating","检查"],["copying","复制"],["verifying","校验"],["committing","切换目录"],["cleanup","清理"]] as const
  for (const [index,[phase,label]] of phases.entries()) {
    await emit(page, {revision:index+2,phase,totalFiles:null,copiedFiles:index})
    assert.match(await page.getByRole("status").innerText(), new RegExp(label))
    const progress = page.getByRole("progressbar", {name:"迁移进度"})
    assert.equal(await progress.getAttribute("value"), null)
    assert.equal(await progress.getAttribute("aria-valuenow"), null)
    assert.doesNotMatch(await page.locator("main").innerText(), /\d+\s*%|\d+\s*\/\s*\d+/)
  }
}))

test("RUI12-03: a real count is rendered exactly, including known zero, without fake percentages or path interpretation", async () => scenario(async page => {
  await mount(page, {...initial,phase:"copying",copiedFiles:2,totalFiles:9,sourcePath:'<img src=x onerror=alert(1)>',targetPath:'/新目录/特别长的本地路径'})
  await page.getByText("已复制 2 / 9 个文件",{exact:true}).waitFor()
  const progress=page.getByRole("progressbar",{name:"迁移进度"})
  assert.equal(await progress.getAttribute("value"), "2"); assert.equal(await progress.getAttribute("max"), "9")
  assert.equal(await page.locator("img").count(),0); await page.getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor()
  await emit(page,{revision:2,phase:"copying",copiedFiles:0,totalFiles:0})
  await page.getByText("已复制 0 / 0 个文件",{exact:true}).waitFor()
  assert.equal(await progress.getAttribute("aria-valuetext"),"已复制 0 / 0 个文件")
}))

test("RUI12-04: main controls cancellation and synchronous double activation issues only one command, without optimistic completion", async () => scenario(async page => {
  await mount(page); await page.getByRole("button",{name:"取消迁移",exact:true}).waitFor()
  await page.evaluate(()=>{const button=document.querySelector<HTMLButtonElement>('[data-maintenance-command="cancel"]')!;button.click();button.click()})
  assert.deepEqual(await page.evaluate(()=>(window as any).f.commands),["cancel"])
  assert.equal(await page.getByRole("button",{name:"正在取消…",exact:true}).isDisabled(),true)
  assert.equal(await page.getByRole("button",{name:"退出应用",exact:true}).isDisabled(),true)
  await page.evaluate(()=>(window as any).f.resolveCommand())
  await page.getByRole("button",{name:"取消迁移",exact:true}).waitFor(); assert.match(await page.getByRole("status").innerText(),/准备/)
  await emit(page,{revision:2,phase:"committing",canCancel:false})
  assert.equal(await page.getByRole("button",{name:"取消迁移",exact:true}).count(),0)
  assert.deepEqual(await page.evaluate(()=>(window as any).f.commands),["cancel"])
}))

test("RUI12-05: rejected command uses safe local text, leaves authority untouched and permits explicit retry", async () => scenario(async page => {
  await mount(page); await page.getByRole("button",{name:"取消迁移",exact:true}).click()
  await page.evaluate(()=>(window as any).f.rejectCommand())
  await page.getByRole("alert").filter({hasText:"操作未完成，请重试。"}).waitFor()
  assert.doesNotMatch(await page.locator("main").innerText(),/private-command-key/)
  assert.match(await page.getByRole("status").innerText(),/准备/)
  await page.getByRole("button",{name:"取消迁移",exact:true}).click()
  assert.deepEqual(await page.evaluate(()=>(window as any).f.commands),["cancel","cancel"])
}))

test("RUI12-06: continue and quit follow only main flags, use restricted commands and cannot be triggered while another command is pending", async () => scenario(async page => {
  await mount(page,{...initial,phase:"complete",canContinue:true,canCancel:false,totalFiles:9,copiedFiles:9})
  assert.equal(await page.getByRole("button",{name:"退出应用",exact:true}).count(),0)
  await page.getByRole("button",{name:"返回工作台",exact:true}).click()
  assert.deepEqual(await page.evaluate(()=>(window as any).f.commands),["continue"])
  assert.equal(await page.getByRole("button",{name:"正在返回…",exact:true}).isDisabled(),true)
  await page.evaluate(()=>(window as any).f.resolveCommand())
  await emit(page,{revision:2,phase:"failed",canContinue:false,canCancel:false})
  await page.getByRole("button",{name:"退出应用",exact:true}).click()
  assert.deepEqual(await page.evaluate(()=>(window as any).f.commands),["continue","quit"])
  assert.equal(await page.getByRole("button",{name:"正在退出…",exact:true}).isDisabled(),true)
}))

test("RUI12-07: cleanup-pending is truthful and distinct from complete, cancelled, failed and recovery-required", async () => scenario(async page => {
  await mount(page,{...initial,phase:"cleanup-pending",canContinue:true,canCancel:false,pendingCount:3})
  await page.getByText("旧目录仍有 3 项待清理，可继续使用新目录。",{exact:true}).waitFor()
  assert.doesNotMatch(await page.getByRole("status").innerText(),/全部清理完成/)
  if(process.env.XAANINK_TEST_SCREENSHOTS)await page.screenshot({path:"docs/evidence/implementation-12/root-maintenance-ui-paper-cleanup-pending.png"})
  const terminals=[["complete","迁移完成"],["cancelled","迁移已取消"],["failed","迁移失败"],["recovery-required","需要恢复"]] as const
  for (const [index,[phase,text]] of terminals.entries()) {
    await emit(page,{revision:index+2,phase,canCancel:false,canContinue:phase==="complete",pendingCount:0})
    assert.match(await page.getByRole("status").innerText(),new RegExp(text))
    assert.equal(await page.getByRole("progressbar").count(),0)
  }
  await page.getByText("原数据已保留，需要处理恢复问题后再继续。",{exact:true}).waitFor()
  assert.equal(await page.getByRole("button",{name:"返回工作台",exact:true}).count(),0)
}))

test("RUI12-08: initial read failure after a valid subscribed event retains current authority and does not leak exception details", async () => scenario(async page => {
  await mount(page,initial,{holdInitial:true,subscribeEvent:{...initial,revision:4,phase:"cleanup",copiedFiles:11,totalFiles:11,canCancel:false}})
  await page.evaluate(()=>(window as any).f.rejectState())
  await page.getByRole("alert").filter({hasText:"暂时无法读取迁移状态，请稍后重试。"}).waitFor()
  assert.match(await page.getByRole("status").innerText(),/清理/)
  assert.doesNotMatch(await page.locator("main").innerText(),/private-state-key/)
  await emit(page,{revision:5,phase:"complete",canContinue:true,canCancel:false})
  assert.equal(await page.getByRole("alert").count(),0)
}))

test("RUI12-09: unmount unsubscribes and ignores late initial, progress and rejected command without changing a new mount", async () => scenario(async page => {
  await mount(page,initial,{holdInitial:true})
  await emit(page,{revision:2,phase:"copying"}); await page.getByRole("button",{name:"取消迁移",exact:true}).click()
  await page.evaluate(()=>{(window as any).old=(window as any).f;(window as any).old.unmount()})
  assert.equal(await page.evaluate(()=>(window as any).old.unsubscribes()),1)
  await mount(page,{...initial,phase:"verifying",revision:8})
  await page.evaluate(state=>{(window as any).old.late(state);(window as any).old.resolveState(state);(window as any).old.rejectCommand()},{...initial,revision:20,phase:"failed"})
  await page.getByRole("status").filter({hasText:"校验"}).waitFor()
  assert.equal(await page.getByRole("alert").count(),0)
}))

test("RUI12-10: StrictMode effect replacement keeps only the live subscription and accepts its valid revision", async () => scenario(async page => {
  await mount(page,initial,{strict:true,holdInitial:true})
  assert.deepEqual(await page.evaluate(()=>(window as any).f.calls),["subscribe","state","subscribe","state"])
  assert.equal(await page.evaluate(()=>(window as any).f.unsubscribes()),1)
  await emit(page,{revision:3,phase:"copying",copiedFiles:4,totalFiles:6})
  await page.getByText("已复制 4 / 6 个文件",{exact:true}).waitFor()
  await page.evaluate(()=>(window as any).f.unmount())
  assert.equal(await page.evaluate(()=>(window as any).f.unsubscribes()),2)
}))

test("RUI12-11: paper and ink use original semantic surface/font/Button, with a draggable reserved top region and narrow safe layout", async () => scenario(async page => {
  const sourcePath="/本地/"+"非常长的目录".repeat(30)
  await mount(page,{...initial,theme:"ink",sourcePath})
  await page.getByRole("button",{name:"取消迁移",exact:true}).waitFor()
  assert.equal(await page.locator("main.ink").count(),1)
  assert.equal(await page.locator('[data-slot="button"]').count(),2)
  assert.equal(await page.locator(".desktop-drag").count(),1)
  const ink=await page.locator("main").evaluate(element=>({surface:getComputedStyle(element).backgroundColor,foreground:getComputedStyle(element).color,font:getComputedStyle(element).fontFamily}))
  if(process.env.XAANINK_TEST_SCREENSHOTS)await page.screenshot({path:"docs/evidence/implementation-12/root-maintenance-ui-ink.png"})
  await emit(page,{revision:2,theme:"paper",sourcePath})
  const paper=await page.locator("main").evaluate(element=>({surface:getComputedStyle(element).backgroundColor,foreground:getComputedStyle(element).color,font:getComputedStyle(element).fontFamily}))
  assert.notEqual(ink.surface,paper.surface); assert.notEqual(ink.foreground,paper.foreground); assert.equal(ink.font,paper.font)
  await page.setViewportSize({width:360,height:620})
  const dimensions=await page.locator("main").evaluate(element=>({scroll:element.scrollWidth,width:element.clientWidth}))
  assert.ok(dimensions.scroll<=dimensions.width,JSON.stringify(dimensions))
  assert.equal(await page.locator(".dashboard-shell,[data-desktop-menu-button]").count(),0)
  await page.getByRole("button",{name:"取消迁移",exact:true}).scrollIntoViewIfNeeded()
  const button=await page.getByRole("button",{name:"取消迁移",exact:true}).boundingBox()
  assert.ok(button&&button.y>=0&&button.y+button.height<=621,JSON.stringify(button))
  if(process.env.XAANINK_TEST_SCREENSHOTS)await page.screenshot({path:"docs/evidence/implementation-12/root-maintenance-ui-paper-narrow.png"})
}))

test("RUI12-12: missing restricted bridge shows a safe unavailable state and never calls a workbench bridge", async () => scenario(async page => {
  await page.evaluate(()=>(window as any).mountWithoutBridge())
  await page.getByRole("alert").filter({hasText:"迁移状态暂不可用，请重新打开应用。"}).waitFor()
  assert.equal(await page.getByRole("button").count(),0)
  assert.equal(await page.getByRole("heading",{name:"迁移应用数据"}).count(),1)
}))

test("RUI12-13: first snapshot failure leaves a restricted quit action available without inventing a root or progress state", async () => scenario(async page => {
  await mount(page,initial,{holdInitial:true})
  await page.evaluate(()=>(window as any).f.rejectState())
  await page.getByRole("alert").filter({hasText:"暂时无法读取迁移状态，请稍后重试。"}).waitFor()
  assert.equal(await page.getByRole("progressbar").count(),0)
  assert.equal(await page.getByRole("button",{name:"返回工作台",exact:true}).count(),0)
  assert.equal(await page.getByRole("button",{name:"取消迁移",exact:true}).count(),0)
  await page.getByRole("button",{name:"退出应用",exact:true}).click()
  assert.deepEqual(await page.evaluate(()=>(window as any).f.commands),["quit"])
  assert.equal(await page.getByRole("button",{name:"正在退出…",exact:true}).isDisabled(),true)
}))

test("RUI12-14: explicit cleanup and rollback pending phases name the retained directory, exact pending count and safe continuation", async () => scenario(async page => {
  await mount(page,{...initial,phase:"cleanup-pending",canCancel:false,canContinue:true,pendingCount:3})
  await page.getByRole("status").filter({hasText:"迁移完成，清理待处理"}).waitFor()
  await page.getByText("旧目录仍有 3 项待清理，可继续使用新目录。",{exact:true}).waitFor()
  assert.equal(await page.getByRole("progressbar").count(),0)
  await page.getByRole("button",{name:"返回工作台",exact:true}).click()
  assert.deepEqual(await page.evaluate(()=>(window as any).f.commands),["continue"])
  await page.evaluate(()=>(window as any).f.resolveCommand())
  await emit(page,{revision:2,phase:"rollback-pending",canCancel:false,canContinue:true,pendingCount:2})
  await page.getByRole("status").filter({hasText:"迁移已停止，回滚待处理"}).waitFor()
  await page.getByText("目标目录仍有 2 项待处理，可返回原目录。",{exact:true}).waitFor()
  assert.doesNotMatch(await page.getByRole("status").innerText(),/迁移完成/)
  assert.equal(await page.getByRole("progressbar").count(),0)
  assert.equal(await page.getByRole("button",{name:"返回工作台",exact:true}).isDisabled(),false)
}))
