import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {DesktopSaveCoordinator,DesktopSaveError} from '../../src/lib/desktop/save-coordinator'
import {DesktopDraftSession} from '../../src/lib/desktop/draft-session'
import {DesktopRecoveryStore,restoreDesktopDraft} from '../../src/lib/desktop/draft-recovery'
import {WorkspaceDraftSource} from '../../src/lib/desktop/workspace-draft-source'
import {AutosaveController} from '../../src/lib/autosave-controller'
import {DraftJournal} from '../../desktop/main/draft-journal'
import type {DraftSnapshot,DraftReceipt} from '../../desktop/shared/drafts'
import type {DesktopBridge} from '../../desktop/shared/ipc'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {prepareApplicationDraftRetention,persistApplicationDraftRetention,installInertApplicationDraftJournal} from '../../desktop/core/application-restore-drafts'
import {ApplicationRestoreDraftBarrier} from '../../desktop/main/application-restore-draft-barrier'
import {applicationDraftRecoveryItems} from '../../desktop/shared/application-restore'

const now='2026-10-08T00:00:00.000Z'
const inertItem=()=>({id:'application:'+randomUUID(),source:'application',path:'operation/candidate/current/original',reason:'APPLICATION_RESTORED' as const,createdAt:now,value:{autosaves:[{request:{url:'/api/novels/work/approve',method:'POST',body:{approved:true}}}],sources:{chat:{pendingRequest:{operationId:randomUUID(),prompt:'never send'},queuedMessages:[{approved:true,prompt:'never replay'}]},staged:{approved:true,request:{method:'PATCH',url:'/api/novels/work/chapters/chapter/content',body:'full unsaved prose'}}}}})
const isAbort=(cause:unknown)=>cause instanceof DOMException&&cause.name==='AbortError'

test('AR104-D01 concurrent force floors and one cancelled waiter share the actual journal IO while the final receipt exceeds every floor',{timeout:10000},async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review104-force-'))),started=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),receipts:DraftReceipt[]=[],writes:DraftSnapshot[]=[],coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null});let writesStarted=0,domainSaves=0
 const journal=new DraftJournal(root,{async beforeRename(){if(++writesStarted===1){started.resolve();await release.promise}}});journal.activate('owner')
 const controller=new AutosaveController<{approved:boolean;request:{method:string;body:string}}>(async()=>{domainSaves++},100000);controller.pause();controller.schedule({approved:true,request:{method:'POST',body:'inert full prose'}});const unregister=coordinator.register(controller),removeSource=coordinator.registerSource('recovery',{read:()=>({version:1,items:[inert]})}),inert=inertItem(),removeWriter=coordinator.configurePersistence(async value=>{writes.push(structuredClone(value) as DraftSnapshot);receipts.push(await journal.persist('owner',value as DraftSnapshot))})
 const first=coordinator.checkpointDrafts();let other:Promise<unknown>|undefined,cancelled:Promise<unknown>|undefined
 try{
  await started.promise;const floor=writes[0].revision,high=floor+20,abort=new AbortController();cancelled=coordinator.checkpointDrafts({afterRevision:floor,signal:abort.signal});other=coordinator.checkpointDrafts({afterRevision:high});abort.abort();await assert.rejects(cancelled,isAbort)
  assert.equal(receipts.length,0);assert.equal(domainSaves,0);release.resolve();const [a,b]=await Promise.all([first,other]);assert.ok(a.revision>high);assert.equal((b as DraftSnapshot).revision,a.revision);assert.ok(receipts.at(-1)!.clientRevision>high);assert.ok(receipts.at(-1)!.revision>receipts[0].revision);assert.equal(domainSaves,0);assert.equal(controller.snapshot().paused,true);assert.equal(controller.snapshot().pending!.value.approved,true);assert.deepEqual((await journal.read())!.sources.recovery,{version:1,items:[inert]})
 }finally{release.resolve();await Promise.allSettled([first,...(other?[other]:[]),...(cancelled?[cancelled]:[])]);removeWriter();removeSource();unregister();controller.dispose();await rm(root,{recursive:true,force:true})}
})

test('AR104-D02 invalid force floors reject before changing generation or starting a journal write',async()=>{
 const coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null});let writes=0;const remove=coordinator.configurePersistence(async()=>{writes++}),before=coordinator.getState().revision
 try{for(const floor of[-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,'10' as unknown as number])await assert.rejects(coordinator.checkpointDrafts({afterRevision:floor}),cause=>cause instanceof DesktopSaveError&&cause.code==='DURABLE_SAVE_FAILED');assert.equal(writes,0);assert.equal(coordinator.getState().revision,before)}finally{remove()}
})

