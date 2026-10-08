import assert from 'node:assert/strict'
import {test,type TestContext} from 'node:test'
import {mkdtemp,mkdir,realpath,rm,writeFile,readFile,readdir,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {ApplicationBackups} from '../../desktop/core/application-backups'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {prepareApplicationDraftRetention} from '../../desktop/core/application-restore-drafts'
import {prepareApplicationRestoreWithProof,reSealApplicationRestoreWithProof,validatePreparedApplicationRestoreForActivation} from '../../desktop/service/database/application-restore'
import {ApplicationRestoreActivation,ApplicationRestoreActivationError} from '../../desktop/core/application-restore-activation'

// Actual producer issuance, copying and FS sealing are exercised here. The SQL
// engine is explicitly a cheap isolated protocol double; these unit cases do
// not claim database health, schema correctness or native user acceptance.
async function fixture(t:TestContext){
 const engine={async query(sql:string){return{rows:sql==='SHOW server_version'?[{server_version:'18.0'}]:sql==='SELECT id FROM "User"'?[{id:'local-author'}]:sql.startsWith('SELECT count(*)::int AS n')?[{n:0}]:[]}},async exec(){},async close(){},async transaction<T>(run:(tx:unknown)=>Promise<T>){return run(this)}}
 t.mock.method(PGlite,'create',async()=>engine as unknown as PGlite)
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review102-capability-'))),source=join(base,'current'),storage=join(base,'packages'),parent=join(base,'native-parent'),boot=join(base,'boot'),appId=randomUUID()
 for(const path of[source,storage,parent,boot])await mkdir(path)
 await mkdir(join(source,'inbox/database'),{recursive:true})
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}))
 await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));await writeFile(join(source,'inbox/database/PG_VERSION'),'18')
 const root=await directoryIdentity(source),journal=new DraftJournal(source),snap=(text:string)=>({version:1 as const,revision:1,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft:text,queuedRequests:[{prompt:text,approved:true}]}},issues:[]})
 journal.activate('old');await journal.persist('old',snap('old backup draft'))
 const backups=new ApplicationBackups(await directoryIdentity(storage),appId,{pglite:'unit-protocol-double',postgresMajor:18},{assertOwner(){},assertClosed(){},async verifyCaptured(){}}),selected=await backups.create(root,10)
 journal.activate('new');await journal.persist('new',snap('latest real source draft'))
 const before=await backups.create(root,10);await new DataRootManager(boot,source).adopt(root)
 let producerLive=true
 const host={expectedAppId:appId,async assertOwner(){if(!producerLive)throw Error('fixture native parent grant revoked')},assertOwnerImmediately(){if(!producerLive)throw Error('fixture native parent grant revoked')}}
 const prepared=await prepareApplicationRestoreWithProof(backups,selected.id,await directoryIdentity(parent),[],host),operationId=randomUUID()
 async function sealed(current:typeof root|null){return reSealApplicationRestoreWithProof(prepared,await prepareApplicationDraftRetention({appId,operationId,candidateId:prepared.candidate.id,current,backup:prepared.candidate.directory},()=>{}))}
 return{base,source,boot,root,backups,before,prepared,sealed,host,bootstrap:await directoryIdentity(boot),revokeProducer:()=>{producerLive=false},close:()=>rm(base,{recursive:true,force:true})}
}

for(const kind of ['missing','same-app-foreign-root'] as const)test(`AR102-R04 ${kind} draft source cannot stand in for the physically available latest authoritative root`,async t=>{
 const f=await fixture(t);try{
  let current:typeof f.root|null=null
  if(kind==='same-app-foreign-root'){const foreign=join(f.base,'same-app-old-copy');await mkdir(foreign);await writeFile(join(foreign,'xuanxiang-app.json'),await readFile(join(f.source,'xuanxiang-app.json')));const journal=new DraftJournal(foreign);journal.activate('foreign');await journal.persist('foreign',{version:1,revision:1,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft:'different older same-app draft'}},issues:[]});current=await directoryIdentity(foreign)}
  const proof=await f.sealed(current),pointerBefore=await readFile(join(f.boot,'data-root.json')),latestBefore=await readFile(join(f.source,'drafts.json')),activation=new ApplicationRestoreActivation(f.bootstrap,{assertStableLock(){},assertCold(){},assertOwner(){},async confirm(){return true}})
  validatePreparedApplicationRestoreForActivation(proof).assertCurrent()
  await assert.rejects(activation.prepare('owner',proof,{currentRootAvailable:true,beforeSnapshot:{backups:f.backups,backupId:f.before.id}}),cause=>cause instanceof ApplicationRestoreActivationError&&!Object.hasOwn(cause,'cause'),'private producer issuance must preserve the exact current authoritative draft source, not only a matching app id')
  assert.deepEqual(await readFile(join(f.boot,'data-root.json')),pointerBefore);assert.deepEqual(await readFile(join(f.source,'drafts.json')),latestBefore);assert.deepEqual(await readdir(f.boot),['data-root.json'])
 }finally{await f.close()}
})

test('AR102-R05 a sealed producer capability cannot outlive its original native selected parent owner',async t=>{
 const f=await fixture(t);try{
  const proof=await f.sealed(f.root);validatePreparedApplicationRestoreForActivation(proof).assertCurrent();f.revokeProducer();f.host.assertOwnerImmediately=()=>{};f.host.assertOwner=async()=>{}
  assert.throws(()=>validatePreparedApplicationRestoreForActivation(proof).assertCurrent(),cause=>cause instanceof Error&&!Object.hasOwn(cause,'cause'),'the original native parent grant must still be live at final activation validation')
  assert.deepEqual(await readdir(f.boot),['data-root.json'])
 }finally{await f.close()}
})

