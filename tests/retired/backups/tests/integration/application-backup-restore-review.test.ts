import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdir,mkdtemp,readFile,writeFile,rm,readdir,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {Workspaces} from '../../desktop/service/workspaces'
import {prisma} from '../../src/lib/db'
import {ApplicationBackups} from '../../desktop/core/application-backups'
import {directoryIdentity,readMetadata} from '../../desktop/core/root-ownership'
import {defaultState} from '../../desktop/core/settings'
import {loadMigrations} from '../../desktop/service/database/migrations'
import {prepareApplicationRestore,type ApplicationRestoreCandidate} from '../../desktop/service/database/application-restore'
import packageInfo from '../../package.json'

let f:Awaited<ReturnType<typeof fixture>>
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-apprestore-independent84-'))),source=join(base,'source'),storage=join(base,'packages'),migrationPath=join(process.cwd(),'prisma/migrations'),works=new Workspaces(source,migrationPath)
 let closed=false,lastCandidate:ApplicationRestoreCandidate|undefined
 try{
  await works.initialize();let postgresMajor=0
  await works.runWithGlobal('inbox',async()=>{const rows=await prisma.$queryRaw<{server_version:string}[]>`SHOW server_version`;postgresMajor=Number(rows[0].server_version.split('.')[0])})
  await works.close();closed=true;await mkdir(storage)
  const statePath=join(source,'state.json'),stateBytes=JSON.stringify({schemaVersion:1,revision:1,value:structuredClone(defaultState)});await writeFile(statePath,stateBytes)
  const catalogBytes=await readFile(join(source,'catalog.json')),root=await directoryIdentity(source),marker=await readMetadata(join(source,'xuanxiang-app.json')) as {id:string},migrations=await loadMigrations(migrationPath)
  const host={expectedAppId:marker.id,assertOwner:async()=>{}}
  let store:ApplicationBackups
  store=new ApplicationBackups(await directoryIdentity(storage),marker.id,{pglite:packageInfo.dependencies['@electric-sql/pglite'],postgresMajor},{assertOwner:async()=>{},assertClosed:async()=>{assert.equal(closed,true)},verifyCaptured:async(receipt,signal)=>{
   const parent=join(base,'verify-'+randomUUID());await mkdir(parent);lastCandidate=await prepareApplicationRestore(store,receipt.id,await directoryIdentity(parent),migrations,host,signal)
  }})
  const healthy=await store.create(root,2)
  return{base,source,storage,store,root,healthy,statePath,stateBytes,catalogBytes,migrations,migrationPath,host,get lastCandidate(){return lastCandidate},async close(){await works.close();await rm(base,{recursive:true,force:true})}}
 }catch(error){await works.close();await rm(base,{recursive:true,force:true});throw error}
}
test.before(async()=>{f=await fixture()})
test.after(async()=>{await f?.close()})

test('AB84-I01: actual original-schema verifier rejects bad settings and drafts before they can replace a healthy package',{timeout:600000},async()=>{
 try{
  for(const kind of ['settings','drafts']){
   const before=await readdir(f.storage)
   if(kind==='settings')await writeFile(f.statePath,'{"schemaVersion":1,"revision":1,"value":{"settings":"invalid"}}')
   else await writeFile(join(f.source,'drafts.json'),'{"schemaVersion":1,"snapshot":"not a durable draft envelope"}')
   await assert.rejects(f.store.create(f.root,1),new RegExp(kind==='settings'?'SETTINGS_INVALID':'DRAFTS_INVALID'))
   const capturedId=(await readdir(f.storage)).find(id=>!before.includes(id));assert.ok(capturedId);assert.equal((await f.store.read(capturedId)).phase,'captured')
   assert.equal((await f.store.read(f.healthy.id)).phase,'verified');assert.deepEqual((await f.store.list()).map(row=>row.id),[f.healthy.id])
   await writeFile(f.statePath,f.stateBytes);await rm(join(f.source,'drafts.json'),{force:true})
  }
 }finally{await writeFile(f.statePath,f.stateBytes);await rm(join(f.source,'drafts.json'),{force:true})}
})

