import {z} from 'zod'
import {canonical} from '../core/application-backup-files'
import {assertRootAuthorityHost,assertRootAuthorityFile,observeRootAuthority,type RootAuthorityFile} from '../core/root-authority'
import type {RootIdentity} from '../core/data-root'
import {applicationDraftRecoveryItems,type ApplicationDraftRetention} from '../shared/application-restore'
import {draftReceiptSchema,type DraftSnapshot,type DraftReceipt} from '../shared/drafts'
import type {ApplicationRestoreProtectionNotice} from '../shared/application-restore-checkpoint'
import {DraftJournal,validateDraftSnapshot} from './draft-journal'
import {ApplicationRestoreDraftBarrier} from './application-restore-draft-barrier'
import {ApplicationRestoreRequests} from './application-restore-request'

export class ApplicationRestoreCheckpointError extends Error{constructor(readonly code:string){super(code);this.name='ApplicationRestoreCheckpointError'}}
function fail(code:string):never{throw new ApplicationRestoreCheckpointError(code)}
type Options={root:string;journal:DraftJournal;journalOwner:string;requests:ApplicationRestoreRequests;operationId:string;ownerNonce:string;assertOwner():void;withWrite<T>(run:()=>Promise<T>):Promise<T>}

/** A single real main-window journal owner. The renderer supplies draft data
 * only; each physical persist includes the core barrier and immutable handoff
 * attestation in the same trusted metadata flight. Business remains blocked
 * until the second actual receipt and consumed control record are durable. */
