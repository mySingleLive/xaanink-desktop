import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {DesktopRecoveryStore,type RecoveryItem} from '../../src/lib/desktop/draft-recovery'
import {DesktopSaveCoordinator} from '../../src/lib/desktop/save-coordinator'
import {recoveryPreview} from '../../src/lib/desktop/recovery-preview'
import {draftSnapshotSchema} from '../../desktop/shared/drafts'

function ast(path:string){return ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)}
function declaration(path:string,name:string){const source=ast(path),node=source.statements.find(row=>ts.isFunctionDeclaration(row)&&row.name?.text===name);assert.ok(node);return node.getText(source).replace(/^export\s+(?:default\s+)?/,'')}
function constant(path:string,name:string){const source=ast(path),node=source.statements.find(row=>ts.isVariableStatement(row)&&row.declarationList.declarations.some(value=>value.name.getText(source)===name));assert.ok(node);return node.getText(source)}
function evaluate(code:string,deps:Record<string,unknown>){return new Function(...Object.keys(deps),transformSync(code,{loader:'tsx',jsx:'transform',jsxFactory:'React.createElement',jsxFragment:'React.Fragment'}).code)(...Object.values(deps))}
const wrap=(tag:string)=>({children,...props}:Record<string,unknown>)=>React.createElement(tag,props,children as React.ReactNode)
const primitives={Dialog:wrap('section'),DialogContent:({children}:Record<string,unknown>)=>React.createElement('article',{},children as React.ReactNode),DialogTitle:wrap('h2'),DialogDescription:wrap('p'),Button:wrap('button'),Input:wrap('input'),Switch:()=>React.createElement('input',{type:'checkbox'})}
function find(node:unknown,predicate:(props:Record<string,unknown>)=>boolean):React.ReactElement<Record<string,unknown>>|null{
 if(Array.isArray(node)){for(const child of node){const value=find(child,predicate);if(value)return value}return null}
 if(!React.isValidElement<Record<string,unknown>>(node))return null
 if(predicate(node.props))return node
 return find(node.props.children,predicate)
}
function settingsFixture(){
 let mountedBackups=0,writes=0;const events:string[]=[],state={bootstrap:{dataRoot:'/isolated/current',version:'test',settings:{general:{defaultParent:'/isolated/works',restoreSession:true,backupIntervalMinutes:15,backupRetention:20},appearance:{},user:{},agent:{}}},saving:0,error:null}
 const deps={React,...primitives,useState:(initial:unknown)=>[initial,()=>{}],useEffect(){},useDesktopStore:(select:(value:typeof state)=>unknown)=>select(state),updateDesktopSettings:async()=>{writes++},window:{dispatchEvent:(event:Event)=>{events.push(event.type)}},toast:{error(){}},localFontFamilies:async()=>[],DataRootMigrationButton:()=>React.createElement('button',{'data-real-migration-entry':true},'迁移目录'),ConfigurationImportButton:()=>null,ConfigurationExportButton:()=>null,ProfileSettings:()=>null,AgentSettings:()=>null,ModelSettings:()=>null,ShortcutSettings:()=>null,AppearanceNumber:()=>null,WorkBackupButton:()=>{mountedBackups++;return React.createElement('button',{},'立即备份')},Settings:()=>null,User:()=>null,Bot:()=>null,Box:()=>null,Monitor:()=>null,Keyboard:()=>null,CircleHelp:()=>null,X:()=>null}
 const path='src/components/desktop/SettingsDialog.tsx',SettingsDialog=evaluate(`${constant(path,'sections')}\n${declaration(path,'Group')}\n${declaration(path,'Row')}\nreturn (${declaration(path,'SettingsDialog')})`,deps) as (props:{open:boolean;onOpenChange(open:boolean):void})=>React.ReactElement
 return{SettingsDialog,events,get mountedBackups(){return mountedBackups},get writes(){return writes}}
}
function draftFixture(){
 const store=new DesktopRecoveryStore(),coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null}),copied:string[]=[],exports:Array<{sessionId:string;snapshot:unknown}>=[];let mountedBackups=0
 const records:RecoveryItem[]=[{id:'draft-readonly',source:'chat',path:'source',reason:'AUTOSAVE_UNMATCHED',createdAt:'2026-10-08T00:00:00Z',value:{draft:'异常退出保留的未发送正文',pendingRequest:{body:'must stay inert'}}}]
 store.retain(records);coordinator.registerSource('recovery',{read:()=>store.read()})
 const state={bootstrap:{draftSessionId:'ordinary-session'}},path='src/components/desktop/RecoveryDialog.tsx',deps={React,...primitives,useState:(initial:unknown)=>[typeof initial==='function'?initial():initial,()=>{}],useEffect(){},useMemo:(read:()=>unknown)=>read(),desktopRecoveryStore:store,desktopSaveCoordinator:coordinator,draftSnapshotSchema,recoveryPreview,useDesktopStore:{getState:()=>state},window:{desktop:{writeClipboardText:async(text:string)=>{copied.push(text)},exportDraft:async(sessionId:string,snapshot:unknown)=>{exports.push({sessionId,snapshot});return true}}},toast:{success(){},error(){}},ApplicationBackupsPanel:()=>{mountedBackups++;return React.createElement('aside',{},'应用备份')},WorkBackupsPanel:()=>{mountedBackups++;return React.createElement('aside',{},'作品备份')}}
 const RecoveryDialog=evaluate(`${constant(path,'sources')}\n${constant(path,'reasons')}\nreturn (${declaration(path,'RecoveryDialog')})`,deps)
 return{RecoveryDialog,props:{open:true,onOpenChange(){}},store,records,copied,exports,get mountedBackups(){return mountedBackups}}
}
function appFixture(){
 const states:unknown[]=[],refs:Array<{current:unknown}>=[],effects:Array<()=>unknown>=[],notifications:string[]=[],migrationCalls:string[]=[],commands:Record<string,{enabled():boolean;run():Promise<void>}>={}
 let stateIndex=0,refIndex=0,business=0,saved=0,subscriber:((event:unknown)=>void)|undefined
 const bootstrap={platform:'win32',settings:{user:{penName:'本地作者',email:''},agent:{},appearance:{}},models:[]},useDesktopStore=Object.assign((select:(value:{bootstrap:typeof bootstrap})=>unknown)=>select({bootstrap}),{getState:()=>({bootstrap}),setState(){}})
 const window={desktop:{bootstrap:()=>new Promise(()=>{}),subscribe:(listener:(event:unknown)=>void)=>{subscriber=listener;return()=>{}},migrateRoot:async(action:string)=>{migrationCalls.push(action)}},addEventListener(){},removeEventListener(){}}
 const deps={React,...primitives,useDesktopStore,window,useState(initial:unknown){const index=stateIndex++;if(!(index in states))states[index]=initial;return[states[index],(value:unknown)=>{states[index]=value}]},useRef(initial:unknown){const index=refIndex++;return refs[index]??(refs[index]={current:initial})},useEffect:(effect:()=>unknown)=>{effects.push(effect)},useTheme:()=>({setTheme(){}}),useQueryClient:()=>({invalidateQueries:async()=>{}}),useDesktopCommands:(value:typeof commands)=>Object.assign(commands,value),useTabsStore:{getState:()=>({activeTabId:'chapter'})},useChatStore:{getState:()=>({}),setState(){}},installDesktopTransport(){},browserSessionStorage:()=>null,WindowsMenuControl:()=>null,WorkLeasePendingDialog:()=>null,DesktopCommandController:()=>null,DesktopNavigation:()=>null,DashboardShell:()=>{business++;return React.createElement('main',{'data-original-workbench':true})},TemplateManagementDialog:()=>null,SettingsDialog:()=>null,ModelRequiredDialog:()=>null,RecoveryDialog:()=>null,Loader2:()=>React.createElement('svg'),toast:{error:(text:string)=>notifications.push(text),success:(text:string)=>notifications.push(text),info:(text:string)=>notifications.push(text)}}
 const App=evaluate(`return (${declaration('src/components/desktop/DesktopApp.tsx','DesktopApp')})`,deps)
 const render=()=>{stateIndex=0;refIndex=0;effects.length=0;return App()}
 render();const cleanup=effects[1]();assert.ok(subscriber)
 return{render,notifications,migrationCalls,commands,emit:(event:unknown)=>subscriber!(event),attachDraft(){refs[1].current={flush:async()=>{saved++}}},get saved(){return saved},get business(){return business},close:()=>{if(typeof cleanup==='function')cleanup()}}
}

