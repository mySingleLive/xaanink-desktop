import assert from "node:assert/strict"
import {test} from "node:test"
import {CloseCoordinator,type CloseOwner,type CloseServices} from "../../desktop/main/close-coordinator"
function defer<T=void>(){const value=Promise.withResolvers<T>();return value}
function rig(overrides:Partial<CloseServices>={}){
 const calls:string[]=[],owner:CloseOwner={owner:4,sessionId:"session-a"}
 const services:CloseServices={current:()=>owner,busy:async()=>false,confirmStop:async()=>true,stopTasks:async()=>{calls.push("stop")},flush:async(_owner,retry)=>{calls.push(`flush:${retry}`)},closeData:async()=>{calls.push("data")},failed:async()=>"cancel",exportDraft:async()=>{calls.push("export")},commit:intent=>{calls.push(`commit:${intent}`)},release:()=>{calls.push("release")},...overrides}
 return{calls,owner,services,coordinator:new CloseCoordinator(services)}
}
test('asynchronous physical handoff commit remains part of the close flight before release',async()=>{
 const held=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();let finished=false
 const r=rig({commit:async()=>{entered.resolve();await held.promise;finished=true}})
 const closing=r.coordinator.request('quit');await entered.promise
 assert.equal(r.calls.includes('release'),false);assert.equal(finished,false)
 held.resolve();assert.equal(await closing,true);assert.equal(finished,true);assert.equal(r.calls.at(-1),'release')
})
test('a failed asynchronous handoff cannot report a successful close',async()=>{
 const r=rig({commit:async()=>{throw Error('arm directory fsync failed')}})
 assert.equal(await r.coordinator.request('quit'),false);assert.equal(r.calls.at(-1),'release')
})
test("closing waits for renderer durable save and database close before committing",async()=>{
 const save=defer(),data=defer();const r=rig({flush:async()=>{r.calls.push("flush");await save.promise},closeData:async()=>{r.calls.push("data");await data.promise}})
 const work=r.coordinator.request("window");await new Promise(setImmediate);assert.deepEqual(r.calls,["stop","flush"])
 save.resolve();await new Promise(setImmediate);assert.deepEqual(r.calls,["stop","flush","data"]);data.resolve();assert.equal(await work,true);assert.deepEqual(r.calls,["stop","flush","data","commit:window","release"])
})
test("repeated close and quit share a single flow and promote the committed intent",async()=>{
 const save=defer();const r=rig({flush:async()=>{r.calls.push("flush");await save.promise}})
 const first=r.coordinator.request("window"),second=r.coordinator.request("quit");await new Promise(setImmediate);assert.equal(r.calls.filter(x=>x==="flush").length,1);save.resolve();assert.equal(await first,true);assert.equal(await second,true);assert.equal(r.calls.filter(x=>x==="commit:quit").length,1)
})
test("cancelling the running-task confirmation does not stop tasks, flush, or close",async()=>{
 const r=rig({busy:async()=>true,confirmStop:async()=>false});assert.equal(await r.coordinator.request("quit"),false);assert.deepEqual(r.calls,["release"])
})
test("failed save may retry the original attempts but cannot close before the retry acknowledges",async()=>{
 let failures=1;const r=rig({flush:async(_owner,retry)=>{r.calls.push(`flush:${retry}`);if(failures--)throw Error("isolated save failure")},failed:async()=>"retry"})
 assert.equal(await r.coordinator.request("window"),true);assert.deepEqual(r.calls,["stop","flush:false","flush:true","data","commit:window","release"])
})
test("exporting after save failure preserves the window; it does not imply approval to discard",async()=>{
 let choices=0;const r=rig({flush:async()=>{r.calls.push("flush");throw Error()},failed:async()=>choices++?"cancel":"export"})
 assert.equal(await r.coordinator.request("quit"),false);assert.deepEqual(r.calls,["stop","flush","export","release"])
})
test("a replaced renderer lifetime invalidates an in-flight close acknowledgement",async()=>{
 const save=defer();const r=rig({flush:async()=>{await save.promise}});const work=r.coordinator.request("window");await new Promise(setImmediate);r.owner.sessionId="session-b";save.resolve();assert.equal(await work,false);assert.deepEqual(r.calls,["stop","release"])
})
test("database close failure retains the window and can be cancelled",async()=>{
 const r=rig({closeData:async()=>{r.calls.push("data");throw Error("isolated database failure")}});assert.equal(await r.coordinator.request("window"),false);assert.deepEqual(r.calls,["stop","flush:false","data","release"])
})
test("an application with no renderer can quit only after database acknowledgement",async()=>{
 const r=rig({current:()=>null});assert.equal(await r.coordinator.request("quit"),true);assert.deepEqual(r.calls,["stop","data","commit:quit","release"])
})
test("failure dialog exceptions still release the flow and allow a new close attempt",async()=>{
 let fail=true;const r=rig({flush:async()=>{if(fail)throw Error()},failed:async()=>{throw Error("native dialog unavailable")}})
 assert.equal(await r.coordinator.request("window"),false);fail=false;assert.equal(await r.coordinator.request("window"),true);assert.equal(r.calls.filter(x=>x==="release").length,2)
})
