import type {Prisma,PrismaClient} from '../../src/generated/prisma/client'
import type {ChatExecutionScope} from '../../src/lib/chat-execution'
import {ContentError} from '../../src/lib/content-errors'
import {conversationDirectoryRequestSchema,createdConversationWorkSchema,type CreatedConversationWork,type ConversationLocation,type ConversationTransferJournal,type ConversationAssociation} from '../shared/conversation-transfer'
import {captureConversationBundle,cleanupConversationSource,copyConversationBundle,discardConversationCopy,verifyConversationCopyInTransaction,withVerifiedConversationCopy,conversationDigest,parseConversationBundle,type ConversationBundle} from './conversation-bundle'
import type {ConversationTransferLedger} from './conversation-ledger'
import {ConversationPhaseGate} from './conversation-phase'
import {getDatabaseContext,runInDatabaseContext,type DatabaseContext,type DatabaseAuthority} from './context'
export interface ConversationTransferHost{
 withWorkspace<T>(id:string,run:(context:DatabaseContext)=>Promise<T>):Promise<T>
 createWork(scope:ChatExecutionScope,input:{title:string;premise?:string;requestId:string},signal?:AbortSignal):Promise<CreatedConversationWork|null>
 findCreatedWork(operationId:string):Promise<CreatedConversationWork|null>
 findNovel(novelId:string):Promise<{workspaceId:string;novelId:string}>
}
export interface ConversationTransferOperations{
 capture(database:PrismaClient,workspace:string,id:string,scope?:ChatExecutionScope):Promise<ConversationBundle>
 copy(database:PrismaClient,bundle:ConversationBundle,novelId:string|null,operationId:string):Promise<void>
 confirm<T>(context:DatabaseContext,bundle:ConversationBundle,novelId:string|null,operationId:string,publish:()=>Promise<T>,globalTransaction:Prisma.TransactionClient):Promise<T>
 discard(database:PrismaClient,bundle:ConversationBundle,novelId:string|null,operationId:string):Promise<void>
 cleanup(database:PrismaClient,bundle:ConversationBundle):Promise<void>
}
const originalOperations:ConversationTransferOperations={capture:captureConversationBundle,copy:copyConversationBundle,discard:discardConversationCopy,cleanup:cleanupConversationSource,confirm:async(context,bundle,novelId,operationId,publish,global)=>{
 if(context.workspaceId==='inbox'){await verifyConversationCopyInTransaction(global,bundle,novelId,operationId);return publish()}
 return withVerifiedConversationCopy(context.database,bundle,novelId,operationId,publish)
}}
interface Binding extends DatabaseAuthority{conversationId:string;capture(context:DatabaseContext):void;finish():void}
export interface ConversationRecoveryResult{operationId:string;phase:'complete'|'pending'|'unavailable';code?:string}
const locationChanged=()=>new ContentError('CONVERSATION_LOCATION_CHANGED','会话位置已变化，原数据已保留')
const deletionPending=(cause:unknown)=>Object.assign(new ContentError('CONVERSATION_DELETION_PENDING','会话已停止使用，目录清理尚未完成，请重试删除',409),{cause})
const missingDeletionSource=(error:unknown)=>{
 const cause=error instanceof Error?error.cause:undefined
 return !!cause&&typeof cause==='object'&&('code'in cause&&['ENOENT','ENOTDIR'].includes(String(cause.code))||cause instanceof Error&&cause.message==='作品不在本地目录索引中')
}
export class ConversationTransfers{
 private readonly bindings=new Map<string,Set<Binding>>()
 constructor(readonly host:ConversationTransferHost,readonly ledger:ConversationTransferLedger,readonly gate=new ConversationPhaseGate(),readonly operations:ConversationTransferOperations=originalOperations){}
 async current(id:string):Promise<ConversationLocation>{
  const existing=await this.ledger.location(id)
  if(existing){if(existing.deleted)throw new ContentError('CONVERSATION_NOT_FOUND','会话不存在',404);return existing}
  // This scope was selected by the dispatcher after one unambiguous legacy
  // owned hit, or is the exact scope in which beginChatRequest created a chat.
  const context=getDatabaseContext(),row=await context.database.conversation.findFirst({where:{id,userId:'local-author'},select:{id:true,novelId:true}})
  if(!row)throw new ContentError('CONVERSATION_NOT_FOUND','会话不存在或无权访问',404)
  return this.ledger.register({conversationId:id,userId:'local-author',workspaceId:context.workspaceId,novelId:row.novelId})
 }
 private async owned<T>(id:string,location:ConversationLocation,run:(context:DatabaseContext)=>Promise<T>):Promise<T>{return this.host.withWorkspace(location.workspaceId,async context=>{
  if(context.workspaceId!==location.workspaceId)throw locationChanged()
  const row=await context.database.conversation.findFirst({where:{id,userId:'local-author'},select:{id:true,novelId:true}})
  if(!row||row.novelId!==location.novelId)throw locationChanged()
  return run(context)
 })}
 async bind<T>(id:string,run:()=>Promise<T>):Promise<T>{
  const context=getDatabaseContext(),present=context.authority as Binding|undefined
  if(present?.conversationId===id)return run()
  await this.current(id)
  let finished=false,tasks=0;const retained=new Map<string,()=>void>(),set=this.bindings.get(id)??new Set<Binding>();this.bindings.set(id,set)
  const release=()=>{if(!finished||tasks)return;for(const done of retained.values())done();retained.clear();set.delete(binding);if(!set.size)this.bindings.delete(id)}
  const capture=(fixed:DatabaseContext)=>{if(tasks&&!retained.has(fixed.workspaceId)){if(!fixed.retainTask)throw new ContentError('CONVERSATION_LEASE_UNAVAILABLE','会话数据库租约不可用');retained.set(fixed.workspaceId,fixed.retainTask())}}
  const binding:Binding={conversationId:id,capture,finish(){finished=true;release()},execute:operation=>this.gate.run(id,async()=>this.owned(id,await this.current(id),fixed=>{capture(fixed);return runInDatabaseContext({...fixed,requestOrigin:context.requestOrigin,authority:binding,authorityPhase:true},()=>operation({...fixed,requestOrigin:context.requestOrigin,authority:binding,authorityPhase:true}))})),retainTask:()=>{
   tasks++;try{capture(getDatabaseContext())}catch(error){tasks--;throw error}
   let done=false;return()=>{if(done)return;done=true;tasks--;release()}
  }}
  set.add(binding)
  try{return await runInDatabaseContext({...context,authority:binding,authorityPhase:false},run)}finally{binding.finish()}
 }
 /** Workspace/assets are fixed when the tool begins. Its network waits do not
  * hold the phase gate; each original DB transaction still enters the binding. */
 async withToolContext<T>(id:string,run:()=>Promise<T>):Promise<T>{return this.bind(id,async()=>{
  const authority=getDatabaseContext().authority as Binding,requestOrigin=getDatabaseContext().requestOrigin
  const location=await this.gate.run(id,()=>this.current(id))
  return this.owned(id,location,context=>{authority.capture(context);return runInDatabaseContext({...context,requestOrigin,authority,authorityPhase:false},run)})
 })}
 async startNovel(scope:ChatExecutionScope,input:{title:string;premise?:string}):Promise<CreatedConversationWork|null>{
  if(scope.userId!=='local-author'||!scope.operationId)throw new ContentError('PRECONDITION_REQUIRED','缺少有效本地建书操作',428)
  scope.signal?.throwIfAborted()
  const request=conversationDirectoryRequestSchema.parse({conversationId:scope.conversationId,operationId:scope.operationId,input:{...input,requestId:scope.operationId}}),hash=conversationDigest(request.input)
  let journal=await this.ledger.journal(scope.operationId)
  if(journal&&(journal.requestHash!==hash||journal.conversationId!==scope.conversationId))throw new ContentError('REQUEST_CONFLICT','建书编号已用于不同请求')
  if(journal?.phase==='cancelled')return null
  if(journal&&['committed','cleanup-pending','complete'].includes(journal.phase)){await this.current(scope.conversationId);return journal.creationReceipt??null}
  const location=await this.current(scope.conversationId)
  if(location.novelId)throw new ContentError('CONVERSATION_ALREADY_ASSOCIATED','当前会话已有作品，请开始新会话')
  await this.owned(scope.conversationId,location,async context=>{const row=await context.database.conversation.findFirst({where:{id:scope.conversationId,userId:scope.userId},select:{activeAttemptId:true,executionEpoch:true}});if(!row||row.activeAttemptId!==scope.attemptId||row.executionEpoch!==scope.epoch)throw new ContentError('EXECUTION_REVOKED','本轮执行已停止')})
  journal??=await this.ledger.prepare({conversationId:scope.conversationId,operationId:scope.operationId,requestHash:hash,source:location,target:null,creationInput:request.input})
  if(!journal.target){
   const created=await this.host.findCreatedWork(scope.operationId)??await this.host.createWork(scope,request.input,scope.signal)
   if(!created){await this.ledger.cancel(scope.operationId);return null}
   // A grant creates the original novel first, but is never content approval.
   // Persist its exact receipt before any cross-database copying.
   journal=await this.ledger.target(scope.operationId,{workspaceId:created.workspaceId,novelId:created.novelId},createdConversationWorkSchema.parse(created))
  }
  scope.signal?.throwIfAborted()
  await this.transfer(journal,scope.signal,scope)
  return journal.creationReceipt??(await this.ledger.journal(scope.operationId))?.creationReceipt??null
 }
 async associate(id:string,input:ConversationAssociation):Promise<ConversationLocation>{
  const current=await this.current(id),target=input.novelId?await this.host.findNovel(input.novelId):{workspaceId:'inbox',novelId:null}
  const hash=conversationDigest({targetNovelId:input.novelId,expectedLocationRevision:input.expectedLocationRevision})
  const previous=await this.ledger.journal(input.operationId)
  if(previous){if(previous.conversationId!==id||previous.requestHash!==hash)throw new ContentError('REQUEST_CONFLICT','关联编号已用于不同请求');return this.transfer(previous)}
  if(current.revision!==input.expectedLocationRevision)throw locationChanged()
  await this.owned(id,current,async context=>{const row=await context.database.conversation.findFirst({where:{id,userId:'local-author'},select:{activeAttemptId:true}});if(row?.activeAttemptId||await context.database.subAgentRun.count({where:{conversationId:id,status:'running'}}))throw new ContentError('CONVERSATION_BUSY','请先停止并保存当前创作任务')})
  if(current.workspaceId===target.workspaceId&&current.novelId===target.novelId)return current
  return this.transfer(await this.ledger.prepare({conversationId:id,operationId:input.operationId,requestHash:hash,source:current,target}))
 }
 async remove(id:string):Promise<void>{return this.gate.transfer(id,async()=>{
  let location=await this.ledger.location(id)??await this.current(id)
  if(!location.deleted){
   if(location.workspaceId==='inbox'){await this.ledger.remove(location,async tx=>{const row=await tx.conversation.findFirst({where:{id,userId:'local-author'},select:{novelId:true}});if(!row||row.novelId!==location.novelId)throw locationChanged();await tx.conversation.delete({where:{id}})});return}
   const source=location
   try{
    await this.owned(id,source,context=>context.database.$transaction(async tx=>{
     await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id=${id} AND "userId"='local-author' FOR UPDATE`
     const row=await tx.conversation.findFirst({where:{id,userId:'local-author'},select:{novelId:true}});if(!row||row.novelId!==source.novelId)throw locationChanged()
     location=await this.ledger.remove(source)
     await tx.conversation.delete({where:{id}})
    },{timeout:60_000}))
   }catch(error){if(location.deleted)throw deletionPending(error);throw error}
   await this.ledger.finishDeletion(id);return
  }
  const deletion=await this.ledger.deletion(id)
  if(!deletion||deletion.revision!==location.revision||deletion.source.workspaceId!==location.workspaceId)throw locationChanged()
  if(deletion.phase==='complete')return
  try{
   await this.host.withWorkspace(location.workspaceId,context=>context.database.$transaction(async tx=>{
    const row=await tx.conversation.findUnique({where:{id},select:{userId:true,novelId:true}})
    if(!row)return
    if(row.userId!=='local-author'||row.novelId!==deletion.source.novelId)throw locationChanged()
    await tx.conversation.delete({where:{id}})
   },{timeout:60_000}))
   await this.ledger.finishDeletion(id)
  }catch(error){throw deletionPending(error)}
 })}
 /** Boot recovery never repeats a model, business tool or native picker. Only
  * an inactive durable transfer may continue its copy/verify/commit sequence.
  * Missing directories remain unavailable authorities and do not become scans. */
 async recover():Promise<ConversationRecoveryResult[]>{
  const results:ConversationRecoveryResult[]=[]
  for(const deletion of await this.ledger.deletions?.()??[])if(deletion.phase==='committed'){
   const operationId='delete:'+conversationDigest(deletion.source.conversationId)
   try{await this.remove(deletion.source.conversationId);results.push({operationId,phase:'complete'})}
   catch(error){if(!(error instanceof ContentError&&error.code==='CONVERSATION_DELETION_PENDING'&&missingDeletionSource(error)))throw error;results.push({operationId,phase:'pending',code:error.code})}
  }
  for(const initial of await this.ledger.journals()){
   try{
    let journal=initial
    const location=await this.ledger.location(journal.conversationId)
    if(!location||location.deleted)throw locationChanged()
    if(journal.bundle){const bundle=parseConversationBundle(journal.bundle);if(conversationDigest(bundle)!==journal.bundleDigest)throw new ContentError('CONVERSATION_GRAPH_INVALID','会话转移证据不完整')}
    if(['committed','cleanup-pending','complete'].includes(journal.phase)){
     if(!location.historicalTransfers.includes(journal.operationId)||location.revision<=journal.source.revision)throw locationChanged()
     // Earlier journals remain provenance after subsequent transfers; only the
     // current authority determines which actual graph must be available.
     await this.owned(journal.conversationId,location,context=>this.operations.capture(context.database,context.workspaceId,journal.conversationId))
     if(journal.phase!=='complete'&&journal.source.workspaceId!==location.workspaceId){
      try{await this.host.withWorkspace(journal.source.workspaceId,context=>this.operations.cleanup(context.database,parseConversationBundle(journal.bundle)));await this.ledger.finish(journal.operationId)}
      catch(error){await this.ledger.finish(journal.operationId,error instanceof ContentError&&error.code==='CONVERSATION_SOURCE_CHANGED'?'SOURCE_CHANGED':'SOURCE_UNAVAILABLE');results.push({operationId:journal.operationId,phase:'pending',code:'SOURCE_UNAVAILABLE'});continue}
     }
     results.push({operationId:journal.operationId,phase:'complete'});continue
    }
    if(conversationDigest(location)!==conversationDigest(journal.source))throw locationChanged()
    if(journal.phase==='cancelled'){results.push({operationId:journal.operationId,phase:'complete'});continue}
    const busy=await this.owned(journal.conversationId,location,async context=>{
     const row=await context.database.conversation.findFirst({where:{id:journal.conversationId,userId:'local-author'},select:{activeAttemptId:true}})
     return !!row?.activeAttemptId||await context.database.subAgentRun.count({where:{conversationId:journal.conversationId,status:'running'}})>0
    })
    if(!journal.target&&journal.creationInput){const created=await this.host.findCreatedWork(journal.operationId);if(created)journal=await this.ledger.target(journal.operationId,{workspaceId:created.workspaceId,novelId:created.novelId},created)}
    if(busy||!journal.target){results.push({operationId:journal.operationId,phase:'pending'});continue}
    await this.transfer(journal)
    const finished=await this.ledger.journal(journal.operationId)
    results.push({operationId:journal.operationId,phase:finished?.phase==='complete'?'complete':'pending',...(finished?.cleanupCode?{code:finished.cleanupCode}:{})})
   }catch(error){results.push({operationId:initial.operationId,phase:'unavailable',code:error instanceof ContentError?error.code:'CONVERSATION_AUTHORITY_UNAVAILABLE'})}
  }
  return results
 }
 private async transfer(initial:ConversationTransferJournal,signal?:AbortSignal,scope?:ChatExecutionScope):Promise<ConversationLocation>{return this.gate.transfer(initial.conversationId,async()=>{
  const journal=(await this.ledger.journal(initial.operationId))!
  if(['committed','cleanup-pending','complete'].includes(journal.phase))return this.current(journal.conversationId)
  if(!journal.target)throw locationChanged()
  const target=journal.target,bundle=await this.owned(journal.conversationId,journal.source,async context=>{if(!scope){const current=await context.database.conversation.findFirst({where:{id:journal.conversationId,userId:'local-author'},select:{activeAttemptId:true}});if(current?.activeAttemptId||await context.database.subAgentRun.count({where:{conversationId:journal.conversationId,status:'running'}}))throw new ContentError('CONVERSATION_BUSY','请先停止并保存当前创作任务')}return this.operations.capture(context.database,context.workspaceId,journal.conversationId,scope)})
  if(journal.bundle&&journal.bundleDigest!==conversationDigest(bundle))await this.host.withWorkspace(target.workspaceId,context=>this.operations.discard(context.database,parseConversationBundle(journal.bundle),target.novelId,journal.operationId))
  await this.ledger.captured(journal.operationId,bundle)
  const location=await this.host.withWorkspace(target.workspaceId,async context=>{
   await this.operations.copy(context.database,bundle,target.novelId,journal.operationId)
   signal?.throwIfAborted()
   const next=await this.ledger.commit(journal.operationId,(_value,publish,global)=>this.operations.confirm(context,bundle,target.novelId,journal.operationId,publish,global))
   for(const binding of this.bindings.get(journal.conversationId)??[])binding.capture(context)
   return next
  })
  // Cleanup failure cannot undo an already committed authority or create again.
  try{await this.host.withWorkspace(journal.source.workspaceId,context=>this.operations.cleanup(context.database,bundle));await this.ledger.finish(journal.operationId)}catch(error){await this.ledger.finish(journal.operationId,error instanceof ContentError&&error.code==='CONVERSATION_SOURCE_CHANGED'?'SOURCE_CHANGED':'SOURCE_UNAVAILABLE')}
  return location
 },signal)}
}