export class ApplicationRestoreCheckpointSession{
 #journal:DraftJournal
 #requests:ApplicationRestoreRequests
 #barrier:ApplicationRestoreDraftBarrier
 #owner:string
 #operationId:string
 #nonce:string
 #host:()=>void
 #write:<T>(run:()=>Promise<T>)=>Promise<T>
 #token:string
 #candidateId:string
 #root:RootIdentity
 #blocked=true
 #first:DraftReceipt|null=null
 #second:DraftReceipt|null=null
 #queue:Promise<unknown>=Promise.resolve()
 constructor(options:Options){
  this.#journal=options.journal;this.#requests=options.requests;this.#owner=options.journalOwner
  this.#operationId=z.uuid().parse(options.operationId);this.#nonce=z.uuid().parse(options.ownerNonce)
  this.#host=options.assertOwner;this.#write=options.withWrite
  this.assertOwner()
  if(this.#journal.root!==options.root)fail('APPLICATION_DRAFT_JOURNAL_MISMATCH')
  const state=this.#requests.startup()
  if(state.mode!=='protected'||state.request?.operationId!==this.#operationId||!state.activation)fail('APPLICATION_RESTORE_NOT_PROTECTED')
  if(state.activation.pointer.root.path!==options.root)fail('APPLICATION_DRAFT_JOURNAL_MISMATCH')
  this.#root=Object.freeze(structuredClone(state.activation.pointer.root))
  this.#token=state.activation.barrierToken;this.#candidateId=state.activation.candidateId
  this.#barrier=new ApplicationRestoreDraftBarrier(options.root,this.#journal,{assertOwner:this.#host})
 }
 get blocked(){return this.#blocked}
 private assertOwner(){assertRootAuthorityHost(this.#host,'APPLICATION_DRAFT_OWNER_EXPIRED')}
 private serial<T>(run:()=>Promise<T>):Promise<T>{const work=this.#queue.then(run);this.#queue=work.catch(()=>{});return work}
 private async retention():Promise<ApplicationDraftRetention>{
  this.assertOwner()
  if(this.#blocked){const state=this.#requests.startup();if(state.mode!=='protected'||state.request?.operationId!==this.#operationId||state.activation?.barrierToken!==this.#token||state.activation?.candidateId!==this.#candidateId)fail('APPLICATION_RESTORE_CONTROL_CHANGED')}
  const retention=await this.#barrier.inspect();this.assertOwner()
  if(!retention||retention.operationId!==this.#operationId||retention.candidateId!==this.#candidateId||retention.barrier.token!==this.#token)fail('APPLICATION_DRAFT_TOKEN_EXPIRED')
  return retention
 }
 private floor(retention:ApplicationDraftRetention){return retention.barrier.phase==='complete'?retention.barrier.secondCheckpoint!.clientRevision:retention.barrier.phase==='checkpointed'?retention.barrier.firstCheckpoint!.clientRevision:0}
 private retentionFile(retention:ApplicationDraftRetention):RootAuthorityFile{
  const file=observeRootAuthority(this.#root,'application-restore-drafts.json',16*1024*1024)!
  if(canonical(JSON.parse(file.text))!==canonical(retention))fail('APPLICATION_DRAFT_BARRIER_CHANGED')
  return file.proof
 }
 private async sealRetention(retention:ApplicationDraftRetention,file:RootAuthorityFile){
  assertRootAuthorityFile(this.#root,'application-restore-drafts.json',file,'APPLICATION_DRAFT_BARRIER_CHANGED')
  const fresh=await this.retention()
  if(canonical(fresh)!==canonical(retention))fail('APPLICATION_DRAFT_BARRIER_CHANGED')
  assertRootAuthorityFile(this.#root,'application-restore-drafts.json',file,'APPLICATION_DRAFT_BARRIER_CHANGED')
 }
 notice():Promise<ApplicationRestoreProtectionNotice>{return this.serial(async()=>{const retained=await this.retention();return{token:this.#token,afterRevision:Math.max(this.floor(retained),this.#first?.clientRevision??0)}})}
 read():Promise<DraftSnapshot|null>{return this.serial(async()=>{
  if(!this.#blocked){this.assertOwner();const snapshot=await DraftJournal.prototype.read.call(this.#journal);this.assertOwner();return snapshot}
  const retained=await this.retention(),file=this.retentionFile(retained),snapshot=await DraftJournal.prototype.read.call(this.#journal);this.assertOwner()
  await this.sealRetention(retained,file)
  const expected=applicationDraftRecoveryItems(retained),prior=snapshot?.sources.recovery
  let items:unknown[]=[]
  if(prior!==undefined){
   if(prior&&typeof prior==='object'&&!Array.isArray(prior)&&(prior as {version?:unknown}).version===1&&Array.isArray((prior as {items?:unknown}).items))items=structuredClone((prior as {items:unknown[]}).items)
   else items=[{id:`application:${this.#operationId}:unrecognized-recovery`,source:'recovery',path:'original-journal',reason:'INVALID_DATA',createdAt:snapshot!.createdAt,value:structuredClone(prior)}]
  }
  for(const item of expected)if(!items.some(old=>canonical(old)===canonical(item)))items.push(item)
  return validateDraftSnapshot({...snapshot??{version:1,revision:0,createdAt:retained.createdAt,autosaves:[],sources:{},issues:[]},sources:{...snapshot?.sources,recovery:{version:1,items}}})
 })}
 persist(input:DraftSnapshot):Promise<DraftReceipt>{return this.serial(()=>this.#write(async()=>{
  this.assertOwner()
  if(!this.#blocked){const saved=await DraftJournal.prototype.persist.call(this.#journal,this.#owner,input);this.assertOwner();return saved}
  const retained=await this.retention(),retentionFile=this.retentionFile(retained),snapshot=validateDraftSnapshot(input),recovery=snapshot.sources.recovery as {version?:unknown;items?:unknown[]}|undefined
  const expected=applicationDraftRecoveryItems(retained)
  if(recovery?.version!==1||!Array.isArray(recovery.items)||expected.some(item=>!recovery.items!.some(actual=>canonical(actual)===canonical(item))))fail('APPLICATION_DRAFT_RECOVERY_INCOMPLETE')
  const floor=this.#first?.clientRevision??this.floor(retained)
  if(snapshot.revision<=floor)fail('APPLICATION_DRAFT_FRESH_CHECKPOINT_REQUIRED')
  const receipt=await DraftJournal.prototype.persist.call(this.#journal,this.#owner,snapshot);this.assertOwner()
  await this.sealRetention(retained,retentionFile)
  if(!this.#first){
   if(retained.barrier.phase==='protected')await this.#barrier.checkpoint(this.#token,this.#owner,receipt)
   await ApplicationRestoreRequests.prototype.recordFirstCheckpoint.call(this.#requests,this.#nonce,this.#operationId,this.#journal,this.#owner,receipt)
   this.assertOwner();this.#first=structuredClone(receipt)
  }else{
   if(receipt.revision<=this.#first.revision||receipt.clientRevision<=this.#first.clientRevision)fail('APPLICATION_DRAFT_SECOND_CHECKPOINT_REQUIRED')
   if(retained.barrier.phase==='checkpointed')await this.#barrier.acknowledge(this.#token,this.#owner,receipt)
   else if(retained.barrier.phase!=='complete')fail('APPLICATION_DRAFT_CHECKPOINT_PHASE_INVALID')
   await ApplicationRestoreRequests.prototype.consumed.call(this.#requests,this.#nonce,this.#operationId,this.#journal,this.#owner,receipt)
   this.assertOwner();this.#second=structuredClone(receipt);this.#blocked=false
  }
  return receipt
 }))}
 confirm(phase:'first'|'complete',token:string,input:DraftReceipt):Promise<void>{return this.serial(async()=>{
  this.assertOwner();const receipt=draftReceiptSchema.parse(input),expected=phase==='first'?this.#first:this.#second
  if(token!==this.#token||!expected||canonical(receipt)!==canonical(expected)||phase==='complete'&&this.#blocked)fail('APPLICATION_DRAFT_CHECKPOINT_UNCONFIRMED')
  await DraftJournal.prototype.confirm.call(this.#journal,this.#owner,receipt);this.assertOwner()
  const state=this.#requests.startup()
  if(phase==='first'?(state.mode!=='protected'||state.request?.operationId!==this.#operationId||canonical(state.request.firstCheckpoint?.receipt)!==canonical(receipt)):state.mode!=='normal')fail('APPLICATION_RESTORE_CONTROL_CHANGED')
 })}
 async flush(){await this.#queue;await this.#barrier.flush();await this.#requests.flush()}
}
