import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,realpath,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {checkpointFixture} from '../fixtures/application-restore-checkpoint'
import {applicationRestorePreflight} from '../../desktop/main/application-restore-preflight'
import {ApplicationRestoreCheckpointSession} from '../../desktop/main/application-restore-checkpoint-session'

test('the synchronous first-turn recovery preflight permits a genuinely fresh bootstrap without creating a pointer or source',async()=>{
 const boot=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-app-preflight36-')))
 try{let assertions=0;const preflight=applicationRestorePreflight(boot,()=>{assertions++});assert.equal(preflight.startup.mode,'normal');assert.ok(assertions>0)}finally{await rm(boot,{recursive:true,force:true})}
})
test('real pending protection overrides normal bootstrap; only two complete physical main checkpoints return it to normal',{timeout:20000},async()=>{
 const f=await checkpointFixture()
 try{
  assert.equal(applicationRestorePreflight(f.boot,()=>{}).startup.mode,'protected')
  const controller=new ApplicationRestoreCheckpointSession({root:f.path,journal:f.journal,journalOwner:f.journalOwner,requests:f.requests,operationId:f.operationId,ownerNonce:f.owner,assertOwner:f.assertOwner,withWrite:run=>f.gate.writeFlight(run)})
  await controller.persist(f.snapshot(1));assert.equal(applicationRestorePreflight(f.boot,()=>{}).startup.mode,'protected')
  await controller.persist(f.snapshot(2));assert.equal(applicationRestorePreflight(f.boot,()=>{}).startup.mode,'normal')
 }finally{await f.close()}
})
test('tampered or orphan application protection is cold, and preflight leaves the original bytes unchanged',{timeout:20000},async t=>{
 for(const kind of['tampered','lost-request'] as const)await t.test(kind,async()=>{
  const f=await checkpointFixture()
  try{
   const target=kind==='tampered'?join(f.path,'application-restore-drafts.json'):join(f.boot,'application-recovery-request.json')
   if(kind==='tampered')await writeFile(target,'{"incomplete":true}\n');else await rm(target)
   const original=kind==='tampered'?await readFile(target):null
   assert.equal(applicationRestorePreflight(f.boot,()=>{}).startup.mode,'cold')
   if(original)assert.deepEqual(await readFile(target),original)
  }finally{await f.close()}
 })
})
test('asynchronous or lost instance-lock assertions cannot admit ordinary startup',async()=>{
 const boot=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-app-preflight-lock36-')))
 try{for(const assertion of[()=>{throw Error('lock lost')},(()=>Promise.resolve()) as unknown as ()=>void])assert.equal(applicationRestorePreflight(boot,assertion).startup.mode,'cold')}finally{await rm(boot,{recursive:true,force:true})}
})
