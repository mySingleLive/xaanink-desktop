import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createHash,randomUUID} from 'node:crypto'
import {mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DataRootManager,type RootOptions} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {RootMigrationRequests} from '../../desktop/main/root-migration-request'
import {RootMaintenanceRunner,type MaintenanceDataRoot,type RootMaintenanceRunnerOptions} from '../../desktop/main/root-maintenance-runner'

function gate(){let resolve!:()=>void;const promise=new Promise<void>(yes=>{resolve=yes});return{promise,resolve}}
function canonical(value:unknown):unknown{return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)])):value}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-pending-review-'))),source=join(base,'from'),target=join(base,'to'),bootstrap=join(base,'boot')
 for(const path of [source,target,bootstrap])await mkdir(path)
 await mkdir(join(source,'inbox/database/pg_notify'),{recursive:true})
 const rootId=randomUUID(),owner=randomUUID(),pointer={schemaVersion:1 as const,revision:1,rootId,migrationId:null,root:await directoryIdentity(source)}
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:rootId,phase:'ready',inboxReady:true}))
 await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 await writeFile(join(source,'state.json'),'initial local settings')
 await writeFile(join(source,'drafts.json'),'real isolated draft bytes')
 await writeFile(join(source,'inbox/database/PG_VERSION'),'17')
 await writeFile(join(bootstrap,'data-root.json'),JSON.stringify(pointer))
 let closed=true,migrations=0,continues=0
 // An injected closure proof, not an actual Electron/PGlite shutdown assertion.
 const guard=()=>{if(!closed)throw Error('controlled unavailable closure proof')}
 const authority=new DataRootManager(bootstrap,source)
 const requests=new RootMigrationRequests(bootstrap,{resolveSource:()=>authority.resolve(),assertOwner(nonce){assert.equal(nonce,owner)},assertStableLock(){},assertClosed:guard})
 const options:RootMaintenanceRunnerOptions={bootstrap,defaultRoot:source,requests,theme:'paper',host:{assertMaintenanceClosed:guard},onContinue:async()=>{continues++},onQuit:async()=>{},createManager(input:RootOptions&{migrationId:string}){
  const manager:MaintenanceDataRoot=new DataRootManager(bootstrap,source,{...input,hook:async(phase,path)=>{await input.hook?.(phase,path);if(phase==='cleanup')await writeFile(join(source,'state.json'),'late old-root setting retained')}})
  const migrate=manager.migrate.bind(manager);manager.migrate=async(...args)=>{migrations++;return migrate(...args)};return manager
 }}
 const prepared=await requests.prepare(owner,await directoryIdentity(target));await requests.arm(owner,prepared.requestId)
 const first=new RootMaintenanceRunner(options);assert.equal((await first.start()).phase,'cleanup-pending')
 const completion=await requests.readResult();assert.ok(completion?.executionNonce)
 const journalPath=join(bootstrap,'root-migration.json'),originalJournal=await readFile(journalPath,'utf8')
 return{base,source,target,bootstrap,requests,options,completion,journalPath,originalJournal,setClosed(value:boolean){closed=value},get migrations(){return migrations},get continues(){return continues},async close(){await requests.flush().catch(()=>undefined);await rm(base,{recursive:true,force:true})}}
}

test('PEND85-01: real pending journal resumes its exact labels; listener/state mutation cannot alter durable records or later views',{timeout:10000},async()=>{
 const f=await fixture()
 try{
  const runner=new RootMaintenanceRunner(f.options),received:string[][]=[]
  runner.subscribe(state=>{if(state.pendingItems?.length){received.push([...state.pendingItems]);state.pendingItems[0]='observer-forged'}})
  const value=await runner.start();assert.deepEqual(value.pendingItems,['state.json']);assert.equal(value.pendingCount,1);assert.equal(value.canContinue,true)
  assert.deepEqual(received,[['state.json']]);value.pendingItems!.push('caller-forged')
  assert.deepEqual(runner.state().pendingItems,['state.json']);assert.equal(await readFile(f.journalPath,'utf8'),f.originalJournal)
  assert.equal(await readFile(join(f.source,'state.json'),'utf8'),'late old-root setting retained')
  assert.equal(await readFile(join(f.target,'state.json'),'utf8'),'initial local settings');assert.equal(f.migrations,1)
 }finally{await f.close()}
})

