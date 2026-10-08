import assert from 'node:assert/strict'
import {test} from 'node:test'
import {ApplicationRestoreWorkerRuntime} from '../../desktop/service/application-restore-worker'
import {entryFixture,executingEntry} from '../fixtures/application-restore-entry'
test('ENTRY36-W03 actual old PID exited; shared revocation drains suspended physical IO and attempt stays one-shot',{timeout:20000},async()=>{
 const f=await entryFixture()
 try{
  const actual=await executingEntry(f),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),revocation=new SharedArrayBuffer(4);let effects=0,cancelled=false
  const worker=new ApplicationRestoreWorkerRuntime({kind:'application-restore36',request:actual.request,layout:actual.layout,migrationsPath:'/unused-fixture',revocation},{confirm:async()=>true},{async execute(scope){entered.resolve();await release.promise;scope.assertCurrent();effects++;return{receiptId:scope.input.request.operationId,requiresColdStart:true}}})
  const run=worker.run();void run.catch(()=>{});await entered.promise
  const cancellation=worker.cancel().then(()=>{cancelled=true});await Promise.resolve();await Promise.resolve();assert.equal(cancelled,false);assert.equal(worker.settled,false)
  assert.equal(Atomics.load(new Int32Array(revocation),0),1);release.resolve();await assert.rejects(run);await cancellation;assert.equal(worker.settled,true);assert.equal(effects,0)
  await assert.rejects(worker.run(),{code:'WORKER_ALREADY_STARTED'});assert.equal(actual.manager.inspect().request?.phase,'executing')
 }finally{await f.close()}
})
test('ENTRY36-W04 constructor captures input and native callbacks; external replacements cannot change an executing attempt',{timeout:20000},async()=>{
 const f=await entryFixture()
 try{
  const actual=await executingEntry(f),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),originalId=actual.request.operationId,input={kind:'application-restore36' as const,request:actual.request,layout:actual.layout,migrationsPath:'/unused-fixture',revocation:new SharedArrayBuffer(4)},host={confirm:async()=>false};let calls=0
  const worker=new ApplicationRestoreWorkerRuntime(input,host,{async execute(scope){entered.resolve();await release.promise;assert.equal(scope.input.request.operationId,originalId);assert.equal(await scope.host.confirm({} as never),false);calls++;return{receiptId:originalId,requiresColdStart:true}}})
  const run=worker.run();await entered.promise;input.request.operationId='changed';host.confirm=async()=>true;release.resolve();assert.equal((await run).receiptId,originalId);assert.equal(calls,1);await assert.rejects(worker.run(),{code:'WORKER_ALREADY_STARTED'})
 }finally{await f.close()}
})
test('ENTRY36-W01 no raw renderer payload or nonexecuting request can invoke the cold producer',{timeout:15000},async()=>{
 let calls=0
 assert.throws(()=>new ApplicationRestoreWorkerRuntime({request:{phase:'armed'}} as never,{confirm:async()=>true},{execute:async()=>{calls++;return{receiptId:'invalid',requiresColdStart:true}}}))
 assert.equal(calls,0)
})
test('ENTRY36-W02 malformed or pre-revoked SAB never grants a cold worker attempt',{timeout:15000},async()=>{
 for(const revocation of[{},new SharedArrayBuffer(8),new ArrayBuffer(4)])assert.throws(()=>new ApplicationRestoreWorkerRuntime({revocation} as never,{confirm:async()=>true}))
})
