import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {ApplicationRestoreEntryController,type ApplicationRestoreEntryControllerOptions} from '../../desktop/main/application-restore-window'
import type {ApplicationRestoreActivationPreview} from '../../desktop/core/application-restore-activation'
import {entryFixture,armedEntryChild} from '../fixtures/application-restore-entry'

// Real FS request/layout and a real departed old Node PID. The restoration
// worker result/exit and native window callbacks are explicit lifecycle doubles;
// these tests cannot establish physical Electron/PG activation success.
function options(f:Awaited<ReturnType<typeof entryFixture>>,changes:Partial<ApplicationRestoreEntryControllerOptions>={}):ApplicationRestoreEntryControllerOptions{return{bootstrap:f.bootstrap,ownerNonce:f.owner,reason:'handoff',theme:'paper',platform:'darwin',migrationsPath:'/unused',assertStableLock(){},assertOwner(){},assertCold(){},chooseBackup:async()=>null,chooseParent:async()=>null,confirmPreparation:async()=>false,confirmActivation:async()=>false,startWorker(){throw Error('no worker authority')},closePrepared:async()=>{},exit:async()=>{},menu(){},...changes}}

test('AR107-E01 native activation confirmation cannot survive original owner revocation or public callback replacement',{timeout:20000},async()=>{
 const f=await entryFixture(),old=await armedEntryChild(f);await old.stop()
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<boolean>();let live=true,accepted=false,nativeCalls=0
 const host=options(f,{assertOwner(){if(!live)throw Error('original native owner revoked')},async confirmActivation(){nativeCalls++;entered.resolve();return release.promise},startWorker(input,confirm){
  const preview={operationId:input.request.operationId,backupId:input.request.backup.backupId,target:{path:join(input.request.parent.path,'unactivated-candidate')},source:input.request.source} as ApplicationRestoreActivationPreview
  const result=(async()=>{try{accepted=await confirm(preview);return{type:'failed' as const,code:'UNEXPECTED_CONFIRMATION'}}catch{return{type:'failed' as const,code:'OPERATION_CANCELLED'}}})()
  return{result,exit:Promise.resolve(0),cancel(){}}
 }})
 const controller=new ApplicationRestoreEntryController(host),run=controller.command({type:'continue',operationId:old.operationId});void run.catch(()=>{})
 try{
  await entered.promise;const pointer=await readFile(join(f.boot,'data-root.json')),executing=f.manager().inspect().request!,history=await Promise.all(executing.history.map(async row=>({name:row.name,bytes:await readFile(join(f.boot,row.name))})));live=false;host.assertOwner=()=>{};host.confirmActivation=async()=>true;release.resolve(true)
  await run;assert.equal(nativeCalls,1);assert.equal(accepted,false);assert.equal(controller.state().phase,'inspection');assert.equal(controller.state().canContinue,false)
  assert.deepEqual(await readFile(join(f.boot,'data-root.json')),pointer);for(const row of history)assert.deepEqual(await readFile(join(f.boot,row.name)),row.bytes)
  const header=JSON.parse(await readFile(join(f.boot,'application-recovery-request.json'),'utf8'));assert.equal(header.state.operations.find((row:{operationId:string})=>row.operationId===old.operationId).phase,'cancelled','settled private worker may append cancellation audit but cannot activate after native confirmation revocation')
 }finally{release.resolve(false);await run.catch(()=>{});await f.close()}
})

test('AR107-E02 a rejected worker exit observation cannot become settled authority or allow quit after a failed result',{timeout:20000},async()=>{
 const f=await entryFixture(),old=await armedEntryChild(f);await old.stop()
 const entered=Promise.withResolvers<void>(),result=Promise.withResolvers<{type:'failed';code:string}>(),exit=Promise.withResolvers<number>();let quits=0
 const controller=new ApplicationRestoreEntryController(options(f,{startWorker(){entered.resolve();return{result:result.promise,exit:exit.promise,cancel(){}}},async exit(){quits++}})),run=controller.command({type:'continue',operationId:old.operationId});void run.catch(()=>{})
 try{
  await entered.promise;const before=await readFile(join(f.boot,'application-recovery-request.json')),quit=controller.command({type:'quit'});void quit.catch(()=>{})
  result.resolve({type:'failed',code:'WORKER_EXIT'});await Promise.resolve();assert.equal(quits,0);exit.reject(Error('physical exit stream unavailable'))
  await assert.rejects(run,{code:'IO_PENDING'});await assert.rejects(quit,{code:'IO_PENDING'});assert.equal(quits,0);assert.equal(controller.state().phase,'inspection')
  assert.deepEqual(await readFile(join(f.boot,'application-recovery-request.json')),before);assert.equal(f.manager().inspect().request?.phase,'executing')
 }finally{result.resolve({type:'failed',code:'WORKER_EXIT'});exit.resolve(0);await run.catch(()=>{});await f.close()}
})

test('AR107-E03 repeated native quit shares one drain and waits worker result plus physical exit before one exit callback',{timeout:20000},async()=>{
 const f=await entryFixture(),old=await armedEntryChild(f);await old.stop()
 const entered=Promise.withResolvers<void>(),result=Promise.withResolvers<{type:'failed';code:string}>(),exit=Promise.withResolvers<number>();let quits=0,cancels=0
 const controller=new ApplicationRestoreEntryController(options(f,{startWorker(){entered.resolve();return{result:result.promise,exit:exit.promise,cancel(){cancels++}}},async exit(){quits++}})),run=controller.command({type:'continue',operationId:old.operationId});void run.catch(()=>{})
 try{
  await entered.promise;const one=controller.drainRevokedWindow(),two=controller.drainRevokedWindow();assert.equal(one,two);assert.equal(cancels,1)
  result.resolve({type:'failed',code:'WORKER_EXIT'});await Promise.resolve();await Promise.resolve();assert.equal(quits,0);assert.equal(f.manager().inspect().request?.phase,'executing')
  exit.resolve(0);await run;await one;await two;assert.equal(quits,1);assert.equal(f.manager().inspect().request?.phase,'unknown')
 }finally{result.resolve({type:'failed',code:'WORKER_EXIT'});exit.resolve(0);await run.catch(()=>{});await f.close()}
})