test('BRUI-01 actual settings general page removes backup controls and keeps draft viewing plus directory migration',{timeout:15000},()=>{
 const f=settingsFixture(),tree=React.createElement(f.SettingsDialog,{open:true,onOpenChange(){}}),html=renderToStaticMarkup(tree)
 assert.doesNotMatch(html,/备份|恢复备份|立即备份/);assert.equal(f.mountedBackups,0);assert.match(html,/data-real-migration-entry/);assert.match(html,/启动时恢复上次工作台/)
 const button=find(f.SettingsDialog({open:true,onOpenChange(){}}),props=>props.children==='查看草稿');assert.ok(button);(button.props.onClick as ()=>void)();assert.deepEqual(f.events,['desktop:recovery']);assert.equal(f.writes,0)
})
test('BRUI-02 actual ordinary draft dialog has one title and no backup panels',{timeout:15000},()=>{
 const f=draftFixture(),html=renderToStaticMarkup(React.createElement(f.RecoveryDialog,f.props))
 assert.match(html,/<h2>保留的草稿<\/h2>/);assert.doesNotMatch(html,/备份|确认恢复|作品恢复后的/);assert.equal(f.mountedBackups,0);assert.match(html,/异常退出保留的未发送正文/);assert.match(html,/readonly/i);assert.doesNotMatch(html,/must stay inert/)
 assert.deepEqual(f.store.read().items,f.records)
})
test('BRUI-03 actual retained-draft copy/export callbacks preserve complete inert records without backup API access',{timeout:15000},async()=>{
  const f=draftFixture(),tree=f.RecoveryDialog(f.props),copy=find(tree,props=>props.children==='复制内容'),exportButton=find(tree,props=>props.children==='导出草稿');assert.ok(copy);assert.ok(exportButton);
  (copy.props.onClick as ()=>void)();(exportButton.props.onClick as ()=>void)();await new Promise<void>(resolve=>setImmediate(resolve))
  assert.deepEqual(f.copied,['对话草稿\n异常退出保留的未发送正文']);assert.equal(f.exports.length,1);assert.equal(f.exports[0].sessionId,'ordinary-session');assert.deepEqual((f.exports[0].snapshot as {sources:{recovery:{items:RecoveryItem[]}}}).sources.recovery.items,f.records);assert.deepEqual(f.store.read().items,f.records)
})
test('BRUI-04 actual DesktopApp ignores removed backup/restore events while normal workbench remains mounted',{timeout:15000},()=>{
 const f=appFixture();try{f.emit({type:'backup-error',message:'obsolete backup error'});f.emit({type:'work-restore-pending'});const html=renderToStaticMarkup(f.render());assert.deepEqual(f.notifications,[]);assert.doesNotMatch(html,/恢复交接|重试完成恢复/);assert.match(html,/data-original-workbench/)}finally{f.close()}
})
test('BRUI-05 actual DesktopApp still flushes normal save and retries ordinary migration cancellation',{timeout:15000},async()=>{
 const f=appFixture();try{f.attachDraft();assert.equal(f.commands['file.save'].enabled(),true);await f.commands['file.save'].run();assert.equal(f.saved,1);f.emit({type:'migration-cancel-pending'});const tree=f.render(),button=find(tree,props=>props.children==='重试取消迁移');assert.ok(button);await(button.props.onClick as ()=>Promise<void>)();assert.deepEqual(f.migrationCalls,['cancel']);f.emit({type:'close-cancelled'});assert.doesNotMatch(renderToStaticMarkup(f.render()),/迁移取消尚未保存/)}finally{f.close()}
})
test('BRUI-06 DesktopApp has no consumers of removed backup protection bridge methods',{timeout:15000},()=>{
 const source=ast('src/components/desktop/DesktopApp.tsx'),names:string[]=[]
 const visit=(node:ts.Node)=>{if(ts.isPropertyAccessExpression(node))names.push(node.name.text);if(ts.isImportSpecifier(node))names.push(node.name.text);ts.forEachChild(node,visit)};visit(source)
 for(const name of['isApplicationProtectedBootstrap','applicationRestore','restoreBarrier','confirmApplicationRestoreDraft','acknowledgeWorkRestore','restoreWork'])assert.equal(names.includes(name),false,name)
})
test('BRUI-07 actual page ignores retired application-restore mode and still selects workbench/migration/relocation',{timeout:15000},()=>{
 const declarations=ast('src/app/page.tsx');assert.equal(declarations.statements.some(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>value.name.getText(declarations)==='ApplicationRestore')),false)
 for(const kind of['workbench','maintenance','relocation'] as const){let selected:unknown=null;const effects:Array<()=>void>=[],mode=kind==='workbench'?{}:kind==='maintenance'?{desktopMaintenance:{}}:{desktopRootRelocation:{}}
  const Home=evaluate(`return (${declaration('src/app/page.tsx','Home')})`,{React,useState:()=>[null,(value:unknown)=>{selected=value}],useEffect:(effect:()=>void)=>effects.push(effect),window:{...mode,desktopApplicationRestore:{retired:true}},DesktopApp:()=>null,Maintenance:()=>null,Relocation:()=>null,ApplicationRestore:()=>null})
  Home();effects[0]();assert.equal(selected,kind)
 }
})
test('BRUI-08 actual ordinary settings mutation keeps original error and refreshes current state after failed save',{timeout:15000},async()=>{
 const before={revision:1,settings:{general:{defaultParent:'/old',restoreSession:true}},models:[]},actual={...before,revision:2,settings:{general:{defaultParent:'/current',restoreSession:false}}}
 let state={bootstrap:before,saving:0,error:null as string|null}
 const useDesktopStore={getState:()=>state,setState(input:Partial<typeof state>|((before:typeof state)=>Partial<typeof state>)){state={...state,...(typeof input==='function'?input(state):input)}}}
 const run=evaluate(`${declaration('src/stores/desktop.ts','receiveDesktopState')}\n${declaration('src/stores/desktop.ts','mutateDesktopState')}\nlet writes=Promise.resolve();return mutateDesktopState`,{useDesktopStore,window:{desktop:{settings:async()=>{throw Error('original save failure')},bootstrap:async()=>actual}}})
 await assert.rejects(run(()=>({type:'update'})),/original save failure/);assert.equal(state.saving,0);assert.equal(state.error,'original save failure');assert.deepEqual(state.bootstrap,actual)
})
