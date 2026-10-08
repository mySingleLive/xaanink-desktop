import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {conversationRequestOriginSchema,conversationClaimSchema,conversationReleaseSchema,conversationChooseDirectorySchema,conversationDirectoryProofSchema,conversationCreateAdmissionSchema,conversationCreateFinishedSchema,type ConversationRequestOrigin,type ConversationTaskTuple} from '../shared/conversation-task'
import type {DirectoryProof} from './directory-authority'

interface Operation{input:string;grantOwner:string;promise:Promise<DirectoryProof|null>;result?:DirectoryProof|null;admission?:CreationAdmission}
interface Claim{id:string;task:ConversationTaskTuple;operations:Map<string,Operation>}
interface CreationAdmission{id:string;origin:ConversationRequestOrigin;claimId:string;task:ConversationTaskTuple;cell:Int32Array;settle():void;operation:Operation}
interface RequestOwner{origin:ConversationRequestOrigin;owner:string;assertOwner():void;requestActive:boolean;claim:Claim|null}
interface Options{
 choose(input:{title:string;premise?:string;requestId:string},assertCurrent:()=>void,grantOwner:string):Promise<DirectoryProof|null>
 revoke(grantOwner:string):void
}
const same=(a:ConversationTaskTuple,b:ConversationTaskTuple)=>a.conversationId===b.conversationId&&a.turnId===b.turnId&&a.attemptId===b.attemptId&&a.epoch===b.epoch
function fail(code='DIRECTORY_AUTHORIZATION_REVOKED'):never{throw Error(code)}

/** Main-issued request capability, then an exact real-task lease. HTTP stream
 * completion does not transfer a detached task to whichever window is current. */
