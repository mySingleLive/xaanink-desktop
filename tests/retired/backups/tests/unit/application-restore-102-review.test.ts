import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,realpath,rm,writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {DataRootManager,type RootIdentity,type RootPointer} from '../../desktop/core/data-root'
import {applicationRestoreActivationRecordSchema,observeRootAuthority,readRootAuthority,RootAuthorityError,type ApplicationRestoreActivationRecord} from '../../desktop/core/root-authority'
import {canonical,digest} from '../../desktop/core/application-backup-files'
import {captureApplicationRoot} from '../../desktop/service/database/application-snapshot'
import {prepareApplicationDraftRetention,persistApplicationDraftRetention} from '../../desktop/core/application-restore-drafts'
import {DraftJournal} from '../../desktop/main/draft-journal'
import type {PGlite} from '@electric-sql/pglite'
import {inspectRetainedRootRelocation} from '../../desktop/core/root-relocation-retention'

// Independent cold-control fixtures use real file identities and bytes. They
// are historical protocol records, never producer or engine health grants.
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review102-authority-'))),boot=join(base,'boot'),appId=randomUUID()
 await mkdir(boot)
 const bootstrap=await directoryIdentity(boot)
 async function root(name:string,id=appId){const path=join(base,name);await mkdir(path);await writeFile(join(path,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id,phase:'ready',inboxReady:true}));return directoryIdentity(path)}
 const original=await root('original'),pointer:RootPointer={schemaVersion:1,revision:1,rootId:appId,migrationId:null,root:original}
 await writeFile(join(boot,'data-root.json'),JSON.stringify(pointer)+'\n')
 async function publish(before:RootPointer,target:RootIdentity,history:ApplicationRestoreActivationRecord['history'],pointerName='data-root.json'){
  const beforePointerFile=observeRootAuthority(bootstrap,pointerName,16384)!.proof,after={...before,revision:before.revision+1,root:target}
  await writeFile(join(boot,pointerName),JSON.stringify(after)+'\n')
  const afterFile=observeRootAuthority(bootstrap,pointerName,16384)!.proof,{ctimeNs:_ctime,...pointerFile}=afterFile,receiptId=randomUUID()
  const record=applicationRestoreActivationRecordSchema.parse({schemaVersion:1,type:'application',receiptId,createdAt:new Date().toISOString(),bootstrap,before,beforePointerFile,after,pointerFile,candidate:{id:randomUUID(),backupId:randomUUID(),backupChecksum:'a'.repeat(64),initialChecksum:'b'.repeat(64),finalChecksum:'c'.repeat(64),retentionChecksum:'d'.repeat(64),barrierToken:randomUUID()},currentRootAvailable:false,beforeSnapshot:null,marker:observeRootAuthority(target,'xuanxiang-app.json',16384)!.proof,controls:{journal:null,request:null},history})
  const name=`application-restore-${receiptId}.json`;await writeFile(join(boot,name),JSON.stringify({record,sha256:digest(canonical(record))})+'\n')
  return{record,name,file:observeRootAuthority(bootstrap,name,1024*1024)!.proof,after}
 }
 return{base,boot,bootstrap,appId,pointer,root,publish,close:()=>rm(base,{recursive:true,force:true})}
}
const refused=(cause:unknown)=>cause instanceof RootAuthorityError&&!Object.hasOwn(cause,'cause')

test('AR102-R01 a newest restore receipt cannot omit an earlier actual restore receipt from its claimed complete history',async()=>{
 const f=await fixture();try{
  const first=await f.publish(f.pointer,await f.root('restored-once'),[]),second=await f.publish(first.after,await f.root('restored-twice'),[{name:first.name,file:first.file}])
  assert.deepEqual(readRootAuthority(f.bootstrap,()=>{}).links.map(row=>row.name),[first.name,second.name])
  const beforePointer=await readFile(join(f.boot,'data-root.json')),firstBytes=await readFile(join(f.boot,first.name)),incomplete={...second.record,history:[]}
  await writeFile(join(f.boot,second.name),JSON.stringify({record:incomplete,sha256:digest(canonical(incomplete))})+'\n')
  assert.throws(()=>readRootAuthority(f.bootstrap,()=>{}),refused,'cold authority must reject a checksummed but incomplete history, even when all prior files are still present')
  assert.deepEqual(await readFile(join(f.boot,'data-root.json')),beforePointer);assert.deepEqual(await readFile(join(f.boot,first.name)),firstBytes)
 }finally{await f.close()}
})

