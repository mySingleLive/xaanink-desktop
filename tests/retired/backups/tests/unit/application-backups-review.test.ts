import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdir,mkdtemp,writeFile,readFile,readdir,rm,realpath,access,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {ApplicationBackups,type ApplicationBackupHost} from '../../desktop/core/application-backups'
import {canonical,digest,inspectTree} from '../../desktop/core/application-backup-files'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {verifyApplicationRestore} from '../../desktop/service/database/application-restore'

async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-backup-independent84-'))),source=join(base,'source'),storage=join(base,'backups'),appId=randomUUID()
 for(const path of [join(source,'inbox/database/global'),join(source,'inbox/database/pg_notify'),storage])await mkdir(path,{recursive:true})
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}))
 await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 await writeFile(join(source,'state.json'),'historical application setting')
 await writeFile(join(source,'inbox/database/PG_VERSION'),'18')
 await writeFile(join(source,'inbox/database/global/pg_control'),'closed controlled engine byte fixture')
 const root=await directoryIdentity(source),directory=await directoryIdentity(storage)
 // These cases test byte/identity/retention guards, not semantic PGlite health.
 const host:ApplicationBackupHost={assertOwner:async()=>{},assertClosed:async()=>{},verifyCaptured:async()=>{}}
 return{base,source,storage,appId,root,directory,host,close:()=>rm(base,{recursive:true,force:true})}
}
async function exists(path:string){try{await access(path);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}}

test('AB84-01: corruption of the new package after pruning starts must stop deleting remaining historical bytes',{timeout:10000},async()=>{
 const f=await fixture();let oldId='',newId='',pruning=false,damaged=false
 f.host.assertClosed=async()=>{
  if(pruning&&!damaged&&!await exists(join(f.storage,oldId,'data/catalog.json'))){damaged=true;await writeFile(join(f.storage,newId,'data/state.json'),'externally damaged new package')}
 }
 const store=new ApplicationBackups(f.directory,f.appId,{pglite:'0.5.8',postgresMajor:18},f.host,{hook(phase){if(phase==='before-prune')pruning=true}})
 try{
  const old=await store.create(f.root,1);oldId=old.id;await writeFile(join(f.source,'state.json'),'current setting replaces historical setting')
  f.host.verifyCaptured=async receipt=>{newId=receipt.id}
  await assert.rejects(store.create(f.root,1),/CHANGED|VERIFY/);assert.equal(damaged,true)
  assert.equal(await readFile(join(f.storage,old.id,'data/state.json'),'utf8').catch(()=>null),'historical application setting','already deleted files need not roll back, but remaining history must survive loss of the new package proof')
  assert.equal(await readFile(join(f.source,'state.json'),'utf8'),'current setting replaces historical setting')
 }finally{await f.close()}
})

test('AB84-02: readonly candidate verification must reject a file changed at its final asynchronous owner guard',{timeout:10000},async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-candidate-independent84-'))),id=randomUUID(),appId=randomUUID(),path=join(base,id)
 try{
  await mkdir(path);await writeFile(join(path,'state.json'),'sealed historical setting')
  const parent=await directoryIdentity(base),directory=await directoryIdentity(path),tree=await inspectTree(directory,async()=>{})
  const body={format:'xuanxiang-application-candidate' as const,schemaVersion:1 as const,id,appId,backupId:randomUUID(),backupChecksum:'0'.repeat(64),createdAt:new Date().toISOString(),phase:'ready' as const,directory,engine:{pglite:'0.5.8',postgresMajor:18},migrations:[],files:tree.files,directories:tree.directories}
  await writeFile(join(path,'.xuanxiang-application-candidate.json'),JSON.stringify({...body,checksum:digest(canonical(body))}))
  // Measure the public guard sequence first, avoiding a guessed private count.
  // The producer is controlled here; this probe concerns the returned seal.
  let calls=0;await verifyApplicationRestore(parent,id,{expectedAppId:appId,assertOwner:async()=>{calls++}});const last=calls;calls=0;let replaced=false
  await assert.rejects(verifyApplicationRestore(parent,id,{expectedAppId:appId,assertOwner:async()=>{if(++calls===last){replaced=true;await writeFile(join(path,'state.json'),'late changed application setting')}}}),/CHANGED/)
  assert.equal(replaced,true);assert.equal(await readFile(join(path,'state.json'),'utf8'),'late changed application setting')
 }finally{await rm(base,{recursive:true,force:true})}
})

test('AB84-03: verifier receipt mutation cannot rewrite package identity or authorize the wrong phase; unknown neighboring files survive',{timeout:10000},async()=>{
 const f=await fixture();f.host.verifyCaptured=async receipt=>{receipt.id=randomUUID();receipt.files.splice(0);receipt.phase='verified';receipt.appId=randomUUID()}
 try{
  await writeFile(join(f.storage,'unknown-neighbor'),'preserve original neighbor')
  const store=new ApplicationBackups(f.directory,f.appId,{pglite:'0.5.8',postgresMajor:18},f.host),receipt=await store.create(f.root,1)
  assert.equal(receipt.appId,f.appId);assert.equal(receipt.phase,'verified');assert.ok(receipt.files.some(row=>row.path==='state.json'))
  assert.equal((await store.read(receipt.id)).checksum,receipt.checksum);assert.equal(await readFile(join(f.storage,'unknown-neighbor'),'utf8'),'preserve original neighbor');assert.equal((await readdir(f.storage)).filter(id=>id!=='unknown-neighbor').length,1)
 }finally{await f.close()}
})

