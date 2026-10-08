import assert from 'node:assert/strict'
import {test,type TestContext} from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {PGlite} from '@electric-sql/pglite'
import {ApplicationBackups} from '../../desktop/core/application-backups'
import {DataRootManager,type RootIdentity} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {prepareApplicationDraftRetention} from '../../desktop/core/application-restore-drafts'
import {preserveClosedApplicationSource} from '../../desktop/core/application-cold-source'
import {prepareApplicationRestoreWithProof,reSealApplicationRestoreWithProof,validatePreparedApplicationRestoreForActivation} from '../../desktop/service/database/application-restore'
import {ApplicationRestoreActivation,ApplicationRestoreActivationError,inspectApplicationRestoreActivation} from '../../desktop/core/application-restore-activation'
import {readRootAuthority} from '../../desktop/core/root-authority'

// Independent actual FS/capability/CAS oracles. Only the candidate SQL API and
// backup health callback are doubles: no PG health or native acceptance claim.
async function fixture(t:TestContext){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-union105-review-'))),source=join(base,'source'),boot=join(base,'bootstrap'),packages=join(base,'packages'),appId=randomUUID()
 for(const path of[source,boot,packages])await mkdir(path)
 await mkdir(join(source,'inbox/database'),{recursive:true});await mkdir(join(source,'session'))
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}))
 await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 await writeFile(join(source,'inbox/database/PG_VERSION'),'18');await writeFile(join(source,'session/Preferences'),'original managed session bytes')
 const journal=new DraftJournal(source),snapshot=(draft:string)=>({version:1 as const,revision:1,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft,queuedRequests:[{approved:true,prompt:'inert saved request'}]}},issues:[]})
 journal.activate('backup-window');await journal.persist('backup-window',snapshot('old backup text'))
 const root=await directoryIdentity(source),bootstrap=await directoryIdentity(boot),backups=new ApplicationBackups(await directoryIdentity(packages),appId,{pglite:'independent-unit-protocol-double',postgresMajor:18},{assertOwner(){},assertClosed(){},async verifyCaptured(){}}),selected=await backups.create(root,10)
 journal.activate('latest-window');await journal.persist('latest-window',snapshot('latest local author input'))
 const pointer=await new DataRootManager(boot,source).adopt(root),pointerBytes=await readFile(join(boot,'data-root.json')),sourceDirectories=new Set([source]);let originalSourceOpens=0
 const engine={async query(sql:string){return{rows:sql==='SHOW server_version'?[{server_version:'18.0'}]:sql==='SELECT id FROM "User"'?[{id:'local-author'}]:sql.startsWith('SELECT count(*)::int AS n')?[{n:0}]:[]}},async exec(){},async close(){},async transaction<T>(run:(tx:unknown)=>Promise<T>){return run(this)}}
 t.mock.method(PGlite,'create',async(options:unknown)=>{if([...sourceDirectories].some(path=>(options as {dataDir:string}).dataDir===join(path,'inbox/database'))){originalSourceOpens++;throw Error('original source engine must never open')}return engine as unknown as PGlite})
 const directories=async(name:string)=>{const path=join(base,name);await mkdir(path);return directoryIdentity(path)}
 const host={expectedAppId:appId,assertOwner(){},assertOwnerImmediately(){}}
 const prepare=async(current:RootIdentity,parent:RootIdentity,operationId:string)=>{
  const prepared=await prepareApplicationRestoreWithProof(backups,selected.id,parent,[],host)
  const drafts=await prepareApplicationDraftRetention({appId,operationId,candidateId:prepared.candidate.id,current,backup:prepared.candidate.directory},()=>{})
  return{prepared,drafts}
 }
 const closed=async(current=root,name='closed')=>{
  sourceDirectories.add(current.path)
  const operationId=randomUUID(),parent=await directories(name+'-candidate'),raw=await directories(name+'-raw'),proof=await preserveClosedApplicationSource({operationId,bootstrap,parent:raw,candidateParent:parent},{assertStableLock(){},assertCold(){},assertOwnerImmediately(_directory,id){assert.equal(id,operationId)}}),candidate=await prepare(current,parent,operationId)
  return{...candidate,proof,parent,operationId}
 }
 const options={assertStableLock(){},assertCold(){},assertOwner(){},async confirm(){return true}}
 return{base,source,boot,root,bootstrap,appId,backups,pointer,pointerBytes,prepare,closed,directories,options,opens:()=>originalSourceOpens,close:()=>rm(base,{recursive:true,force:true})}
}
const refused=(cause:unknown)=>cause instanceof ApplicationRestoreActivationError&&!Object.hasOwn(cause,'cause')

test('AR105-U01 replacing public cold proof assertions cannot hide a managed session change at final native confirmation',{timeout:15000},async t=>{
 const f=await fixture(t)
 try{
  await writeFile(join(f.source,'inbox/database/PG_VERSION'),'damaged database bytes');const c=await f.closed(),sealed=await reSealApplicationRestoreWithProof(c.prepared,c.drafts,undefined,{kind:'closed-source',bootstrap:f.bootstrap,preservation:c.proof}),original=await readFile(join(f.source,'drafts.json')),copy=await readFile(join(c.proof.receipt.data.path,'session/Preferences'))
  c.proof.assertCurrent=()=>{}
  const activation=new ApplicationRestoreActivation(f.bootstrap,{...f.options,async confirm(){await writeFile(join(f.source,'session/Preferences'),'changed managed session bytes');return true}}),preview=await activation.prepare('native-owner',sealed,{kind:'closed-source',preservation:c.proof})
  await assert.rejects(activation.activate('native-owner',preview.operationId),refused)
  assert.deepEqual(await readFile(join(f.boot,'data-root.json')),f.pointerBytes);assert.deepEqual(await readFile(join(f.source,'drafts.json')),original);assert.deepEqual(await readFile(join(c.proof.receipt.data.path,'session/Preferences')),copy);assert.equal(f.opens(),0)
 }finally{await f.close()}
})

