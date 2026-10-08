import {randomUUID} from 'node:crypto'
import type {DirectoryProof} from './directory-authority'
import type {RootMigrationRequests} from './root-migration-request'
interface HandoffOptions {
 requests:Pick<RootMigrationRequests,'prepare'|'arm'|'cancel'|'acknowledgeResult'|'inspect'>
 choose():Promise<DirectoryProof|null>
 confirm(target:DirectoryProof):Promise<boolean>
 /** Captured native window and draft session must remain current. */
 assertOwner():void
 /** Existing close coordinator owns stop/flush/close, then calls armClosed. */
 close():Promise<boolean>
 restart():void
}
/** A selected directory is armed only after the actual close flow succeeds. */
export class RootMigrationHandoff {
 private flight:Promise<boolean>|null=null
 private nonce:string|null=null
 private requestId:string|null=null
 private armed=false
 private committed=false
 private prepareAttempted=false
 private cancelledReceipt:{requestId:string;receiptId:string}|null=null
 private cancelling:Promise<void>|null=null
 private cancellationRequested=false
 get pending(){return this.prepareAttempted&&!this.committed}
 constructor(private options:HandoffOptions){}
 assertOwner(nonce:string){if(!this.nonce||nonce!==this.nonce)throw Error('MIGRATION_OWNER_EXPIRED');this.options.assertOwner()}
 start():Promise<boolean>{
  if(this.flight)return this.flight
  if(this.pending)return Promise.reject(Error('MIGRATION_CANCELLATION_PENDING'))
  this.nonce=randomUUID();this.requestId=null;this.armed=false;this.committed=false;this.prepareAttempted=false;this.cancelledReceipt=null;this.cancellationRequested=false
  const work=Promise.resolve().then(()=>this.run())
  this.flight=work
  void work.then(()=>{if(this.flight===work)this.flight=null},()=>{if(this.flight===work)this.flight=null})
  return work
 }
 private async run(){
  const nonce=this.nonce!
  try{
   this.assertOwner(nonce)
   const target=await this.options.choose();this.assertOwner(nonce)
   if(!target)return false
   if(!await this.options.confirm(target))return false
   this.assertOwner(nonce)
   this.prepareAttempted=true
   const request=await this.options.requests.prepare(nonce,target);this.requestId=request.requestId
   this.assertOwner(nonce)
   return await this.options.close()
  }finally{
   try{
    if(!this.committed)await this.cancelPrepared()
   }finally{if(!this.pending){this.nonce=null;this.requestId=null;this.armed=false}}
  }
 }
 cancelPrepared():Promise<void>{
  if(this.cancelling)return this.cancelling
  if(!this.pending)return Promise.resolve()
  this.cancellationRequested=true;this.armed=false
  const work=Promise.resolve().then(async()=>{
   if(!this.requestId){
    const state=await this.options.requests.inspect()
    if(state.active?.ownerNonce===this.nonce)this.requestId=state.active.requestId
    else if(state.results.some(result=>result.ownerNonce===this.nonce)){
     const result=state.results.find(result=>result.ownerNonce===this.nonce)!
     if(result.outcome.status!=='cancelled')throw Error('MIGRATION_CANCELLATION_PENDING')
     this.requestId=result.requestId;this.cancelledReceipt=result
    }else{this.prepareAttempted=false;this.nonce=null;return}
   }
   if(!this.cancelledReceipt)this.cancelledReceipt=await this.options.requests.cancel(this.requestId,this.nonce!)
   await this.options.requests.acknowledgeResult(this.cancelledReceipt.requestId,this.cancelledReceipt.receiptId)
   this.requestId=null;this.cancelledReceipt=null;this.armed=false;this.prepareAttempted=false;this.nonce=null
  })
  this.cancelling=work
  void work.then(()=>{if(this.cancelling===work)this.cancelling=null},()=>{if(this.cancelling===work)this.cancelling=null})
  return work
 }
 async armClosed(){
  if(!this.requestId||this.committed)return
  if(this.cancellationRequested)throw Error('MIGRATION_CANCELLATION_PENDING')
  const nonce=this.nonce!;this.assertOwner(nonce)
  await this.options.requests.arm(nonce,this.requestId)
  this.assertOwner(nonce);if(this.cancellationRequested)throw Error('MIGRATION_CANCELLATION_PENDING');this.armed=true
 }
 commit(){
  if(!this.armed||this.committed||this.cancellationRequested)return false
  this.assertOwner(this.nonce!)
  this.options.restart();this.committed=true;return true
 }
}
