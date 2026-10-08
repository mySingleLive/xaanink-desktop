import assert from 'node:assert/strict'
import {test} from 'node:test'
import {withApplicationMetadataSnapshot} from '../../desktop/service/application-metadata-capture'
const id='4a5b8f1e-b5d7-40d3-a8c4-1c9b0819fa91'
test('internal snapshot acquire precedes capture; release is awaited and exact-token even on capture failure',async()=>{
 for(const fail of [false,true]){
  const events:string[]=[],finish=Promise.withResolvers<void>(),released=Promise.withResolvers<void>();let completed=false
  const peer={call:async<T>(method:string,value?:unknown):Promise<T>=>{events.push(method);if(method==='application.capture.acquire'){assert.equal(value,undefined);return id as T}assert.equal(method,'application.capture.release');assert.equal(value,id);released.resolve();await finish.promise;return true as T}}
  const flight=withApplicationMetadataSnapshot(peer,async()=>{events.push('capture');if(fail)throw Error('capture failed');return 7});void flight.then(()=>{completed=true},()=>{completed=true});await released.promise;assert.equal(completed,false);finish.resolve()
  if(fail)await assert.rejects(flight,/capture failed/);else assert.equal(await flight,7)
  assert.deepEqual(events,['application.capture.acquire','capture','application.capture.release'])
 }
})
test('invalid acquire and missing release acknowledgement reject instead of completing an unowned snapshot',async()=>{
 let called=false;await assert.rejects(withApplicationMetadataSnapshot({call:async<T>()=>'forged' as T},async()=>{called=true}));assert.equal(called,false)
 await assert.rejects(withApplicationMetadataSnapshot({call:async<T>(method:string)=>(method.endsWith('acquire')?id:false) as T},async()=>7),/RELEASE/)
})
