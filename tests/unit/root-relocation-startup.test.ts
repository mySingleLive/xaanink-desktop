import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,realpath,mkdir,writeFile,readFile,rename,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createHash} from 'node:crypto'
import {DataRootManager,type RootPointer,type RootOptions} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {RootRelocation,inspectRootRelocation} from '../../desktop/core/root-relocation'
import {createRootRelocationRetention} from '../../desktop/core/root-relocation-retention'
import {startOwnedRoot} from '../../desktop/service/root-startup'
import {RootMigrationRequests} from '../../desktop/main/root-migration-request'
import {RootMaintenanceRunner} from '../../desktop/main/root-maintenance-runner'
import {Worker} from 'node:worker_threads'
import {once} from 'node:events'
import {resolve} from 'node:path'
import fsPromises from 'node:fs/promises'
import {writeFileSync} from 'node:fs'
import {syncBuiltinESMExports} from 'node:module'
const stable=(v:unknown):unknown=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,stable(x)])):v
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')
async function fixture(phase:'cleanup-pending'|'rollback-pending'='cleanup-pending'){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-cold33-'))),bootstrap=join(base,'boot'),old=join(base,'old'),root=join(base,'root'),moved=join(base,'moved'),owner=randomUUID(),id=randomUUID(),rootId=randomUUID()
 for(const path of[bootstrap,old,root])await mkdir(path)
 const live=phase==='cleanup-pending'?root:old,other=phase==='cleanup-pending'?old:root
 await mkdir(join(live,'inbox/database'),{recursive:true});await writeFile(join(live,'inbox/database/PG_VERSION'),'17');await writeFile(join(live,'catalog.json'),'{"revision":0,"value":[]}');await writeFile(join(live,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:rootId,phase:'ready',inboxReady:true}));await writeFile(join(live,'private-data'),'original live bytes');await writeFile(join(other,'keep'),'keep other root bytes')
 const source:RootPointer={schemaVersion:1,revision:1,rootId,migrationId:null,root:await directoryIdentity(old)},target=await directoryIdentity(root),before:RootPointer=phase==='cleanup-pending'?{...source,revision:2,migrationId:id,root:target}:source
 const journal={schemaVersion:1,migrationId:id,phase,source,target,stage:`.xuanxiang-migration-${id}`,sourceInboxIdentity:{...source.root,path:join(old,'inbox')},files:[],createdAt:new Date().toISOString(),pending:['preserved-owned-file']}
 await writeFile(join(bootstrap,'data-root.json'),JSON.stringify(before));await writeFile(join(bootstrap,'root-migration.json'),JSON.stringify({journal,sha256:digest(journal)})+'\n')
 const completion={requestId:randomUUID(),ownerNonce:owner,source,target,createdAt:new Date().toISOString(),receiptId:randomUUID(),executionNonce:id,finishedAt:new Date().toISOString(),outcome:{status:phase,migrationId:id,root:before,pendingCount:1}}
 await writeFile(join(bootstrap,'root-migration-request.json'),JSON.stringify({schemaVersion:1,revision:4,active:null,results:[completion]})+'\n')
 await rename(live,moved);const boot=await directoryIdentity(bootstrap),host={assertStableLock(){},assertCold(){},assertOwner(nonce:string){assert.equal(nonce,owner)},confirm:async()=>true},locator=new RootRelocation(boot,host),preview=await locator.prepare(owner,await directoryIdentity(moved)),outcome=await locator.commit(owner,preview.attemptId),journalBytes=await readFile(join(bootstrap,'root-migration.json'))
 const provider=createRootRelocationRetention(bootstrap,host)
 return{base,bootstrap,root,old,moved,other,owner,id,before,journal,completion,boot,host,outcome,journalBytes,provider,close:()=>rm(base,{recursive:true,force:true})}
}