test('AR102-F06 cancellation waits an actual native confirmation flight, then retires the private capability across cores',async t=>{
 const f=await fixture(t);let release!:()=>void,entered!:()=>void;const pendingConfirm=new Promise<boolean>(resolve=>release=()=>resolve(true)),started=new Promise<void>(resolve=>entered=resolve)
 try{
  const proof=await f.sealed(f.root),options={assertStableLock(){},assertCold(){},assertOwner(){},async confirm(){entered();return pendingConfirm}},activation=new ApplicationRestoreActivation(f.bootstrap,options),preview=await activation.prepare('owner',proof,{currentRootAvailable:true,beforeSnapshot:{backups:f.backups,backupId:f.before.id}}),before=await readFile(join(f.boot,'data-root.json')),active=activation.activate('owner',preview.operationId)
  await started;let cancelled=false;const cancel=activation.cancel('owner',preview.operationId).then(()=>{cancelled=true});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(cancelled,false);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),before);release()
  await assert.rejects(active,cause=>cause instanceof ApplicationRestoreActivationError&&cause.code==='ATTEMPT_EXPIRED');await cancel;assert.equal(cancelled,true)
  await assert.rejects(new ApplicationRestoreActivation(f.bootstrap,{...options,async confirm(){return true}}).prepare('owner',proof,{currentRootAvailable:true,beforeSnapshot:{backups:f.backups,backupId:f.before.id}}),cause=>cause instanceof ApplicationRestoreActivationError&&cause.code==='APPLICATION_RESTORE_PROOF_INVALID')
  assert.deepEqual(await readdir(f.boot),['data-root.json']);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),before)
 }finally{release?.();await f.close()}
})

test('AR102-F07 same-byte old pointer inode replacement after append-only receipt rejects final CAS and preserves both source and audit',async t=>{
 const f=await fixture(t);try{
  const proof=await f.sealed(f.root),path=join(f.boot,'data-root.json'),before=await readFile(path),latest=await readFile(join(f.source,'drafts.json')),activation=new ApplicationRestoreActivation(f.bootstrap,{assertStableLock(){},assertCold(){},assertOwner(){},async confirm(){return true},async beforePointerRename(){await rename(path,path+'.original');await writeFile(path,before)}}),preview=await activation.prepare('owner',proof,{currentRootAvailable:true,beforeSnapshot:{backups:f.backups,backupId:f.before.id}})
  await assert.rejects(activation.activate('owner',preview.operationId),cause=>cause instanceof ApplicationRestoreActivationError&&cause.code==='POINTER_CHANGED')
  assert.deepEqual(await readFile(path),before);assert.deepEqual(await readFile(path+'.original'),before);assert.deepEqual(await readFile(join(f.source,'drafts.json')),latest);assert.equal((await readdir(f.boot)).filter(name=>name.startsWith('application-restore-')).length,1)
 }finally{await f.close()}
})

test('AR102-F08 receipt fsync uncertainty keeps the original pointer and locks the instance without guessing a commit',async t=>{
 const f=await fixture(t);try{
  const proof=await f.sealed(f.root),before=await readFile(join(f.boot,'data-root.json')),activation=new ApplicationRestoreActivation(f.bootstrap,{assertStableLock(){},assertCold(){},assertOwner(){},async confirm(){return true},async beforeDirectorySync(stage){if(stage==='receipt')throw Error('isolated directory durability failure')}}),source={currentRootAvailable:true,beforeSnapshot:{backups:f.backups,backupId:f.before.id}},preview=await activation.prepare('owner',proof,source)
  await assert.rejects(activation.activate('owner',preview.operationId),cause=>cause instanceof ApplicationRestoreActivationError&&cause.code==='DURABILITY_UNCONFIRMED'&&!Object.hasOwn(cause,'cause'));await assert.rejects(activation.prepare('owner',proof,source),cause=>cause instanceof ApplicationRestoreActivationError&&cause.code==='DURABILITY_UNCONFIRMED')
  assert.deepEqual(await readFile(join(f.boot,'data-root.json')),before);assert.equal((await readdir(f.boot)).filter(name=>name.startsWith('application-restore-')).length,1)
 }finally{await f.close()}
})

test('AR102-F13 a newer healthy before-snapshot cannot conceal a source journal change after retention resealing',async t=>{
 const f=await fixture(t);try{
  const proof=await f.sealed(f.root);validatePreparedApplicationRestoreForActivation(proof).assertCurrent();const candidateRetention=await readFile(join(proof.candidate.directory.path,'application-restore-drafts.json')),writer=new DraftJournal(f.source);writer.activate('later');await writer.persist('later',{version:1,revision:3,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft:'later input after candidate reseal',queuedRequests:[{approved:false,prompt:'latest must not be omitted'}]}},issues:[]})
  const latest=await readFile(join(f.source,'drafts.json')),newBefore=await f.backups.create(f.root,10),pointer=await readFile(join(f.boot,'data-root.json')),activation=new ApplicationRestoreActivation(f.bootstrap,{assertStableLock(){},assertCold(){},assertOwner(){},async confirm(){return true}})
  await assert.rejects(activation.prepare('owner',proof,{currentRootAvailable:true,beforeSnapshot:{backups:f.backups,backupId:newBefore.id}}),cause=>cause instanceof ApplicationRestoreActivationError&&!Object.hasOwn(cause,'cause'),'the retained latest journal must still be the original observed bytes, not merely the same current root identity')
  assert.deepEqual(await readFile(join(f.source,'drafts.json')),latest);assert.deepEqual(await readFile(join(proof.candidate.directory.path,'application-restore-drafts.json')),candidateRetention);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),pointer)
 }finally{await f.close()}
})
