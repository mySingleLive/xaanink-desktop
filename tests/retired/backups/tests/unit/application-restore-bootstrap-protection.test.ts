import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {checkpointFixture} from '../fixtures/application-restore-checkpoint'
import {ApplicationRestoreCheckpointSession} from '../../desktop/main/application-restore-checkpoint-session'
import {DesktopDraftSession} from '../../src/lib/desktop/draft-session'
import {DesktopSaveCoordinator} from '../../src/lib/desktop/save-coordinator'
import {restoreDesktopDraft,installRecoveryDraftSource} from '../../src/lib/desktop/draft-recovery'
import {isApplicationProtectedBootstrap,type DesktopBootstrap} from '../../desktop/shared/ipc'
import {defaultState} from '../../desktop/core/settings'

const file=ts.createSourceFile('DesktopApp.tsx',readFileSync('src/components/desktop/DesktopApp.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let startup='';const walk=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(file)==='useEffect'&&node.arguments[0]?.getText(file).includes('installDesktopTransport(bridge)'))startup=node.arguments[0].getText(file);ts.forEachChild(node,walk)};walk(file);assert.ok(startup)
const compiled=transformSync(`const effect=${startup}`,{loader:'ts'}).code

test('actual startup effect confirms both physical checkpoints before reading/publishing ordinary settings; restore-session cannot replay the backup',{timeout:20000},async()=>{
 const f=await checkpointFixture(),sessionId=randomUUID(),coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null}),controller=new ApplicationRestoreCheckpointSession({root:f.path,journal:f.journal,journalOwner:f.journalOwner,requests:f.requests,operationId:f.operationId,ownerNonce:f.owner,assertOwner:f.assertOwner,withWrite:run=>f.gate.writeFlight(run)})
 let bootstrapReads=0,published=0,verifications=0,settingsFlush=0,confirmations=0;const errors:string[]=[],protectedViews:unknown[]=[],drafts:{current:DesktopDraftSession|null}={current:null}
 const notice=await controller.notice(),protectedState:DesktopBootstrap={kind:'application-protected',platform:'darwin',version:'0.1.0',dataRoot:f.path,draftSessionId:sessionId,systemDark:false,applicationRestore:notice},normalState={platform:'darwin' as const,version:'0.1.0',dataRoot:f.path,draftSessionId:sessionId,systemDark:false,revision:1,settings:structuredClone(defaultState.settings),models:[]}
 const bridge={bootstrap:async()=>{bootstrapReads++;if(bootstrapReads===1)return protectedState;assert.equal(controller.blocked,false);assert.equal(f.requests.startup().mode,'normal');return normalState},readDraft:()=>controller.read(),persistDraft:(_id:string,value:any)=>controller.persist(value),markDraftReady:async()=>{},confirmApplicationRestoreDraft:async(action:any)=>{await controller.confirm(action.phase,action.token,action.receipt);confirmations++},subscribe:()=>()=>{},replyClose:async()=>true}
 const dependencies={window:{desktop:bridge,addEventListener(){},removeEventListener(){}},isApplicationProtectedBootstrap,installDesktopTransport(){},browserSessionStorage:()=>null,DesktopDraftSession,desktopSaveCoordinator:coordinator,restoreDesktopDraft,createRecoveryVerifier:()=>()=>{verifications++;return true},toast:{info(){},success(){},error(){}},installDesktopDraftSources:()=>()=>{},installWorkspaceDraftSource:()=>()=>{},installRecoveryDraftSource,installCommentDraftSource:()=>()=>{},flushDesktopSettings:async()=>{settingsFlush++},closingRef:{current:false},leasePendingRef:{current:false},setClosing(){},setError:(value:string)=>errors.push(value),setProtectedStartup:(value:unknown)=>protectedViews.push(value),setRecoveryOpen(){},drafts,useDesktopStore:{setState(value:any){assert.equal(controller.blocked,false);assert.ok(value.bootstrap.settings);published++}},queryClient:{invalidateQueries:async()=>{}},receiveDesktopState(){},setModelRequired(){},setSettingsSection(){},setSettingsOpen(){},setTemplatesOpen(){},setMigrationPending(){},setRestorePending(){},setLeasePending(){},useChatStore:{getState:()=>({})}}
 const effect=new Function(...Object.keys(dependencies),compiled+'\nreturn effect')(...Object.values(dependencies)) as ()=>()=>void,cleanup=effect()
 try{
  for(let n=0;n<500&&published===0&&errors.length===0;n++)await new Promise(resolve=>setTimeout(resolve,5))
  assert.deepEqual(errors,[]);assert.equal(published,1);assert.equal(bootstrapReads,2);assert.equal(confirmations,2);assert.equal(verifications,0);assert.equal(settingsFlush,0);assert.equal(controller.blocked,false);assert.ok(protectedViews[0]);assert.equal(protectedViews.at(-1),null)
 }finally{cleanup();await controller.flush();await f.close()}
})
