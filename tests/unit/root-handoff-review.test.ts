import assert from 'node:assert/strict'
import {test,mock} from 'node:test'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import {syncBuiltinESMExports} from 'node:module'
import {mkdtemp,mkdir,readFile,realpath,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {RootMigrationHandoff} from '../../desktop/main/root-migration-handoff'
import {RootMigrationRequests} from '../../desktop/main/root-migration-request'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import type {RootPointer} from '../../desktop/core/data-root'
import {DataRootManager} from '../../desktop/core/data-root'
import {BusinessGate} from '../../desktop/main/business-gate'
import {rootMaintenanceRequired} from '../../desktop/main/root-maintenance-preflight'

test('H70-01: an unconfirmed cancellation after an arm rename retains its original handoff owner for explicit retry',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-handoff70-'))),bootstrap=join(base,'bootstrap'),source=join(base,'source'),target=join(base,'target')
 try{
  for(const path of [bootstrap,source,target])await mkdir(path)
  const pointer:RootPointer={schemaVersion:1,revision:1,rootId:randomUUID(),migrationId:null,root:await directoryIdentity(source)}
  let flow!:RootMigrationHandoff,closed=false,failSync=false,ownerNonce='',restarts=0
  const requests=new RootMigrationRequests(bootstrap,{resolveSource:async()=>({state:'existing',pointer}),assertStableLock(){},assertOwner(nonce){flow.assertOwner(nonce)},assertClosed(){assert.equal(closed,true)},writeOptions:{async beforeDirectorySync(){if(failSync)throw Error('review70 persistent sync failure')}}})
  flow=new RootMigrationHandoff({requests:{async prepare(nonce,proof){ownerNonce=nonce;return requests.prepare(nonce,proof)},arm:requests.arm.bind(requests),cancel:requests.cancel.bind(requests),acknowledgeResult:requests.acknowledgeResult.bind(requests),inspect:requests.inspect.bind(requests)},choose:async()=>directoryIdentity(target),confirm:async()=>true,assertOwner(){},async close(){closed=true;failSync=true;await flow.armClosed();flow.commit();return true},restart(){restarts++}})
  await assert.rejects(flow.start(),/DURABILITY_UNCONFIRMED/);assert.equal(restarts,0)
  const observed=JSON.parse(await readFile(join(bootstrap,'root-migration-request.json'),'utf8'));assert.equal(observed.active.phase,'armed');assert.equal(observed.active.ownerNonce,ownerNonce)
  assert.doesNotThrow(()=>flow.assertOwner(ownerNonce),'failed cancel persistence must not expire the only retained owner of the still-armed request')
  assert.equal(flow.pending,true);await assert.rejects(flow.start(),/MIGRATION_CANCELLATION_PENDING/)
  failSync=false;const first=flow.cancelPrepared(),second=flow.cancelPrepared();assert.equal(first,second);await first
  assert.equal(flow.pending,false);assert.equal(flow.commit(),false);assert.equal(rootMaintenanceRequired(bootstrap),false);assert.equal((await requests.inspect()).active,null)
 }finally{await rm(base,{recursive:true,force:true})}
})

test('H70-02: owner loss after prepared or armed persistence cancels and ACKs only that owner without restarting',async()=>{
 for(const expireAt of ['prepared','armed']){
  const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-handoff70-owner-'))),bootstrap=join(base,'bootstrap'),source=join(base,'source'),target=join(base,'target')
  try{
   for(const path of [bootstrap,source,target])await mkdir(path)
   const pointer:RootPointer={schemaVersion:1,revision:1,rootId:randomUUID(),migrationId:null,root:await directoryIdentity(source)}
   let flow!:RootMigrationHandoff,owner=true,closed=false,restarts=0,expired=false
   const requests=new RootMigrationRequests(bootstrap,{resolveSource:async()=>({state:'existing',pointer}),assertStableLock(){},assertOwner(nonce){flow.assertOwner(nonce)},assertClosed(){assert.equal(closed,true)},writeOptions:{async beforeDirectorySync(){const phase=JSON.parse(await readFile(join(bootstrap,'root-migration-request.json'),'utf8')).active?.phase;if(!expired&&phase===expireAt){expired=true;owner=false}}}})
   flow=new RootMigrationHandoff({requests,choose:async()=>directoryIdentity(target),confirm:async()=>true,assertOwner(){if(!owner)throw Error('review70 owner gone')},async close(){closed=true;await flow.armClosed();flow.commit();return true},restart(){restarts++}})
   await assert.rejects(flow.start(),/review70 owner gone/);assert.equal(expired,true);assert.equal(restarts,0);assert.equal(flow.pending,false);assert.equal(rootMaintenanceRequired(bootstrap),false)
   const record=await requests.inspect();assert.equal(record.active,null);assert.deepEqual(record.results,[])
  }finally{await rm(base,{recursive:true,force:true})}
 }
})

