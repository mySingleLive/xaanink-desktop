import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
const file=ts.createSourceFile('DesktopApp.tsx',readFileSync('src/components/desktop/DesktopApp.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let source='';function walk(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(file)==='useEffect'&&node.arguments[0]?.getText(file).includes('installDesktopTransport(bridge)'))source=node.arguments[0].getText(file);ts.forEachChild(node,walk)}walk(file);assert.ok(source)
async function rig(status:'activated'|'pending'|'failed',failAck=false){
 const barrier={token:randomUUID(),outcome:status==='failed'?{status,message:'local isolated failure'}:{status}},sessionId=randomUUID(),receipt={revision:4,clientRevision:2,digest:'b'.repeat(64)},events:string[]=[],acks:unknown[]=[],notices:string[]=[],errors:string[]=[];let restoreSession:unknown,published=0
 const bridge={bootstrap:async()=>({draftSessionId:sessionId,restoreBarrier:barrier,settings:{general:{restoreSession:true}}}),subscribe:()=>()=>{},acknowledgeWorkRestore:async(input:unknown)=>{acks.push(input);events.push('ack');if(failAck)throw Error('ack failure')}}
 class Session{constructor(_bridge:unknown,_coordinator:unknown,private services:any){}async initialize(){await this.services.restore(null,new AbortController().signal);if(this.services.restoreBarrier)await this.services.restoreBarrier.confirm(receipt);events.push('initialized')}dispose(){}}
 const deps={window:{desktop:bridge,addEventListener(){},removeEventListener(){}},installDesktopTransport:()=>{},browserSessionStorage:()=>({}),DesktopDraftSession:Session,desktopSaveCoordinator:{},restoreDesktopDraft:async(_snapshot:unknown,options:{restoreSession:boolean})=>{restoreSession=options.restoreSession;events.push('retain');return{retained:1,requiresCheckpoint:false}},createRecoveryVerifier:()=>{},toast:{info:(text:string)=>notices.push(text),success:(text:string)=>notices.push(text),error:(text:string)=>notices.push(text)},installDesktopDraftSources:()=>{},installWorkspaceDraftSource:()=>{},installRecoveryDraftSource:()=>{},installCommentDraftSource:()=>{},flushDesktopSettings:()=>{},closingRef:{current:false},setClosing:()=>{},setError:(value:string)=>errors.push(value),setRecoveryOpen:()=>{},setRecoveryTab:()=>{},drafts:{current:null},useDesktopStore:{setState:()=>{published++;events.push('published')}},queryClient:{invalidateQueries:()=>Promise.resolve()},receiveDesktopState:()=>{},setModelRequired:()=>{},setSettingsSection:()=>{},setSettingsOpen:()=>{},useChatStore:{getState:()=>({})},setMigrationPending:()=>{},setRestorePending:()=>{}}
 const effect=new Function(...Object.keys(deps),transformSync(`return ${source}`,{loader:'ts'}).code)(...Object.values(deps));const cleanup=effect();await new Promise(setImmediate);cleanup();return{barrier,sessionId,receipt,events,acks,notices,errors,restoreSession,published}
}
test('actual bootstrap forces inert recovery before the ACK even when restoreSession is enabled',async()=>{
 const r=await rig('activated');assert.equal(r.restoreSession,false);assert.deepEqual(r.acks,[{sessionId:r.sessionId,token:r.barrier.token,receipt:r.receipt}]);assert.deepEqual(r.events,['retain','ack','initialized','published']);assert.equal(r.published,1);assert.ok(r.notices.some(text=>text.includes('恢复完成')))
})
test('unknown/failed restore outcomes never tell the user activation succeeded',async()=>{
 for(const status of ['pending','failed'] as const){const r=await rig(status);assert.equal(r.restoreSession,false);assert.equal(r.published,1);assert.equal(r.notices.some(text=>text.includes('恢复完成')),false);assert.ok(r.notices.some(text=>text.includes(status==='pending'?'尚未确认':'未完成')))}
})
test('failed durable draft ACK keeps actual bootstrap non-editable and reports load failure',async()=>{const r=await rig('activated',true);assert.equal(r.published,0);assert.equal(r.errors.length,1);assert.equal(r.notices.some(text=>text.includes('恢复完成')),false)})
