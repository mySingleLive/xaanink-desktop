import assert from "node:assert/strict"
import {test} from "node:test"
import {randomUUID} from "node:crypto"
import {DesktopDraftSession} from "../../src/lib/desktop/draft-session"
import {DesktopSaveCoordinator} from "../../src/lib/desktop/save-coordinator"
import {AutosaveController} from "../../src/lib/autosave-controller"
import type {DesktopBridge} from "../../desktop/shared/ipc"
import type {DraftSnapshot} from "../../desktop/shared/drafts"
import type {CloseReply,PrepareClose} from "../../desktop/shared/close"
const oldSnapshot=():DraftSnapshot=>({version:1,revision:30,createdAt:new Date().toISOString(),autosaves:[],sources:{chat:{draft:"恢复原稿"}},issues:[]})
function rig(overrides:{read?:()=>Promise<DraftSnapshot|null>;markReady?:()=>Promise<void>;sources?:()=>void;persist?:(snapshot:DraftSnapshot)=>Promise<void>;settings?:()=>Promise<void>;restore?:(snapshot:DraftSnapshot|null)=>void|(()=>void)}={}){
 const events:string[]=[],written:DraftSnapshot[]=[],replies:CloseReply[]=[],coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null}),sessionId=randomUUID()
 const bridge={readDraft:async()=>{events.push("read");return overrides.read?overrides.read():oldSnapshot()},markDraftReady:async()=>{events.push("ready");await overrides.markReady?.()},persistDraft:async(_id:string,snapshot:DraftSnapshot)=>{events.push("persist");written.push(snapshot);await overrides.persist?.(snapshot);return{revision:written.length,digest:"b".repeat(64),clientRevision:snapshot.revision}},replyClose:async(_session:string,_id:string,reply:CloseReply)=>{events.push(`reply:${reply.status}`);replies.push(reply);return true}} as unknown as DesktopBridge
 const session=new DesktopDraftSession(bridge,coordinator,{restore:snapshot=>{events.push("restore");return overrides.restore?.(snapshot)},installSources:()=>{events.push("sources");overrides.sources?.();const release=coordinator.registerSource("staged",{read:()=>({batches:{},chips:[]})});return()=>{release();events.push("release-sources")}},flushSettings:async()=>{events.push("settings");await overrides.settings?.()},closing:value=>events.push(`closing:${value}`)})
 const close=(action:"flush"|"export"="flush",nonce=sessionId):PrepareClose=>({type:"prepare-close",id:randomUUID(),sessionId:nonce,action,retryFailures:false})
 return{session,coordinator,sessionId,events,written,replies,close}
}
test("startup restores the durable record before enabling sources and any checkpoint writer",async()=>{
 const gate=Promise.withResolvers<DraftSnapshot|null>(),r=rig({read:()=>gate.promise});const init=r.session.initialize(r.sessionId)
 await new Promise(setImmediate);assert.deepEqual(r.events,["read"]);await assert.rejects(r.coordinator.checkpointDrafts(),{code:"DURABLE_SAVE_UNAVAILABLE"})
 gate.resolve(oldSnapshot());await init;assert.deepEqual(r.events,["read","restore","sources","ready"]);await r.coordinator.checkpointDrafts();assert.equal(r.written.length,1);r.session.dispose()
})
test("a disposed bootstrap cannot restore stale data or install a replacement writer",async()=>{
 const gate=Promise.withResolvers<DraftSnapshot|null>(),r=rig({read:()=>gate.promise}),init=r.session.initialize(r.sessionId);r.session.dispose();gate.resolve(oldSnapshot());await assert.rejects(init,{name:"AbortError"});assert.deepEqual(r.events,["read"])
})
test("invalid recovery data and restore failures leave the coordinator unable to overwrite it",async()=>{
 for(const overrides of [{read:async()=>({...oldSnapshot(),version:2}) as unknown as DraftSnapshot},{restore:()=>{throw Error("unreadable recovery")}}]){
  const r=rig(overrides);await assert.rejects(r.session.initialize(r.sessionId));await assert.rejects(r.coordinator.checkpointDrafts(),{code:"DURABLE_SAVE_UNAVAILABLE"});assert.equal(r.written.length,0);r.session.dispose()
 }
})
test("close waits for settings, original autosaves, and main acknowledgement in that order",async()=>{
 const settings=Promise.withResolvers<void>(),disk=Promise.withResolvers<void>(),r=rig({settings:()=>settings.promise,persist:()=>disk.promise});await r.session.initialize(r.sessionId)
 const autosave=new AutosaveController<string>(async()=>{r.events.push("autosave")},60000),release=r.coordinator.register(autosave);autosave.schedule("原稿输入")
 const closing=r.session.handle(r.close());await new Promise(setImmediate);assert.equal(r.written.length,0);assert.equal(r.replies.length,0)
 settings.resolve();await new Promise(setImmediate);assert.ok(r.events.indexOf("settings")<r.events.indexOf("autosave"));assert.equal(r.written.length,1);assert.equal(r.replies.length,0)
 disk.resolve();await closing;assert.equal(r.replies[0]?.status,"saved");assert.ok(!r.events.includes("closing:false"));r.session.dispose();release();autosave.dispose()
})
test("failed save reports failure without dismissing the close barrier; cancellation unlocks it",async()=>{
 const r=rig({persist:async()=>{throw Error("disk full")}});await r.session.initialize(r.sessionId);await r.session.handle(r.close());assert.deepEqual(r.replies,[{status:"failed"}]);assert.equal(r.events.at(-1),"reply:failed");await r.session.handle({type:"close-cancelled"});assert.equal(r.events.at(-1),"closing:false");r.session.dispose()
})
test("recovery export reads current dirty input without triggering business save or marking it approved",async()=>{
 const r=rig();await r.session.initialize(r.sessionId);let saves=0;const controller=new AutosaveController<string>(async()=>{saves++},60000),release=r.coordinator.register(controller);controller.schedule("未批准的恢复输入");controller.pause()
 await r.session.handle(r.close("export"));assert.equal(saves,0);assert.equal(r.written.length,0);const reply=r.replies[0];assert.equal(reply.status,"export");if(reply.status==="export")assert.equal((reply.snapshot.autosaves[0].draft as {pending:{value:string}}).pending.value,"未批准的恢复输入");r.session.dispose();release();controller.dispose()
})
test("stale sessions and late replies after cancellation never acknowledge another close",async()=>{
 const gate=Promise.withResolvers<void>(),r=rig({settings:()=>gate.promise});await r.session.initialize(r.sessionId);await r.session.handle(r.close("flush",randomUUID()));assert.equal(r.replies.length,0)
 const pending=r.session.handle(r.close());await new Promise(setImmediate);await r.session.handle({type:"close-cancelled"});gate.resolve();await pending;assert.equal(r.replies.length,0);r.session.dispose()
})
test("an unreadable recovery boot can close unchanged without overwriting the original journal",async()=>{
 const r=rig({read:async()=>{throw Error("corrupt disk record")}});await assert.rejects(r.session.initialize(r.sessionId));await r.session.handle(r.close());assert.deepEqual(r.replies,[{status:"unmodified"}]);assert.equal(r.written.length,0);r.session.dispose()
})
test("close before restore completes aborts initialization and prevents a late restore or writer",async()=>{
 const gate=Promise.withResolvers<DraftSnapshot|null>(),r=rig({read:()=>gate.promise}),init=r.session.initialize(r.sessionId);await r.session.handle(r.close());assert.deepEqual(r.replies,[{status:"unmodified"}]);gate.resolve(oldSnapshot());await assert.rejects(init,{name:"AbortError"});assert.ok(!r.events.includes("sources"));assert.equal(r.written.length,0);r.session.dispose()
})
test("close during the main ready handshake waits for it before requiring a durable save",async()=>{
 const gate=Promise.withResolvers<void>(),r=rig({markReady:()=>gate.promise}),init=r.session.initialize(r.sessionId);await new Promise(setImmediate)
 const close=r.session.handle(r.close());await new Promise(setImmediate);assert.equal(r.replies.length,0);gate.resolve();await init;await close;assert.equal(r.replies[0]?.status,"saved");assert.equal(r.written.length,1);r.session.dispose()
})
test("owned cache cleanup happens only after the recovery copy is durable, then checkpoints the cleared state",async()=>{
 const r=rig({restore:()=>()=>r.events.push("clear-cache")});await r.session.initialize(r.sessionId);assert.deepEqual(r.events,["read","restore","sources","ready","persist","clear-cache","persist"]);r.session.dispose()
})
test("a failed initial checkpoint preserves the old owned cache and keeps a retryable writer",async()=>{
 let fail=true;const r=rig({restore:()=>()=>r.events.push("clear-cache"),persist:async()=>{if(fail)throw Error("disk failure")}});await assert.rejects(r.session.initialize(r.sessionId));assert.equal(r.events.includes("clear-cache"),false);fail=false;await r.session.handle(r.close());assert.equal(r.replies[0]?.status,"saved");r.session.dispose()
})

test("source installation failure never enables main persistence and may close the unchanged journal",async()=>{
 const r=rig({sources:()=>{throw Error("source setup failed")}});await assert.rejects(r.session.initialize(r.sessionId));assert.equal(r.events.includes("ready"),false);await r.session.handle(r.close());assert.deepEqual(r.replies,[{status:"unmodified"}]);r.session.dispose()
})
