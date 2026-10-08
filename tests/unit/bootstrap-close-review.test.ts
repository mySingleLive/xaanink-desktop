import assert from "node:assert/strict"
import {test} from "node:test"
import {randomUUID} from "node:crypto"
import {DesktopDraftSession} from "../../src/lib/desktop/draft-session"
import {DesktopSaveCoordinator} from "../../src/lib/desktop/save-coordinator"
import type {DesktopBridge} from "../../desktop/shared/ipc"
import type {DraftSnapshot} from "../../desktop/shared/drafts"
import type {CloseReply,PrepareClose} from "../../desktop/shared/close"

const snapshot=():DraftSnapshot=>({version:1,revision:10,createdAt:new Date().toISOString(),autosaves:[],sources:{chat:{draft:"old inert recovery"}},issues:[]})
function rig(options:{install?:()=>()=>void;cleanup?:()=>Promise<void>;persist?:(snapshot:DraftSnapshot)=>Promise<void>}={}){
 const coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null}),nonce=randomUUID(),replies:CloseReply[]=[],writes:DraftSnapshot[]=[]
 let mainReady=false,sources=0,disposed=0
 const bridge={readDraft:async()=>snapshot(),markDraftReady:async()=>{mainReady=true},persistDraft:async(_id:string,saved:DraftSnapshot)=>{assert.equal(mainReady,true);writes.push(saved);await options.persist?.(saved);return{revision:writes.length,digest:"c".repeat(64),clientRevision:saved.revision}},replyClose:async(_id:string,_token:string,reply:CloseReply)=>{replies.push(reply);return reply.status!=="unmodified"||!mainReady}} as unknown as DesktopBridge
 const session=new DesktopDraftSession(bridge,coordinator,{restore:()=>options.cleanup,installSources:()=>{sources++;if(options.install)return options.install();const release=coordinator.registerSource("recovery",{read:()=>({oldCopy:true})});return()=>{disposed++;release()}},flushSettings:async()=>{},closing:()=>{}})
 const close:PrepareClose={type:"prepare-close",id:randomUUID(),sessionId:nonce,action:"flush",retryFailures:false}
 return{session,coordinator,nonce,close,replies,writes,mainReady:()=>mainReady,sources:()=>sources,disposed:()=>disposed}
}

test("B55-01: a source installation failure must not leave main ready with no usable close writer",async()=>{
 const r=rig({install:()=>{throw Error("isolated source registration failure")}})
 try{
  await assert.rejects(r.session.initialize(r.nonce),/registration/)
  assert.equal(r.mainReady(),false,"no editable renderer or writer exists; main must still allow unchanged close of the old journal")
  await r.session.handle(r.close)
  assert.deepEqual(r.replies,[{status:"unmodified"}]);assert.equal(r.writes.length,0)
 }finally{r.session.dispose()}
})

test("B55-02: a close during restore-disabled cache cleanup waits for cleanup and its second durable checkpoint",async()=>{
 const gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>(),lastWrite=Promise.withResolvers<void>();let clearing=false,cleaned=false
 const r=rig({cleanup:async()=>{clearing=true;entered.resolve();await gate.promise;cleaned=true},persist:async()=>{if(cleaned)await lastWrite.promise}})
 const initialized=r.session.initialize(r.nonce)
 try{
  await entered.promise;assert.equal(clearing,true);assert.equal(r.writes.length,1)
  const closing=r.session.handle(r.close);await new Promise(setImmediate)
  assert.equal(r.replies.length,0,"a ready handshake alone must not acknowledge close before the initialization cleanup barrier")
  gate.resolve();await new Promise(setImmediate)
  assert.equal(r.replies.length,0,"the post-cleanup durable checkpoint must also acknowledge before close")
  lastWrite.resolve();await initialized;await closing
  assert.equal(r.replies[0]?.status,"saved")
 }finally{gate.resolve();lastWrite.resolve();await initialized.catch(()=>{});r.session.dispose()}
})

test("B55-03: synchronous persistence setup failure cannot strand a main-ready session without a close writer",async()=>{
 let releaseObserver:()=>void=()=>{}
 const r=rig({install:()=>{
  const release=r.coordinator.registerSource("recovery",{read:()=>({oldCopy:true})})
  // Source installation succeeds. A real coordinator observer fails in the
  // next configurePersistence emit, before that call returns its release.
  releaseObserver=r.coordinator.subscribe(()=>{throw Error("isolated persistence observer failure")})
  return()=>{releaseObserver();release()}
 }})
 try{
  // Isolating a failing observer is also a valid implementation; the oracle
  // requires a safe closing state rather than a particular exception strategy.
  await r.session.initialize(r.nonce).catch(error=>assert.match(error.message,/persistence observer/))
  await r.session.handle(r.close)
  assert.ok(r.replies[0]?.status==="saved"||!r.mainReady()&&r.replies[0]?.status==="unmodified","local setup failure must leave either a usable durable writer or a genuinely unready main session")
 }finally{releaseObserver();r.session.dispose()}
})

test("B55-04: observer isolation still fails close when a restored draft source is unreadable",async()=>{
 let releaseObserver:()=>void=()=>{}
 const r=rig({install:()=>{
  const release=r.coordinator.registerSource("recovery",{read:()=>{throw Error("unreadable author recovery source")}})
  releaseObserver=r.coordinator.subscribe(()=>{throw Error("unrelated UI subscriber")})
  return()=>{releaseObserver();release()}
 }})
 try{
  await r.session.initialize(r.nonce);await r.session.handle(r.close)
  assert.deepEqual(r.replies,[{status:"failed"}]);assert.equal(r.writes.length,0)
 }finally{releaseObserver();r.session.dispose()}
})
