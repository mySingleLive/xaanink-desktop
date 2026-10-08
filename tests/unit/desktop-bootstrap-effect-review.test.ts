import assert from "node:assert/strict"
import {test} from "node:test"
import {readFileSync} from "node:fs"
import {randomUUID} from "node:crypto"
import ts from "typescript"
import {transformSync} from "esbuild"
import type {DesktopEvent} from "../../desktop/shared/ipc"

// Run the actual DesktopApp startup effect with a controlled bridge and view
// setters. This proves event/Promise ordering, not a mounted React GUI.
const file=ts.createSourceFile("DesktopApp.tsx",readFileSync("src/components/desktop/DesktopApp.tsx","utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let source=""
function walk(node:ts.Node){
 if(ts.isCallExpression(node)&&node.expression.getText(file)==="useEffect"&&node.arguments[0]?.getText(file).includes("installDesktopTransport(bridge)"))source=node.arguments[0].getText(file)
 ts.forEachChild(node,walk)
}
walk(file);assert.ok(source)
const compiled=transformSync(`const effect=${source}`,{loader:"ts"}).code
function rig(){
 const bootstrap=Promise.withResolvers<object>(),replies:unknown[]=[],errors:string[]=[],closing:boolean[]=[],events:{listener:((event:DesktopEvent)=>void)|null}={listener:null}
 let reads=0,ready=0,persists=0,sessions=0,published=0
 const bridge={bootstrap:()=>bootstrap.promise,replyClose:async(...args:unknown[])=>{replies.push(args);return true},subscribe:(listener:(event:DesktopEvent)=>void)=>{events.listener=listener;return()=>{events.listener=null}},readDraft:async()=>{reads++;return null},markDraftReady:async()=>{ready++},persistDraft:async()=>{persists++}}
 const window={desktop:bridge,addEventListener(){},removeEventListener(){}}
 class Session{constructor(){sessions++}initialize(){return Promise.resolve()}handle(){return Promise.resolve()}dispose(){}}
 const dependencies={window,installDesktopTransport:()=>{},browserSessionStorage:()=>({}),DesktopDraftSession:Session,desktopSaveCoordinator:{},restoreDesktopDraft:()=>{throw Error("unexpected restore")},createRecoveryVerifier:()=>{},toast:{info(){}},installDesktopDraftSources:()=>{},installWorkspaceDraftSource:()=>{},installRecoveryDraftSource:()=>{},installCommentDraftSource:()=>{},flushDesktopSettings:()=>{},closingRef:{current:false},setClosing:(value:boolean)=>closing.push(value),setError:(value:string)=>errors.push(value),setRecoveryOpen:()=>{},drafts:{current:null},useDesktopStore:{setState:()=>{published++}},queryClient:{invalidateQueries:()=>Promise.resolve()},receiveDesktopState:()=>{},setModelRequired:()=>{},setSettingsSection:()=>{},setSettingsOpen:()=>{},useChatStore:{getState:()=>({})}}
 // Later migration UI state is a separate boundary; preserve the original
 // bootstrap-abort assertions while injecting its new setter.
 const effectDependencies={...dependencies,setMigrationPending:()=>{},setRestorePending:()=>{},leasePendingRef:{current:false},setProtectedStartup:()=>{}}
 const effect=new Function(...Object.keys(effectDependencies),compiled+"\nreturn effect")(...Object.values(effectDependencies)) as ()=>()=>void
 const cleanup=effect()
 return{bootstrap,replies,errors,closing,send:(event:DesktopEvent)=>{assert.ok(events.listener);events.listener(event)},cleanup,counts:()=>({reads,ready,persists,sessions,published})}
}

test("B55-05: closing before bootstrap resolves replies unchanged and blocks its late initialization",async()=>{
 const r=rig(),sessionId=randomUUID(),id=randomUUID()
 try{
  r.send({type:"prepare-close",sessionId,id,action:"flush",retryFailures:false})
  await new Promise(setImmediate)
  assert.deepEqual(r.replies,[[sessionId,id,{status:"unmodified"}]])
  r.send({type:"close-cancelled"})
  r.bootstrap.resolve({draftSessionId:sessionId});await new Promise(setImmediate)
  assert.deepEqual(r.counts(),{reads:0,ready:0,persists:0,sessions:0,published:0})
  assert.equal(r.closing.at(-1),false);assert.ok(r.errors.length>0)
 }finally{r.cleanup()}
})

test("B55-06: an export requested before bootstrap cannot return an empty recovery snapshot",async()=>{
 const r=rig(),sessionId=randomUUID(),id=randomUUID()
 try{
  r.send({type:"prepare-close",sessionId,id,action:"export",retryFailures:false});await new Promise(setImmediate)
  assert.deepEqual(r.replies,[[sessionId,id,{status:"failed"}]])
  r.bootstrap.resolve({draftSessionId:sessionId});await new Promise(setImmediate)
  assert.equal(r.counts().sessions,0);assert.equal(r.counts().persists,0)
 }finally{r.cleanup()}
})
