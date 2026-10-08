import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,realpath,writeFile,readFile,readdir,rename,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {canonical,digest} from '../../desktop/core/application-backup-files'
import {ApplicationRestoreRequests,type ApplicationRestoreRequestOptions} from '../../desktop/main/application-restore-request'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {ApplicationRestoreDraftBarrier} from '../../desktop/main/application-restore-draft-barrier'
import {prepareApplicationDraftRetention,persistApplicationDraftRetention,installInertApplicationDraftJournal} from '../../desktop/core/application-restore-drafts'
import {applicationDraftRecoveryItems} from '../../desktop/shared/application-restore'
import {observeRootAuthority} from '../../desktop/core/root-authority'
import {applicationRestoreRequestBodySchema} from '../../desktop/shared/application-restore-request'

async function fixture(overrides:Partial<ApplicationRestoreRequestOptions>={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-coldrequest36-'))),boot=join(base,'bootstrap'),source=join(base,'source'),backup=join(base,'backup'),parent=join(base,'parent')
 for(const path of[boot,source,backup,parent])await mkdir(path)
 const appId=randomUUID(),backupId=randomUUID(),owner=randomUUID()
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}))
 const latestJournal=new DraftJournal(source),deactivate=latestJournal.activate('original-source-fixture')
 await latestJournal.persist('original-source-fixture',{version:1,revision:1,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft:'最后保留的当前输入',queuedRequests:[{prompt:'inert only'}]}},issues:[]});deactivate()
 const pointer={schemaVersion:1,revision:1,rootId:appId,migrationId:null,root:await directoryIdentity(source)}
 await writeFile(join(boot,'data-root.json'),JSON.stringify(pointer)+'\n')
 const body={format:'xuanxiang-application-backup',schemaVersion:1,id:backupId,appId,createdAt:'2026-10-08T00:00:00.000Z',phase:'verified',engine:{pglite:'0.5.8',postgresMajor:17},files:[],directories:[],bytes:0}
 await writeFile(join(backup,'xuanxiang-app-backup.json'),JSON.stringify({...body,checksum:digest(canonical(body))}))
 const selection={backup:{directory:await directoryIdentity(backup),backupId},parent:await directoryIdentity(parent)}
 const options:ApplicationRestoreRequestOptions={assertStableLock(){},assertOwner(value){if(value!==owner)throw Error('wrong owner')},assertQuiesced(){},assertOldProcessExited(){},assertCold(){},assertExecutionSettled(){},inspectPendingEvidence(){return{operationIds:[],unknown:false}},...overrides}
 const manager=new ApplicationRestoreRequests(await directoryIdentity(boot),options)
 return{base,boot,source,backup,parent,appId,backupId,owner,pointer,selection,options,manager,close:()=>rm(base,{recursive:true,force:true})}
}

