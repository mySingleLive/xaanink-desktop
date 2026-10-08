import type {DesktopBridge,DesktopEvent} from "@desktop/shared/ipc"
import type {DraftSnapshot,DraftReceipt} from "@desktop/shared/drafts"
import {draftSnapshotSchema} from "@desktop/shared/drafts"
import type {DesktopSaveCoordinator} from "./save-coordinator"
type RecoveryCleanup=()=>void|Promise<void>
export interface DraftSessionServices {
 restore(snapshot:DraftSnapshot|null,signal:AbortSignal):Promise<void|RecoveryCleanup>|void|RecoveryCleanup
 installSources():()=>void
 flushSettings():Promise<void>
 closing(value:boolean):void
 restoreBarrier?:{afterRevision?:number;checkpoint?(receipt:DraftReceipt):Promise<void>;confirm(receipt:DraftReceipt):Promise<void>}
}
export class DesktopDraftSession {
 private alive=true
 private lifetime=new AbortController()
 private ready=false
 private markingReady:Promise<void>|null=null
 private maintenance:Promise<void>|null=null
 private sessionId:string|null=null
 private receipt:DraftReceipt|null=null
 private releaseWriter:(()=>void)|undefined
 private releaseSources:(()=>void)|undefined
 private closeAttempt:{id:string;abort:AbortController}|null=null
 constructor(private bridge:DesktopBridge,private coordinator:DesktopSaveCoordinator,private services:DraftSessionServices){}
 private active(){if(!this.alive||this.lifetime.signal.aborted)throw new DOMException("工作台已关闭","AbortError")}
 async initialize(sessionId:string):Promise<void>{
  this.active();if(this.sessionId)throw new Error("草稿会话已经初始化")
  this.sessionId=sessionId
  const raw=await this.bridge.readDraft(sessionId);this.active()
  const snapshot=raw===null?null:draftSnapshotSchema.parse(raw)
  const cleanup=await this.services.restore(snapshot,this.lifetime.signal);this.active()
  this.releaseSources=this.services.installSources()
  // Main owns this transition. A close arriving during the handshake must wait
  // for the acknowledgement so it cannot misreport an editable session as clean.
  this.markingReady=this.bridge.markDraftReady(sessionId)
  await this.markingReady;this.active()
  this.releaseWriter=this.coordinator.configurePersistence(async value=>{
   this.active()
   const saved=await this.bridge.persistDraft(sessionId,draftSnapshotSchema.parse(value));this.active()
   if(saved.clientRevision!==value.revision)throw new Error("草稿落盘回执不匹配")
   this.receipt=saved
  })
  this.ready=true
  if(cleanup||this.services.restoreBarrier){
   this.maintenance=Promise.resolve().then(async()=>{
    await this.coordinator.checkpointDrafts({signal:this.lifetime.signal,afterRevision:this.services.restoreBarrier?.afterRevision});this.active()
    const firstRevision=this.receipt?.clientRevision
    if(this.services.restoreBarrier?.checkpoint){
     if(!this.receipt)throw new Error("恢复草稿首份落盘尚未确认")
     await this.services.restoreBarrier.checkpoint(this.receipt);this.active()
    }
    await cleanup?.();this.active()
    await this.coordinator.checkpointDrafts({signal:this.lifetime.signal,...(this.services.restoreBarrier?.checkpoint?{afterRevision:firstRevision}:{})});this.active()
    if(this.services.restoreBarrier){
     if(!this.receipt)throw new Error("恢复草稿保留尚未确认")
     await this.services.restoreBarrier.confirm(this.receipt);this.active()
    }
   })
   await this.maintenance
  }
 }
 private async savedReceipt(retryFailures=false,signal?:AbortSignal):Promise<DraftReceipt>{
  this.active();if(!this.ready)throw new Error("草稿恢复尚未完成")
  // Do not acknowledge close between the archived-cache receipt and the clean
  // session receipt. A failed startup still allows retrying a fresh snapshot.
  await this.maintenance?.catch(()=>{});this.active()
  await this.services.flushSettings();this.active()
  const snapshot=await this.coordinator.flushAll({retryFailures,signal})
  this.active()
  if(!this.receipt||this.receipt.clientRevision!==snapshot.revision)throw new Error("草稿落盘尚未确认")
  return this.receipt
 }
 async handle(event:DesktopEvent):Promise<void>{
  if(!this.alive)return
  if(event.type==="close-cancelled"){this.closeAttempt?.abort.abort();this.closeAttempt=null;this.services.closing(false);return}
  if(event.type!=="prepare-close"||event.sessionId!==this.sessionId)return
  this.closeAttempt?.abort.abort()
  const attempt={id:event.id,abort:new AbortController()};this.closeAttempt=attempt
  this.services.closing(true)
  const current=()=>this.alive&&this.closeAttempt===attempt
  try{
   if(!this.ready&&this.markingReady)await this.markingReady.catch(()=>{})
   if(!current())return
   if(!this.ready){
    if(event.action!=="flush")throw new Error("恢复数据尚未读取完成")
    this.lifetime.abort()
    await this.bridge.replyClose(event.sessionId,event.id,{status:"unmodified"})
    return
   }
   const reply=event.action==="export"?{status:"export" as const,snapshot:draftSnapshotSchema.parse(this.coordinator.exportSnapshot())}:{status:"saved" as const,receipt:await this.savedReceipt(event.retryFailures,attempt.abort.signal)}
   if(current())await this.bridge.replyClose(event.sessionId,event.id,reply)
  }catch{
   if(current())await this.bridge.replyClose(event.sessionId,event.id,{status:"failed"}).catch(()=>{})
  }
 }
 async flush():Promise<void>{await this.savedReceipt()}
 dispose():void{this.alive=false;this.ready=false;this.lifetime.abort();this.closeAttempt?.abort.abort();this.closeAttempt=null;this.releaseWriter?.();this.releaseSources?.()}
}