test('AR104-D03 replacing a writer and revoking its real owner during pending IO cannot commit that old checkpoint; an explicit new-owner checkpoint preserves the same data',{timeout:10000},async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review104-writer-'))),started=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null});let armed=false,held=false
 const journal=new DraftJournal(root,{async beforeRename(){if(armed&&!held){held=true;started.resolve();await release.promise}}}),releaseOwner=journal.activate('old'),beforeSnapshot:DraftSnapshot={version:1,revision:1,createdAt:now,autosaves:[],sources:{chat:{draft:'original on disk'}},issues:[]};await journal.persist('old',beforeSnapshot);const before=await readFile(join(root,'drafts.json'));armed=true
 const item=inertItem(),removeSource=coordinator.registerSource('recovery',{read:()=>({version:1,items:[item]})}),removeOld=coordinator.configurePersistence(async value=>{await journal.persist('old',value as DraftSnapshot)}),first=coordinator.checkpointDrafts();let removeNew:(()=>void)|undefined
 try{
  await started.promise;const floor=coordinator.exportSnapshot().revision;removeOld();releaseOwner();journal.activate('new');removeNew=coordinator.configurePersistence(async value=>{await journal.persist('new',value as DraftSnapshot)});release.resolve();await assert.rejects(first,cause=>cause instanceof DesktopSaveError&&cause.code==='DURABLE_SAVE_FAILED');assert.deepEqual(await readFile(join(root,'drafts.json')),before)
  const saved=await coordinator.checkpointDrafts({afterRevision:floor});assert.ok(saved.revision>floor);assert.deepEqual((await journal.read())!.sources.recovery,{version:1,items:[item]})
 }finally{release.resolve();await first.catch(()=>{});removeNew?.();removeOld();removeSource();await rm(root,{recursive:true,force:true})}
})

async function sessionFixture(options:{beforeFirst?():Promise<void>;beforeSecond?():Promise<void>;afterRevision?:number}={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review104-session-'))),current=join(base,'current'),target=join(base,'target'),appId=randomUUID(),originals:Buffer[]=[]
 for(const [i,root]of[current,target].entries()){await mkdir(root);await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}));const previous=new DraftJournal(root);previous.activate('old');await previous.persist('old',{version:1,revision:1,createdAt:now,autosaves:[],sources:{chat:{draft:i?'old backup':'latest actual source',queuedRequests:[{approved:true,prompt:'keep inert'}]}},issues:[]});originals.push(await readFile(join(root,'drafts.json')))}
 const input={appId,operationId:randomUUID(),candidateId:randomUUID(),current:await directoryIdentity(current),backup:await directoryIdentity(target)},saved=await installInertApplicationDraftJournal(await persistApplicationDraftRetention(await prepareApplicationDraftRetention(input,()=>{}),{appId,operationId:input.operationId,candidateId:input.candidateId,backup:input.backup})),items=applicationDraftRecoveryItems(saved.retention),journal=new DraftJournal(target),releaseOwner=journal.activate('active'),coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null}),receipts:DraftReceipt[]=[];let live=true,cleanups=0
 const barrier=new ApplicationRestoreDraftBarrier(target,journal,{assertOwner(){if(!live)throw Error('actual owner revoked')}}),bridge={readDraft:()=>journal.read(),markDraftReady:async()=>{},persistDraft:async(_id:string,value:DraftSnapshot)=>{const receipt=await journal.persist('active',value);receipts.push(receipt);return receipt}} as unknown as DesktopBridge,session=new DesktopDraftSession(bridge,coordinator,{restore:()=>()=>{cleanups++},installSources:()=>coordinator.registerSource('recovery',{read:()=>({version:1,items})}),flushSettings:async()=>{},closing:()=>{},restoreBarrier:{afterRevision:options.afterRevision,checkpoint:async receipt=>{await options.beforeFirst?.();await barrier.checkpoint(saved.retention.barrier.token,'active',receipt)},confirm:async receipt=>{await options.beforeSecond?.();await barrier.acknowledge(saved.retention.barrier.token,'active',receipt)}}})
 return{base,current,target,originals,receipts,saved,items,journal,barrier,session,cleanups:()=>cleanups,revoke(){live=false;releaseOwner();session.dispose()},async close(){session.dispose();releaseOwner();await barrier.flush();await rm(base,{recursive:true,force:true})}}
}

test('AR104-D04 revocation during the second actual acknowledgement keeps the application barrier checkpointed and all original requests inert',{timeout:10000},async()=>{
 const started=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),f=await sessionFixture({async beforeSecond(){started.resolve();await release.promise}}),init=f.session.initialize(randomUUID())
 try{
  await started.promise;assert.equal(f.receipts.length,2);assert.ok(f.receipts[1].revision>f.receipts[0].revision);assert.ok(f.receipts[1].clientRevision>f.receipts[0].clientRevision);assert.equal(f.cleanups(),1);assert.equal((await f.barrier.inspect())!.barrier.phase,'checkpointed');const before=await readFile(join(f.target,'application-restore-drafts.json'));f.revoke();release.resolve();await assert.rejects(init);assert.deepEqual(await readFile(join(f.target,'application-restore-drafts.json')),before);assert.deepEqual(await readFile(join(f.current,'drafts.json')),f.originals[0]);assert.deepEqual((await f.journal.read())!.sources.recovery,{version:1,items:f.items});assert.equal((await f.journal.read())!.autosaves.length,0)
 }finally{release.resolve();await init.catch(()=>{});await f.close()}
})