test('AR105-U02 a genuine cold capability from a different bootstrap cannot be rebound merely by copying the same valid pointer bytes',{timeout:15000},async t=>{
 const f=await fixture(t)
 try{
  const c=await f.closed(),parallel=await f.directories('parallel-bootstrap');await writeFile(join(parallel.path,'data-root.json'),f.pointerBytes);readRootAuthority(parallel,()=>{}).assertCurrent()
  const candidateBytes=await readFile(join(c.prepared.candidate.directory.path,'drafts.json'))
  await assert.rejects(reSealApplicationRestoreWithProof(c.prepared,c.drafts,undefined,{kind:'closed-source',bootstrap:parallel,preservation:c.proof}),cause=>cause instanceof Error&&!Object.hasOwn(cause,'cause'))
  assert.deepEqual(await readFile(join(c.prepared.candidate.directory.path,'drafts.json')),candidateBytes)
  assert.ok(!(await readdir(c.prepared.candidate.directory.path)).includes('application-restore-drafts.json'));assert.deepEqual(await readFile(join(f.boot,'data-root.json')),f.pointerBytes);assert.deepEqual(await readFile(join(parallel.path,'data-root.json')),f.pointerBytes)
  // Rejection before any own mutation leaves the original private capability
  // usable only with its original bootstrap proof, rather than silently consuming it.
  const sealed=await reSealApplicationRestoreWithProof(c.prepared,c.drafts,undefined,{kind:'closed-source',bootstrap:f.bootstrap,preservation:c.proof});validatePreparedApplicationRestoreForActivation(sealed).assertCurrent();assert.equal(f.opens(),0)
 }finally{await f.close()}
})

test('AR105-U03 actual legacy v1 healthy activation composes with a new v2 closed-source activation and keeps complete v1 provenance',{timeout:15000},async t=>{
 const f=await fixture(t)
 try{
  const before=await f.backups.create(f.root,10),parent=await f.directories('legacy-candidate'),operationId=randomUUID(),p=await f.prepare(f.root,parent,operationId),sealed=await reSealApplicationRestoreWithProof(p.prepared,p.drafts),legacy=new ApplicationRestoreActivation(f.bootstrap,f.options),preview=await legacy.prepare('legacy-owner',sealed,{currentRootAvailable:true,beforeSnapshot:{backups:f.backups,backupId:before.id}})
  await legacy.activate('legacy-owner',preview.operationId);const firstName=`application-restore-${operationId}.json`,firstBytes=await readFile(join(f.boot,firstName)),oldRetention=JSON.parse(await readFile(join(sealed.candidate.directory.path,'application-restore-drafts.json'),'utf8'));assert.equal(JSON.parse(firstBytes.toString()).record.schemaVersion,1)
  const current=readRootAuthority(f.bootstrap,()=>{}).pointer.root,c=await f.closed(current,'second'),secondSealed=await reSealApplicationRestoreWithProof(c.prepared,c.drafts,undefined,{kind:'closed-source',bootstrap:f.bootstrap,preservation:c.proof}),second=new ApplicationRestoreActivation(f.bootstrap,f.options),secondPreview=await second.prepare('second-owner',secondSealed,{kind:'closed-source',preservation:c.proof})
  await second.activate('second-owner',secondPreview.operationId);const authority=readRootAuthority(f.bootstrap,()=>{});authority.assertCurrent();assert.deepEqual(authority.links.map(row=>row.name),[firstName,`application-restore-${c.operationId}.json`]);assert.equal(authority.pointer.revision,3)
  const disposition=await inspectApplicationRestoreActivation(f.bootstrap,f.options);assert.equal(disposition!.sourceKind,'closed-source');disposition!.assertCurrent();assert.deepEqual(await readFile(join(f.boot,firstName)),firstBytes)
  const retained=JSON.parse(await readFile(join(secondSealed.candidate.directory.path,'application-restore-drafts.json'),'utf8'));for(const entry of oldRetention.snapshots)assert.deepEqual(retained.snapshots.find((row:{id:string})=>row.id===entry.id),entry)
  assert.equal(f.opens(),0)
 }finally{await f.close()}
})

test('AR105-U04 strict source inputs reject compatibility fields mixed into closed-source before producing any activation audit',{timeout:15000},async t=>{
 const f=await fixture(t)
 try{
  const c=await f.closed(),sealed=await reSealApplicationRestoreWithProof(c.prepared,c.drafts,undefined,{kind:'closed-source',bootstrap:f.bootstrap,preservation:c.proof}),activation=new ApplicationRestoreActivation(f.bootstrap,f.options)
  for(const extra of[{currentRootAvailable:true},{beforeSnapshot:null},{sourceKind:'healthy'},{unknown:true}])await assert.rejects(activation.prepare('native-owner',sealed,{kind:'closed-source',preservation:c.proof,...extra} as never),refused)
  assert.deepEqual(await readdir(f.boot),['data-root.json']);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),f.pointerBytes)
  const valid=await activation.prepare('native-owner',sealed,{kind:'closed-source',preservation:c.proof});assert.equal(valid.sourceKind,'closed-source');await activation.cancel('native-owner',valid.operationId);assert.equal(f.opens(),0)
 }finally{await f.close()}
})