test('PEND85-02: actual journal authority mismatches fail closed while unrelated details preserve the durable count and data bytes',{timeout:15000},async()=>{
 const f=await fixture()
 try{
  const seed=JSON.parse(f.originalJournal).journal,receiptPath=join(f.bootstrap,'root-migration-request.json'),pointerPath=join(f.bootstrap,'data-root.json')
  const receiptBytes=await readFile(receiptPath),pointerBytes=await readFile(pointerPath)
  // Authority changes fail the real completion seal. Optional detail changes
  // cannot supply labels, but do not revoke the unchanged durable root pointer.
  const variants:[string,unknown,boolean][]=[
   ['source revision',{...seed,source:{...seed.source,revision:seed.source.revision+1}},false],
   ['target detail identity',{...seed,target:{...seed.target,inode:String(BigInt(seed.target.inode)+1n)}},true],
   ['execution identity',{...seed,migrationId:randomUUID()},false],
   ['detail result phase',{...seed,phase:'rollback-pending'},true],
   ['detail pending count',{...seed,pending:['state.json','additional.json']},true],
   ['unsafe detail label',{...seed,pending:['../unsafe']},true],
  ]
  for(const [label,journal,canContinue] of variants){
   const journalBytes=JSON.stringify({journal,sha256:digest(journal)})+'\n'
   await writeFile(f.journalPath,journalBytes)
   const runner=new RootMaintenanceRunner(f.options),state=await runner.start()
   assert.equal(state.phase,canContinue?'cleanup-pending':'recovery-required',label);assert.equal(state.canContinue,canContinue,label);assert.equal(state.canCancel,false)
   if(canContinue){assert.equal(state.pendingCount,1,label);assert.equal(state.pendingItems,null,`${label} cannot masquerade as a complete empty list`)}
   else await assert.rejects(runner.continue(),/CANNOT_CONTINUE/)
   const completion=await f.requests.readResult();assert.deepEqual(completion,f.completion)
   assert.equal('pendingCount'in completion!.outcome&&completion.outcome.pendingCount,1,'The durable receipt retains its original count even when an unrelated journal cannot authorize the UI')
   assert.equal(await readFile(f.journalPath,'utf8'),journalBytes);assert.deepEqual(await readFile(receiptPath),receiptBytes);assert.deepEqual(await readFile(pointerPath),pointerBytes)
   assert.equal(f.continues,0);assert.equal(f.migrations,1)
   assert.equal(await readFile(join(f.source,'state.json'),'utf8'),'late old-root setting retained');assert.equal(await readFile(join(f.target,'state.json'),'utf8'),'initial local settings')
   assert.equal(await readFile(join(f.target,'drafts.json'),'utf8'),'real isolated draft bytes')
  }
  assert.equal(f.migrations,1);assert.equal(await readFile(join(f.target,'drafts.json'),'utf8'),'real isolated draft bytes')
 }finally{await f.close()}
})

test('PEND85-03: closure proof revoked during the actual detail-read await cannot publish continue; retry reads the original receipt',{timeout:10000},async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let flight:Promise<unknown>|undefined
 try{
  const create=f.options.createManager!;f.options.createManager=input=>{const manager=create(input),read=manager.recordedMigration.bind(manager);manager.recordedMigration=async id=>{const record=await read(id);entered.resolve();await allow.promise;return record};return manager}
  const runner=new RootMaintenanceRunner(f.options);flight=runner.start();await entered.promise;f.setClosed(false);allow.resolve();await flight
  assert.equal(runner.state().phase,'recovery-required');assert.equal(runner.state().canContinue,false);await assert.rejects(runner.continue(),/CANNOT_CONTINUE/)
  assert.equal((await f.requests.readResult())?.receiptId,f.completion.receiptId);assert.equal(f.continues,0)
  f.setClosed(true);const retry=await runner.start();assert.equal(retry.phase,'cleanup-pending');assert.deepEqual(retry.pendingItems,['state.json']);assert.equal(f.migrations,1)
 }finally{allow.resolve();f.setClosed(true);await flight?.catch(()=>undefined);await f.close()}
})

test('PEND85-04: a missing details journal still truthfully reports unknown labels and continues only from the validated authority',{timeout:10000},async()=>{
 const f=await fixture()
 try{
  await rm(f.journalPath);const runner=new RootMaintenanceRunner(f.options),state=await runner.start()
  assert.equal(state.pendingItems,null);assert.equal(state.pendingCount,1);assert.equal(state.phase,'cleanup-pending');assert.equal(state.canContinue,true)
  await runner.continue();assert.equal(f.continues,1);assert.equal(await f.requests.readResult(),null);assert.equal(f.migrations,1)
  assert.equal(await readFile(join(f.source,'state.json'),'utf8'),'late old-root setting retained');assert.equal(await readFile(join(f.target,'drafts.json'),'utf8'),'real isolated draft bytes')
 }finally{await f.close()}
})
