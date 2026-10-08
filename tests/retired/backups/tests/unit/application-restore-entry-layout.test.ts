import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,realpath,writeFile,readdir,rename,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import fsPromises from 'node:fs/promises'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {canonical,digest} from '../../desktop/core/application-backup-files'
import {ApplicationRestoreRequests} from '../../desktop/main/application-restore-request'
import {createNativeApplicationRestoreLayout,bindApplicationRestoreLayout,inspectApplicationRestoreLayouts,loadApplicationRestoreLayout} from '../../desktop/main/application-restore-layout'

async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-entry36-'))),boot=join(root,'boot'),base=join(root,'base'),source=join(root,'source'),backup=join(root,'backup'),id=randomUUID(),owner=randomUUID(),backupId=randomUUID()
 for(const path of[boot,base,source,backup])await mkdir(path)
 const bootstrap=await directoryIdentity(boot),parent=await directoryIdentity(base)
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id,phase:'ready',inboxReady:true}))
 await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 await writeFile(join(boot,'data-root.json'),JSON.stringify({schemaVersion:1,revision:1,rootId:id,migrationId:null,root:await directoryIdentity(source)}))
 const receipt={format:'xuanxiang-application-backup',schemaVersion:1,id:backupId,appId:id,createdAt:'2026-10-08T00:00:00.000Z',phase:'verified',engine:{pglite:'0.5.8',postgresMajor:17},files:[],directories:[],bytes:0}
 await writeFile(join(backup,'xuanxiang-app-backup.json'),JSON.stringify({...receipt,checksum:digest(canonical(receipt))}))
 return{root,boot,base,source,bootstrap,parent,owner,backupId,backup:await directoryIdentity(backup),close:()=>rm(root,{recursive:true,force:true})}
}
test('ENTRY36-L01 native empty base allocates four distinct UUID siblings; intent is cold until exact prepared binding',{timeout:15000},async()=>{
 const f=await fixture()
 try{
  const handle=await createNativeApplicationRestoreLayout(f.bootstrap,f.parent,f.owner,'healthy',()=>{})
  assert.equal(new Set(Object.values(handle.layout.parents).map(row=>row.path)).size,4);assert.equal((await readdir(f.base)).length,4)
  assert.equal(inspectApplicationRestoreLayouts(f.bootstrap).unknown,true)
  assert.deepEqual(inspectApplicationRestoreLayouts(f.bootstrap,{allowed:handle}),{operationIds:[],unknown:false})
  const manager=new ApplicationRestoreRequests(f.bootstrap,{assertStableLock(){},assertOwner(){},assertQuiesced(){},assertOldProcessExited(){},assertCold(){},assertExecutionSettled(){},inspectPendingEvidence(){return inspectApplicationRestoreLayouts(f.bootstrap,{allowed:handle})}})
  const prepared=await manager.prepare(f.owner,{backup:{directory:f.backup,backupId:f.backupId},parent:handle.layout.parents.candidate})
  await bindApplicationRestoreLayout(handle,prepared)
  assert.deepEqual(inspectApplicationRestoreLayouts(f.bootstrap),{operationIds:[prepared.operationId],unknown:false})
  const loaded=loadApplicationRestoreLayout(f.bootstrap,prepared);assert.equal(loaded.sourceKind,'healthy');assert.equal(loaded.parents.candidate.path,prepared.parent.path)
  await manager.cancelPrepared(f.owner,prepared.operationId)
  assert.deepEqual(inspectApplicationRestoreLayouts(f.bootstrap),{operationIds:[],unknown:false})
 }finally{await f.close()}
})
test('ENTRY36-L06 own new UUID child is pinned before first async identity read; replacement remains foreign and allocating stays cold',{timeout:15000},async t=>{
 const f=await fixture()
 try{
  const original=fsPromises.lstat;let swapped=false
  t.mock.method(fsPromises,'lstat',(async(...args:Parameters<typeof fsPromises.lstat>)=>{const path=String(args[0]);if(!swapped&&path.startsWith(f.base+'/')){swapped=true;await rename(path,join(f.root,'owned-child-preserved'));await mkdir(path)}return original(...args)}) as typeof fsPromises.lstat)
  await assert.rejects(createNativeApplicationRestoreLayout(f.bootstrap,f.parent,f.owner,'healthy',()=>{}))
  assert.equal(swapped,true);assert.equal(inspectApplicationRestoreLayouts(f.bootstrap).unknown,true);assert.ok((await readdir(f.root)).includes('owned-child-preserved'));assert.equal((await readdir(f.boot)).includes('application-recovery-request.json'),false)
 }finally{t.mock.restoreAll();await f.close()}
})
test('ENTRY36-L04 registered external work is protected by its original physical identity even after a same-volume rename',{timeout:15000},async()=>{
 const f=await fixture()
 try{
  const work=join(f.root,'work'),moved=join(f.root,'work-moved');await mkdir(work)
  const identity=await directoryIdentity(work)
  await writeFile(join(f.source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[{id:randomUUID(),path:work,identity:{device:identity.device,inode:identity.inode},novelId:'novel',title:'title',requestId:randomUUID(),requestHash:'hash',createdAt:'2026-10-08T00:00:00.000Z'}]}))
  await rename(work,moved);const inside=join(moved,'selected');await mkdir(inside)
  await assert.rejects(createNativeApplicationRestoreLayout(f.bootstrap,await directoryIdentity(inside),f.owner,'closed-source',()=>{}),{code:'LAYOUT_OVERLAP'})
  assert.deepEqual(await readdir(inside),[]);assert.deepEqual((await readdir(f.boot)).filter(name=>name.startsWith('desktop-recovery-layout-')),[])
 }finally{await f.close()}
})
test('ENTRY36-L05 missing exact layout alongside a valid prepared request stays cold; cloned JSON grants no suppression',{timeout:15000},async()=>{
 const f=await fixture()
 try{
  const handle=await createNativeApplicationRestoreLayout(f.bootstrap,f.parent,f.owner,'healthy',()=>{})
  const manager=new ApplicationRestoreRequests(f.bootstrap,{assertStableLock(){},assertOwner(){},assertQuiesced(){},assertOldProcessExited(){},assertCold(){},assertExecutionSettled(){},inspectPendingEvidence(){return inspectApplicationRestoreLayouts(f.bootstrap,{allowed:handle})}})
  const prepared=await manager.prepare(f.owner,{backup:{directory:f.backup,backupId:f.backupId},parent:handle.layout.parents.candidate});await bindApplicationRestoreLayout(handle,prepared)
  const file=(await readdir(f.boot)).find(name=>name.startsWith('desktop-recovery-layout-'))!;await rm(join(f.boot,file))
  assert.equal(inspectApplicationRestoreLayouts(f.bootstrap).unknown,true)
  assert.equal(manager.startup().mode,'cold');assert.throws(()=>loadApplicationRestoreLayout(f.bootstrap,prepared))
 }finally{await f.close()}
})
test('ENTRY36-L02 cloned handles cannot suppress pending evidence or bind; replacement ancestor remains unknown',{timeout:15000},async()=>{
 const f=await fixture()
 try{
  const handle=await createNativeApplicationRestoreLayout(f.bootstrap,f.parent,f.owner,'missing',()=>{})
  assert.equal(inspectApplicationRestoreLayouts(f.bootstrap,{allowed:{...handle}}).unknown,true)
  await assert.rejects(bindApplicationRestoreLayout({...handle},{} as never))
  await rename(f.base,f.base+'.original');await mkdir(f.base)
  assert.equal(inspectApplicationRestoreLayouts(f.bootstrap,{allowed:handle}).unknown,true)
  assert.throws(()=>handle.assertCurrent())
 }finally{await f.close()}
})
test('ENTRY36-L03 revoked sync authority and nonempty base produce no new physical layout or metadata',{timeout:15000},async()=>{
 const f=await fixture()
 try{
  await assert.rejects(createNativeApplicationRestoreLayout(f.bootstrap,f.parent,f.owner,'healthy',()=>{throw Error('revoked')}))
  assert.deepEqual(await readdir(f.base),[])
  await writeFile(join(f.base,'foreign'),'preserve')
  await assert.rejects(createNativeApplicationRestoreLayout(f.bootstrap,f.parent,f.owner,'healthy',()=>{}))
  assert.deepEqual((await readdir(f.boot)).filter(name=>name.startsWith('desktop-recovery-layout-')),[])
 }finally{await f.close()}
})
test('ENTRY36-L07 unconfirmed existing app marker cannot allocate a recovery layout even with a readable catalog',{timeout:15000},async()=>{
 const f=await fixture()
 try{await writeFile(join(f.source,'xuanxiang-app.json'),'invalid owner');await assert.rejects(createNativeApplicationRestoreLayout(f.bootstrap,f.parent,f.owner,'closed-source',()=>{}));assert.deepEqual(await readdir(f.base),[]);assert.deepEqual((await readdir(f.boot)).filter(name=>name.startsWith('desktop-recovery-layout-')),[])}finally{await f.close()}
})
