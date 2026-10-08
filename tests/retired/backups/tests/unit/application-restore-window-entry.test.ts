import assert from 'node:assert/strict'
import {test} from 'node:test'
import {applicationRestoreEntryCommandSchema,applicationRestoreEntryStateSchema} from '../../desktop/shared/application-restore-entry'
import {ApplicationRestoreEntryController} from '../../desktop/main/application-restore-window'
import type {ApplicationRestoreEntryControllerOptions} from '../../desktop/main/application-restore-window'
import {entryFixture,armedEntryChild} from '../fixtures/application-restore-entry'
import {readFile,readdir,writeFile,rename} from 'node:fs/promises'
import {join} from 'node:path'
function options(f:Awaited<ReturnType<typeof entryFixture>>,changes:Partial<ApplicationRestoreEntryControllerOptions>={}):ApplicationRestoreEntryControllerOptions{return{bootstrap:f.bootstrap,ownerNonce:f.owner,reason:'bad-db',theme:'paper',platform:'darwin',migrationsPath:'/unused',assertStableLock(){},assertOwner(){},assertCold(){},chooseBackup:async()=>f.backup,chooseParent:async()=>f.parent,confirmPreparation:async()=>false,confirmActivation:async()=>false,startWorker(){throw Error('must not start')},closePrepared:async()=>{},exit:async()=>{},menu(){},...changes}}
test('ENTRY36-C03 native picker cancellation and late completion after quit write no request/layout; exit waits picker settlement',{timeout:15000},async()=>{
 const f=await entryFixture()
 try{
  const pick=Promise.withResolvers<string|null>();let exited=0
  const controller=new ApplicationRestoreEntryController(options(f,{chooseBackup:async()=>null}));await controller.command({type:'choose-backup'});assert.equal(controller.state().backup,null)
  const pending=new ApplicationRestoreEntryController(options(f,{chooseBackup:()=>pick.promise,exit:async()=>{exited++}})),flight=pending.command({type:'choose-backup'});void flight.catch(()=>{});await Promise.resolve()
  const quit=pending.command({type:'quit'});await Promise.resolve();assert.equal(exited,0);pick.resolve(f.backup);await assert.rejects(flight);await quit;assert.equal(exited,1)
  assert.deepEqual((await readdir(f.boot)).filter(name=>name.includes('recovery')),[]);assert.deepEqual(await readdir(f.parent),[])
 }finally{await f.close()}
})
test('ENTRY36-C04 real armed old PID cannot run while alive; actual exited worker is required before cancellation writes audit',{timeout:20000},async()=>{
 const f=await entryFixture(),child=await armedEntryChild(f)
 try{
  let calls=0;const done=Promise.withResolvers<{type:'failed';code:string}>(),exit=Promise.withResolvers<number>(),entered=Promise.withResolvers<void>();let fence:SharedArrayBuffer|undefined
  const controller=new ApplicationRestoreEntryController(options(f,{reason:'handoff',startWorker(input){calls++;fence=input.revocation;entered.resolve();return{result:done.promise,exit:exit.promise,cancel(){}}}}))
  assert.equal(controller.state().canContinue,false);await assert.rejects(controller.command({type:'continue',operationId:child.operationId}));assert.equal(calls,0)
  await child.stop();await controller.command({type:'inspect'});const flight=controller.command({type:'continue',operationId:child.operationId});void flight.catch(()=>{});await entered.promise
  const cancellation=controller.command({type:'cancel',operationId:child.operationId});assert.equal(Atomics.load(new Int32Array(fence!),0),1);done.resolve({type:'failed',code:'OPERATION_CANCELLED'});await Promise.resolve();await Promise.resolve()
  assert.equal(f.manager().inspect().request?.phase,'executing');exit.resolve(0);await flight;await cancellation;assert.equal(JSON.parse(await readFile(join(f.boot,'application-recovery-request.json'),'utf8')).state.operations.find((row:{operationId:string})=>row.operationId===child.operationId).phase,'cancelled');assert.equal(f.manager().inspect().mode,'normal')
 }finally{await child.stop();await f.close()}
})
test('ENTRY36-C05 failed worker result still waits physical exit and records unknown; quit cannot race suspended worker IO',{timeout:20000},async()=>{
 const f=await entryFixture(),child=await armedEntryChild(f);await child.stop()
 try{
  const result=Promise.withResolvers<never>(),exit=Promise.withResolvers<number>(),entered=Promise.withResolvers<void>();let exited=0
  const controller=new ApplicationRestoreEntryController(options(f,{reason:'handoff',startWorker(){entered.resolve();return{result:result.promise,exit:exit.promise,cancel(){}}},exit:async()=>{exited++}})),flight=controller.command({type:'continue',operationId:child.operationId});void flight.catch(()=>{});await entered.promise
  result.reject(Error('worker result stream failed'));const quit=controller.command({type:'quit'});void quit.catch(()=>{});await Promise.resolve();await Promise.resolve();assert.equal(exited,0)
  exit.resolve(0);await flight;await quit;assert.equal(exited,1);assert.equal(f.manager().inspect().request?.phase,'unknown')
 }finally{await f.close()}
})
test('ENTRY36-C06 committed-layout loss, orphan intention and bad-db reason cannot expose locate or fresh selection',{timeout:15000},async()=>{
 const f=await entryFixture()
 try{
  const bad=new ApplicationRestoreEntryController(options(f,{reason:'bad-db',locateAvailable:true}));assert.equal(bad.state().canLocate,false)
  const stale=new ApplicationRestoreEntryController(options(f,{reason:'lost',locateAvailable:true}));assert.equal(stale.state().canLocate,false)
  await rename(f.source,f.source+'.preserved');const lost=new ApplicationRestoreEntryController(options(f,{reason:'lost',locateAvailable:true}));assert.equal(lost.state().canLocate,true)
  await writeFile(join(f.boot,'desktop-recovery-layout-foreign.json'),'unbound evidence');const unknown=new ApplicationRestoreEntryController(options(f,{reason:'lost',locateAvailable:true}));assert.equal(unknown.state().canChooseBackup,false);assert.equal(unknown.state().canLocate,false)
 }finally{await f.close()}
})
test('ENTRY36-C08 actual orphan or invalid draft protection evidence blocks fresh bad-db backup selection',{timeout:15000},async()=>{
 const f=await entryFixture()
 try{
  await writeFile(join(f.source,'application-restore-drafts.json'),'invalid protection bytes must be retained')
  const controller=new ApplicationRestoreEntryController(options(f,{reason:'bad-db'}));assert.equal(controller.state().canChooseBackup,false);assert.equal(controller.state().canContinue,false)
  await assert.rejects(controller.command({type:'choose-backup'}));assert.equal(await readFile(join(f.source,'application-restore-drafts.json'),'utf8'),'invalid protection bytes must be retained')
 }finally{await f.close()}
})
test('ENTRY36-C01 renderer command vocabulary rejects paths, nonce, confirmation and arbitrary menu content',{timeout:10000},()=>{
 for(const value of[{type:'continue',operationId:'not-id'},{type:'quit',path:'/tmp/a'},{type:'choose-backup',accepted:true},{type:'menu',items:[]},{type:'continue',operationId:'e178dfd6-e748-4d8e-8a4d-a7249b603329',nonce:'forged'}])assert.equal(applicationRestoreEntryCommandSchema.safeParse(value).success,false)
 assert.equal(applicationRestoreEntryCommandSchema.safeParse({type:'inspect'}).success,true)
 assert.equal(typeof ApplicationRestoreEntryController,'function')
})
test('ENTRY36-C02 display state is bounded and has no opaque producer, execution or credential payload',{timeout:10000},()=>{
 const state={version:1,revision:1,theme:'paper',platform:'darwin',phase:'inspection',operationId:null,sourcePath:null,targetPath:null,backup:null,notice:'inspection-required',canChooseBackup:false,canChooseParent:false,canContinue:false,canCancel:false,canRestart:true,canLocate:false}
 assert.equal(applicationRestoreEntryStateSchema.safeParse(state).success,true)
 for(const extra of[{request:{}},{proof:{}},{apiKey:'never expose'},{attemptId:'opaque'}])assert.equal(applicationRestoreEntryStateSchema.safeParse({...state,...extra}).success,false)
})
