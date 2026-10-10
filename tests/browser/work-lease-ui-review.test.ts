// Independent assertions; controlled harness adapted from author fixture. Actual production React and BaseUI are bundled directly.
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
 useDesktopStore.setState({bootstrap:null});let bootResolve,bootReject;const bridge={bootstrap:()=>options.holdBootstrap?new Promise((resolve,reject)=>{bootResolve=resolve;bootReject=reject}):Promise.resolve(state),subscribe:listener=>{listeners.push(listener);return()=>listeners.splice(listeners.indexOf(listener),1)},repairWorkLease:action=>{calls.push({api:'repair',...action});return new Promise((resolve,reject)=>repairs.push({resolve,reject}))},replyClose:async()=>true};
 if(options.missingRepair)delete bridge.repairWorkLease;window.desktop=new Proxy(bridge,{get(target,key){if(/backup|restoreWork|restoreApplication/i.test(String(key)))throw Error('retired bridge accessed '+String(key));return target[key]}});
 const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(mode==='dialog'?<WorkLeasePendingDialog open={true}/>:<DesktopApp/>));
 return{calls,messages,repairs,confirmed:()=>structuredClone(useDesktopStore.getState().bootstrap),repair:(value,index=0)=>repairs[index].resolve(value),repairFail:(index=0)=>repairs[index].reject(Error('private-native-path-key')),emit:event=>listeners.slice().forEach(listener=>listener(event)),boot:()=>bootResolve(state),failBoot:()=>bootReject(Error("private-bootstrap-path")),unmount:()=>flushSync(()=>root.unmount())};
};`},bundle:true,platform:"browser",format:"iife",write:false,tsconfig:"tsconfig.json",plugins:[{name:"controlled-workspace",setup(builder){
 // esbuild returns native importer paths; preserve this boundary on Windows.
 builder.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:"controlled"}:args.importer.replaceAll("\\", "/").endsWith("/DesktopApp.tsx")&&emptyChildren[args.path]?{path:args.path,namespace:"empty-child"}:undefined)
 builder.onLoad({filter:/.*/,namespace:"controlled"},args=>({contents:mocks[args.path],loader:"tsx",resolveDir:process.cwd()}))
 builder.onLoad({filter:/.*/,namespace:"empty-child"},args=>({contents:`import React from "react";export const ${emptyChildren[args.path]}=(props)=>React.createElement("output",{hidden:true,"data-child":"${emptyChildren[args.path]}","data-open":String(!!props.open)})`,loader:"js",resolveDir:process.cwd()}))
}}]}).then(result=>result.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.XAANINK_TEST_CHROMIUM})})
test.after(async()=>{await browser?.close()})
async function scenario(mode:"dialog"|"app",run:(page:Page)=>Promise<void>,options:Record<string,boolean>={}){
 const page=await browser.newPage({viewport:{width:1000,height:760}}),errors:string[]=[];page.setDefaultTimeout(2200);page.on("pageerror",error=>errors.push(error.message))
 try{await page.setContent('<div id="app"></div>');await page.addStyleTag({content:await css});await page.addScriptTag({content:await bundle});await page.evaluate(({mode,options})=>{(window as any).f=(window as any).mountLeaseUI(mode,options)},{mode,options});await(mode==="dialog"?page.getByRole("heading",{name:"作品锁修复交接尚未完成",exact:true}):options.holdBootstrap?page.getByRole("status"):page.getByLabel("旧工作台正文")).waitFor();await run(page);assert.deepEqual(errors,[])}finally{await page.close()}
}
async function settle(page:Page){await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))}

// The old late backup-list/owner-selector scenario is preserved in the mixed
// original. Late ordinary state may still arrive after this lease barrier.
test("WL90-U01: a late ordinary state reply cannot release the pending repair barrier or change the retained workspace",()=>scenario("app",async page=>{
 await page.getByLabel('旧工作台正文').fill('修复前原草稿');await page.evaluate(()=>(window as any).f.emit({type:'work-lease-pending'}));await page.getByRole('button',{name:'重试完成修复',exact:true}).click();await page.evaluate(()=>(window as any).f.repair('pending'));await page.getByRole('button',{name:'重试完成修复',exact:true}).waitFor()
 await page.evaluate(()=>{const f=(window as any).f,state=f.confirmed();f.emit({type:'state',state:{...state,revision:state.revision+1}});f.emit({type:'close-cancelled'})});await settle(page)
 assert.equal(await page.evaluate(()=>(window as any).f.confirmed().revision),1);assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.getByLabel('旧工作台正文').inputValue(),'修复前原草稿');assert.ok(await page.getByLabel('旧工作台正文').evaluate(element=>!!element.closest('[inert]')));assert.equal(await page.evaluate(()=>(window as any).commands['file.save'].enabled()),false);assert.deepEqual(await page.evaluate(()=>(window as any).f.calls),[{api:'repair',type:'retry'}])
}))
test("WL90-U02: malformed retry replies retain the barrier without leaking their cause and only deliberate retry sends another narrow command",()=>scenario("app",async page=>{
 await page.evaluate(()=>(window as any).f.emit({type:'work-lease-pending'}));await page.getByRole('button',{name:'重试完成修复',exact:true}).click()
 await page.evaluate(()=>(window as any).f.repair({status:'restarting',path:'private-response-path'}));await page.getByRole('alert').filter({hasText:'修复交接仍未完成'}).waitFor();assert.doesNotMatch(await page.locator('body').innerText(),/private-response-path/)
 await page.evaluate(()=>(window as any).f.emit({type:'close-cancelled'}));await settle(page);assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await page.evaluate(()=>(window as any).commands['file.save'].enabled()),false)
 assert.equal(await page.getByLabel('旧工作台正文').inputValue(),'原草稿');assert.equal(await page.evaluate(()=>(window as any).f.calls.length),1)
 await page.getByRole('button',{name:'重试完成修复',exact:true}).click();assert.deepEqual(await page.evaluate(()=>(window as any).f.calls),[{api:'repair',type:'retry'},{api:'repair',type:'retry'}]);await page.evaluate(()=>(window as any).f.repair('pending',1))
}))
test("WL90-U03: a pending retry survives bootstrap failure with the same DOM flight and disabled reload",()=>scenario("app",async page=>{
 await page.evaluate(()=>(window as any).f.emit({type:'work-lease-pending'}));await page.getByRole('button',{name:'重试完成修复',exact:true}).click();await page.getByRole('button',{name:'正在重试…',exact:true}).waitFor()
 await page.getByRole('button',{name:'正在重试…',exact:true}).evaluate(element=>{(window as any).retryButton=element});await page.evaluate(()=>(window as any).f.failBoot());await page.getByRole('alert',{includeHidden:true}).filter({hasText:'本地数据加载失败'}).waitFor({state:'attached'});await settle(page)
 assert.equal(await page.getByRole('button',{name:'正在重试…',exact:true}).evaluate(element=>element===(window as any).retryButton),true);assert.equal(await page.getByRole('button',{name:'重新打开工作台',exact:true,includeHidden:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>(window as any).f.repairs.length),1)
 await page.evaluate(()=>(window as any).f.repair('restarting'));await page.getByRole('heading',{name:'正在重新启动工作台',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'重试完成修复',exact:true}).count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/private-bootstrap-path/)
},{holdBootstrap:true}))
test("WL90-U04: native and custom settings, templates and recovery commands cannot reopen background surfaces after lease pending",()=>scenario("app",async page=>{
 await page.getByLabel('旧工作台正文').fill('关闭前尚未提交的原草稿')
 await page.evaluate(()=>{const f=(window as any).f;f.emit({type:'work-lease-pending'});for(const id of ['app.settings','file.templates','file.chat','works.refresh'])f.emit({type:'command',id});window.dispatchEvent(new CustomEvent('desktop:settings',{detail:'models'}));window.dispatchEvent(new Event('desktop:recovery'));f.emit({type:'close-cancelled'})})
 await page.getByRole('dialog').filter({hasText:'作品锁修复交接尚未完成'}).waitFor();await settle(page)
 const open=await page.locator('output[data-child]').evaluateAll(nodes=>nodes.map(node=>({child:node.getAttribute('data-child'),open:node.getAttribute('data-open')})))
 for(const child of ['SettingsDialog','TemplateManagementDialog','RecoveryDialog'])assert.equal(open.find(row=>row.child===child)?.open,'false',child)
 assert.equal(await page.getByLabel('旧工作台正文').inputValue(),'关闭前尚未提交的原草稿');assert.ok(await page.getByLabel('旧工作台正文').evaluate(element=>!!element.closest('[inert]')));assert.equal(await page.evaluate(()=>(window as any).commands['file.save'].enabled()),false);assert.equal(await page.evaluate(()=>(window as any).f.calls.length),0)
}))