test('AR36-01: synchronous first-await startup is normal only without handoff/pending evidence; prepared never authorizes producer',{timeout:15000},async()=>{
 const f=await fixture()
 try{
  assert.equal(f.manager.startup().mode,'normal')
  const request=await f.manager.prepare(f.owner,f.selection)
  assert.equal(request.phase,'prepared');assert.equal(request.source.rootId,f.appId);assert.equal(request.backup.backupId,f.backupId)
  assert.equal(request.backup.checksum,JSON.parse(await readFile(join(f.backup,'xuanxiang-app-backup.json'),'utf8')).checksum)
  assert.equal(request.oldProcess.pid,process.pid)
  assert.equal(new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options).startup().mode,'cold')
  await assert.rejects(f.manager.beginExecution(f.owner,request.operationId),{code:'PHASE_INVALID'})
 }finally{await f.close()}
})
test('AR36-02: prepared→armed requires actual synchronous quiescence; even a trusted callback cannot declare a live old PID exited',{timeout:15000},async()=>{
 let closed=false
 const f=await fixture({assertQuiesced(){if(!closed)throw Error('IO pending')}})
 try{
  const prepared=await f.manager.prepare(f.owner,f.selection)
  await assert.rejects(f.manager.arm(f.owner,prepared.operationId),{code:'SOURCE_NOT_CLOSED'})
  assert.equal(f.manager.startup().request?.phase,'prepared')
  closed=true;assert.equal((await f.manager.arm(f.owner,prepared.operationId)).phase,'armed')
  await assert.rejects(f.manager.beginExecution(f.owner,prepared.operationId),{code:'SOURCE_PROCESS_ACTIVE'})
  assert.equal(f.manager.startup().request?.phase,'armed')
 }finally{await f.close()}
})
test('AR36-03: foreign/tampered backup or a nonempty native parent writes no request/phase record',{timeout:15000},async t=>{
 for(const change of['foreign','checksum','parent'] as const)await t.test(change,async()=>{
  const f=await fixture()
  try{
   if(change==='parent')await writeFile(join(f.parent,'existing'),'leave me')
   else{const path=join(f.backup,'xuanxiang-app-backup.json'),receipt=JSON.parse(await readFile(path,'utf8'));if(change==='foreign'){receipt.appId=randomUUID();const{checksum:_old,...body}=receipt;receipt.checksum=digest(canonical(body))}else receipt.checksum='0'.repeat(64);await writeFile(path,JSON.stringify(receipt))}
   await assert.rejects(f.manager.prepare(f.owner,f.selection))
   assert.deepEqual((await readdir(f.boot)).filter(name=>name.startsWith('application-recovery-')),[])
  }finally{await f.close()}
 })
})
test('AR36-04: sync assertion returning a Promise is rejected before any metadata write',{timeout:15000},async()=>{
 const f=await fixture({assertStableLock:(()=>Promise.resolve()) as unknown as ()=>void})
 try{await assert.rejects(f.manager.prepare(f.owner,f.selection),{code:'LOCK_REQUIRED'});assert.deepEqual((await readdir(f.boot)).filter(name=>name.startsWith('application-recovery-')),[])}finally{await f.close()}
})
test('AR36-05: same-byte request inode replacement at final CAS remains foreign and blocks cold startup',{timeout:15000},async()=>{
 let replace=false
 const f=await fixture({writeHooks:{async beforeRename(kind){if(kind==='request'&&replace){const path=join(f.boot,'application-recovery-request.json'),bytes=await readFile(path);await rename(path,path+'.preserved');await writeFile(path,bytes);replace=false}}}})
 try{
  const prepared=await f.manager.prepare(f.owner,f.selection);replace=true
  await assert.rejects(f.manager.arm(f.owner,prepared.operationId),{code:'RECORD_CHANGED'})
  const startup=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options).startup()
  assert.equal(startup.mode,'cold');assert.equal(startup.code,'HISTORY_INCOMPLETE')
  assert((await readdir(f.boot)).includes('application-recovery-request.json.preserved'))
 }finally{await f.close()}
})
test('AR36-06: write-after-request-rename failure is uncertain; no cancellation or extra transition can claim success',{timeout:15000},async()=>{
 let fail=false
 const f=await fixture({writeHooks:{async beforeDirectorySync(kind){if(kind==='request'&&fail)throw Error('controlled fsync failure')}}})
 try{
  const prepared=await f.manager.prepare(f.owner,f.selection);fail=true
  await assert.rejects(f.manager.arm(f.owner,prepared.operationId),{code:'DURABILITY_UNCONFIRMED'})
  await assert.rejects(f.manager.cancelPrepared(f.owner,prepared.operationId),{code:'DURABILITY_UNCONFIRMED'})
  assert.equal(f.manager.startup().mode,'cold')
 }finally{await f.close()}
})
test('AR36-07: missing necessary request/phase receipt and unrelated pending protection never enter business startup',{timeout:15000},async t=>{
 for(const missing of['request','phase','external'] as const)await t.test(missing,async()=>{
  const f=await fixture(missing==='external'?{inspectPendingEvidence(){return{operationIds:[randomUUID()],unknown:false}}}:{})
  try{
   if(missing!=='external'){await f.manager.prepare(f.owner,f.selection);const files=await readdir(f.boot),path=missing==='request'?'application-recovery-request.json':files.find(name=>name.startsWith('application-recovery-phase-'))!;await rename(join(f.boot,path),join(f.boot,path+'.retained'))}
   assert.equal(new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options).startup().mode,'cold')
  }finally{await f.close()}
 })
})
test('AR36-08: safe prepared cancellation preserves append-only complete history and allows a clean subsequent startup',{timeout:15000},async()=>{
 const f=await fixture()
 try{
  const prepared=await f.manager.prepare(f.owner,f.selection)
  assert.equal((await f.manager.cancelPrepared(f.owner,prepared.operationId)).phase,'cancelled')
  const names=(await readdir(f.boot)).filter(name=>name.startsWith('application-recovery-phase-'))
  assert.equal(names.length,2)
  assert.equal(new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options).startup().mode,'normal')
 }finally{await f.close()}
})

