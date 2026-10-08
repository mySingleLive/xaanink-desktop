import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,realpath,rm,writeFile,readFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {prepareApplicationDraftRetention,persistApplicationDraftRetention,installInertApplicationDraftJournal} from '../../desktop/core/application-restore-drafts'
import {ApplicationRestoreDraftBarrier,ApplicationRestoreDraftBarrierError} from '../../desktop/main/application-restore-draft-barrier'
import {applicationDraftRecoveryItems} from '../../desktop/shared/application-restore'
import type {DraftSnapshot} from '../../desktop/shared/drafts'

async function fixture(options:{beforeRename?():Promise<void>}={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review102-drafts-'))),current=join(base,'current'),candidate=join(base,'candidate'),appId=randomUUID(),originals:DraftSnapshot[]=[],bytes:Buffer[]=[]
 for(const [i,path]of[current,candidate].entries()){
  await mkdir(path);await writeFile(join(path,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}))
  const snapshot:DraftSnapshot={version:1,revision:i+4,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[{id:randomUUID(),draft:{content:i?'旧正文草稿':'最新正文未保存稿',baseVersion:8,approved:false}}],sources:{chat:{draft:i?'旧对话':'最新未发送对话',queuedRequests:[{requestId:randomUUID(),approved:true,tool:'adoptContentCandidate',candidateId:randomUUID(),authorDecision:'old approval must stay inert'}]},comments:{quote:'原批注锚点',proposal:{approved:true,body:'只保存数据'}},staged:{pendingSave:{revision:9,payload:'禁止自动提交'}}},issues:[]}
  const writer=new DraftJournal(path);writer.activate('old');await writer.persist('old',snapshot);originals.push(snapshot);bytes.push(await readFile(join(path,'drafts.json')))
 }
 const input={appId,operationId:randomUUID(),candidateId:randomUUID(),current:await directoryIdentity(current),backup:await directoryIdentity(candidate)},saved=await installInertApplicationDraftJournal(await persistApplicationDraftRetention(await prepareApplicationDraftRetention(input,()=>{}),{appId,operationId:input.operationId,candidateId:input.candidateId,backup:input.backup})),journal=new DraftJournal(candidate);journal.activate('active');let live=true
 const barrier=new ApplicationRestoreDraftBarrier(candidate,journal,{assertOwner(){if(!live)throw Error('private fixture owner revoked')},...options}),checkpoint=(revision:number):DraftSnapshot=>({version:1,revision,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{recovery:{version:1,items:applicationDraftRecoveryItems(saved.retention)}},issues:[]})
 return{base,current,candidate,originals,bytes,saved,journal,barrier,checkpoint,revoke:()=>{live=false},close:()=>rm(base,{recursive:true,force:true})}
}

test('AR102-F09 latest prose, chat, comments and old approved requests survive both real application checkpoints strictly as complete inert snapshots',async()=>{
 const f=await fixture();try{
  assert.deepEqual(f.saved.retention.snapshots.map(row=>row.snapshot),f.originals);assert.deepEqual((await f.journal.read())!.sources,{});assert.deepEqual((await f.journal.read())!.autosaves,[])
  const first=await f.journal.persist('active',f.checkpoint(20));await f.barrier.checkpoint(f.saved.retention.barrier.token,'active',first)
  const second=await f.journal.persist('active',f.checkpoint(21));await f.barrier.acknowledge(f.saved.retention.barrier.token,'active',second)
  const retained=await f.barrier.inspect();assert.equal(retained!.barrier.phase,'complete');assert.deepEqual(retained!.snapshots.map(row=>row.snapshot),f.originals);assert.deepEqual(await readFile(join(f.current,'drafts.json')),f.bytes[0]);assert.deepEqual((await f.journal.read())!.sources,{recovery:{version:1,items:applicationDraftRecoveryItems(f.saved.retention)}});assert.equal((await f.journal.read())!.autosaves.length,0)
 }finally{await f.close()}
})

test('AR102-F10 a higher fabricated checkpoint revision and digest cannot acknowledge the application barrier',async()=>{
 const f=await fixture();try{
  const first=await f.journal.persist('active',f.checkpoint(20));await f.barrier.checkpoint(f.saved.retention.barrier.token,'active',first);const before=await readFile(join(f.candidate,'application-restore-drafts.json'))
  await assert.rejects(f.barrier.acknowledge(f.saved.retention.barrier.token,'active',{...first,revision:first.revision+1,clientRevision:first.clientRevision+1,digest:'a'.repeat(64)}),cause=>cause instanceof ApplicationRestoreDraftBarrierError&&cause.code==='APPLICATION_DRAFT_CHECKPOINT_UNCONFIRMED'&&!Object.hasOwn(cause,'cause'));assert.deepEqual(await readFile(join(f.candidate,'application-restore-drafts.json')),before);assert.equal((await f.barrier.inspect())!.barrier.phase,'checkpointed')
 }finally{await f.close()}
})

test('AR102-F11 closing the true owner during the final barrier IO prevents a transition and flush waits the physical flight',async()=>{
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve),f=await fixture({async beforeRename(){entered();await gate}})
 try{
  const first=await f.journal.persist('active',f.checkpoint(20)),before=await readFile(join(f.candidate,'application-restore-drafts.json')),flight=f.barrier.checkpoint(f.saved.retention.barrier.token,'active',first);await started;f.revoke();let drained=false;const drain=f.barrier.flush().then(()=>{drained=true});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(drained,false);release()
  await assert.rejects(flight,cause=>cause instanceof ApplicationRestoreDraftBarrierError&&!Object.hasOwn(cause,'cause'));await drain;assert.equal(drained,true);assert.deepEqual(await readFile(join(f.candidate,'application-restore-drafts.json')),before);assert.deepEqual(await readFile(join(f.current,'drafts.json')),f.bytes[0])
 }finally{release?.();await f.close()}
})

test('AR102-F12 readonly inspection of an ordinary root never manufactures an application restoration barrier',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review102-ordinary-')));try{
  const journal=new DraftJournal(base),barrier=new ApplicationRestoreDraftBarrier(base,journal,{assertOwner(){}});assert.equal(await barrier.inspect(),null);assert.equal(await barrier.inspect(),null);await barrier.flush();assert.deepEqual(await readdir(base),[])
 }finally{await rm(base,{recursive:true,force:true})}
})