test('AR102-R02 a well formed foreign app restore receipt in the same bootstrap is damaged control evidence rather than unrelated audit data',async()=>{
 const f=await fixture();try{
  const own=await f.publish(f.pointer,await f.root('restored'),[]);assert.equal(readRootAuthority(f.bootstrap,()=>{}).links.length,1)
  const foreignApp=randomUUID(),foreignBefore:RootPointer={schemaVersion:1,revision:1,rootId:foreignApp,migrationId:null,root:await f.root('foreign-before',foreignApp)},pointerName='foreign-pointer.fixture.json'
  await writeFile(join(f.boot,pointerName),JSON.stringify(foreignBefore)+'\n')
  await f.publish(foreignBefore,await f.root('foreign-after',foreignApp),[],pointerName)
  const ownBytes=await readFile(join(f.boot,own.name)),pointerBytes=await readFile(join(f.boot,'data-root.json'))
  assert.throws(()=>readRootAuthority(f.bootstrap,()=>{}),refused,'every retained application receipt must belong to the current bootstrap app identity')
  assert.deepEqual(await readFile(join(f.boot,own.name)),ownBytes);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),pointerBytes)
 }finally{await f.close()}
})

test('AR102-R03 the next online application capture preserves the complete application restore draft artifact',async()=>{
 const f=await fixture();try{
  const source=f.pointer.root,backup=await f.root('backup-draft'),staging=await f.root('staging')
  // The staging parent contains no data before capture. The fixture helper's
  // marker is removed rather than treating it as captured metadata.
  await rm(join(staging.path,'xuanxiang-app.json'))
  await writeFile(join(source.path,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
  const original=new DraftJournal(source.path);original.activate('old');await original.persist('old',{version:1,revision:1,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft:'latest unsent author input',queuedRequests:[{approved:true,prompt:'keep inert'}]}},issues:[]})
  const operationId=randomUUID(),candidateId=randomUUID(),saved=await persistApplicationDraftRetention(await prepareApplicationDraftRetention({appId:f.appId,operationId,candidateId,current:backup,backup:source},()=>{}),{appId:f.appId,operationId,candidateId,backup:source}),originalRetention=await readFile(join(source.path,saved.file.path))
  let capturedDirectory:string|undefined
  const stop=Error('independent fixture stops before any engine import'),engine={async query(){return{rows:[{server_version:'18.0'}]}},async syncToFs(){},async dumpDataDir(){return new Blob(['private fixture archive, never imported'])},async _runExclusiveTransaction<T>(run:()=>Promise<T>){return run()},async runExclusive<T>(run:()=>Promise<T>){return run()}} as unknown as PGlite
  await assert.rejects(captureApplicationRoot(source,staging,engine,{assertOwner(){},assertLiveInbox(){}},undefined,{async hook(phase){if(phase==='before-import'){const entries=await import('node:fs/promises').then(fs=>fs.readdir(staging.path));assert.equal(entries.length,1);capturedDirectory=join(staging.path,entries[0]);throw stop}}}),cause=>cause===stop)
  assert.ok(capturedDirectory)
  assert.deepEqual(await readFile(join(capturedDirectory,saved.file.path)),originalRetention,'restoring an older backup must not make later application backups silently omit retained original drafts')
  assert.deepEqual(await readFile(join(source.path,saved.file.path)),originalRetention)
 }finally{await f.close()}
})

test('AR102-F14 an actual migration may retain an earlier uncommitted restore audit only with its exact before-pointer file witness',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.pointer.root.path,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));await mkdir(join(f.pointer.root.path,'inbox/database'),{recursive:true});await writeFile(join(f.pointer.root.path,'inbox/database/PG_VERSION'),'18')
  const beforeFile=observeRootAuthority(f.bootstrap,'data-root.json',16384)!.proof,pointerName='uncommitted-pointer.fixture.json';await writeFile(join(f.boot,pointerName),JSON.stringify(f.pointer)+'\n')
  const pending=await f.publish(f.pointer,await f.root('uncommitted-candidate'),[],pointerName),record={...pending.record,beforePointerFile:beforeFile};await writeFile(join(f.boot,pending.name),JSON.stringify({record,sha256:digest(canonical(record))})+'\n')
  assert.equal(readRootAuthority(f.bootstrap,()=>{}).links.length,0)
  const target=join(f.base,'migrated');await mkdir(target);const result=await new DataRootManager(f.boot,f.pointer.root.path).migrate(await directoryIdentity(target),{async quiesce(){return{source:f.pointer.root,ownedFiles:['xuanxiang-app.json','catalog.json','inbox/database/PG_VERSION'],assertClosed(){},release(){}}}}),audit=await readFile(join(f.boot,pending.name)),pointer=await readFile(join(f.boot,'data-root.json')),authority=readRootAuthority(f.bootstrap,()=>{})
  assert.deepEqual(authority.pointer,result.root);assert.equal(authority.links.length,0);assert.equal(await inspectRetainedRootRelocation(f.boot,{assertStableLock(){},assertCold(){}}),null);assert.deepEqual(await readFile(join(f.boot,pending.name)),audit)
  const incorrect={...record,beforePointerFile:{...record.beforePointerFile,inode:String(BigInt(record.beforePointerFile.inode)+1n)}};await writeFile(join(f.boot,pending.name),JSON.stringify({record:incorrect,sha256:digest(canonical(incorrect))})+'\n')
  assert.throws(()=>readRootAuthority(f.bootstrap,()=>{}),refused,'a merely semantic pending source match cannot stand in for the original pointer inode');assert.deepEqual(await readFile(join(f.boot,'data-root.json')),pointer)
 }finally{await f.close()}
})