test('H70-06: uncertain prepare is inspected by its exact owner and durably cancelled before any close or restart',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-handoff70-prepare-'))),bootstrap=join(base,'bootstrap'),source=join(base,'source'),target=join(base,'target')
 try{
  for(const path of [bootstrap,source,target])await mkdir(path)
  const pointer:RootPointer={schemaVersion:1,revision:1,rootId:randomUUID(),migrationId:null,root:await directoryIdentity(source)}
  let flow!:RootMigrationHandoff,firstSync=true,closes=0,restarts=0
  const requests=new RootMigrationRequests(bootstrap,{resolveSource:async()=>({state:'existing',pointer}),assertStableLock(){},assertOwner(nonce){flow.assertOwner(nonce)},assertClosed(){throw Error('never closed')},writeOptions:{async beforeDirectorySync(){if(firstSync){firstSync=false;throw Error('review70 uncertain prepare')}}}})
  flow=new RootMigrationHandoff({requests,choose:async()=>directoryIdentity(target),confirm:async()=>true,assertOwner(){},async close(){closes++;return false},restart(){restarts++}})
  await assert.rejects(flow.start(),/DURABILITY_UNCONFIRMED/);assert.equal(closes,0);assert.equal(restarts,0);assert.equal(flow.pending,false);assert.equal(rootMaintenanceRequired(bootstrap),false)
  const snapshot=await requests.inspect();assert.equal(snapshot.active,null);assert.deepEqual(snapshot.results,[])
 }finally{await rm(base,{recursive:true,force:true})}
})

test('G70-01: closing before accepted operations start waits for a real write and a rejected operation, and admits no late write',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-gate70-'))),gate=new BusinessGate(),release=Promise.withResolvers<void>(),failure=Error('review70 operation rejected');let drained=false
 try{
  const work=gate.run(async()=>{await release.promise;await writeFile(join(base,'saved'),'accepted work completed');return 'saved'})
  const rejected=gate.run(async()=>{await release.promise;throw failure}),observed=assert.rejects(rejected,error=>error===failure)
  const drain=gate.close();assert.equal(gate.close(),drain);void drain.then(()=>{drained=true})
  await assert.rejects(gate.run(()=>writeFile(join(base,'forbidden'),'late write')),/BUSINESS_CLOSED/);await Promise.resolve();assert.equal(drained,false);assert.throws(()=>gate.reopen(),/BUSINESS_DRAINING/)
  release.resolve();assert.equal(await work,'saved');await observed;await drain;assert.equal(await readFile(join(base,'saved'),'utf8'),'accepted work completed');await assert.rejects(readFile(join(base,'forbidden')),{code:'ENOENT'})
  gate.reopen();assert.equal(await gate.run(()=>readFile(join(base,'saved'),'utf8')),'accepted work completed')
 }finally{release.resolve();await gate.close();await rm(base,{recursive:true,force:true})}
})

test('P70-02: only a strictly empty ledger permits ordinary startup, with read-only bounded fatal-UTF8 checks',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-preflight70-shapes-'))),bootstrap=join(base,'bootstrap');await mkdir(bootstrap);const path=join(bootstrap,'root-migration-request.json')
 try{
  assert.equal(rootMaintenanceRequired(bootstrap),false);await assert.rejects(readFile(path),{code:'ENOENT'})
  const empty={schemaVersion:1,revision:7,active:null,results:[]};await writeFile(path,JSON.stringify(empty));const before=fs.lstatSync(path,{bigint:true});assert.equal(rootMaintenanceRequired(bootstrap),false);const after=fs.lstatSync(path,{bigint:true});assert.deepEqual([after.dev,after.ino,after.size,after.mtimeNs,after.ctimeNs],[before.dev,before.ino,before.size,before.mtimeNs,before.ctimeNs])
  for(const invalid of ['{',JSON.stringify({...empty,unknown:true}),JSON.stringify({...empty,revision:-1}),JSON.stringify({...empty,results:[{}]}),Buffer.from([0xff,0xfe]),Buffer.alloc(256*1024+1,32)]){await writeFile(path,invalid);assert.equal(rootMaintenanceRequired(bootstrap),true);assert.deepEqual(await readFile(path),Buffer.isBuffer(invalid)?invalid:Buffer.from(invalid))}
 }finally{await rm(base,{recursive:true,force:true})}
})