async function armedChild(f:Awaited<ReturnType<typeof fixture>>){
 const module=join(process.cwd(),'desktop/main/application-restore-request.ts'),ownership=join(process.cwd(),'desktop/core/root-ownership.ts')
 const script=`import {ApplicationRestoreRequests} from ${JSON.stringify(module)};import {directoryIdentity} from ${JSON.stringify(ownership)};import {once} from 'node:events';const owner=${JSON.stringify(f.owner)},manager=new ApplicationRestoreRequests(await directoryIdentity(${JSON.stringify(f.boot)}),{assertStableLock(){},assertOwner(n){if(n!==owner)throw Error('expired')},assertQuiesced(){},assertOldProcessExited(){},assertCold(){},assertExecutionSettled(){},inspectPendingEvidence(){return{operationIds:[],unknown:false}}});const request=await manager.prepare(owner,${JSON.stringify(f.selection)});await manager.arm(owner,request.operationId);process.stdout.write(JSON.stringify({operationId:request.operationId,pid:process.pid})+'\\n');process.stdin.resume();await once(process.stdin,'data');process.stdin.pause();`
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']})
 let output='',errors='';child.stderr.on('data',data=>{errors+=data})
 const exited=once(child,'exit')
 const armed=await new Promise<{operationId:string;pid:number}>((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('child handoff timeout '+errors)),8000)
  child.stdout.on('data',data=>{output+=data;if(output.includes('\n')){clearTimeout(timeout);try{resolve(JSON.parse(output.split('\n')[0]))}catch(cause){reject(cause)}}})
  child.once('error',cause=>{clearTimeout(timeout);reject(cause)})
  child.once('exit',()=>{clearTimeout(timeout);if(!output.includes('\n'))reject(Error('child failed '+errors))})
 })
 let stopped=false
 return{...armed,async stop(){if(stopped)return;stopped=true;child.stdin.end('exit');const[code]=await exited;assert.equal(code,0,errors)}}
}
test('AR36-09: only an actually exited old process permits one private executing handle; restart and clones cannot reissue it',{timeout:20000},async()=>{
 let settled=false,observedPid=0
 const f=await fixture({assertOldProcessExited(old){observedPid=old.pid},assertExecutionSettled(){if(!settled)throw Error('physical IO active')}}),child=await armedChild(f)
 try{
  const cold=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options)
  await assert.rejects(cold.beginExecution(f.owner,child.operationId),{code:'SOURCE_PROCESS_ACTIVE'})
  await child.stop()
  const handle=await cold.beginExecution(f.owner,child.operationId);assert.equal(observedPid,child.pid);assert.equal(handle.assertCurrent(),undefined)
  await assert.rejects(cold.unknown({...handle}),{code:'ATTEMPT_EXPIRED'})
  const restarted=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options)
  assert.equal(restarted.startup().mode,'cold')
  await assert.rejects(restarted.beginExecution(f.owner,child.operationId),{code:'PHASE_INVALID'})
  await assert.rejects(cold.cancelExecution(handle),{code:'IO_PENDING'})
  assert.equal(cold.startup().request?.phase,'executing')
  settled=true;assert.equal((await cold.cancelExecution(handle)).phase,'cancelled')
  assert.throws(()=>handle.assertCurrent(),{code:'ATTEMPT_EXPIRED'})
  assert.equal(new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options).startup().mode,'normal')
 }finally{await child.stop();await f.close()}
})
test('AR36-10: a receipt in the commit window makes physical-worker cancellation unknown even before pointer replacement',{timeout:20000},async()=>{
 const f=await fixture(),child=await armedChild(f)
 try{
  await child.stop();const cold=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options),handle=await cold.beginExecution(f.owner,child.operationId)
  const receiptPath=join(f.boot,`application-restore-${child.operationId}.json`),bytes='{"unfinished":"commit evidence must be preserved"}\n';await writeFile(receiptPath,bytes)
  assert.equal((await cold.cancelExecution(handle)).phase,'unknown')
  assert.equal(await readFile(receiptPath,'utf8'),bytes)
  assert.equal(new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options).startup().mode,'cold')
  await assert.rejects(cold.beginExecution(f.owner,child.operationId),{code:'PHASE_INVALID'})
 }finally{await child.stop();await f.close()}
})
test('AR36-11: owner revocation synchronously invalidates the original handle but still permits only unknown audit',{timeout:20000},async()=>{
 let live=true
 const f=await fixture({assertOwner(){if(!live)throw Error('window gone')}}),child=await armedChild(f)
 try{
  await child.stop();const cold=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options),handle=await cold.beginExecution(f.owner,child.operationId)
  live=false;assert.throws(()=>handle.assertCurrent(),{code:'OWNER_EXPIRED'})
  assert.equal((await cold.unknown(handle,'WORKER_EXIT')).phase,'unknown')
  assert.equal(cold.startup().mode,'cold')
 }finally{await child.stop();await f.close()}
})
test('AR36-12: request writes are single-flight and flush waits the complete physical publish and directory synchronization',{timeout:15000},async()=>{
 const entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>()
 const f=await fixture({writeHooks:{async beforeRename(kind){if(kind==='phase'){entered.resolve();await resume.promise}}}})
 try{
  const first=f.manager.prepare(f.owner,f.selection);await entered.promise
  await assert.rejects(f.manager.prepare(f.owner,f.selection),{code:'APPLICATION_RESTORE_REQUEST_BUSY'})
  let finished=false;const flush=f.manager.flush().then(()=>{finished=true});await new Promise(setImmediate);assert.equal(finished,false)
  resume.resolve();await first;await flush;assert.equal(finished,true)
 }finally{resume.resolve();await f.manager.flush();await f.close()}
})
test('AR36-13: sixteen retained operations are bounded; the seventeenth never truncates prior control history',{timeout:20000},async()=>{
 const f=await fixture()
 try{
  for(let n=0;n<16;n++){const request=await f.manager.prepare(f.owner,f.selection);await f.manager.cancelPrepared(f.owner,request.operationId)}
  const path=join(f.boot,'application-recovery-request.json'),before=await readFile(path)
  await assert.rejects(f.manager.prepare(f.owner,f.selection),{code:'OPERATION_LIMIT'})
  assert.deepEqual(await readFile(path),before);assert.equal((await readdir(f.boot)).filter(name=>name.startsWith('application-recovery-phase-')).length,32)
  assert.equal(f.manager.startup().mode,'normal')
 }finally{await f.close()}
})

