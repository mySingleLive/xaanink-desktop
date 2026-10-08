import assert from 'node:assert/strict'
import {test} from 'node:test'
import {BusinessGate} from '../../desktop/main/business-gate'
const deferred=()=>Promise.withResolvers<void>()
test('closing admission waits for actual in-flight IPC completion and rejects new writes',async()=>{
 const gate=new BusinessGate(),finish=deferred(),entered=deferred();let stopped=false
 const work=gate.run(async()=>{entered.resolve();await finish.promise;return 42});await entered.promise
 const drain=gate.close().then(()=>{stopped=true});await Promise.resolve();assert.equal(stopped,false)
 await assert.rejects(gate.run(async()=>1),/BUSINESS_CLOSED/);finish.resolve();assert.equal(await work,42);await drain;assert.equal(stopped,true);assert.equal(gate.closed,true)
})
test('failed work drains, repeated close shares ownership, reopening while draining fails',async()=>{
 const gate=new BusinessGate(),finish=deferred();const work=gate.run(async()=>{await finish.promise;throw Error('write failed')});const rejected=assert.rejects(work,/write failed/)
 const drain=gate.close();assert.equal(gate.close(),drain);assert.throws(()=>gate.reopen(),/BUSINESS_DRAINING/)
 finish.resolve();await rejected;await drain;gate.reopen();assert.equal(gate.closed,false);assert.equal(await gate.run(async()=>7),7)
})
test('synchronous throw releases pending ownership without unhandled internal rejection',async()=>{
 const gate=new BusinessGate();await assert.rejects(gate.run(()=>{throw Error('bad')}),/bad/);await gate.close();gate.reopen();assert.equal(await gate.run(()=>Promise.resolve('ok')),'ok')
})