test('P70-03: ledger hardlinks, bootstrap symlinks and symlink ancestors enter maintenance without touching external data',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-preflight70-links-'))),bootstrap=join(base,'bootstrap');await mkdir(bootstrap);const empty=JSON.stringify({schemaVersion:1,revision:0,active:null,results:[]}),outside=join(base,'outside.json'),path=join(bootstrap,'root-migration-request.json')
 try{
  await writeFile(outside,empty);fs.linkSync(outside,path);assert.equal(rootMaintenanceRequired(bootstrap),true);assert.equal(await readFile(outside,'utf8'),empty);await rm(path)
  fs.symlinkSync(outside,path);assert.equal(rootMaintenanceRequired(bootstrap),true);assert.equal(await readFile(outside,'utf8'),empty);await rm(path);await writeFile(path,empty)
  fs.symlinkSync(bootstrap,join(base,'alias-bootstrap'));assert.equal(rootMaintenanceRequired(join(base,'alias-bootstrap')),true)
  fs.symlinkSync(base,join(base,'alias-parent'));assert.equal(rootMaintenanceRequired(join(base,'alias-parent','bootstrap')),true)
  assert.equal(await readFile(path,'utf8'),empty);assert.equal(rootMaintenanceRequired(join(base,'missing-bootstrap')),true)
 }finally{await rm(base,{recursive:true,force:true})}
})

test('R70-01: an old rollback cannot match a new execution nonce, and a corrupt checksummed journal is not hidden by an ID mismatch',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-record70-'))),bootstrap=join(base,'bootstrap'),source=join(base,'source'),target=join(base,'target'),nonce=randomUUID(),abort=new AbortController()
 try{
  for(const path of [bootstrap,source,target,join(source,'inbox')])await mkdir(path)
  await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:false}));await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
  const manager=new DataRootManager(bootstrap,source,{migrationId:nonce,hook(phase){if(phase==='verified')abort.abort()}});await manager.adopt(await directoryIdentity(source))
  const host={async quiesce(pointer:RootPointer){return{source:pointer.root,ownedFiles:['xuanxiang-app.json','catalog.json'],ownedDirectories:['inbox'],assertClosed(){},release(){}}}}
  await assert.rejects(manager.migrate(await directoryIdentity(target),host,abort.signal),/MIGRATION_CANCELLED/)
  const path=join(bootstrap,'root-migration.json'),raw=await readFile(path,'utf8'),cold=new DataRootManager(bootstrap,source),record=await cold.recordedMigration(nonce);assert.ok(record);assert.equal(record.result?.status,'rolled-back');assert.equal(await cold.recordedMigration(randomUUID()),null);assert.equal(await readFile(path,'utf8'),raw)
  record.source.root.path='caller mutation';assert.equal((await cold.recordedMigration(nonce))?.source.root.path,source)
  const corrupt=JSON.parse(raw);corrupt.journal.createdAt='changed without updating checksum';await writeFile(path,JSON.stringify(corrupt));await assert.rejects(cold.recordedMigration(randomUUID()),/JOURNAL_INVALID/);assert.equal(await readFile(path,'utf8'),JSON.stringify(corrupt))
 }finally{await rm(base,{recursive:true,force:true})}
})

test('H70-05: an uncertain ACK retries the same receipt and expires ownership only after durable cancellation completes',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-handoff70-ack-'))),bootstrap=join(base,'bootstrap'),source=join(base,'source'),target=join(base,'target')
 try{
  for(const path of [bootstrap,source,target])await mkdir(path)
  const pointer:RootPointer={schemaVersion:1,revision:1,rootId:randomUUID(),migrationId:null,root:await directoryIdentity(source)}
  let flow!:RootMigrationHandoff,failNextSync=false,ownerNonce='',cancelCalls=0,ackCalls=0,chooseCalls=0,restarts=0
  const receipts:string[]=[]
  const requests=new RootMigrationRequests(bootstrap,{resolveSource:async()=>({state:'existing',pointer}),assertStableLock(){},assertOwner(nonce){flow.assertOwner(nonce)},assertClosed(){throw Error('close was cancelled')},writeOptions:{async beforeDirectorySync(){if(failNextSync){failNextSync=false;throw Error('review70 ACK sync failure')}}}})
  flow=new RootMigrationHandoff({requests:{async prepare(nonce,proof){ownerNonce=nonce;return requests.prepare(nonce,proof)},arm:requests.arm.bind(requests),async cancel(id,nonce){cancelCalls++;return requests.cancel(id,nonce)},async acknowledgeResult(id,receipt){ackCalls++;receipts.push(receipt);if(ackCalls===1)failNextSync=true;return requests.acknowledgeResult(id,receipt)},inspect:requests.inspect.bind(requests)},async choose(){chooseCalls++;return directoryIdentity(target)},confirm:async()=>true,assertOwner(){},close:async()=>false,restart(){restarts++}})
  await assert.rejects(flow.start(),/DURABILITY_UNCONFIRMED/);assert.equal(flow.pending,true);assert.equal(cancelCalls,1);assert.equal(ackCalls,1)
  const onDisk=JSON.parse(await readFile(join(bootstrap,'root-migration-request.json'),'utf8'));assert.equal(onDisk.active,null);assert.deepEqual(onDisk.results,[])
  await assert.rejects(flow.start(),/MIGRATION_CANCELLATION_PENDING/);assert.equal(chooseCalls,1)
  const first=flow.cancelPrepared(),second=flow.cancelPrepared();assert.equal(first,second);await first
  assert.equal(flow.pending,false);assert.equal(cancelCalls,1);assert.equal(ackCalls,2);assert.equal(receipts[0],receipts[1]);assert.equal(restarts,0);assert.equal(rootMaintenanceRequired(bootstrap),false)
  assert.equal((await requests.inspect()).active,null);assert.throws(()=>flow.assertOwner(ownerNonce),/MIGRATION_OWNER_EXPIRED/,'completed cancellation must retire its old owner even after an explicit retry')
 }finally{await rm(base,{recursive:true,force:true})}
})

