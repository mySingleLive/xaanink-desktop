import assert from 'node:assert/strict'
import {test} from 'node:test'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {join} from 'node:path'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'

test('AR105-G01 capture also drains a later grandchild issued by a still-active detached physical writer',{timeout:5000},async()=>{
 const gate=new ApplicationMetadataGate(),entered=Promise.withResolvers<void>(),firstRelease=Promise.withResolvers<void>(),secondEntered=Promise.withResolvers<void>(),secondRelease=Promise.withResolvers<void>();let finished=false
 const flight=gate.writeFlight(async()=>{void gate.write(async()=>{entered.resolve();await firstRelease.promise;void gate.write(async()=>{secondEntered.resolve();await secondRelease.promise;finished=true})})})
 try{await entered.promise;let captured=false;const acquisition=gate.acquire().then(token=>{captured=true;return token});firstRelease.resolve();await secondEntered.promise;await new Promise(setImmediate);assert.equal(captured,false);assert.equal(finished,false);secondRelease.resolve();await flight;const token=await acquisition;assert.equal(finished,true);gate.release(token)}finally{firstRelease.resolve();secondRelease.resolve();await flight.catch(()=>{});gate.revoke()}
})

test('AR105-G02 a failed detached actual filesystem writer is reported by its flight without a second unhandled rejection',{timeout:10000},async()=>{
 const script=`import {ApplicationMetadataGate} from ${JSON.stringify(join(process.cwd(),'desktop/main/application-metadata-gate.ts'))};import {mkdtemp,readFile,rm} from 'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';const base=await mkdtemp(join(tmpdir(),'xuanxiang-review105-flight-')),gate=new ApplicationMetadataGate(),unhandled=[];process.on('unhandledRejection',cause=>unhandled.push(cause.code??cause.name));let failure;try{await gate.writeFlight(async()=>{void gate.write(async()=>{await readFile(join(base,'missing-owned-fixture'))})})}catch(cause){failure=cause.code??cause.name};const token=await gate.acquire();gate.release(token);await new Promise(setImmediate);await new Promise(setImmediate);await rm(base,{recursive:true,force:true});process.stdout.write(JSON.stringify({failure,unhandled})+String.fromCharCode(10));`
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']}),exit=once(child,'exit');let output='',errors='';child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{errors+=data});assert.equal((await exit)[0],0,errors);const actual=JSON.parse(output.trim());assert.equal(actual.failure,'ENOENT');assert.deepEqual(actual.unhandled,[],'the parent drained and reported this child failure; the detached wrapper must not independently reject without a handler')
})

test('AR105-G03 acquiring capture from the private active flight rejects without deadlocking and leaves the next ordinary capture usable',{timeout:5000},async()=>{
 const gate=new ApplicationMetadataGate()
 await assert.rejects(gate.writeFlight(()=>gate.acquire()),/APPLICATION_CAPTURE_INSIDE_WRITE/);const token=await gate.acquire();let written=false;const pending=gate.write(async()=>{written=true});await new Promise(setImmediate);assert.equal(written,false);gate.release(token);await pending;assert.equal(written,true)
})
