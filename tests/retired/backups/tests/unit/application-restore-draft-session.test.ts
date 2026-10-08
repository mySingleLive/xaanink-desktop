import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,realpath,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DesktopDraftSession} from '../../src/lib/desktop/draft-session'
import {DesktopSaveCoordinator} from '../../src/lib/desktop/save-coordinator'
import {DesktopRecoveryStore,restoreDesktopDraft} from '../../src/lib/desktop/draft-recovery'
import {WorkspaceDraftSource} from '../../src/lib/desktop/workspace-draft-source'
import type {DesktopBridge} from '../../desktop/shared/ipc'
import type {DraftSnapshot,DraftReceipt} from '../../desktop/shared/drafts'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {prepareApplicationDraftRetention,persistApplicationDraftRetention,installInertApplicationDraftJournal} from '../../desktop/core/application-restore-drafts'
import {ApplicationRestoreDraftBarrier} from '../../desktop/main/application-restore-draft-barrier'
import {applicationDraftRecoveryItems} from '../../desktop/shared/application-restore'

function fixture(options:{first?(receipt:DraftReceipt):Promise<void>;persist?(count:number):Promise<void>;afterRevision?:number}={}){
 const trace:string[]=[],writes:DraftSnapshot[]=[],coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null}),sessionId=randomUUID()
 const bridge={readDraft:async()=>null,markDraftReady:async()=>{},persistDraft:async(_id:string,snapshot:DraftSnapshot)=>{const count=writes.push(snapshot);trace.push(`write:${count}`);await options.persist?.(count);return{revision:count,digest:'a'.repeat(64),clientRevision:snapshot.revision}}} as unknown as DesktopBridge
 const barrier={afterRevision:options.afterRevision,checkpoint:async(receipt:DraftReceipt)=>{trace.push(`first:${receipt.revision}`);await options.first?.(receipt)},confirm:async(receipt:DraftReceipt)=>{trace.push(`second:${receipt.revision}`)}}
 const session=new DesktopDraftSession(bridge,coordinator,{restore:()=>()=>{trace.push('cleanup')},installSources:()=>coordinator.registerSource('recovery',{read:()=>({version:1,items:[]})}),flushSettings:async()=>{},closing:()=>{},restoreBarrier:barrier})
 return{session,sessionId,trace,writes}
}
test('application retention records the first actual receipt before clearing caches or writing the second',{timeout:5000},async()=>{
 const f=fixture();try{await f.session.initialize(f.sessionId);assert.deepEqual(f.trace,['write:1','first:1','cleanup','write:2','second:2']);assert.ok(f.writes[1].revision>f.writes[0].revision)}finally{f.session.dispose()}
})
test('a failed first application checkpoint cannot clear caches or acknowledge a second receipt',{timeout:5000},async()=>{
 const f=fixture({first:async()=>{throw Error('checkpoint directory fsync failed')}})
 try{await assert.rejects(f.session.initialize(f.sessionId));assert.deepEqual(f.trace,['write:1','first:1'])}finally{f.session.dispose()}
})
test('the first checkpoint waits for actual journal persistence and physical confirmation IO',{timeout:5000},async()=>{
 const persisted=Promise.withResolvers<void>(),persisting=Promise.withResolvers<void>(),confirmed=Promise.withResolvers<void>(),confirming=Promise.withResolvers<void>()
 const f=fixture({persist:async count=>{if(count===1){persisting.resolve();await persisted.promise}},first:async()=>{confirming.resolve();await confirmed.promise}}),init=f.session.initialize(f.sessionId)
 try{await persisting.promise;assert.deepEqual(f.trace,['write:1']);persisted.resolve();await confirming.promise;assert.deepEqual(f.trace,['write:1','first:1']);confirmed.resolve();await init;assert.equal(f.trace.at(-1),'second:2')}finally{persisted.resolve();confirmed.resolve();await init.catch(()=>{});f.session.dispose()}
})
test('window disposal while first confirmation is pending keeps old caches and skips second ACK',{timeout:5000},async()=>{
 const confirming=Promise.withResolvers<void>(),released=Promise.withResolvers<void>(),f=fixture({first:async()=>{confirming.resolve();await released.promise}}),init=f.session.initialize(f.sessionId)
 try{await confirming.promise;f.session.dispose();released.resolve();await assert.rejects(init);assert.deepEqual(f.trace,['write:1','first:1'])}finally{released.resolve();await init.catch(()=>{});f.session.dispose()}
})
test('a restarted protected session advances both actual checkpoints past the previous session revision',{timeout:5000},async()=>{
 const f=fixture({afterRevision:30});try{await f.session.initialize(f.sessionId);assert.ok(f.writes[0].revision>30);assert.ok(f.writes[1].revision>f.writes[0].revision)}finally{f.session.dispose()}
})
test('a monotonic checkpoint joining pending physical IO cannot acknowledge the older revision',{timeout:5000},async()=>{
 const coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null}),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),writes:number[]=[]
 const dispose=coordinator.configurePersistence(async snapshot=>{writes.push(snapshot.revision);if(writes.length===1){entered.resolve();await release.promise}}),initial=coordinator.checkpointDrafts()
 try{await entered.promise;const second=coordinator.checkpointDrafts({afterRevision:writes[0]});release.resolve();const results=await Promise.all([initial,second]);assert.ok(results.every(result=>result.revision>writes[0]));assert.ok(writes[1]>writes[0])}finally{release.resolve();await initial.catch(()=>{});dispose()}
})
test('an invalid checkpoint lower bound fails before touching the current writer',async()=>{
 const coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null});let writes=0;const dispose=coordinator.configurePersistence(async()=>{writes++})
 try{for(const afterRevision of [-1,Infinity,Number.MAX_SAFE_INTEGER,1.5])await assert.rejects(coordinator.checkpointDrafts({afterRevision}));assert.equal(writes,0);assert.equal(coordinator.getState().revision,1)}finally{dispose()}
})
test('application recovery items survive another launch with full saved requests remaining inert',async()=>{
 const recovery=new DesktopRecoveryStore(),workspace=new WorkspaceDraftSource(),item={id:'application:'+randomUUID(),source:'application',path:'current/full-original-snapshot',reason:'APPLICATION_RESTORED',createdAt:'2026-10-08T00:00:00Z',value:{sources:{chat:{pendingRequest:{url:'/api/novels/private/approve',method:'POST',body:'never execute'}}}}}
 const snapshot={version:1 as const,revision:1,createdAt:item.createdAt,autosaves:[],sources:{recovery:{version:1,items:[item]}},issues:[]},before=structuredClone(snapshot)
 let reads=0
 await restoreDesktopDraft(snapshot,{restoreSession:true,accountId:'local-author',storage:null,recovery,workspace,verifyTarget:()=>{reads++;return false}})
 assert.deepEqual(recovery.read().items,[item]);assert.equal(reads,0);assert.deepEqual(snapshot,before)
})
test('an unchanged renderer recovery payload produces two distinct real fsynced journal receipts',{timeout:10000},async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-app-session36-'))),current=join(base,'current'),backup=join(base,'backup'),appId=randomUUID(),owner='active-window'
 let session:DesktopDraftSession|undefined
 try{
  for(const root of [current,backup]){await mkdir(root);await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}));const previous=new DraftJournal(root);previous.activate('original');await previous.persist('original',{version:1,revision:1,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft:root===current?'latest':'backup',request:{approved:true,prompt:'inert'}}},issues:[]})}
  const input={appId,operationId:randomUUID(),candidateId:randomUUID(),current:await directoryIdentity(current),backup:await directoryIdentity(backup)},proof=await prepareApplicationDraftRetention(input,()=>{})
  const saved=await installInertApplicationDraftJournal(await persistApplicationDraftRetention(proof,{appId,operationId:input.operationId,candidateId:input.candidateId,backup:input.backup})),items=applicationDraftRecoveryItems(saved.retention)
  const journal=new DraftJournal(backup),release=journal.activate(owner),barrier=new ApplicationRestoreDraftBarrier(backup,journal,{assertOwner(){}}),coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null}),receipts:DraftReceipt[]=[]
  const bridge={readDraft:()=>journal.read(),markDraftReady:async()=>{},persistDraft:async(_id:string,snapshot:DraftSnapshot)=>{const receipt=await journal.persist(owner,snapshot);receipts.push(receipt);return receipt}} as unknown as DesktopBridge
  session=new DesktopDraftSession(bridge,coordinator,{restore:()=>()=>{},installSources:()=>coordinator.registerSource('recovery',{read:()=>({version:1,items})}),flushSettings:async()=>{},closing:()=>{},restoreBarrier:{checkpoint:async receipt=>{await barrier.checkpoint(saved.retention.barrier.token,owner,receipt)},confirm:async receipt=>{await barrier.acknowledge(saved.retention.barrier.token,owner,receipt)}}})
  await session.initialize(randomUUID());assert.equal(receipts.length,2);assert.ok(receipts[1].revision>receipts[0].revision);assert.ok(receipts[1].clientRevision>receipts[0].clientRevision);assert.equal((await barrier.inspect())!.barrier.phase,'complete');assert.deepEqual((await journal.read())!.sources.recovery,{version:1,items});release()
 }finally{session?.dispose();await rm(base,{recursive:true,force:true})}
})
