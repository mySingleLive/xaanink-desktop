import assert from 'node:assert/strict'
import {test} from 'node:test'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve))
test('metadata snapshot waits admitted physical writes and blocks later writes until its exact lease releases',async()=>{
 const gate=new ApplicationMetadataGate(),inside=Promise.withResolvers<void>(),leave=Promise.withResolvers<void>(),events:string[]=[]
 const first=gate.write(async()=>{events.push('first');inside.resolve();await leave.promise;events.push('physical-done')});await inside.promise
 let acquired=false;const capture=gate.acquire().then(id=>{acquired=true;events.push('captured');return id})
 const late=gate.write(async()=>{events.push('late');return 42});await tick();assert.equal(acquired,false);assert.deepEqual(events,['first'])
 leave.resolve();await first;const id=await capture;await tick();assert.deepEqual(events,['first','physical-done','captured'])
 assert.throws(()=>gate.release('wrong'),/LEASE/);await tick();assert.equal(events.includes('late'),false)
 gate.release(id);assert.equal(await late,42);assert.deepEqual(events,['first','physical-done','captured','late'])
})
test('write failure drains, duplicate captures reject, late releases cannot unfreeze another capture',async()=>{
 const gate=new ApplicationMetadataGate();await assert.rejects(gate.write(async()=>{throw Error('actual write failure')}),/actual/)
 const first=await gate.acquire();await assert.rejects(gate.acquire(),/ACTIVE/);gate.release(first)
 const second=await gate.acquire();assert.notEqual(second,first);assert.throws(()=>gate.release(first),/LEASE/)
 let written=false;const pending=gate.write(async()=>{written=true});await tick();assert.equal(written,false);gate.release(second);await pending;assert.equal(written,true)
})
test('worker disconnect releases queued writes and invalidates a still-acquiring capture without cancelling admitted physical IO',async()=>{
 const gate=new ApplicationMetadataGate(),inside=Promise.withResolvers<void>(),leave=Promise.withResolvers<void>()
 let physicalDone=false,written=false;const first=gate.write(async()=>{inside.resolve();await leave.promise;physicalDone=true});await inside.promise
 const capture=gate.acquire();const failed=assert.rejects(capture,/REVOKED/),late=gate.write(async()=>{written=true})
 gate.revoke();await late;assert.equal(written,true);assert.equal(physicalDone,false);leave.resolve();await first;await failed
 const next=await gate.acquire();gate.release(next)
})