/** Seed only an actual filesystem authority chain; this test does not issue a
 * producer proof or claim to run batch35 activation/PG or native confirmation. */
async function committedControl(f:Awaited<ReturnType<typeof fixture>>,operationId:string){
 const candidateId=randomUUID(),path=join(f.parent,candidateId);await mkdir(path)
 const marker={schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:f.appId,phase:'ready',inboxReady:true}
 await writeFile(join(path,'xuanxiang-app.json'),JSON.stringify(marker))
 const old=new DraftJournal(path);old.activate('inert-backup-fixture');await old.persist('inert-backup-fixture',{version:1,revision:1,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft:'原备份输入',queuedRequests:[{approved:true,prompt:'never execute'}]}},issues:[]})
 const target=await directoryIdentity(path),beforeFile=observeRootAuthority(await directoryIdentity(f.boot),'data-root.json',16384)!.proof
 const retained=await installInertApplicationDraftJournal(await persistApplicationDraftRetention(await prepareApplicationDraftRetention({appId:f.appId,operationId,candidateId,current:await directoryIdentity(f.source),backup:target},()=>{}),{appId:f.appId,operationId,candidateId,backup:target}))
 const after={...f.pointer,revision:2,root:target},tempName='.test-fixture-pointer';await writeFile(join(f.boot,tempName),JSON.stringify(after)+'\n')
 const pointer=observeRootAuthority(await directoryIdentity(f.boot),tempName,16384)!.proof,{ctimeNs:_ctime,...pointerFile}=pointer
 const backup=JSON.parse(await readFile(join(f.backup,'xuanxiang-app-backup.json'),'utf8'))
 const record={schemaVersion:1,type:'application',receiptId:operationId,createdAt:new Date().toISOString(),bootstrap:await directoryIdentity(f.boot),before:f.pointer,beforePointerFile:beforeFile,after,pointerFile,candidate:{id:candidateId,backupId:f.backupId,backupChecksum:backup.checksum,initialChecksum:'1'.repeat(64),finalChecksum:'2'.repeat(64),retentionChecksum:retained.retention.checksum,barrierToken:retained.retention.barrier.token},currentRootAvailable:true,beforeSnapshot:{id:randomUUID(),checksum:'3'.repeat(64),directory:await directoryIdentity(f.backup),data:await directoryIdentity(f.backup)},marker:observeRootAuthority(target,'xuanxiang-app.json',16384)!.proof,controls:{journal:null,request:null},history:[]}
 await writeFile(join(f.boot,`application-restore-${operationId}.json`),JSON.stringify({record,sha256:digest(canonical(record))})+'\n')
 await rename(join(f.boot,tempName),join(f.boot,'data-root.json'))
 const journal=new DraftJournal(path);journal.activate('protected-session')
 const barrier=new ApplicationRestoreDraftBarrier(path,journal,{assertOwner(){}})
 const snapshot=(revision:number)=>({version:1 as const,revision,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{recovery:{version:1,items:applicationDraftRecoveryItems(retained.retention)}},issues:[]})
 return{path,retained,journal,barrier,snapshot}
}
test('AR36-14: actual two checkpoint/barrier contexts are required before durable consumed; later legitimate journal writes remain allowed',{timeout:20000},async()=>{
 const f=await fixture(),child=await armedChild(f)
 try{
  await child.stop();const cold=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options),handle=await cold.beginExecution(f.owner,child.operationId),control=await committedControl(f,child.operationId)
  assert.equal((await cold.activated(handle)).phase,'activated')
  const protectedManager=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options)
  assert.equal(protectedManager.startup().mode,'protected')
  const first=await control.journal.persist('protected-session',control.snapshot(2))
  await control.barrier.checkpoint(control.retained.retention.barrier.token,'protected-session',first)
  await assert.rejects(protectedManager.consumed(f.owner,child.operationId,control.journal,'protected-session',first),{code:'FIRST_CHECKPOINT_REQUIRED'})
  await assert.rejects(protectedManager.recordFirstCheckpoint(f.owner,child.operationId,control.journal,'wrong-owner',first),{code:'CHECKPOINT_UNCONFIRMED'})
  await protectedManager.recordFirstCheckpoint(f.owner,child.operationId,control.journal,'protected-session',first)
  await assert.rejects(protectedManager.consumed(f.owner,child.operationId,control.journal,'protected-session',first),{code:'SECOND_CHECKPOINT_REQUIRED'})
  const second=await control.journal.persist('protected-session',control.snapshot(3));await control.barrier.acknowledge(control.retained.retention.barrier.token,'protected-session',second)
  assert.equal((await protectedManager.consumed(f.owner,child.operationId,control.journal,'protected-session',second)).phase,'consumed')
  assert.equal(new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options).startup().mode,'normal')
  await control.journal.persist('protected-session',{...control.snapshot(4),sources:{chat:{draft:'恢复后的新输入'}}})
  assert.equal(new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options).startup().mode,'normal','historical consumed attestations must not freeze future ordinary drafts')
 }finally{await child.stop();await f.close()}
})
test('AR36-15: executing restart with committed pointer is read-only protected inspection; it does not reissue a handle or activation',{timeout:20000},async()=>{
 const f=await fixture(),child=await armedChild(f)
 try{
  await child.stop();const cold=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options)
  await cold.beginExecution(f.owner,child.operationId);await committedControl(f,child.operationId)
  const requestPath=join(f.boot,'application-recovery-request.json'),before=await readFile(requestPath),manager=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options)
  assert.equal(manager.startup().mode,'protected');assert.equal(manager.inspect().request?.phase,'executing')
  await assert.rejects(manager.beginExecution(f.owner,child.operationId),{code:'PHASE_INVALID'})
  await assert.rejects(manager.activated({operationId:child.operationId,attemptId:randomUUID(),assertCurrent(){}}),{code:'ATTEMPT_EXPIRED'})
  assert.deepEqual(await readFile(requestPath),before)
 }finally{await child.stop();await f.close()}
})
test('AR36-16: lost/old-session attestation stays protected; only two newer actual contexts in the new session can consume',{timeout:30000},async t=>{
 for(const mode of['complete-missing','complete-old-session','checkpointed-old-session'] as const)await t.test(mode,async()=>{
  const f=await fixture(),child=await armedChild(f)
  try{
   await child.stop();const cold=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options),handle=await cold.beginExecution(f.owner,child.operationId),control=await committedControl(f,child.operationId)
   await cold.activated(handle)
   const originalFirst=await control.journal.persist('protected-session',control.snapshot(2));await control.barrier.checkpoint(control.retained.retention.barrier.token,'protected-session',originalFirst)
   if(mode!=='complete-missing')await cold.recordFirstCheckpoint(f.owner,child.operationId,control.journal,'protected-session',originalFirst)
   let minimum=2
   if(mode!=='checkpointed-old-session'){const originalSecond=await control.journal.persist('protected-session',control.snapshot(3));await control.barrier.acknowledge(control.retained.retention.barrier.token,'protected-session',originalSecond);minimum=3}
   const barrierPath=join(control.path,'application-restore-drafts.json'),completeBytes=await readFile(barrierPath),owner=randomUUID(),options={...f.options,assertOwner(value:string){if(value!==owner)throw Error('old main window')}}
   const manager=new ApplicationRestoreRequests(await directoryIdentity(f.boot),options),journal=new DraftJournal(control.path);journal.activate('new-real-session')
   assert.equal(manager.startup().mode,'protected')
   const first=await journal.persist('new-real-session',control.snapshot(minimum+1))
   await assert.rejects(manager.recordFirstCheckpoint(f.owner,child.operationId,journal,'new-real-session',first),{code:'OWNER_EXPIRED'})
   await assert.rejects(manager.consumed(owner,child.operationId,journal,'protected-session',first))
   const recorded=await manager.recordFirstCheckpoint(owner,child.operationId,journal,'new-real-session',first)
   assert.equal(recorded.firstCheckpoint?.kind,mode==='checkpointed-old-session'?'checkpointed-session-restart':'completed-barrier-restart')
   await assert.rejects(manager.consumed(owner,child.operationId,journal,'new-real-session',first),{code:'SECOND_CHECKPOINT_REQUIRED'})
   const second=await journal.persist('new-real-session',control.snapshot(minimum+2))
   if(mode==='checkpointed-old-session')await new ApplicationRestoreDraftBarrier(control.path,journal,{assertOwner(){}}).acknowledge(control.retained.retention.barrier.token,'new-real-session',second)
   else assert.deepEqual(await readFile(barrierPath),completeBytes,'complete core token, inode and old receipts remain original bytes')
   assert.equal((await manager.consumed(owner,child.operationId,journal,'new-real-session',second)).phase,'consumed')
   if(mode!=='checkpointed-old-session')assert.deepEqual(await readFile(barrierPath),completeBytes)
   assert.equal(manager.startup().mode,'normal')
  }finally{await child.stop();await f.close()}
 })
})
test('AR36-17: journal inode replacement during checkpoint publish cannot consume or invent an attestation',{timeout:20000},async()=>{
 let checkpointPath:string|undefined,replace=false
 const f=await fixture({writeHooks:{async beforeRename(kind){if(kind==='request'&&replace&&checkpointPath){replace=false;const bytes=await readFile(checkpointPath);await rename(checkpointPath,checkpointPath+'.preserved');await writeFile(checkpointPath,bytes)}}}}),child=await armedChild(f)
 try{
  await child.stop();const cold=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options),handle=await cold.beginExecution(f.owner,child.operationId),control=await committedControl(f,child.operationId)
  await cold.activated(handle);const first=await control.journal.persist('protected-session',control.snapshot(2));await control.barrier.checkpoint(control.retained.retention.barrier.token,'protected-session',first)
  checkpointPath=join(control.path,'drafts.json');replace=true
  await assert.rejects(cold.recordFirstCheckpoint(f.owner,child.operationId,control.journal,'protected-session',first),{code:'RECORD_CHANGED'})
  assert.equal(new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options).startup().mode,'cold')
  assert((await readdir(control.path)).includes('drafts.json.preserved'))
 }finally{await child.stop();await f.close()}
})
test('AR36-18: actual core restore evidence with every handoff file missing blocks startup even without an external pending flag',{timeout:20000},async()=>{
 const f=await fixture(),child=await armedChild(f)
 try{
  await child.stop();const cold=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options)
  await cold.beginExecution(f.owner,child.operationId);await committedControl(f,child.operationId)
  for(const name of await readdir(f.boot))if(name.startsWith('application-recovery-'))await rm(join(f.boot,name))
  const restarted=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options)
  assert.deepEqual(restarted.startup(),{mode:'cold',code:'HISTORY_INCOMPLETE'})
  await assert.rejects(restarted.prepare(f.owner,f.selection),{code:'HISTORY_INCOMPLETE'})
  assert.equal((await readdir(f.boot)).filter(name=>name.startsWith('application-recovery-')).length,0)
 }finally{await child.stop();await f.close()}
})
test('AR36-19: metadata gate covers actual first-context confirmation and every attestation write; flush waits the whole gated flight',{timeout:20000},async()=>{
 const entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>();let gated=false
 const f=await fixture({async withWrite(run){gated=true;entered.resolve();await resume.promise;return run()}}),child=await armedChild(f)
 let cold:ApplicationRestoreRequests|undefined
 try{
  await child.stop();cold=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options)
  const handle=await cold.beginExecution(f.owner,child.operationId),control=await committedControl(f,child.operationId)
  await cold.activated(handle)
  const first=await control.journal.persist('protected-session',control.snapshot(2));await control.barrier.checkpoint(control.retained.retention.barrier.token,'protected-session',first)
  const before=await readFile(join(f.boot,'application-recovery-request.json')),recording=cold.recordFirstCheckpoint(f.owner,child.operationId,control.journal,'protected-session',first)
  await entered.promise;assert.equal(gated,true);assert.deepEqual(await readFile(join(f.boot,'application-recovery-request.json')),before)
  let flushed=false;const flush=cold.flush().then(()=>{flushed=true});await new Promise(setImmediate);assert.equal(flushed,false)
  await assert.rejects(cold.consumed(f.owner,child.operationId,control.journal,'protected-session',first),{code:'APPLICATION_RESTORE_REQUEST_BUSY'})
  resume.resolve();assert((await recording).firstCheckpoint);await flush;assert.equal(flushed,true)
 }finally{resume.resolve();await cold?.flush();await child.stop();await f.close()}
})
test('AR36-20: every phase strictly admits only its own fields and consumed witnesses agree in kind/session/recovery and both revisions',{timeout:15000},async()=>{
 const f=await fixture()
 try{
  const{history:_history,...base}=await f.manager.prepare(f.owner,f.selection),execution={attemptId:randomUUID(),ownerNonce:f.owner,process:base.oldProcess}
  const file=base.sourcePointerFile,activation={receiptId:base.operationId,receiptFile:file,pointer:base.source,pointerFile:file,candidateId:randomUUID(),barrierToken:randomUUID()}
  const first={kind:'first-checkpoint' as const,receipt:{revision:1,digest:'1'.repeat(64),clientRevision:2},sessionId:randomUUID(),journalFile:file,retentionFile:file,snapshotChecksum:'1'.repeat(64),recoveryChecksum:'2'.repeat(64)}
  const second={...first,receipt:{revision:2,digest:'3'.repeat(64),clientRevision:3},snapshotChecksum:'3'.repeat(64)}
  const extras={execution,activation,firstCheckpoint:first,secondCheckpoint:second,reason:'CONTROL_UNCERTAIN' as const}
  const states={prepared:base,armed:{...base,phase:'armed'},executing:{...base,phase:'executing',execution},unknown:{...base,phase:'unknown',execution,reason:extras.reason},activated:{...base,phase:'activated',execution,activation},consumed:{...base,phase:'consumed',execution,activation,firstCheckpoint:first,secondCheckpoint:second},cancelled:{...base,phase:'cancelled'}}
  for(const state of Object.values(states))assert.equal(applicationRestoreRequestBodySchema.safeParse(state).success,true,`${state.phase} valid baseline`)
  assert.equal(applicationRestoreRequestBodySchema.safeParse({...states.cancelled,execution}).success,true,'settled execution cancellation retains only its actual execution')
  for(const phase of['prepared','armed'] as const)for(const[field,value]of Object.entries(extras))assert.equal(applicationRestoreRequestBodySchema.safeParse({...states[phase],[field]:value}).success,false,`${phase} forbids ${field}`)
  const forbidden={executing:['secondCheckpoint','reason'],unknown:['secondCheckpoint'],activated:['secondCheckpoint','reason'],consumed:['reason'],cancelled:['activation','firstCheckpoint','secondCheckpoint','reason']} as const
  for(const[phase,fields]of Object.entries(forbidden))for(const field of fields)assert.equal(applicationRestoreRequestBodySchema.safeParse({...states[phase as keyof typeof states],[field]:extras[field]}).success,false,`${phase} forbids ${field}`)
  const required={executing:['execution'],unknown:['execution','reason'],activated:['execution','activation'],consumed:['execution','activation','firstCheckpoint','secondCheckpoint']} as const
  for(const[phase,fields]of Object.entries(required))for(const field of fields)assert.equal(applicationRestoreRequestBodySchema.safeParse({...states[phase as keyof typeof states],[field]:undefined}).success,false,`${phase} requires ${field}`)
  assert.equal(applicationRestoreRequestBodySchema.safeParse({...states.executing,firstCheckpoint:first}).success,false,'attestation requires activation proof')
  for(const altered of[{...second,kind:'completed-barrier-restart'},{...second,sessionId:randomUUID()},{...second,recoveryChecksum:'4'.repeat(64)},{...second,receipt:{...second.receipt,revision:1}},{...second,receipt:{...second.receipt,clientRevision:2}}])assert.equal(applicationRestoreRequestBodySchema.safeParse({...states.consumed,secondCheckpoint:altered}).success,false,'consumed pair is one ordered actual context')
 }finally{await f.close()}
})
test('AR36-21: an actual committed unknown result consumes through two actual checkpoints while preserving the reason only in immutable history',{timeout:20000},async()=>{
 const f=await fixture(),child=await armedChild(f)
 try{
  await child.stop();const cold=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options),handle=await cold.beginExecution(f.owner,child.operationId),control=await committedControl(f,child.operationId)
  const unknown=await cold.unknown(handle,'COMMIT_UNCERTAIN');assert.equal(unknown.reason,'COMMIT_UNCERTAIN');assert.equal(cold.startup().mode,'protected')
  const first=await control.journal.persist('protected-session',control.snapshot(2));await control.barrier.checkpoint(control.retained.retention.barrier.token,'protected-session',first)
  await cold.recordFirstCheckpoint(f.owner,child.operationId,control.journal,'protected-session',first)
  const second=await control.journal.persist('protected-session',control.snapshot(3));await control.barrier.acknowledge(control.retained.retention.barrier.token,'protected-session',second)
  const consumed=await cold.consumed(f.owner,child.operationId,control.journal,'protected-session',second);assert.equal(consumed.phase,'consumed');assert.equal(consumed.reason,undefined)
  const reasonRecord=JSON.parse(await readFile(join(f.boot,unknown.history.at(-1)!.name),'utf8'));assert.equal(reasonRecord.record.request.reason,'COMMIT_UNCERTAIN')
  assert.equal(new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options).startup().mode,'normal')
 }finally{await child.stop();await f.close()}
})
test('AR36-22: prepared cancellation cannot acquire an executing identity through a checksummed phase rewrite',{timeout:15000},async()=>{
 const f=await fixture()
 try{
  const prepared=await f.manager.prepare(f.owner,f.selection);await f.manager.cancelPrepared(f.owner,prepared.operationId)
  const path=join(f.boot,'application-recovery-request.json'),head=JSON.parse(await readFile(path,'utf8')),operation=head.state.operations[0],tail=operation.history.at(-1),phasePath=join(f.boot,tail.name),phase=JSON.parse(await readFile(phasePath,'utf8'))
  const execution={attemptId:randomUUID(),ownerNonce:f.owner,process:prepared.oldProcess};phase.record.request.execution=execution;phase.checksum=digest(canonical(phase.record));await writeFile(phasePath,JSON.stringify(phase)+'\n')
  operation.execution=execution;tail.file=observeRootAuthority(await directoryIdentity(f.boot),tail.name,256*1024)!.proof;head.checksum=digest(canonical(head.state));await writeFile(path,JSON.stringify(head)+'\n')
  const before=await readFile(path),startup=new ApplicationRestoreRequests(await directoryIdentity(f.boot),f.options).startup();assert.deepEqual(startup,{mode:'cold',code:'HISTORY_CHANGED'});assert.deepEqual(await readFile(path),before)
 }finally{await f.close()}
})
test('AR36-23: append chronology rejects reversed predecessors, reordered operations and interleaved operations despite complete revision sets',{timeout:20000},async t=>{
 for(const mode of['predecessor','operation-order','interleaved'] as const)await t.test(mode,async()=>{
  const f=await fixture()
  try{
   const prepared=await f.manager.prepare(f.owner,f.selection)
   if(mode==='predecessor')await f.manager.arm(f.owner,prepared.operationId)
   else{await f.manager.cancelPrepared(f.owner,prepared.operationId);const next=await f.manager.prepare(f.owner,f.selection);await f.manager.cancelPrepared(f.owner,next.operationId)}
   const path=join(f.boot,'application-recovery-request.json'),head=JSON.parse(await readFile(path,'utf8')),boot=await directoryIdentity(f.boot)
   const rewrite=async(operation:typeof head.state.operations[number],revisions:number[])=>{
    let previous=null
    for(let index=0;index<operation.history.length;index++){
     const witness=operation.history[index],phasePath=join(f.boot,witness.name),phase=JSON.parse(await readFile(phasePath,'utf8'))
     phase.record.revision=revisions[index];phase.record.previous=previous;phase.checksum=digest(canonical(phase.record));await writeFile(phasePath,JSON.stringify(phase)+'\n')
     witness.file=observeRootAuthority(boot,witness.name,256*1024)!.proof;previous=structuredClone(witness)
    }
   }
   if(mode==='predecessor')await rewrite(head.state.operations[0],[2,1])
   else if(mode==='operation-order')head.state.operations.reverse()
   else{await rewrite(head.state.operations[0],[1,3]);await rewrite(head.state.operations[1],[2,4])}
   head.checksum=digest(canonical(head.state));await writeFile(path,JSON.stringify(head)+'\n');const before=await readFile(path)
   assert.deepEqual(new ApplicationRestoreRequests(boot,f.options).startup(),{mode:'cold',code:'HISTORY_INCOMPLETE'},mode)
   assert.deepEqual(await readFile(path),before)
  }finally{await f.close()}
 })
})