test('H70-04: an explicit cancellation in progress prevents commit/restart of an armed request',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-handoff70-cancel-'))),bootstrap=join(base,'bootstrap'),source=join(base,'source'),target=join(base,'target')
 const armed=Promise.withResolvers<void>(),finishClose=Promise.withResolvers<void>(),cancelEntered=Promise.withResolvers<void>(),finishCancel=Promise.withResolvers<void>();let started:Promise<boolean>|undefined,cancelling:Promise<void>|undefined
 try{
  for(const path of [bootstrap,source,target])await mkdir(path)
  const pointer:RootPointer={schemaVersion:1,revision:1,rootId:randomUUID(),migrationId:null,root:await directoryIdentity(source)}
  let flow!:RootMigrationHandoff,closed=false,blockCancel=false,restarts=0
  const requests=new RootMigrationRequests(bootstrap,{resolveSource:async()=>({state:'existing',pointer}),assertStableLock(){},assertOwner(nonce){flow.assertOwner(nonce)},assertClosed(){assert.equal(closed,true)},writeOptions:{async beforeRename(){if(blockCancel){blockCancel=false;cancelEntered.resolve();await finishCancel.promise}}}})
  flow=new RootMigrationHandoff({requests,choose:async()=>directoryIdentity(target),confirm:async()=>true,assertOwner(){},async close(){closed=true;await flow.armClosed();armed.resolve();await finishClose.promise;return false},restart(){restarts++}})
  started=flow.start();await armed.promise;blockCancel=true;cancelling=flow.cancelPrepared();await cancelEntered.promise
  assert.equal(flow.commit(),false,'commit must not race a pending durable cancellation');assert.equal(restarts,0)
  finishCancel.resolve();await cancelling;finishClose.resolve();assert.equal(await started,false);assert.equal(flow.pending,false)
  assert.deepEqual(await requests.inspect(),{schemaVersion:1,revision:4,active:null,results:[]})
 }finally{finishCancel.resolve();finishClose.resolve();await Promise.allSettled([started,cancelling].filter((value):value is Promise<any>=>!!value));await rm(base,{recursive:true,force:true})}
})

test('P70-01: a bootstrap identity replacement during a missing-ledger lookup requires maintenance rather than ordinary startup',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-preflight70-'))),bootstrap=join(base,'bootstrap');await mkdir(bootstrap)
 const path=join(bootstrap,'root-migration-request.json'),originalLstat=fs.lstatSync;let replaced=false
 const fault=mock.method(fs,'lstatSync',((...args:Parameters<typeof fs.lstatSync>)=>{
  if(args[0]===path&&!replaced){replaced=true;fs.renameSync(bootstrap,bootstrap+'-original');fs.mkdirSync(bootstrap)}
  return Reflect.apply(originalLstat,fs,args)
 }) as typeof fs.lstatSync);syncBuiltinESMExports()
 try{
  assert.equal(rootMaintenanceRequired(bootstrap),true,'ENOENT may belong to a replacement bootstrap; it must not certify the captured original directory as empty')
  assert.equal(replaced,true);assert.deepEqual(await (await import('node:fs/promises')).readdir(bootstrap),[])
 }finally{fault.mock.restore();syncBuiltinESMExports();await rm(base,{recursive:true,force:true})}
})