export class ConversationDirectoryAuthorizations{
 private requests=new Map<string,RequestOwner>()
 private pending=new Set<Promise<unknown>>()
 private admissions=new Map<string,CreationAdmission>()
 private pickerTail:Promise<void>=Promise.resolve()
 constructor(private options:Options){}
 private live(entry:RequestOwner){
  if(this.requests.get(entry.origin.requestId)!==entry)fail()
  try{const result:unknown=entry.assertOwner();if(result!==undefined){void Promise.resolve(result).catch(()=>{});fail()}}catch{fail()}
 }
 private entry(origin:ConversationRequestOrigin){
  const entry=this.requests.get(origin.requestId)
  if(!entry||entry.origin.nonce!==origin.nonce)return fail()
  return entry
 }
 private task(entry:RequestOwner,task:ConversationTaskTuple,claimId:string){
  const claim=entry.claim
  if(!claim||claim.id!==claimId||!same(claim.task,task))return fail()
  return claim
 }
 private revokeClaim(claim:Claim|null){if(claim)for(const operation of claim.operations.values()){
  if(operation.admission)Atomics.store(operation.admission.cell,0,1)
  this.options.revoke(operation.grantOwner)
 }}
 begin(requestId:string,owner:string,assertOwner:()=>void):ConversationRequestOrigin{
  z.uuid().parse(requestId);z.string().min(1).max(512).parse(owner)
  if(this.requests.has(requestId)||this.requests.size>=256)fail('DIRECTORY_REQUEST_LIMIT')
  const origin={requestId,nonce:randomUUID()},entry:RequestOwner={origin,owner,assertOwner,requestActive:true,claim:null}
  this.requests.set(requestId,entry)
  try{this.live(entry)}catch(error){this.requests.delete(requestId);throw error}
  return{...origin}
 }
 endRequest(input:ConversationRequestOrigin){
  const origin=conversationRequestOriginSchema.parse(input),entry=this.requests.get(origin.requestId)
  if(!entry||entry.origin.nonce!==origin.nonce)return
  entry.requestActive=false;if(!entry.claim)this.requests.delete(origin.requestId)
 }
 claim(input:unknown):{claimId:string}{
  const value=conversationClaimSchema.parse(input),entry=this.entry(value.origin);this.live(entry)
  if(value.previous){
   const old=this.task(entry,value.previous.task,value.previous.claimId)
   if(value.task.conversationId!==old.task.conversationId||value.task.turnId!==old.task.turnId||value.task.epoch<=old.task.epoch||value.task.attemptId===old.task.attemptId)fail()
   this.revokeClaim(old)
   this.live(entry)
  }else if(!entry.requestActive||entry.claim)fail()
  const claim:Claim={id:randomUUID(),task:value.task,operations:new Map()};entry.claim=claim
  return{claimId:claim.id}
 }
 release(input:unknown):true{
  const value=conversationReleaseSchema.parse(input),entry=this.requests.get(value.origin.requestId)
  // Cleanup remains idempotent after window destruction or worker disconnect.
  if(!entry||entry.origin.nonce!==value.origin.nonce)return true
  const claim=this.task(entry,value.task,value.claimId)
  entry.claim=null;this.revokeClaim(claim)
  if(!entry.requestActive)this.requests.delete(entry.origin.requestId)
  return true
 }
 async choose(input:unknown):Promise<DirectoryProof|null>{
  const value=conversationChooseDirectorySchema.parse(input),entry=this.entry(value.origin),claim=this.task(entry,value.task,value.claimId)
  const guard=()=>{this.live(entry);if(entry.claim!==claim)fail()}
  guard()
  const fingerprint=JSON.stringify(value.input),existing=claim.operations.get(value.operationId)
  if(existing){if(existing.input!==fingerprint)fail('DIRECTORY_OPERATION_CHANGED');const result=await existing.promise;guard();return structuredClone(result)}
  if(claim.operations.size>=64||this.pending.size>=128)fail('DIRECTORY_OPERATION_LIMIT')
  const grantOwner=`${entry.origin.nonce}:${claim.id}:${randomUUID()}`
  const physical=this.pickerTail.then(async()=>{
   guard();const result=await this.options.choose(value.input,guard,grantOwner);guard()
   const proof=result===null?null:conversationDirectoryProofSchema.parse(result)
   operation.result=proof
   return proof
  }).finally(()=>this.options.revoke(grantOwner))
  const operation:Operation={input:fingerprint,grantOwner,promise:physical}
  claim.operations.set(value.operationId,operation);this.pending.add(physical)
  this.pickerTail=physical.then(()=>{},()=>{})
  void physical.then(()=>this.pending.delete(physical),()=>{this.pending.delete(physical);if(claim.operations.get(value.operationId)===operation)claim.operations.delete(value.operationId)})
  const result=await physical;guard();return structuredClone(result)
 }
 createAdmission(input:unknown):{admissionId:string;revocation:SharedArrayBuffer}{
  const value=conversationCreateAdmissionSchema.parse(input),entry=this.entry(value.origin),claim=this.task(entry,value.task,value.claimId)
  this.live(entry)
  const operation=claim.operations.get(value.operationId),selection=operation?.result
  if(!operation||!selection||selection.path!==value.selection.path||selection.device!==value.selection.device||selection.inode!==value.selection.inode)fail()
  if(operation.admission)fail('DIRECTORY_OPERATION_IN_PROGRESS')
  if(this.pending.size>=128)fail('DIRECTORY_OPERATION_LIMIT')
  const revocation=new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),flight=Promise.withResolvers<void>()
  const admission:CreationAdmission={id:randomUUID(),origin:{...entry.origin},claimId:claim.id,task:{...claim.task},cell:new Int32Array(revocation),settle:flight.resolve,operation}
  operation.admission=admission;this.admissions.set(admission.id,admission);this.pending.add(flight.promise)
  void flight.promise.then(()=>this.pending.delete(flight.promise))
  return{admissionId:admission.id,revocation}
 }
 finishCreate(input:unknown):true{
  const value=conversationCreateFinishedSchema.parse(input),admission=this.admissions.get(value.admissionId)
  if(!admission)return true
  if(admission.origin.requestId!==value.origin.requestId||admission.origin.nonce!==value.origin.nonce||admission.claimId!==value.claimId||!same(admission.task,value.task))fail()
  this.settleAdmission(admission);return true
 }
 private settleAdmission(admission:CreationAdmission){
  Atomics.store(admission.cell,0,1)
  this.admissions.delete(admission.id)
  if(admission.operation.admission===admission)admission.operation.admission=undefined
  admission.settle()
 }
 /** Only the worker's exit event proves its physical work has ended. An error
  * or a closed renderer revokes seals but must still wait for write cleanup. */
 workerStopped(){this.revokeAll();for(const admission of [...this.admissions.values()])this.settleAdmission(admission)}
 revokeOwner(owner:string){for(const [id,entry]of this.requests)if(entry.owner===owner){this.requests.delete(id);this.revokeClaim(entry.claim)}}
 revokeAll(){const entries=[...this.requests.values()];this.requests.clear();for(const entry of entries)this.revokeClaim(entry.claim)}
 async flush(){while(this.pending.size)await Promise.allSettled([...this.pending])}
}