test('AR104-D05 a failed physical first-checkpoint hook preserves protection and prevents cache cleanup or a second receipt',{timeout:10000},async()=>{
 const f=await sessionFixture({async beforeFirst(){throw Error('isolated first checkpoint failure')}})
 try{const before=await readFile(join(f.target,'application-restore-drafts.json'));await assert.rejects(f.session.initialize(randomUUID()));assert.equal(f.receipts.length,1);assert.equal(f.cleanups(),0);assert.equal((await f.barrier.inspect())!.barrier.phase,'protected');assert.deepEqual(await readFile(join(f.target,'application-restore-drafts.json')),before);assert.deepEqual(await readFile(join(f.current,'drafts.json')),f.originals[0]);assert.deepEqual((await f.journal.read())!.sources.recovery,{version:1,items:f.items})}finally{await f.close()}
})

test('AR104-D06 application reasons and complete saved request objects survive duplicate launches without verification, controller actions or transport replay',async t=>{
 const item=inertItem(),changed={...structuredClone(item),value:{...item.value,extra:'distinct author input despite repeated original id'}},snapshot:DraftSnapshot={version:1,revision:7,createdAt:now,autosaves:[{id:randomUUID(),draft:{approved:true,request:{method:'POST',url:'/api/novels/work/candidates/adopt',body:'must stay inert'}}}],sources:{recovery:{version:1,items:[item,item,changed]},chat:{approved:true,pendingRequest:{url:'/api/chat',method:'POST',body:'never execute'}},scene:{submissions:{approved:true,request:{url:'/api/scenes/save'}}},staged:{requests:[{method:'PATCH',approved:true,body:'full prose'}]},comments:{requests:[{method:'POST',approved:true,body:'full comment'}]},workspace:{tabs:[{type:'chapter-content',refId:'historical'}]}},issues:[]},original=structuredClone(snapshot),first=new DesktopRecoveryStore();let verifications=0,network=0
 t.mock.method(globalThis,'fetch',async()=>{network++;throw Error('recovery must not call transport')})
 await restoreDesktopDraft(snapshot,{restoreSession:false,disabledReason:'APPLICATION_RESTORED',accountId:'local-author',storage:null,recovery:first,workspace:new WorkspaceDraftSource(),verifyTarget(){verifications++;return true}});assert.deepEqual(snapshot,original);const retained=first.read();assert.equal(retained.items.filter(row=>row.source==='application').length,2);assert.ok(retained.items.every(row=>row.reason==='APPLICATION_RESTORED'));assert.equal(verifications,0);assert.equal(network,0)
 const second=new DesktopRecoveryStore(),next:DraftSnapshot={version:1,revision:8,createdAt:now,autosaves:[],sources:{recovery:retained},issues:[]};await restoreDesktopDraft(next,{restoreSession:true,accountId:'local-author',storage:null,recovery:second,workspace:new WorkspaceDraftSource(),verifyTarget(){verifications++;return true}});await restoreDesktopDraft(next,{restoreSession:true,accountId:'local-author',storage:null,recovery:second,workspace:new WorkspaceDraftSource()});assert.deepEqual(second.read(),retained);assert.equal(verifications,0);assert.equal(network,0)
 const exported=second.read();(exported.items[0].value as {tampered?:boolean}).tampered=true;assert.deepEqual(second.read(),retained)
})

test('AR104-D07 a fresh coordinator advances unchanged recovery data past a prior actual client receipt and completes two separate disk checkpoints',{timeout:10000},async()=>{
 const f=await sessionFixture({afterRevision:30})
 try{
  const previous=await f.journal.persist('active',{version:1,revision:30,createdAt:now,autosaves:[],sources:{recovery:{version:1,items:f.items}},issues:[]});assert.equal(previous.clientRevision,30)
  await f.session.initialize(randomUUID());assert.equal(f.receipts.length,2);assert.ok(f.receipts[0].clientRevision>previous.clientRevision);assert.ok(f.receipts[0].revision>previous.revision);assert.ok(f.receipts[1].clientRevision>f.receipts[0].clientRevision);assert.ok(f.receipts[1].revision>f.receipts[0].revision);assert.equal((await f.barrier.inspect())!.barrier.phase,'complete');assert.deepEqual((await f.journal.read())!.sources.recovery,{version:1,items:f.items});assert.deepEqual(await readFile(join(f.current,'drafts.json')),f.originals[0])
 }finally{await f.close()}
})
