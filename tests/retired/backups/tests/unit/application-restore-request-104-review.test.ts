import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,realpath,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {canonical,digest} from '../../desktop/core/application-backup-files'
import {observeRootAuthority} from '../../desktop/core/root-authority'
import {ApplicationRestoreRequests,type ApplicationRestoreRequestOptions} from '../../desktop/main/application-restore-request'

async function fixture(overrides:Partial<ApplicationRestoreRequestOptions>={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review104-request-'))),boot=join(base,'bootstrap'),source=join(base,'source'),backup=join(base,'backup'),parent=join(base,'parent'),appId=randomUUID(),backupId=randomUUID(),owner=randomUUID()
 for(const path of[boot,source,backup,parent])await mkdir(path)
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}))
 await writeFile(join(boot,'data-root.json'),JSON.stringify({schemaVersion:1,revision:1,rootId:appId,migrationId:null,root:await directoryIdentity(source)})+'\n')
 const body={format:'xuanxiang-application-backup',schemaVersion:1,id:backupId,appId,createdAt:'2026-10-08T00:00:00.000Z',phase:'verified',engine:{pglite:'0.5.8',postgresMajor:17},files:[],directories:[],bytes:0}
 await writeFile(join(backup,'xuanxiang-app-backup.json'),JSON.stringify({...body,checksum:digest(canonical(body))}))
 const selection={backup:{directory:await directoryIdentity(backup),backupId},parent:await directoryIdentity(parent)},options:ApplicationRestoreRequestOptions={assertStableLock(){},assertOwner(value){assert.equal(value,owner)},assertQuiesced(){},assertOldProcessExited(){},assertCold(){},assertExecutionSettled(){},inspectPendingEvidence(){return{operationIds:[],unknown:false}},...overrides},bootstrap=await directoryIdentity(boot)
 return{base,boot,source,parent,owner,selection,options,bootstrap,manager:new ApplicationRestoreRequests(bootstrap,options),close:()=>rm(base,{recursive:true,force:true})}
}

async function actualOldProcess(f:Awaited<ReturnType<typeof fixture>>){
 const script=`import {ApplicationRestoreRequests} from ${JSON.stringify(join(process.cwd(),'desktop/main/application-restore-request.ts'))};import {directoryIdentity} from ${JSON.stringify(join(process.cwd(),'desktop/core/root-ownership.ts'))};import {once} from 'node:events';const owner=${JSON.stringify(f.owner)},manager=new ApplicationRestoreRequests(await directoryIdentity(${JSON.stringify(f.boot)}),{assertStableLock(){},assertOwner(n){if(n!==owner)throw Error('owner')},assertQuiesced(){},assertOldProcessExited(){},assertCold(){},assertExecutionSettled(){},inspectPendingEvidence(){return{operationIds:[],unknown:false}}});const request=await manager.prepare(owner,${JSON.stringify(f.selection)});await manager.arm(owner,request.operationId);process.stdout.write(JSON.stringify({operationId:request.operationId,pid:process.pid})+String.fromCharCode(10));process.stdin.resume();await once(process.stdin,'data');process.stdin.pause();`
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']}),exit=once(child,'exit');let output='',errors='',stopped=false
 child.stderr.on('data',data=>{errors+=data})
 const info=await new Promise<{operationId:string;pid:number}>((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(Error('isolated handoff child timeout'))},8000);child.stdout.on('data',data=>{output+=data;if(output.includes('\n')){clearTimeout(timeout);try{resolve(JSON.parse(output.split('\n')[0]))}catch(cause){reject(cause)}}});child.once('error',cause=>{clearTimeout(timeout);reject(cause)});child.once('exit',()=>{clearTimeout(timeout);if(!output.includes('\n'))reject(Error('isolated handoff child failed: '+errors))})})
 return{...info,async stop(){if(stopped)return;stopped=true;child.stdin.end('exit');const[code]=await exit;assert.equal(code,0,errors)}}
}

test('AR104-R01 replacing the public options object cannot resurrect a revoked original native execution owner',{timeout:15000},async()=>{
 let live=true
 const f=await fixture({assertOwner(){if(!live)throw Error('actual owner expired')}}),child=await actualOldProcess(f)
 try{
  await child.stop();const manager=new ApplicationRestoreRequests(f.bootstrap,f.options),handle=await manager.beginExecution(f.owner,child.operationId);handle.assertCurrent();const before=await readFile(join(f.boot,'application-recovery-request.json'))
  live=false;assert.throws(()=>handle.assertCurrent(),{code:'OWNER_EXPIRED'})
  Object.defineProperty(manager,'options',{value:Object.freeze({...manager.options,assertOwner(){}})})
  assert.throws(()=>handle.assertCurrent(),{code:'OWNER_EXPIRED'},'private execution proof must retain the originally captured native owner check')
  assert.deepEqual(await readFile(join(f.boot,'application-recovery-request.json')),before)
 }finally{await child.stop();await f.close()}
})

