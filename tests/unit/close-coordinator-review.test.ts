import assert from "node:assert/strict"
import {test} from "node:test"
import {CloseCoordinator,type CloseServices} from "../../desktop/main/close-coordinator"

function services(overrides:Partial<CloseServices>={}) {
 const calls:string[]=[]
 return {calls,value:{current:()=>({owner:9,sessionId:"review-owner"}),busy:async()=>false,confirmStop:async()=>true,stopTasks:async()=>{},flush:async()=>{},closeData:async()=>{},failed:async()=>"cancel" as const,exportDraft:async()=>{},commit:intent=>{calls.push(intent)},release:()=>{},...overrides} satisfies CloseServices}
}

test("C53-01: synchronous last-window quit during window commit must complete the quit intent",async()=>{
 let promoted:Promise<boolean>|undefined
 const r=services({commit:intent=>{r.calls.push(intent);if(intent==="window")promoted=coordinator.request("quit")}})
 const coordinator=new CloseCoordinator(r.value)
 assert.equal(await coordinator.request("window"),true)
 assert.equal(await promoted,true)
 assert.ok(r.calls.includes("quit"),"before-quit must eventually commit quit, rather than sharing an already-window-only commit")
})

test("C53-02: quit promotion while exporting a failed save still cannot approve discarding it",async()=>{
 const gate=Promise.withResolvers<void>();let failed=0,exports=0,release=0
 const r=services({flush:async()=>{throw Error("isolated save failure")},failed:async()=>failed++?"cancel":"export",exportDraft:async()=>{exports++;await gate.promise;throw Error("isolated export failure")},release:()=>{release++}})
 const coordinator=new CloseCoordinator(r.value),windowClose=coordinator.request("window")
 while(exports===0)await new Promise(setImmediate)
 const quit=coordinator.request("quit");gate.resolve()
 assert.equal(await windowClose,false);assert.equal(await quit,false)
 assert.deepEqual(r.calls,[]);assert.equal(exports,1);assert.equal(release,1)
})

test("C53-03: owner replacement during database acknowledgement prevents commit",async()=>{
 const gate=Promise.withResolvers<void>();let owner={owner:9,sessionId:"review-owner"},released=0
 const r=services({current:()=>owner,closeData:()=>gate.promise,release:()=>{released++}})
 const coordinator=new CloseCoordinator(r.value),work=coordinator.request("quit")
 await new Promise(setImmediate);owner={...owner,sessionId:"replacement-owner"};gate.resolve()
 assert.equal(await work,false);assert.deepEqual(r.calls,[]);assert.equal(released,1)
})

test("C53-01b: synchronous quit promotion cannot close a new owner installed by window commit",async()=>{
 let owner={owner:9,sessionId:"review-owner"}
 const r=services({current:()=>owner,commit:intent=>{r.calls.push(intent);if(intent==="window"){owner={owner:10,sessionId:"new-owner"};void coordinator.request("quit")}}})
 const coordinator=new CloseCoordinator(r.value)
 assert.equal(await coordinator.request("window"),false)
 assert.deepEqual(r.calls,["window"])
})
