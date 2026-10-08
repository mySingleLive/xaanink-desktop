import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath,rename} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {WorkStorage,type StorageOutcome} from '../../desktop/core/work-storage'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import type {StoreOptions} from '../../desktop/core/versioned-store'
async function fixture(options:StoreOptions={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review75-storage-'))),workId=randomUUID(),required=join(root,'required.json')
 await writeFile(required,'false')
 const storage=new WorkStorage(await directoryIdentity(root),workId,{assertOwner(){},required:async()=>JSON.parse(await readFile(required,'utf8')),markRequired:async()=>{await writeFile(required,'true')},writeOptions:options})
 async function candidate(){const id=randomUUID(),path=join(root,'.xuanxiang-restores',id);await mkdir(path,{recursive:true});await writeFile(join(path,'host-ready'),'ready');return{id,path,directory:await directoryIdentity(path)}}
 async function verify(id:string){const path=join(root,'.xuanxiang-restores',id);if(await readFile(join(path,'host-ready'),'utf8')!=='ready')throw Error('host candidate no longer ready');return directoryIdentity(path)}
 return{root,storage,required,candidate,verify,close:()=>rm(root,{recursive:true,force:true})}
}

test('ST75-01 failed activation cannot release an old candidate whose recorded directory identity has been replaced',async()=>{
 let replacement:()=>Promise<void>=async()=>{}
 const f=await fixture({beforeRename:async()=>replacement()})
 try{
  await f.storage.initialize();const a=await f.candidate(),b=await f.candidate()
  const first=await f.storage.activate(0,a.id,{verify:f.verify,quiesce:async()=>({preRestoreBackupId:randomUUID(),release:async()=>{}})})
  const outcomes:StorageOutcome[]=[]
  replacement=async()=>{await rename(a.path,join(f.root,'held-active'));await mkdir(a.path);await writeFile(join(a.path,'host-ready'),'ready');throw Error('controlled pre-rename failure')}
  await assert.rejects(f.storage.activate(first.revision,b.id,{verify:f.verify,quiesce:async()=>({preRestoreBackupId:randomUUID(),release:async outcome=>{outcomes.push(outcome)}})}),/controlled/)
  assert.deepEqual(outcomes,['blocked'],'old requires its recorded active directory identity, not merely unchanged pointer JSON')
  await assert.rejects(f.storage.resolve(),/directory/)
 }finally{await f.close()}
})

test('ST75-02 post-rename uncertainty must keep business blocked when the new host candidate proof no longer holds',async()=>{
 let damage:()=>Promise<void>=async()=>{}
 const f=await fixture({beforeDirectorySync:async()=>damage()})
 try{
  await f.storage.initialize();const b=await f.candidate(),outcomes:StorageOutcome[]=[]
  damage=async()=>{await writeFile(join(b.path,'host-ready'),'cancelled');throw Error('controlled directory sync failure')}
  await assert.rejects(f.storage.activate(0,b.id,{verify:f.verify,quiesce:async()=>({preRestoreBackupId:randomUUID(),release:async outcome=>{outcomes.push(outcome)}})}))
  assert.deepEqual(outcomes,['blocked'],'a visible new pointer cannot authorize resuming a candidate rejected by the host verifier')
  const state=await f.storage.resolve();assert.equal(state.active.kind,'candidate','new pointer remains authoritative; never silently use original')
 }finally{await f.close()}
})

test('ST75-03 a valid new authority is retained after durable-sync uncertainty and release remains awaited',async()=>{
 let fail=false;const f=await fixture({beforeDirectorySync:async()=>{if(fail)throw Error('controlled sync uncertainty')}})
 try{
  await f.storage.initialize();const b=await f.candidate(),release=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>(),outcomes:StorageOutcome[]=[];fail=true
  let settled=false
  const activation=f.storage.activate(0,b.id,{verify:f.verify,quiesce:async()=>({preRestoreBackupId:randomUUID(),release:async outcome=>{outcomes.push(outcome);entered.resolve();await release.promise}})}).then(()=>{throw Error('expected sync failure')},()=>{settled=true})
  await entered.promise;assert.deepEqual(outcomes,['new']);assert.equal(settled,false);assert.equal((await f.storage.resolve()).active.kind,'candidate')
  release.resolve();await activation;assert.equal(settled,true)
 }finally{await f.close()}
})

test('ST75-04 a successful pointer write still requires the final new candidate host proof before release',async()=>{
 let damage:()=>Promise<void>=async()=>{}
 const f=await fixture({beforeDirectorySync:async()=>damage()})
 try{
  await f.storage.initialize();const b=await f.candidate(),outcomes:StorageOutcome[]=[]
  damage=async()=>{await writeFile(join(b.path,'host-ready'),'cancelled')}
  await assert.rejects(f.storage.activate(0,b.id,{verify:f.verify,quiesce:async()=>({preRestoreBackupId:randomUUID(),release:async outcome=>{outcomes.push(outcome)}})}))
  assert.deepEqual(outcomes,['blocked']);assert.equal((await f.storage.resolve()).active.kind,'candidate')
 }finally{await f.close()}
})
