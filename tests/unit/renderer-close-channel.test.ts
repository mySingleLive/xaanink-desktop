import assert from "node:assert/strict"
import {test} from "node:test"
import {RendererCloseChannel} from "../../desktop/main/renderer-close-channel"
import type {PrepareClose} from "../../desktop/shared/close"
const owner={owner:2,sessionId:"isolation-session"},saved={status:"saved" as const,receipt:{revision:1,clientRevision:2,digest:"a".repeat(64)}}
test("only the requested owner, lifetime and token may acknowledge a pending close",async()=>{
 const events:PrepareClose[]=[],channel=new RendererCloseChannel(e=>events.push(e)),pending=channel.request(owner,"flush")
 assert.equal(events.length,1);const event=events[0];assert.equal(event.sessionId,owner.sessionId)
 assert.equal(channel.reply({...owner,owner:3},event.id,saved),false);assert.equal(channel.reply({...owner,sessionId:"later"},event.id,saved),false);assert.equal(channel.reply(owner,"old-token",saved),false)
 assert.equal(channel.reply(owner,event.id,saved),true);assert.deepEqual(await pending,saved);assert.equal(channel.reply(owner,event.id,saved),false)
})
test("malformed or action-mismatched replies cannot release the pending flush",async()=>{
 const events:PrepareClose[]=[],channel=new RendererCloseChannel(e=>events.push(e)),pending=channel.request(owner,"flush")
 const id=events[0].id;assert.equal(channel.reply(owner,id,{status:"saved",receipt:{...saved.receipt,digest:"invalid"}}),false)
 assert.equal(channel.reply(owner,id,{status:"export",snapshot:{version:1,revision:0,createdAt:new Date().toISOString(),autosaves:[],sources:{},issues:[]}}),false)
 assert.equal(channel.reply(owner,id,{status:"failed"}),true);assert.deepEqual(await pending,{status:"failed"})
})
test("timeout and window disposal settle a close without accepting late acknowledgements",async t=>{
 t.mock.timers.enable({apis:["setTimeout"]});const events:PrepareClose[]=[],channel=new RendererCloseChannel(e=>events.push(e),50)
 const pending=channel.request(owner,"flush");t.mock.timers.tick(50);await assert.rejects(pending,/响应/);assert.equal(channel.reply(owner,events[0].id,saved),false)
 const next=channel.request(owner,"flush");channel.cancel();await assert.rejects(next,/取消/);assert.equal(channel.reply(owner,events[1].id,saved),false);t.mock.timers.reset()
})
test("a second request cannot replace the outstanding token",async()=>{
 const events:PrepareClose[]=[],channel=new RendererCloseChannel(e=>events.push(e)),pending=channel.request(owner,"flush")
 await assert.rejects(channel.request(owner,"export"),/等待/);assert.equal(events.length,1);channel.reply(owner,events[0].id,saved);await pending
})
test("synchronous send failure clears pending ownership and its timer",async()=>{
 let fail=true;const events:PrepareClose[]=[],channel=new RendererCloseChannel(e=>{if(fail)throw Error("send failed");events.push(e)})
 await assert.rejects(channel.request(owner,"flush"),/send failed/);fail=false;const pending=channel.request(owner,"export");channel.reply(owner,events[0].id,{status:"failed"});await pending
})
