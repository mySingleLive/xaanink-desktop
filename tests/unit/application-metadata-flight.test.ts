import assert from 'node:assert/strict'
import {test} from 'node:test'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'

test('actual capture drains a complete trusted write flight including an inner physical writer, without blocking its own parent',async()=>{
 const gate=new ApplicationMetadataGate(),entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>()
 let written=false,captured=false
 const flight=gate.writeFlight(async()=>{entered.resolve();await resume.promise;await gate.write(async()=>{written=true});return 7})
 await entered.promise
 const capture=gate.acquire().then(value=>{captured=true;return value})
 await new Promise(setImmediate);assert.equal(captured,false)
 resume.resolve();assert.equal(await flight,7)
 const token=await capture;assert.equal(written,true);gate.release(token)
})

test('a detached inner writer remains part of the flight; expired context cannot bypass a subsequent capture',async()=>{
 const gate=new ApplicationMetadataGate(),entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>(),later=Promise.withResolvers<void>()
 let done=false,laterDone=false,laterWrite:Promise<void>|undefined
 const flight=gate.writeFlight(async()=>{
  void gate.write(async()=>{entered.resolve();await resume.promise;done=true})
  void later.promise.then(()=>{laterWrite=gate.write(async()=>{laterDone=true})})
 })
 await entered.promise
 let drained=false;const capture=gate.acquire().then(value=>{drained=true;return value})
 await new Promise(setImmediate);assert.equal(drained,false)
 resume.resolve();await flight;const token=await capture;assert.equal(done,true)
 later.resolve();await new Promise(setImmediate);assert.equal(laterDone,false)
 gate.release(token);await laterWrite;assert.equal(laterDone,true)
})

test('a failed flight still drains its actual child writes before capture becomes ready',async()=>{
 const gate=new ApplicationMetadataGate(),entered=Promise.withResolvers<void>(),resume=Promise.withResolvers<void>()
 const flight=gate.writeFlight(async()=>{void gate.write(async()=>{entered.resolve();await resume.promise});throw Error('controlled failure')})
 const rejected=assert.rejects(flight,/controlled failure/)
 await entered.promise
 let captured=false;const pending=gate.acquire().then(token=>{captured=true;return token})
 await new Promise(setImmediate);assert.equal(captured,false)
 resume.resolve();await rejected;gate.release(await pending)
})

test('a different gate never inherits the first gate flight authorization',async()=>{
 const first=new ApplicationMetadataGate(),second=new ApplicationMetadataGate(),token=await second.acquire()
 let written=false
 const pending=first.writeFlight(()=>second.write(async()=>{written=true}))
 await new Promise(setImmediate);assert.equal(written,false)
 second.release(token);await pending;assert.equal(written,true)
})