test('AB84-I02: a checksum-valid package with malformed original workspace catalog cannot receive ready or verified status',{timeout:600000},async()=>{
 await writeFile(join(f.source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[{path:join(f.base,'unavailable-work')}]}))
 try{
  let accepted:Awaited<ReturnType<ApplicationBackups['create']>>|undefined,error:unknown
  try{accepted=await f.store.create(f.root,1,[f.healthy.id])}catch(caught){error=caught}
  if(accepted){
   assert.ok(f.lastCandidate);const candidateWorks=new Workspaces(f.lastCandidate.directory.path,f.migrationPath)
   try{await assert.rejects(candidateWorks.initialize(),'the same returned candidate must demonstrate actual startup catalog incompatibility')}finally{await candidateWorks.close()}
  }
  assert.ok(error,'prepareApplicationRestore accepted a malformed catalog, marked the new package verified, although actual Workspaces.initialize rejects that candidate')
  assert.equal(accepted,undefined);assert.equal((await f.store.read(f.healthy.id)).phase,'verified')
 }finally{await writeFile(join(f.source,'catalog.json'),f.catalogBytes)}
})

test('AB84-I04: a structurally valid unavailable work reference remains intact and does not require opening that work',{timeout:600000},async()=>{
 const record={id:randomUUID(),path:join(f.base,'offline-author-work'),identity:{device:'123',inode:'456'},novelId:'offline-novel',title:'失联作品索引仍保留',requestId:randomUUID(),requestHash:'a'.repeat(64),createdAt:new Date().toISOString()}
 await writeFile(join(f.source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:2,value:[record]}))
 try{
  const receipt=await f.store.create(f.root,2,[f.healthy.id]);assert.equal(receipt.phase,'verified');assert.ok(f.lastCandidate)
  const candidateWorks=new Workspaces(f.lastCandidate.directory.path,f.migrationPath)
  try{await candidateWorks.initialize();assert.deepEqual(await candidateWorks.list(),[record])}finally{await candidateWorks.close()}
  await assert.rejects(readFile(join(record.path,'xuanxiang-work.json')),{code:'ENOENT'});assert.equal((await f.store.read(f.healthy.id)).phase,'verified')
 }finally{await writeFile(join(f.source,'catalog.json'),f.catalogBytes)}
})

test('AB84-I05: a current profile avatar UUID without its global PNG cannot pass the actual application verifier',{timeout:600000},async()=>{
 const value=structuredClone(defaultState);value.settings.user.avatarAssetId=randomUUID();await writeFile(f.statePath,JSON.stringify({schemaVersion:1,revision:3,value}))
 try{
  const before=await readdir(f.storage)
  await assert.rejects(f.store.create(f.root,1,[f.healthy.id]),/APPLICATION_RESTORE_AVATAR/)
  const capturedId=(await readdir(f.storage)).find(id=>!before.includes(id));assert.ok(capturedId);assert.equal((await f.store.read(capturedId)).phase,'captured')
  assert.equal((await f.store.read(f.healthy.id)).phase,'verified');await assert.rejects(readFile(join(f.source,'assets/global',value.settings.user.avatarAssetId+'.png')),{code:'ENOENT'})
 }finally{await writeFile(f.statePath,f.stateBytes)}
})

test('AB84-I03: independently restored original-schema candidate reads only the healthy backup even when the entire current source is missing',{timeout:600000},async()=>{
 const parent=join(f.base,'missing-source-restore');await mkdir(parent);await rm(f.source,{recursive:true})
 const reader=new ApplicationBackups(await directoryIdentity(f.storage),f.healthy.appId,f.store.engine,{assertOwner:async()=>{},assertClosed:async()=>{throw Error('current source must not be read or opened')},verifyCaptured:async()=>{throw Error('restoring must not create against current source')}})
 const proof=await prepareApplicationRestore(reader,f.healthy.id,await directoryIdentity(parent),f.migrations,f.host)
 assert.equal(proof.phase,'ready');assert.equal(proof.backupChecksum,f.healthy.checksum);assert.equal(await readFile(join(proof.directory.path,'state.json'),'utf8'),f.stateBytes)
 assert.equal((await reader.read(f.healthy.id)).phase,'verified');await assert.rejects(readFile(join(f.source,'xuanxiang-app.json')),{code:'ENOENT'})
})
