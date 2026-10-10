import assert from "node:assert/strict"
import {test} from "node:test"
import {readFile,readdir} from "node:fs/promises"
import {build} from "esbuild"
import {chromium,type Browser,type Page} from "playwright-core"

// Current React, WorkLeasePendingDialog, DesktopApp, original BaseUI Dialog/Button
// and compiled application CSS. Other workspace children and the main bridge
// are controlled; no native prompt, filesystem repair, Electron or OS claim.
const css=readdir(".next/static/chunks").then(async files=>(await Promise.all(files.filter(file=>file.endsWith(".css")).sort().map(file=>readFile(".next/static/chunks/"+file,"utf8")))).join("\n"))
const mocks:Record<string,string>={
 "@/components/layout/DashboardShell":`import React from 'react';export function DashboardShell(){return <main><input aria-label='旧工作台正文' defaultValue='原草稿'/></main>}`,
 "next-themes":`const setTheme=()=>{};export const useTheme=()=>({setTheme})`,
 "@tanstack/react-query":`const client={invalidateQueries:async()=>{}};export const useQueryClient=()=>client`,
 "@/stores/chat":`const state={pendingRequest:null,isGenerating:false};export const useChatStore={getState:()=>state,setState(){}}`,
 "@/stores/tabs":`export const useTabsStore={getState:()=>({activeTabId:'chapter'})}`,
 "@/lib/desktop/transport":`export const installDesktopTransport=()=>{}`,
 "@/lib/desktop/appearance":`export const desktopFontFamily=()=> 'sans-serif'`,
 "@/lib/desktop/chat-defaults":`export const inheritedChatChoices=()=>({})`,
 "@/lib/desktop/command-runtime":`export const setDesktopCatalogStatus=()=>{}`,
 "@/lib/desktop/monaco-commands":`export const initializeMonacoCommandCatalog=async()=>()=>{}`,
 "@/lib/desktop/use-command-target":`export const useDesktopCommands=commands=>{globalThis.commands=commands}`,
 "@/lib/desktop/draft-session":`export class DesktopDraftSession{constructor(bridge,save,options){this.options=options}async initialize(){}async flush(){}async handle(event){if(event.type==='close-cancelled')this.options.closing(false);else this.options.closing(true)}dispose(){}}`,
 "@/lib/desktop/save-coordinator":`export const desktopSaveCoordinator={}`,
 "@/lib/desktop/draft-sources":`export const installDesktopDraftSources=()=>()=>{}`,
 "@/lib/desktop/workspace-draft-source":`export const installWorkspaceDraftSource=()=>()=>{}`,
 "@/lib/desktop/comment-draft-source":`export const installCommentDraftSource=()=>()=>{}`,
 "@/lib/desktop/draft-recovery":`export const restoreDesktopDraft=async()=>({});export const installRecoveryDraftSource=()=>()=>{}`,
 "@/lib/desktop/recovery-targets":`export const createRecoveryVerifier=()=>()=>{}`,
 "@/lib/chat-session":`export const browserSessionStorage=()=>({})`,
 "sonner":`export const toast={info:x=>globalThis.messages.push(x),success:x=>globalThis.messages.push(x),error:x=>globalThis.messages.push(x)}`,
}
const emptyChildren:Record<string,string>={"./WindowControls":"WindowsMenuControl","./SettingsDialog":"SettingsDialog","./ModelRequiredDialog":"ModelRequiredDialog","./DesktopCommandController":"DesktopCommandController","./DesktopNavigation":"DesktopNavigation","./RecoveryDialog":"RecoveryDialog","./TemplateManagementDialog":"TemplateManagementDialog"}
const bundle=build({stdin:{loader:"tsx",resolveDir:process.cwd(),contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{WorkLeasePendingDialog}from'./src/components/desktop/WorkLeasePendingDialog';import DesktopApp from'./src/components/desktop/DesktopApp';
import{useDesktopStore}from'./src/stores/desktop';import{defaultState}from'./desktop/core/settings';
globalThis.mountLeaseUI=(mode='dialog',options={})=>{
 const calls=[],repairs=[],listeners=[],messages=[];globalThis.messages=messages;
 const state={...structuredClone(defaultState),revision:0,platform:'darwin',version:'0.1.0',dataRoot:'/controlled/local',draftSessionId:'b0000000-0000-4000-8000-000000000001',systemDark:false};
 useDesktopStore.setState({bootstrap:null});let bootResolve;const bridge={bootstrap:()=>options.holdBootstrap?new Promise(resolve=>{bootResolve=resolve}):Promise.resolve(state),subscribe:listener=>{listeners.push(listener);return()=>listeners.splice(listeners.indexOf(listener),1)},repairWorkLease:action=>{calls.push({api:'repair',...action});return new Promise((resolve,reject)=>repairs.push({resolve,reject}))},replyClose:async()=>true};
 if(options.missingRepair)delete bridge.repairWorkLease;window.desktop=new Proxy(bridge,{get(target,key){if(/backup|restoreWork|restoreApplication/i.test(String(key)))throw Error('retired bridge accessed '+String(key));return target[key]}});
 const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(mode==='dialog'?<WorkLeasePendingDialog open={true}/>:<DesktopApp/>));
 return{calls,messages,repairs,repair:(value,index=0)=>repairs[index].resolve(value),repairFail:(index=0)=>repairs[index].reject(Error('private-native-path-key')),emit:event=>listeners.slice().forEach(listener=>listener(event)),boot:()=>bootResolve(state),unmount:()=>flushSync(()=>root.unmount())};
};`},bundle:true,platform:"browser",format:"iife",write:false,tsconfig:"tsconfig.json",plugins:[{name:"controlled-workspace",setup(builder){
 // esbuild returns native importer paths; preserve this boundary on Windows.
 builder.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:"controlled"}:args.importer.replaceAll("\\", "/").endsWith("/DesktopApp.tsx")&&emptyChildren[args.path]?{path:args.path,namespace:"empty-child"}:undefined)
 builder.onLoad({filter:/.*/,namespace:"controlled"},args=>({contents:mocks[args.path],loader:"tsx",resolveDir:process.cwd()}))
 builder.onLoad({filter:/.*/,namespace:"empty-child"},args=>({contents:`export const ${emptyChildren[args.path]}=()=>null`,loader:"js"}))
}}]}).then(result=>result.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.XAANINK_TEST_CHROMIUM})})
test.after(async()=>{await browser?.close()})
async function scenario(mode:"dialog"|"app",run:(page:Page)=>Promise<void>,options:Record<string,boolean>={}){
 const page=await browser.newPage({viewport:{width:1000,height:760}}),errors:string[]=[];page.setDefaultTimeout(2200);page.on("pageerror",error=>errors.push(error.message))
 try{await page.setContent('<div id="app"></div>');await page.addStyleTag({content:await css});await page.addScriptTag({content:await bundle});await page.evaluate(({mode,options})=>{(window as any).f=(window as any).mountLeaseUI(mode,options)},{mode,options});await(mode==="dialog"?page.getByRole("heading",{name:"作品锁修复交接尚未完成",exact:true}):options.holdBootstrap?page.getByRole("status"):page.getByLabel("旧工作台正文")).waitFor();await run(page);assert.deepEqual(errors,[])}finally{await page.close()}
}
async function settle(page:Page){await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))}
// Backup owner/list/restore interactions (including LUI23-03) are preserved
// verbatim in the mixed original. Current lease invariants exercise the actual
// remaining pending dialog and its narrow retry bridge.
test("LUI23-01 pending repair uses only the narrow retry command with no backup or work-selection bridge",()=>scenario("dialog",async page=>{
 await page.getByRole("button",{name:"重试完成修复",exact:true}).click();assert.deepEqual(await page.evaluate(()=>(window as any).f.calls),[{api:'repair',type:'retry'}]);assert.equal(await page.locator('select').count(),0);await page.evaluate(()=>(window as any).f.repair('pending'));await page.getByRole("button",{name:"重试完成修复",exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),1)
}))
test("LUI23-02 pending repair is single-flight and disables retry until the authoritative reply",()=>scenario("dialog",async page=>{
 await page.evaluate(()=>{const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='重试完成修复')!;button.click();button.click()});await page.getByRole("button",{name:"正在重试…",exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:"正在重试…",exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>(window as any).f.repairs.length),1)
 await page.evaluate(()=>(window as any).f.repair('pending'));await page.getByRole("button",{name:"重试完成修复",exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),1)
}))
for(const result of ['pending','restarting'] as const)test(`LUI23-04-${result} repair does not claim success or release the barrier after ${result}`,()=>scenario("dialog",async page=>{
 await page.getByRole("button",{name:"重试完成修复",exact:true}).click();await page.evaluate(result=>(window as any).f.repair(result),result);await page.getByRole('heading',{name:result==='pending'?'作品锁修复交接尚未完成':'正在重新启动工作台',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),1);assert.doesNotMatch(await page.getByRole('dialog').innerText(),/修复成功|修复完成|已取消/);assert.equal(await page.getByRole('button',{name:'Close',exact:true}).count(),0)
}))
test("LUI23-05 failed repair is safely described, retains the barrier, and permits deliberate retry",()=>scenario("dialog",async page=>{
 await page.getByRole("button",{name:"重试完成修复",exact:true}).click();await page.evaluate(()=>(window as any).f.repairFail());await page.getByRole("alert").filter({hasText:"修复交接仍未完成"}).waitFor();assert.doesNotMatch(await page.locator('body').innerText(),/private-native-path-key/);assert.equal(await page.getByRole('dialog').count(),1);await page.getByRole("button",{name:"重试完成修复",exact:true}).click();assert.equal(await page.evaluate(()=>(window as any).f.repairs.length),2);await page.evaluate(()=>(window as any).f.repair('pending',1))
}))
test("LUI23-06 missing repair bridge never invents an executable repair action or releases the barrier",()=>scenario("dialog",async page=>{
 await page.getByRole("button",{name:"重试完成修复",exact:true}).click();await page.getByRole("alert").filter({hasText:"当前无法重试锁恢复"}).waitFor();assert.equal(await page.evaluate(()=>(window as any).f.repairs.length),0);assert.deepEqual(await page.evaluate(()=>(window as any).f.calls),[]);assert.equal(await page.getByRole('dialog').count(),1)
},{missingRepair:true}))
test("LUI23-07 a late repair reply after unmount does not alter the detached view",()=>scenario("dialog",async page=>{
 await page.getByRole("button",{name:"重试完成修复",exact:true}).click();await page.evaluate(()=>{(window as any).f.unmount();(window as any).f.repair('pending')});await settle(page);assert.equal(await page.locator('#app').innerText(),'');assert.equal(await page.getByRole('dialog').count(),0)
}))
test("LUI23-08 DesktopApp keeps the post-close repair dialog through close-cancelled and Escape, including disabled background save",()=>scenario("app",async page=>{
 await page.evaluate(()=>(window as any).f.emit({type:'work-lease-pending'}));await page.getByRole("dialog").filter({hasText:'作品锁修复交接尚未完成'}).waitFor();await page.evaluate(()=>(window as any).f.emit({type:'close-cancelled'}));await page.keyboard.press('Escape');await settle(page);assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.getByRole('button',{name:'Close',exact:true}).count(),0);assert.equal(await page.evaluate(()=>(window as any).commands['file.save'].enabled()),false);assert.equal(await page.getByLabel('旧工作台正文').inputValue(),'原草稿');assert.ok(await page.getByLabel('旧工作台正文').evaluate(element=>!!element.closest('[inert]')),'closed workspace must explicitly remain inert')
}))
test("LUI23-09 DesktopApp retries only the narrow repair API once and retains the barrier on rejection/cancelled",()=>scenario("app",async page=>{
 await page.evaluate(()=>(window as any).f.emit({type:'work-lease-pending'}));await page.getByRole('button',{name:'重试完成修复',exact:true}).waitFor();await page.evaluate(()=>{const button=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='重试完成修复')!;button.click();button.click()});assert.deepEqual(await page.evaluate(()=>(window as any).f.calls),[{api:'repair',type:'retry'}]);await page.getByRole('button',{name:'正在重试…',exact:true}).waitFor();await page.evaluate(()=>(window as any).f.repairFail());await page.getByRole('alert').filter({hasText:'修复交接仍未完成'}).waitFor();assert.doesNotMatch(await page.locator('body').innerText(),/private-native-path-key/)
 await page.getByRole('button',{name:'重试完成修复',exact:true}).click();await page.evaluate(()=>(window as any).f.repair('cancelled',1));await settle(page);assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.evaluate(()=>(window as any).commands['file.save'].enabled()),false)
}))
test("LUI23-10 restarting repair remains blocked, hides retry and does not call any new work command",()=>scenario("app",async page=>{
 await page.evaluate(()=>(window as any).f.emit({type:'work-lease-pending'}));await page.getByRole('button',{name:'重试完成修复',exact:true}).click();await page.evaluate(()=>(window as any).f.repair('restarting'));await page.getByRole('heading',{name:'正在重新启动工作台',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'重试完成修复',exact:true}).count(),0);await page.evaluate(()=>(window as any).f.emit({type:'close-cancelled'}));await settle(page);assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.evaluate(()=>(window as any).commands['file.save'].enabled()),false)
}))
test("LUI23-11 pending event still shows the restricted retry surface during bootstrap and survives late bootstrap",()=>scenario("app",async page=>{
 await page.evaluate(()=>(window as any).f.emit({type:'work-lease-pending'}));await page.getByRole('button',{name:'重试完成修复',exact:true}).waitFor();await page.evaluate(()=>(window as any).f.boot());await settle(page);assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.evaluate(()=>(window as any).commands['file.save'].enabled()),false)
},{holdBootstrap:true}))
test("LUI23-12 an in-flight retry survives bootstrap completion without remounting or granting a second request",()=>scenario("app",async page=>{
 await page.evaluate(()=>(window as any).f.emit({type:'work-lease-pending'}));await page.getByRole('button',{name:'重试完成修复',exact:true}).click();await page.getByRole('button',{name:'正在重试…',exact:true}).waitFor();await page.evaluate(()=>(window as any).f.boot());await settle(page);assert.equal(await page.getByRole('button',{name:'正在重试…',exact:true}).count(),1,'bootstrap must not replace the pending dialog flight');assert.equal(await page.evaluate(()=>(window as any).f.repairs.length),1);await page.evaluate(()=>(window as any).f.repair('restarting'));await page.getByRole('heading',{name:'正在重新启动工作台',exact:true}).waitFor()
},{holdBootstrap:true}))
test("LUI23-13 actual pending dialog and Button remain readable without overflow in both themes at 360px",()=>scenario("dialog",async page=>{
 await page.setViewportSize({width:360,height:680});const colors:string[]=[]
 for(const theme of ['paper','ink']){
  await page.evaluate(theme=>{document.documentElement.className=theme;document.body.style.background='var(--background)';document.body.style.color='var(--foreground)'},theme)
  const entry=page.getByRole('button',{name:'重试完成修复',exact:true});await entry.scrollIntoViewIfNeeded();assert.equal(await entry.getAttribute('data-slot'),'button');const box=await entry.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=361,JSON.stringify(box));assert.equal(await page.getByRole('dialog').evaluate(element=>element.scrollWidth<=element.clientWidth),true)
  colors.push(await page.getByRole('dialog').evaluate(element=>getComputedStyle(element).backgroundColor))
 }
 assert.notEqual(colors[0],colors[1]);assert.doesNotMatch(await page.getByRole('dialog').innerText(),/PID|\/controlled\/local/)
}))
test("LUI23-14 unmounted retry ignores a late rejection and subscribed pending event without changing a new workspace",()=>scenario("app",async page=>{
 await page.evaluate(()=>(window as any).f.emit({type:'work-lease-pending'}));await page.getByRole('button',{name:'重试完成修复',exact:true}).click();await page.evaluate(()=>{(window as any).old=(window as any).f;(window as any).old.unmount();(window as any).f=(window as any).mountLeaseUI('app')});await page.getByLabel('旧工作台正文').waitFor();await page.evaluate(()=>{(window as any).old.repairFail();(window as any).old.emit({type:'work-lease-pending'})});await settle(page);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.evaluate(()=>(window as any).commands['file.save'].enabled()),true);assert.equal(await page.getByLabel('旧工作台正文').inputValue(),'原草稿')
}))