test('AR104-R02 prepared and armed old-live-process states remain inert; after physical exit executing and unknown restarts only inspect',{timeout:15000},async()=>{
 const f=await fixture(),child=await actualOldProcess(f)
 try{
  const live=new ApplicationRestoreRequests(f.bootstrap,f.options);assert.equal(live.startup().mode,'execute-ready');await assert.rejects(live.beginExecution(f.owner,child.operationId),{code:'SOURCE_PROCESS_ACTIVE'});await child.stop()
  const manager=new ApplicationRestoreRequests(f.bootstrap,f.options),handle=await manager.beginExecution(f.owner,child.operationId)
  for(const phase of['executing','unknown']){
   if(phase==='unknown')await manager.unknown(handle,'WORKER_EXIT')
   const before=await readFile(join(f.boot,'application-recovery-request.json')),names=await readdir(f.boot),restart=new ApplicationRestoreRequests(f.bootstrap,f.options)
   for(let i=0;i<3;i++){assert.equal(restart.startup().mode,'cold');assert.equal(restart.inspect().request?.phase,phase)}
   await assert.rejects(restart.beginExecution(f.owner,child.operationId),{code:'PHASE_INVALID'});await assert.rejects(restart.unknown({...handle}),{code:'ATTEMPT_EXPIRED'});assert.deepEqual(await readFile(join(f.boot,'application-recovery-request.json')),before);assert.deepEqual(await readdir(f.boot),names)
  }
 }finally{await child.stop();await f.close()}
})

test('AR104-R03 revocation at physical phase publish cannot be hidden by replacing the caller callbacks; flush waits that IO',{timeout:15000},async()=>{
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let live=true
 const f=await fixture({assertOwner(){if(!live)throw Error('actual native owner expired')},writeHooks:{async beforeRename(kind){if(kind==='phase'){entered.resolve();await release.promise}}}}),operation=f.manager.prepare(f.owner,f.selection)
 try{
  await entered.promise;let flushed=false;const flush=f.manager.flush().then(()=>{flushed=true});await new Promise(setImmediate);assert.equal(flushed,false);live=false;f.options.assertOwner=()=>{};release.resolve();await assert.rejects(operation,{code:'OWNER_EXPIRED'});await flush;assert.equal(flushed,true);assert.deepEqual((await readdir(f.boot)).filter(name=>name.startsWith('application-recovery-')),[])
 }finally{release.resolve();await operation.catch(()=>{});await f.manager.flush();await f.close()}
})

test('AR104-R04 a checksummed armed history containing premature execution authority is invalid data and must remain cold',{timeout:15000},async()=>{
 const f=await fixture(),child=await actualOldProcess(f)
 try{
  await child.stop();const path=join(f.boot,'application-recovery-request.json'),head=JSON.parse(await readFile(path,'utf8')),operation=head.state.operations[0],tail=operation.history.at(-1),phasePath=join(f.boot,tail.name),phase=JSON.parse(await readFile(phasePath,'utf8')),execution={attemptId:randomUUID(),ownerNonce:f.owner,process:{pid:process.pid,instanceNonce:randomUUID(),startedAt:'2026-10-08T00:00:00.000Z'}}
  phase.record.request.execution=execution;phase.checksum=digest(canonical(phase.record));await writeFile(phasePath,JSON.stringify(phase)+'\n');operation.execution=execution;tail.file=observeRootAuthority(f.bootstrap,tail.name,256*1024)!.proof;head.checksum=digest(canonical(head.state));await writeFile(path,JSON.stringify(head)+'\n');const before=await readFile(path)
  const restart=new ApplicationRestoreRequests(f.bootstrap,f.options);assert.equal(restart.startup().mode,'cold','armed does not contain an executing attempt; schema/checksum alone must not normalize that malformed phase');assert.deepEqual(await readFile(path),before)
 }finally{await child.stop();await f.close()}
})

test('AR104-R05 a complete checksummed predecessor chain cannot reverse the actual append-only phase revisions',{timeout:15000},async()=>{
 const f=await fixture(),child=await actualOldProcess(f)
 try{
  await child.stop();const path=join(f.boot,'application-recovery-request.json'),head=JSON.parse(await readFile(path,'utf8')),operation=head.state.operations[0],first=operation.history[0],last=operation.history[1],firstPath=join(f.boot,first.name),lastPath=join(f.boot,last.name),prepared=JSON.parse(await readFile(firstPath,'utf8')),armed=JSON.parse(await readFile(lastPath,'utf8'))
  assert.equal(prepared.record.revision,1);assert.equal(armed.record.revision,2);prepared.record.revision=2;prepared.checksum=digest(canonical(prepared.record));await writeFile(firstPath,JSON.stringify(prepared)+'\n');first.file=observeRootAuthority(f.bootstrap,first.name,256*1024)!.proof;armed.record.revision=1;armed.record.previous=structuredClone(first);armed.checksum=digest(canonical(armed.record));await writeFile(lastPath,JSON.stringify(armed)+'\n');last.file=observeRootAuthority(f.bootstrap,last.name,256*1024)!.proof;head.checksum=digest(canonical(head.state));await writeFile(path,JSON.stringify(head)+'\n');const before=await readFile(path)
  assert.equal(new ApplicationRestoreRequests(f.bootstrap,f.options).startup().mode,'cold','the latest armed phase cannot have a lower revision than its prepared predecessor');assert.deepEqual(await readFile(path),before)
 }finally{await child.stop();await f.close()}
})