test('AB84-04: a full 1000-entry container must reject creation without producing an inaccessible 1001st package',{timeout:10000},async()=>{
 const f=await fixture()
 try{
  for(let start=0;start<1000;start+=25)await Promise.all(Array.from({length:25},(_,offset)=>writeFile(join(f.storage,`foreign-${start+offset}`),'preserve neighboring byte')))
  const store=new ApplicationBackups(f.directory,f.appId,{pglite:'0.5.8',postgresMajor:18},f.host)
  await assert.rejects(store.create(f.root,1),/APPLICATION_BACKUP_LIMIT/)
  assert.equal((await readdir(f.storage)).length,1000);assert.equal(await readFile(join(f.storage,'foreign-999'),'utf8'),'preserve neighboring byte')
 }finally{await f.close()}
})

test('AB84-05: a replaced metadata temporary pathname is foreign content and cannot be unlinked on a failed owner guard',{timeout:10000},async()=>{
 const f=await fixture();let armed=false,replaced:string|undefined
 f.host.assertOwner=async()=>{
  if(!armed||replaced)return
  for(const id of await readdir(f.storage)){
   if(!/^[0-9a-f-]{36}$/.test(id))continue
   const temporary=(await readdir(join(f.storage,id))).find(name=>/^\.[0-9a-f-]{36}\.tmp$/.test(name))
   if(temporary){replaced=join(f.storage,id,temporary);await rename(replaced,join(f.base,'retained-own-temporary'));await writeFile(replaced,'foreign temporary replacement');throw Error('OWNER_LOST_AFTER_TEMP_REPLACEMENT')}
  }
 }
 try{
  const store=new ApplicationBackups(f.directory,f.appId,{pglite:'0.5.8',postgresMajor:18},f.host),healthy=await store.create(f.root,1);armed=true
  await assert.rejects(store.create(f.root,1),/OWNER_LOST_AFTER_TEMP_REPLACEMENT/);assert.ok(replaced)
  assert.equal(await readFile(replaced,'utf8').catch(()=>null),'foreign temporary replacement','failed staging cleanup must not claim a foreign inode at the owned temporary name')
  assert.equal((await store.read(healthy.id)).phase,'verified');assert.ok((await readFile(join(f.base,'retained-own-temporary'),'utf8')).includes('xuanxiang-application-backup'))
 }finally{await f.close()}
})

test('AB84-06: cancellation keeps the physical verifier flight and queued read pending, then preserves captured bytes and the old package',{timeout:10000},async()=>{
 const f=await fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),abort=new AbortController();let createFlight:Promise<unknown>|undefined
 try{
  const store=new ApplicationBackups(f.directory,f.appId,{pglite:'0.5.8',postgresMajor:18},f.host),old=await store.create(f.root,1);let id='',settled=false,listed=false
  f.host.verifyCaptured=async receipt=>{id=receipt.id;entered.resolve();await release.promise}
  createFlight=store.create(f.root,1,[],abort.signal).finally(()=>{settled=true});const outcome=createFlight.then(()=>({ok:true}),error=>({ok:false,error}))
  await entered.promise;abort.abort();const queued=store.list().then(rows=>{listed=true;return rows});await new Promise(setImmediate)
  assert.equal(settled,false);assert.equal(listed,false);assert.equal((await store.inspect(id)).receipt.phase,'captured')
  assert.equal(await readFile(join(f.storage,old.id,'data/state.json'),'utf8'),'historical application setting')
  release.resolve();assert.equal((await outcome).ok,false);assert.deepEqual((await queued).map(row=>row.id),[old.id])
  assert.equal((await store.read(id)).phase,'captured');assert.equal(await readFile(join(f.source,'state.json'),'utf8'),'historical application setting')
 }finally{release.resolve();await createFlight?.catch(()=>undefined);await f.close()}
})

test('AB84-07: owner revocation during semantic verification cannot promote the captured package or prune old history',{timeout:10000},async()=>{
 const f=await fixture();let owner=true,id='';f.host.assertOwner=async()=>{if(!owner)throw Error('OWNER_REVOKED')}
 try{
  const store=new ApplicationBackups(f.directory,f.appId,{pglite:'0.5.8',postgresMajor:18},f.host),old=await store.create(f.root,1)
  f.host.verifyCaptured=async receipt=>{id=receipt.id;owner=false}
  await assert.rejects(store.create(f.root,1),/OWNER_REVOKED/);owner=true
  assert.equal((await store.read(old.id)).phase,'verified');assert.equal((await store.read(id)).phase,'captured');assert.equal(await readFile(join(f.storage,old.id,'data/state.json'),'utf8'),'historical application setting')
 }finally{owner=true;await f.close()}
})
