import assert from "node:assert/strict"
import {test} from "node:test"
import {readFile} from "node:fs/promises"
import {resolve} from "node:path"
import {build} from "esbuild"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import {chromium,type Browser,type Page} from "playwright-core"
import type {RootMaintenanceState} from "../../desktop/shared/root-maintenance"

// Independently bundle the actual React/installed BaseUI component. Only its
// narrow preload is controlled; every request outside this isolated page aborts.
const css=(async()=>{const path=resolve("src/app/globals.css");return(await postcss([tailwind()]).process(await readFile(path,"utf8"),{from:path})).css+"\n"+await readFile("src/app/desktop.css","utf8")})()
const script=build({stdin:{loader:"tsx",resolveDir:process.cwd(),contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {RootMaintenanceScreen} from './src/components/desktop/RootMaintenanceScreen';
globalThis.reviewMount=(seed,config={})=>{
 const live=new Set(),all=[],reads=[],writes=[],sequence=[],received=[];let unsub=0,workbench=0;
 const deferred=()=>{let yes,no;const promise=new Promise((resolve,reject)=>{yes=resolve;no=reject});return{promise,yes,no}};
 const ctl={seed,config,live,all,reads,writes,sequence,received,get unsub(){return unsub},get workbench(){return workbench}};
 const bridge={subscribe:listener=>{sequence.push('subscribe');if(config.throwSubscribe)throw Error('sk-secret-subscribe');live.add(listener);all.push(listener);if(config.synchronous)listener(config.synchronous);return()=>{unsub++;live.delete(listener)}},
 state:()=>{sequence.push('state');if(config.throwRead)throw Error('sk-secret-read');const request=deferred();reads.push(request);if(config.emitWhileRead)for(const listener of live)listener(config.emitWhileRead);if(!config.hold)request.yes(seed);return request.promise},
 command:action=>{sequence.push(action);const request=deferred();writes.push({action,...request});if(config.commandEvent)for(const listener of live)listener(config.commandEvent);return request.promise}};
 window.desktop=new Proxy({}, {get(){workbench++;throw Error('normal workbench forbidden')}});window.desktopMaintenance=bridge;
 const root=createRoot(document.getElementById('app'));
 flushSync(()=>root.render(config.strict?React.createElement(React.StrictMode,null,React.createElement(RootMaintenanceScreen)):React.createElement(RootMaintenanceScreen)));
 ctl.emit=state=>flushSync(()=>live.forEach(listener=>listener(state)));ctl.raw=state=>live.forEach(listener=>listener(state));
 ctl.old=state=>flushSync(()=>all.forEach(listener=>listener(state)));ctl.unmount=()=>flushSync(()=>root.unmount());ctl.bridge=bridge;
 globalThis.review=ctl;return ctl;
};
`},bundle:true,platform:"browser",format:"iife",write:false,tsconfig:"tsconfig.json"}).then(result=>result.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.XAANINK_TEST_CHROMIUM})})
test.after(async()=>{await browser?.close()})
const initial:RootMaintenanceState={version:1,revision:1,phase:"copying",theme:"paper",sourcePath:"/本地/原目录",targetPath:"/本地/目标目录",copiedFiles:1,totalFiles:4,canCancel:true,canContinue:false,pendingCount:0}
async function isolated(run:(page:Page)=>Promise<void>){
 const page=await browser.newPage({viewport:{width:760,height:560}}),errors:string[]=[];page.setDefaultTimeout(1600);page.on("pageerror",error=>errors.push(error.message))
 try{await page.route("**/*",route=>route.request().isNavigationRequest()?route.fulfill({contentType:"text/html",body:'<!doctype html><html lang="zh-CN"><body><div id="app"></div></body></html>'}):route.abort());await page.goto("http://127.0.0.1:1/review73-isolated");await page.addStyleTag({content:await css});await page.addScriptTag({content:await script});await run(page);assert.deepEqual(errors,[]);assert.equal(await page.evaluate("review.workbench"),0)}finally{await page.close()}
}
async function mount(page:Page,state:RootMaintenanceState=initial,config:Record<string,unknown>={}){await page.evaluate(({state,config})=>(window as any).reviewMount(state,config),{state,config})}
async function emit(page:Page,state:Partial<RootMaintenanceState>){await page.evaluate(state=>(window as any).review.emit(state),{...initial,...state})}

test("MUI73-01 synchronous reentrant read event outranks initial snapshot and old/equal updates cannot restore permissions",async()=>isolated(async page=>{
 await mount(page,initial,{emitWhileRead:{...initial,revision:8,phase:"verifying",canCancel:false}});await page.getByRole("status").filter({hasText:"校验"}).waitFor();assert.deepEqual(await page.evaluate("review.sequence"),["subscribe","state"]);await emit(page,{revision:7,phase:"copying",canCancel:true});await emit(page,{revision:8,phase:"failed",canCancel:true});assert.equal(await page.getByRole("button",{name:"取消迁移"}).count(),0);assert.match(await page.getByRole("status").innerText(),/校验/)
}))
test("MUI73-02 StrictMode old connection has distinct initial promise and cannot publish its greater revision or rejected read",async()=>isolated(async page=>{
 await mount(page,initial,{hold:true,strict:true});assert.equal(await page.evaluate("review.reads.length"),2);assert.equal(await page.evaluate("review.unsub"),1);await page.evaluate(state=>(window as any).review.reads[1].yes(state),{...initial,revision:5,phase:"verifying"});await page.getByRole("status").filter({hasText:"校验"}).waitFor();await page.evaluate(state=>(window as any).review.all[0](state),{...initial,revision:100,phase:"failed"});await page.evaluate("review.reads[0].no(Error('sk-stale-initial'))");await page.waitForTimeout(20);assert.match(await page.getByRole("status").innerText(),/校验/);assert.equal(await page.getByRole("alert").count(),0);await page.evaluate("review.unmount()");assert.equal(await page.evaluate("review.unsub"),2)
}))
test("MUI73-03 permission changes before React DOM commit block stale enabled cancel and continue button activations",async()=>isolated(async page=>{
 await mount(page);await page.getByRole("button",{name:"取消迁移"}).waitFor();await page.evaluate(state=>{const button=document.querySelector<HTMLButtonElement>('[data-maintenance-command="cancel"]')!;(window as any).review.raw(state);button.click()},{...initial,revision:2,phase:"committing",canCancel:false});assert.equal(await page.evaluate("review.writes.length"),0);await emit(page,{revision:3,phase:"complete",canCancel:false,canContinue:true});await page.getByRole("button",{name:"返回工作台"}).waitFor();await page.evaluate(state=>{const button=document.querySelector<HTMLButtonElement>('[data-maintenance-command="continue"]')!;(window as any).review.raw(state);button.click()},{...initial,revision:4,phase:"recovery-required",canCancel:false,canContinue:false});assert.equal(await page.evaluate("review.writes.length"),0);await page.getByRole("button",{name:"退出应用"}).waitFor()
}))
test("MUI73-04 synchronous command completion event retains main result, disables newly enabled continue until pending settles, and safe rejection does not revert it",async()=>isolated(async page=>{
 await mount(page,initial,{commandEvent:{...initial,revision:2,phase:"complete",canCancel:false,canContinue:true}});await page.getByRole("button",{name:"取消迁移"}).click();await page.getByRole("status").filter({hasText:"迁移完成"}).waitFor();assert.equal(await page.getByRole("button",{name:"返回工作台"}).isDisabled(),true);await page.evaluate("review.writes[0].no(Error('sk-command-cause'))");await page.getByRole("alert").waitFor();assert.match(await page.getByRole("status").innerText(),/迁移完成/);assert.equal(await page.getByRole("button",{name:"返回工作台"}).isDisabled(),false);assert.doesNotMatch(await page.locator("main").innerText(),/sk-command-cause/);assert.deepEqual(await page.evaluate("review.writes.map(row=>row.action)"),["cancel"])
}))
test("MUI73-05 old subscription, read and command settlements remain isolated after actual unmount and remount",async()=>isolated(async page=>{
 await mount(page,initial,{hold:true});await emit(page,{revision:2});await page.getByRole("button",{name:"取消迁移"}).click();await page.evaluate("globalThis.retired=review;review.unmount()");await mount(page,{...initial,revision:3,theme:"ink",phase:"verifying"});await page.evaluate(state=>{const retired=(window as any).retired;retired.old(state);retired.reads[0].yes(state);retired.writes[0].no(Error("sk-old-command"))},{...initial,revision:999,phase:"failed",canCancel:false});await page.waitForTimeout(20);assert.match(await page.getByRole("status").innerText(),/校验/);assert.equal(await page.locator("main.ink").count(),1);assert.equal(await page.getByRole("alert").count(),0);assert.equal(await page.evaluate("retired.unsub"),1)
}))
test("MUI73-06 impossible copied over total event is rejected without replacing last truthful progress",async()=>isolated(async page=>{
 await mount(page);await page.getByText("已复制 1 / 4 个文件",{exact:true}).waitFor();await emit(page,{revision:2,copiedFiles:7,totalFiles:4});assert.equal(await page.getByText("已复制 1 / 4 个文件",{exact:true}).count(),1);assert.equal(await page.getByText("已复制 7 / 4 个文件",{exact:true}).count(),0);await page.getByRole("alert").waitFor();await emit(page,{revision:3,copiedFiles:2,totalFiles:4});await page.getByText("已复制 2 / 4 个文件",{exact:true}).waitFor();assert.equal(await page.getByRole("alert").count(),0)
}))
test("MUI73-07 original BaseUI keyboard activation obeys pending disabled semantics and only emits restricted cancel",async()=>isolated(async page=>{
 await mount(page);const cancel=page.getByRole("button",{name:"取消迁移"});await cancel.focus();await page.keyboard.press("Enter");await page.keyboard.press("Enter");await page.keyboard.press("Space");assert.deepEqual(await page.evaluate("review.writes.map(row=>row.action)"),["cancel"]);assert.equal(await page.getByRole("button",{name:"正在取消…"}).isDisabled(),true);assert.equal(await page.getByRole("button",{name:"退出应用"}).isDisabled(),true);await page.evaluate("review.writes[0].yes()");await page.getByRole("button",{name:"取消迁移"}).waitFor();assert.match(await page.getByRole("status").innerText(),/复制/)
}))
test("MUI73-08 subscribe or synchronous state failure still permits guarded local quit without normal workbench fallback",async()=>isolated(async page=>{
 await mount(page,initial,{throwSubscribe:true});await page.getByRole("alert").waitFor();assert.deepEqual(await page.evaluate("review.sequence"),["subscribe"]);await page.getByRole("button",{name:"退出应用"}).click();assert.equal(await page.getByRole("button",{name:"正在退出…"}).isDisabled(),true);assert.doesNotMatch(await page.locator("main").innerText(),/sk-secret/);await page.evaluate("review.writes[0].yes();review.unmount()");await mount(page,initial,{throwRead:true});await page.getByRole("alert").waitFor();assert.deepEqual(await page.evaluate("review.sequence"),["subscribe","state"]);await page.getByRole("button",{name:"退出应用"}).click();assert.deepEqual(await page.evaluate("review.writes.map(row=>row.action)"),["quit"])
}))
test("MUI73-09 invalid unsupported revision event preserves authority and unknown counts stay indeterminate instead of fake percentage",async()=>isolated(async page=>{
 await mount(page,{...initial,totalFiles:null});await page.getByRole("progressbar").waitFor();await page.evaluate(state=>(window as any).review.emit(state),{...initial,revision:2,phase:"toString"});assert.match(await page.getByRole("status").innerText(),/复制/);await page.getByRole("alert").waitFor();assert.equal(await page.getByRole("progressbar").getAttribute("value"),null);assert.doesNotMatch(await page.locator("main").innerText(),/\d+\s*%/);await emit(page,{revision:3,totalFiles:0,copiedFiles:0});assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuetext"),"已复制 0 / 0 个文件");assert.equal(await page.getByRole("progressbar").getAttribute("max"),"1")
}))
test("MUI73-10 both themes with 4096-character paths at 320x240 retain native buttons, exact pending descriptions and reachable scrolling",async()=>isolated(async page=>{
 const path="/"+"路径/".repeat(1365);assert.equal(path.length,4096);await page.setViewportSize({width:320,height:240});await mount(page,{...initial,sourcePath:path,targetPath:path,phase:"cleanup-pending",canCancel:false,canContinue:true,pendingCount:4});await page.getByText("旧目录仍有 4 项待清理，可继续使用新目录。",{exact:true}).waitFor();const paper=await page.locator("main").evaluate(element=>({color:getComputedStyle(element).color,background:getComputedStyle(element).backgroundColor,width:element.clientWidth,scroll:element.scrollWidth}));assert.ok(paper.scroll<=paper.width);await page.getByRole("button",{name:"返回工作台"}).scrollIntoViewIfNeeded();const box=await page.getByRole("button",{name:"返回工作台"}).boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=241);assert.equal(await page.locator('[data-slot="button"]').count(),1);await page.screenshot({path:"docs/evidence/implementation-12/review73-paper-long-path.png"});await emit(page,{revision:2,theme:"ink",sourcePath:path,targetPath:path,phase:"rollback-pending",canCancel:false,canContinue:true,pendingCount:2});await page.getByText("目标目录仍有 2 项待处理，可返回原目录。",{exact:true}).waitFor();const ink=await page.locator("main").evaluate(element=>({color:getComputedStyle(element).color,background:getComputedStyle(element).backgroundColor,width:element.clientWidth,scroll:element.scrollWidth}));assert.notEqual(ink.background,paper.background);assert.notEqual(ink.color,paper.color);assert.ok(ink.scroll<=ink.width);assert.equal(await page.getByRole("progressbar").count(),0);assert.equal(await page.locator(".dashboard-shell,.sidebar-tree,[data-desktop-menu-button]").count(),0);await page.getByRole("button",{name:"返回工作台"}).scrollIntoViewIfNeeded();await page.screenshot({path:"docs/evidence/implementation-12/review73-ink-long-path.png"})
}))
