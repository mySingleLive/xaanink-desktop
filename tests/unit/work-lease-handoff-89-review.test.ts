import assert from 'node:assert/strict'
import {test} from 'node:test'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {randomUUID} from 'node:crypto'
import {hostname,tmpdir} from 'node:os'
import {mkdtemp,realpath,mkdir,writeFile,readFile,rename,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {WorkLeaseHandoff,WorkLeaseHandoffError,type WorkLeaseHandoffOptions} from '../../desktop/main/work-lease-handoff'
import {CloseCoordinator} from '../../desktop/main/close-coordinator'

const deadPid=(async()=>{const child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});await once(child,'exit');assert.ok(child.pid);assert.throws(()=>process.kill(child.pid!,0),{code:'ESRCH'});return child.pid!})()
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-handoff-review89-'))),root=join(base,'work'),lock=join(root,'.xuanxiang-lock'),ownerFile=join(lock,'owner.json')
 await mkdir(root);await mkdir(lock)
 const lease={token:randomUUID(),host:hostname(),pid:await deadPid},ownerBytes=JSON.stringify(lease)
 await writeFile(ownerFile,ownerBytes);await writeFile(join(root,'database.bin'),'unchanged original bytes')
 const work=await directoryIdentity(root),identity={workId:randomUUID(),owner:{owner:11,sessionId:randomUUID()}}
 let closed=false,ownerValid=true,restarts=0,confirmations=0
 let handoff:WorkLeaseHandoff
 const options:WorkLeaseHandoffOptions={
  assertHost(){},assertOwner(owner){assert.deepEqual(owner,identity.owner);if(!ownerValid)throw Error('private owner changed')},assertClosed(){if(!closed)throw Error('private database not closed')},
  async target(id){assert.equal(id,identity.workId);return work},async confirm(){confirmations++;return true},
  async close(){closed=true;await handoff.finishClosed();handoff.commit();return true},async notice(){},restart(){restarts++},
 }
 handoff=new WorkLeaseHandoff(identity,options)
 return{base,root,lock,ownerFile,ownerBytes,work,identity,options,handoff,setClosed:(value:boolean)=>{closed=value},setOwner:(value:boolean)=>{ownerValid=value},restarts:()=>restarts,confirmations:()=>confirmations,cleanup:()=>rm(base,{recursive:true,force:true})}
}

test('LH89-01: only boolean true can approve destructive recovery; native-shaped or truthy non-boolean responses preserve every owner',async()=>{
 const preserved:boolean[]=[],sourcePreserved:boolean[]=[]
 for(const invalid of ['false',{response:1},[false],1]){
  const f=await fixture()
  try{
   f.options.confirm=async()=>invalid as unknown as boolean
   await f.handoff.start().catch(error=>{assert.ok(error instanceof WorkLeaseHandoffError);assert.match(error.code,/^HANDOFF_/);assert.equal(Object.hasOwn(error,'cause'),false)})
   preserved.push(await readFile(f.ownerFile,'utf8').then(bytes=>bytes===f.ownerBytes,()=>false))
   sourcePreserved.push(await readFile(join(f.root,'database.bin'),'utf8')==='unchanged original bytes')
  }finally{await f.cleanup()}
 }
 assert.deepEqual(sourcePreserved,[true,true,true,true])
 assert.deepEqual(preserved,[true,true,true,true])
})

test('LH89-02: a catalog target replaced before core preparation cannot authorize deletion of either old or foreign directories',async()=>{
 const f=await fixture(),preserved=join(f.base,'preserved-work')
 try{
  f.options.target=async()=>{
   await rename(f.root,preserved);await mkdir(f.root);await mkdir(f.lock)
   await writeFile(f.ownerFile,'foreign owner bytes');await writeFile(join(f.root,'database.bin'),'foreign database bytes')
   return f.work
  }
  assert.equal(await f.handoff.start(),true)
  assert.equal(f.handoff.outcome?.status,'failed');assert.equal(f.confirmations(),0);assert.equal(f.restarts(),1)
  assert.equal(await readFile(f.ownerFile,'utf8'),'foreign owner bytes')
  assert.equal(await readFile(join(preserved,'.xuanxiang-lock/owner.json'),'utf8'),f.ownerBytes)
  assert.equal(await readFile(join(preserved,'database.bin'),'utf8'),'unchanged original bytes')
  assert.equal(await readFile(join(f.root,'database.bin'),'utf8'),'foreign database bytes')
 }finally{await f.cleanup()}
})

test('LH89-03: the real CloseCoordinator owns pending host flush while handoff cancellation remains safe in release without a wait cycle',async()=>{
 const f=await fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let pending:Promise<boolean>|undefined,flushed=0,closed=0
 try{
  const coordinator=new CloseCoordinator({current:()=>f.identity.owner,busy:async()=>false,confirmStop:async()=>true,stopTasks:async()=>{},
   flush:async()=>{flushed++;entered.resolve();await release.promise},closeData:async()=>{closed++;f.setClosed(true)},afterClose:()=>f.handoff.finishClosed(),
   failed:async()=>{throw Error('unexpected failure')},exportDraft:async()=>{throw Error('unexpected export')},commit:()=>{f.handoff.commit()},release:()=>f.handoff.cancel(),
  })
  f.options.close=intent=>coordinator.request(intent)
  pending=f.handoff.start();await entered.promise
  await f.handoff.cancel()
  assert.equal(f.handoff.ready,false);assert.equal(f.handoff.pending,true);assert.equal(closed,0);assert.equal(f.restarts(),0)
  const originalFlight=coordinator.request('quit');assert.strictEqual(coordinator.request('quit'),originalFlight)
  let settled=false;void originalFlight.then(()=>{settled=true});await new Promise(setImmediate);assert.equal(settled,false)
  release.resolve();assert.equal(await pending,true);assert.equal(await originalFlight,true)
  assert.equal(flushed,1);assert.equal(closed,1);assert.equal(f.confirmations(),0);assert.equal(f.handoff.outcome?.status,'cancelled');assert.equal(f.restarts(),1)
  assert.equal(await readFile(f.ownerFile,'utf8'),f.ownerBytes)
 }finally{release.resolve();await pending?.catch(()=>{});await f.cleanup()}
})

test('LH89-04: lost owner during notice permanently prevents restart while the already-completed deletion remains a factual result',async()=>{
 const f=await fixture()
 try{
  f.options.notice=async()=>{f.setOwner(false)}
  await assert.rejects(f.handoff.start(),(error:unknown)=>error instanceof WorkLeaseHandoffError&&error.code==='HANDOFF_OWNER_CHANGED')
  assert.equal(f.handoff.outcome?.status,'recovered');assert.equal(f.handoff.requiresRestart,true);assert.equal(f.handoff.ready,false);assert.equal(f.restarts(),0)
  const external=f.handoff.outcome!;external.status='cancelled';assert.equal(f.handoff.outcome?.status,'recovered')
  f.setOwner(true)
  await assert.rejects(f.handoff.finishClosed(),(error:unknown)=>error instanceof WorkLeaseHandoffError&&error.code==='HANDOFF_OWNER_CHANGED')
  assert.throws(()=>f.handoff.commit(),WorkLeaseHandoffError)
  assert.equal(await readFile(join(f.root,'database.bin'),'utf8'),'unchanged original bytes');assert.equal(f.restarts(),0)
 }finally{await f.cleanup()}
})