test('RC33-01 cleanup/rollback pending recover uses fresh exact proof, never quiesces/cleans either directory or rewrites journal',async()=>{
 for(const phase of['cleanup-pending','rollback-pending']as const){const f=await fixture(phase);try{let quiesced=0;const core=new DataRootManager(f.bootstrap,f.old,{retainedRelocation:f.provider}as RootOptions);const result=await core.recover({async quiesce(){quiesced++;throw Error('must not clean historical roots')}});assert.equal(result?.status,phase);assert.deepEqual(result?.root,f.outcome.pointer);assert.equal(quiesced,0);assert.deepEqual(await readFile(join(f.bootstrap,'root-migration.json')),f.journalBytes);assert.equal(await readFile(join(f.moved,'private-data'),'utf8'),'original live bytes');assert.equal(await readFile(join(f.other,'keep'),'utf8'),'keep other root bytes')}finally{await f.close()}}
})
test('RC33-02 actual startup initializes only relocated directory after pending proof, never old path/fallback',async()=>{
 const f=await fixture();try{const opened:string[]=[];const started=await startOwnedRoot({bootstrap:f.bootstrap,root:f.old},async path=>{opened.push(path);return'initialized relocated root'});assert.deepEqual(opened,[f.moved]);assert.equal(started.root,f.moved);assert.deepEqual(started.pointer,f.outcome.pointer);assert.deepEqual(await readFile(join(f.bootstrap,'root-migration.json')),f.journalBytes);assert.equal(await readFile(join(f.other,'keep'),'utf8'),'keep other root bytes')}finally{await f.close()}
})
test('RC33-03 stale provider cannot skip changed complete journal or pointer, final seal occurs after last await',async()=>{
 const f=await fixture();try{const retained=await f.provider(f.outcome.pointer,digest(f.journal));assert.ok(retained);const changed={...f.journal,pending:['foreign changed content']};await writeFile(join(f.bootstrap,'root-migration.json'),JSON.stringify({journal:changed,sha256:digest(changed)}));let quiesced=0;await assert.rejects(new DataRootManager(f.bootstrap,f.old,{retainedRelocation:async()=>retained}as RootOptions).recover({async quiesce(){quiesced++;throw Error('forbidden')}}));assert.equal(quiesced,0);assert.match(await readFile(join(f.bootstrap,'root-migration.json'),'utf8'),/foreign changed content/);assert.equal(await readFile(join(f.moved,'private-data'),'utf8'),'original live bytes')}finally{await f.close()}
})
test('RC33-04 pending read proof loses host after await and blocks startup without initializing any directory',async()=>{
 const f=await fixture();try{let opened=0;const provider=createRootRelocationRetention(f.bootstrap,{assertStableLock(){},assertCold(){throw Error('source session live')}});await assert.rejects(new DataRootManager(f.bootstrap,f.old,{retainedRelocation:provider}as RootOptions).recover({async quiesce(){throw Error('forbidden')}}));assert.equal(opened,0);assert.deepEqual(await readFile(join(f.bootstrap,'root-migration.json')),f.journalBytes)}finally{await f.close()}
})
test('RC33-05 actual maintenance preserves old completion, validates it on display/ACK then new cold worker startup retains pending safely',async()=>{
 const f=await fixture();try{const manager=new DataRootManager(f.bootstrap,f.old),requests=new RootMigrationRequests(f.bootstrap,{resolveSource:()=>manager.resolve(),assertStableLock(){},assertOwner(nonce){assert.equal(nonce,f.owner)},assertClosed(){}});let continued=0;const runner=new RootMaintenanceRunner({bootstrap:f.bootstrap,defaultRoot:f.old,requests,theme:'paper',host:{assertMaintenanceClosed(){}},async onContinue(){continued++},async onQuit(){}});assert.equal((await runner.start()).phase,'cleanup-pending');assert.equal(runner.state().canContinue,true);assert.equal(runner.state().currentRootPath,f.moved);assert.deepEqual(await requests.readResult(),f.completion);await runner.continue();assert.equal(continued,1);assert.equal(await requests.readResult(),null);assert.deepEqual(await readFile(join(f.bootstrap,'root-migration.json')),f.journalBytes);const started=await startOwnedRoot({bootstrap:f.bootstrap,root:f.old},async path=>path);assert.equal(started.root,f.moved);assert.equal(await readFile(join(f.other,'keep'),'utf8'),'keep other root bytes')}finally{await f.close()}
})
test('RC33-06 changed completion with same request/receipt ids cannot grant old result display or ACK after relocation',async()=>{
 const f=await fixture();try{const path=join(f.bootstrap,'root-migration-request.json'),changed={...f.completion,outcome:{...f.completion.outcome,pendingCount:2}};await writeFile(path,JSON.stringify({schemaVersion:1,revision:5,active:null,results:[changed]}));const requests=new RootMigrationRequests(f.bootstrap,{resolveSource:()=>new DataRootManager(f.bootstrap,f.old).resolve(),assertStableLock(){},assertOwner(){},assertClosed(){}}),runner=new RootMaintenanceRunner({bootstrap:f.bootstrap,defaultRoot:f.old,requests,theme:'paper',host:{assertMaintenanceClosed(){}},async onContinue(){throw Error('forbidden')},async onQuit(){}});assert.equal((await runner.start()).phase,'recovery-required');assert.equal(runner.state().canContinue,false);assert.deepEqual((await requests.inspect()).results,[changed]);await assert.rejects(runner.continue());assert.deepEqual((await requests.inspect()).results,[changed])}finally{await f.close()}
})
test('RC33-07 late changed receipt set after a fresh provider is returned cannot retain an old journal from cache',async()=>{
 const f=await fixture();try{const retained=await f.provider(f.outcome.pointer,digest(f.journal));assert.ok(retained);await writeFile(join(f.bootstrap,`root-relocation-${randomUUID()}.json`),'foreign record');await assert.rejects(new DataRootManager(f.bootstrap,f.old,{retainedRelocation:async()=>retained}as RootOptions).recover({async quiesce(){throw Error('forbidden')}}));assert.deepEqual(await readFile(join(f.bootstrap,'root-migration.json')),f.journalBytes);assert.equal((await readdir(f.bootstrap)).filter(v=>v.startsWith('root-relocation-')).length,2)}finally{await f.close()}
})
test('RC33-08 missing relocation audit cannot make historical same-physical pending completion ordinary or ACK it',async()=>{
 const f=await fixture();try{await rm(join(f.bootstrap,`root-relocation-${f.outcome.receiptId}.json`));const requests=new RootMigrationRequests(f.bootstrap,{resolveSource:()=>new DataRootManager(f.bootstrap,f.old).resolve(),assertStableLock(){},assertOwner(){},assertClosed(){}}),runner=new RootMaintenanceRunner({bootstrap:f.bootstrap,defaultRoot:f.old,requests,theme:'paper',host:{assertMaintenanceClosed(){}},async onContinue(){throw Error('forbidden')},async onQuit(){}});assert.equal((await runner.start()).phase,'recovery-required');assert.equal(runner.state().canContinue,false);assert.deepEqual(await requests.readResult(),f.completion);await assert.rejects(runner.continue());assert.deepEqual(await readFile(join(f.bootstrap,'root-migration.json')),f.journalBytes)}finally{await f.close()}
})
test('RC33-09 new real worker calls actual cold startup only at relocated path after production ledger ACK, without a database engine',async()=>{
 const f=await fixture();let worker:Worker|undefined;try{const requests=new RootMigrationRequests(f.bootstrap,{resolveSource:()=>new DataRootManager(f.bootstrap,f.old).resolve(),assertStableLock(){},assertOwner(){},assertClosed(){}});await requests.acknowledgeResult(f.completion.requestId,f.completion.receiptId);await requests.flush();worker=new Worker(`require('tsx/cjs');const{parentPort,workerData}=require('node:worker_threads');const{startOwnedRoot}=require(workerData.module);startOwnedRoot({bootstrap:workerData.bootstrap,root:workerData.root},async path=>path).then(value=>parentPort.postMessage(value),error=>{parentPort.postMessage({code:error.code});process.exitCode=1})`,{eval:true,execArgv:[],workerData:{module:resolve('desktop/service/root-startup.ts'),bootstrap:f.bootstrap,root:f.old}});const exited=once(worker,'exit'),[value]=await once(worker,'message');assert.equal(value.root,f.moved);assert.equal(value.value,f.moved);assert.deepEqual(value.pointer,f.outcome.pointer);assert.deepEqual(await exited,[0]);assert.deepEqual(await readFile(join(f.bootstrap,'root-migration.json')),f.journalBytes);assert.equal(await readFile(join(f.other,'keep'),'utf8'),'keep other root bytes')}finally{await worker?.terminate();await f.close()}
})
test('RC33-10 changed original journal during final resolve after recover cannot open the first engine',async t=>{
 const f=await fixture(),original=fsPromises.open;let count=0,opened=0;try{t.mock.method(fsPromises,'open',async(...args:Parameters<typeof original>)=>{if(String(args[0])===join(f.bootstrap,'data-root.json')&&++count===2)writeFileSync(join(f.bootstrap,'root-migration.json'),'foreign late journal');return original(...args)});syncBuiltinESMExports();await assert.rejects(startOwnedRoot({bootstrap:f.bootstrap,root:f.old},async()=>{opened++;return'forbidden'}));assert.equal(opened,0);assert.equal(await readFile(join(f.bootstrap,'root-migration.json'),'utf8'),'foreign late journal');assert.equal(await readFile(join(f.moved,'private-data'),'utf8'),'original live bytes')}finally{t.mock.restoreAll();syncBuiltinESMExports();await f.close()}
})
