import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {WorkStorage} from '../../desktop/core/work-storage'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import type {StoreOptions} from '../../desktop/core/versioned-store'
async function fixture(options:StoreOptions={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-storage13-'))),workId=randomUUID();await writeFile(join(root,'required.json'),'false')
 const control=new WorkStorage(await directoryIdentity(root),workId,{assertOwner(){},required:async()=>JSON.parse(await readFile(join(root,'required.json'),'utf8')),markRequired:async()=>{await writeFile(join(root,'required.json'),'true')},writeOptions:options})
 const candidateId=randomUUID();await mkdir(join(root,'.xuanxiang-restores',candidateId),{recursive:true});const candidate=await directoryIdentity(join(root,'.xuanxiang-restores',candidateId))
 return{root,workId,control,candidateId,candidate,close:()=>rm(root,{recursive:true,force:true})}
}
test('restore activates one generation only after quiescence and a real pre-restore backup receipt; original remains addressable',async()=>{
 const f=await fixture();try{
  assert.equal((await f.control.resolve()).active.kind,'original');const baseline=await f.control.initialize();assert.equal(baseline.revision,0);const beforeBackup=randomUUID(),events:string[]=[]
  const result=await f.control.activate(baseline.revision,f.candidateId,{verify:async id=>{assert.equal(id,f.candidateId);events.push('verify');return f.candidate},quiesce:async()=>{events.push('quiesce');assert.equal((await f.control.resolve()).active.kind,'original');return{preRestoreBackupId:beforeBackup,release:async outcome=>{events.push(outcome)}}}})
  assert.equal(result.revision,1);assert.equal(result.active.kind,'candidate');assert.equal(result.previous?.active.kind,'original');assert.equal(result.previous?.backupId,beforeBackup);assert.deepEqual(events,['verify','quiesce','verify','verify','verify','new'])
  assert.deepEqual(await f.control.resolve(),result)
  await assert.rejects(f.control.activate(0,f.candidateId,{verify:async()=>f.candidate,quiesce:async()=>{throw Error('should not execute')}}),/变更/)
 }finally{await f.close()}
})
test('pointer replacement failure keeps original authority and releases only that old generation',async()=>{
 let fail=false;const f=await fixture({beforeRename:async()=>{if(fail)throw Error('write failed')}});try{
  await f.control.initialize();const before=await readFile(join(f.root,'xuanxiang-storage.json')),outcomes:string[]=[];fail=true
  await assert.rejects(f.control.activate(0,f.candidateId,{verify:async()=>f.candidate,quiesce:async()=>({preRestoreBackupId:randomUUID(),release:async outcome=>{outcomes.push(outcome)}})}),/write failed/)
  assert.deepEqual(await readFile(join(f.root,'xuanxiang-storage.json')),before);assert.deepEqual(outcomes,['old']);assert.equal((await f.control.resolve()).active.kind,'original')
 }finally{await f.close()}
})
test('a required missing/corrupt pointer fails closed instead of falling back to the original directory',async()=>{
 const f=await fixture();try{await f.control.initialize();await rm(join(f.root,'xuanxiang-storage.json'));await assert.rejects(f.control.resolve(),/缺失/);await writeFile(join(f.root,'xuanxiang-storage.json'),'bad');await assert.rejects(f.control.resolve())}finally{await f.close()}
})
test('post-rename sync uncertainty never resumes old data after new authority is already visible',async()=>{
 let fail=false;const f=await fixture({beforeDirectorySync:async()=>{if(fail)throw Error('sync failed')}});try{
  await f.control.initialize();fail=true;const outcomes:string[]=[]
  await assert.rejects(f.control.activate(0,f.candidateId,{verify:async()=>f.candidate,quiesce:async()=>({preRestoreBackupId:randomUUID(),release:async outcome=>{outcomes.push(outcome)}})}))
  assert.equal((await f.control.resolve()).active.kind,'candidate');assert.deepEqual(outcomes,['new'])
 }finally{await f.close()}
})
