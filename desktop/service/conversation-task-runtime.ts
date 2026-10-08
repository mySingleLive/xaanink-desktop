import {AsyncLocalStorage} from 'node:async_hooks'
import type {ChatExecutionScope} from '../../src/lib/chat-execution'
import {ContentError} from '../../src/lib/content-errors'
import {conversationRequestOriginSchema,conversationTaskTupleSchema,conversationClaimReceiptSchema,conversationDirectoryProofSchema,conversationCreateAdmissionReceiptSchema,type ConversationRequestOrigin,type ConversationTaskTuple} from '../shared/conversation-task'
import type {DirectoryProof} from '../main/directory-authority'
export type ConversationTaskTransport=(method:string,input:unknown)=>Promise<unknown>
interface State{origin?:ConversationRequestOrigin;task:ConversationTaskTuple;claimId?:string;finished:boolean;changing?:Promise<void>;finishing?:Promise<void>;releaseDatabase:()=>void}
const tuple=(scope:ChatExecutionScope)=>conversationTaskTupleSchema.parse({conversationId:scope.conversationId,turnId:scope.turnId,attemptId:scope.attemptId,epoch:scope.epoch})
const same=(a:ConversationTaskTuple,b:ConversationTaskTuple)=>a.conversationId===b.conversationId&&a.turnId===b.turnId&&a.attemptId===b.attemptId&&a.epoch===b.epoch
const revoked=()=>new ContentError('EXECUTION_REVOKED','此轮目录授权已失效，原数据已保留')
export class ConversationTaskRuntime{
 private readonly storage=new AsyncLocalStorage<State>()
 constructor(readonly call:ConversationTaskTransport){}
 async run<T>(origin:ConversationRequestOrigin|undefined,scope:ChatExecutionScope,callback:()=>Promise<T>,releaseDatabase:()=>void=()=>{}):Promise<T>{
  const state:State={origin:origin?conversationRequestOriginSchema.parse(origin):undefined,task:tuple(scope),finished:false,releaseDatabase}
  return this.storage.run(state,async()=>{
   try{if(state.origin){state.claimId=conversationClaimReceiptSchema.parse(await this.call('conversation.claim',{origin:state.origin,task:state.task})).claimId;scope.signal?.throwIfAborted()}return await callback()}
   catch(error){await this.finish().catch(()=>{});throw error}
  })
 }
 async refresh(scope:ChatExecutionScope):Promise<void>{
  const state=this.storage.getStore();if(!state||state.finished||state.changing)throw revoked()
  const next=tuple(scope);if(next.conversationId!==state.task.conversationId||next.turnId!==state.task.turnId||next.epoch<=state.task.epoch)throw revoked()
  if(!state.origin){state.task=next;return}
  if(!state.claimId)throw revoked()
  const old={task:state.task,claimId:state.claimId}
  const changing=Promise.resolve().then(async()=>{
   const replacement=conversationClaimReceiptSchema.parse(await this.call('conversation.claim',{origin:state.origin,task:next,previous:old}))
   state.claimId=replacement.claimId;state.task=next;scope.signal?.throwIfAborted()
  })
  state.changing=changing
  try{await changing;if(state.finished)throw revoked()}finally{if(state.changing===changing)state.changing=undefined}
 }
 finish():Promise<void>{
  const state=this.storage.getStore();if(!state)return Promise.resolve()
  if(state.finishing)return state.finishing
  state.finished=true
  // Publish the shared flight before invoking transport callbacks; a release
  // listener cannot reenter and release a task twice.
  return state.finishing=Promise.resolve().then(async()=>{
   await state.changing?.catch(()=>{})
   try{if(state.origin&&state.claimId){const claimId=state.claimId;await this.call('conversation.release',{origin:state.origin,task:state.task,claimId});state.claimId=undefined}}
   finally{state.releaseDatabase()}
  })
 }
 async choose(scope:ChatExecutionScope,input:{title:string;premise?:string;requestId:string}):Promise<DirectoryProof|null>{
  const state=this.storage.getStore()
  if(!state?.origin)throw new ContentError('DIRECTORY_REQUIRED','请在受信桌面窗口中选择作品目录',428)
  const task=tuple(scope),claimId=state.claimId
  if(state.finished||state.changing||!claimId||!same(state.task,task)||!scope.operationId||input.requestId!==scope.operationId)throw revoked()
  scope.signal?.throwIfAborted()
  const result=await this.call('conversation.choose-directory',{origin:state.origin,task,claimId,operationId:scope.operationId,input})
  if(state.finished||state.changing||state.claimId!==claimId||!same(state.task,task))throw revoked()
  scope.signal?.throwIfAborted()
  return result===null?null:conversationDirectoryProofSchema.parse(result)
 }
 async withCreateAdmission<T>(scope:ChatExecutionScope,input:{title:string;premise?:string;requestId:string},selection:DirectoryProof,run:(assertCurrent:()=>void)=>Promise<T>):Promise<T>{
  const state=this.storage.getStore()
  if(!state?.origin)throw new ContentError('DIRECTORY_REQUIRED','请在受信桌面窗口中选择作品目录',428)
  const task=tuple(scope),claimId=state.claimId,origin=state.origin
  const assertTask=()=>{if(state.finished||state.changing||!claimId||state.claimId!==claimId||!same(state.task,task)||!scope.operationId||input.requestId!==scope.operationId)throw revoked();scope.signal?.throwIfAborted()}
  assertTask()
  const admitted=conversationCreateAdmissionReceiptSchema.parse(await this.call('conversation.create-admission',{origin,task,claimId,operationId:scope.operationId,selection:conversationDirectoryProofSchema.parse(selection)}))
  const assertCurrent=()=>{assertTask();if(Atomics.load(new Int32Array(admitted.revocation),0)!==0)throw revoked()}
  try{assertCurrent();return await run(assertCurrent)}
  finally{await this.call('conversation.create-finished',{origin,task,claimId,admissionId:admitted.admissionId})}
 }
}
