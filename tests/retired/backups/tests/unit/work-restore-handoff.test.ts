import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {WorkRestoreHandoff} from '../../desktop/main/work-restore-handoff'
import {CloseCoordinator,type CloseServices} from '../../desktop/main/close-coordinator'
const identity={workId:randomUUID(),backupId:randomUUID()},candidate={id:randomUUID(),revision:2,backupId:identity.backupId,createdAt:new Date().toISOString()}
function rig(){
 const events:string[]=[],hold=Promise.withResolvers<void>();let prepared=false,failClose=false,failSettle=false,active=true
 const owner={owner:1,sessionId:randomUUID()}
 let handoff:WorkRestoreHandoff,coordinator:CloseCoordinator
 const options={assertOwner:async()=>{if(!active)throw Error('expired')},assertClosed:async()=>{assert.ok(prepared)},prepare:async()=>{events.push('prepare');return candidate},cancel:async()=>{events.push('cancel')},confirm:async()=>{events.push('confirm');return true},close:async()=>{events.push('close');return coordinator.request('quit')},restart:()=>{events.push('restart')},barrier:{begin:async()=>{events.push('barrier');return{...identity,candidateId:candidate.id,token:randomUUID(),createdAt:new Date().toISOString(),outcome:{status:'pending' as const}}},settle:async()=>{events.push('settle');if(failSettle)throw Error('sync')}},activate:async()=>{events.push('activate')},closeReopenedData:async()=>{events.push('reclose');if(failClose)throw Error('close failed')}}
 const services:CloseServices={current:()=>owner,busy:async()=>false,confirmStop:async()=>true,stopTasks:async()=>{events.push('stop')},flush:async()=>{events.push('flush')},closeData:async()=>{events.push('close-data');prepared=true},closedHandoffPending:()=>handoff.requiresRestart,afterClose:async()=>{await handoff.finishClosed()},failed:async()=> 'cancel',exportDraft:async()=>{},commit:()=>{handoff.commit();events.push('quit')},release:async()=>{await handoff.cancelPrepared();events.push(handoff.requiresRestart?'retained':'resumed')}}
 handoff=new WorkRestoreHandoff(identity,options);coordinator=new CloseCoordinator(services)
 return{events,hold,options,services,handoff,coordinator,setFailClose:(value:boolean)=>{failClose=value},setFailSettle:(value:boolean)=>{failSettle=value},expire:()=>{active=false}}
}
test('actual close coordinator orders durable flush/close before activation and relaunch',async()=>{
 const r=rig();assert.equal(await r.handoff.start(),true)
 assert.deepEqual(r.events,['prepare','confirm','close','stop','flush','close-data','barrier','activate','settle','reclose','restart','quit','retained'])
})
test('declining confirmation cancels isolated candidate without closing or activating',async()=>{
 const r=rig();r.options.confirm=async()=>false;assert.equal(await r.handoff.start(),false);assert.deepEqual(r.events,['prepare','cancel']);assert.equal(r.handoff.pending,false)
})
test('cancel close before barrier resumes safely and retires candidate',async()=>{
 const r=rig();r.services.flush=async()=>{throw Error('draft failed')};assert.equal(await r.handoff.start(),false);assert.equal(r.handoff.requiresRestart,false);assert.equal(r.handoff.pending,false);assert.deepEqual(r.events,['prepare','confirm','close','stop','cancel','resumed'])
})
test('reclose failure leaves old renderer blocked; a later close retries only handoff, never old buffers',async()=>{
 const r=rig();r.setFailClose(true);assert.equal(await r.handoff.start(),false);assert.equal(r.handoff.requiresRestart,true);assert.equal(r.handoff.pending,true);assert.equal(r.events.filter(x=>x==='activate').length,1)
 r.setFailClose(false);assert.equal(await r.coordinator.request('quit'),true);assert.equal(r.events.filter(x=>x==='flush').length,1);assert.equal(r.events.filter(x=>x==='stop').length,1);assert.equal(r.events.filter(x=>x==='close-data').length,1);assert.equal(r.events.filter(x=>x==='activate').length,1);assert.equal(r.events.filter(x=>x==='restart').length,1);assert.equal(r.events.includes('resumed'),false)
})
test('in-flow retry after barrier failure does not flush or reclose the old database again',async()=>{
 const r=rig();r.setFailSettle(true);r.services.failed=async()=>{r.setFailSettle(false);return 'retry'};assert.equal(await r.handoff.start(),true);assert.equal(r.events.filter(x=>x==='flush').length,1);assert.equal(r.events.filter(x=>x==='activate').length,1);assert.equal(r.events.filter(x=>x==='settle').length,2)
})
test('single-flight starts cannot create a second candidate or restart',async()=>{
 const r=rig();r.options.prepare=async()=>{r.events.push('prepare');await r.hold.promise;return candidate};const first=r.handoff.start(),second=r.handoff.start();assert.equal(first,second);await new Promise(setImmediate);assert.equal(r.handoff.preparing,true);r.hold.resolve();assert.equal(await first,true);assert.equal(r.handoff.commit(),false);assert.equal(r.events.filter(x=>x==='restart').length,1)
})
test('renderer ownership expiration after preparation cancels isolated candidate and never asks to activate',async()=>{
 const r=rig();r.options.prepare=async()=>{r.expire();return candidate};await assert.rejects(r.handoff.start(),/expired/);assert.deepEqual(r.events,['cancel']);assert.equal(r.handoff.requiresRestart,false)
})
