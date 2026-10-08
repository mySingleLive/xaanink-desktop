import type {Prisma} from '../../src/generated/prisma/client'
import {conversationDigest,parseConversationBundle} from './conversation-bundle'
import type {Workspaces,WorkRecord} from './workspaces'
import {ConversationTransfers} from './conversation-transfer'
import {ConversationTransferLedger} from './conversation-ledger'
import {getDatabaseContext,retainDatabaseTask} from './context'
import {ConversationTaskRuntime,type ConversationTaskTransport} from './conversation-task-runtime'
import {assertChatExecution,outsideChatExecution,type ChatExecutionScope} from '../../src/lib/chat-execution'
import {ContentError} from '../../src/lib/content-errors'
import {conversationAssociationSchema,createdConversationWorkSchema,type CreatedConversationWork,type ConversationAssociation} from '../shared/conversation-transfer'
interface Runtime{works:Workspaces;manager:ConversationTransfers;tasks:ConversationTaskRuntime}
let active:Runtime|undefined
/** Boot-only dependency injection. It never replaces a global Prisma client. */
export function configureConversationTransfers(works:Workspaces,call:ConversationTaskTransport):()=>void{
 const previous=active,tasks=new ConversationTaskRuntime(call)
 const receipt=(record:WorkRecord):Promise<CreatedConversationWork>=>works.run(record.id,async()=>{const novel=await getDatabaseContext().database.novel.findFirstOrThrow({where:{id:record.novelId,userId:'local-author',status:{not:'DELETED'}},select:{id:true,title:true,status:true,currentStage:true,createdAt:true,updatedAt:true}});return createdConversationWorkSchema.parse({workspaceId:record.id,novelId:record.novelId,receipt:{...novel,createdAt:novel.createdAt.toISOString(),updatedAt:novel.updatedAt.toISOString()}})})
 const ledger=new ConversationTransferLedger(run=>works.run('inbox',()=>run(getDatabaseContext().database)))
 const manager=new ConversationTransfers({
  withWorkspace:(id,run)=>works.runWithGlobal(id,()=>run(getDatabaseContext())),
  findCreatedWork:async operationId=>{const found=(await works.list()).filter(row=>row.requestId===operationId);if(found.length>1)throw new ContentError('REQUEST_CONFLICT','建书请求存在多份目录，原数据已保留');return found.length?receipt(found[0]):null},
  findNovel:async novelId=>{const found=(await works.list()).filter(row=>row.novelId===novelId);if(found.length!==1)throw new ContentError('NOVEL_UNAVAILABLE','作品未关联有效本地目录',410);return{workspaceId:found[0].id,novelId}},
  createWork:async(scope,input)=>{
   const selection=await tasks.choose(scope,input)
   if(!selection){await works.assertNoPendingCreation(input.requestId);return null}
   scope.signal?.throwIfAborted()
   const location=await manager.current(scope.conversationId)
   await manager.gate.run(scope.conversationId,()=>works.runWithGlobal(location.workspaceId,()=>getDatabaseContext().database.$transaction(tx=>assertChatExecution(tx,scope))))
   scope.signal?.throwIfAborted()
   const record=await tasks.withCreateAdmission(scope,input,selection,assertCurrent=>outsideChatExecution(()=>{assertCurrent();return works.create(selection,input,assertCurrent)}))
   return receipt(record)
  },
 },ledger)
 active={works,manager,tasks};return()=>{if(active?.manager===manager)active=previous}
}
export const conversationTransfersFor=(works:Workspaces)=>active?.works===works?active.manager:undefined
export function withConversationContext<T>(id:string,run:()=>Promise<T>):Promise<T>{return active?active.manager.bind(id,run):run()}
export function withConversationToolContext<T>(id:string,run:()=>Promise<T>):Promise<T>{return active?active.manager.withToolContext(id,run):run()}
export async function runConversationTask<T>(scope:ChatExecutionScope,run:()=>Promise<T>):Promise<T>{
 if(!active)return run()
 const runtime=active
 return runtime.manager.bind(scope.conversationId,async()=>{
  await runtime.manager.ledger.indexEntity(scope.conversationId,'turn',scope.turnId)
  await runtime.manager.ledger.indexEntity(scope.conversationId,'attempt',scope.attemptId)
  return runtime.tasks.run(getDatabaseContext().requestOrigin,scope,run,retainDatabaseTask())
 })
}
export async function refreshConversationTask(scope:ChatExecutionScope){if(active){await active.manager.ledger.indexEntity(scope.conversationId,'attempt',scope.attemptId);await active.tasks.refresh(scope)}}
export const finishConversationTask=()=>active?.tasks.finish()??Promise.resolve()
export const conversationLocation=(id:string)=>active?.manager.current(id)??Promise.resolve(null)
export async function associateConversation(id:string,input:ConversationAssociation){
 if(!active)throw new ContentError('CONVERSATION_AUTHORITY_UNAVAILABLE','会话目录服务暂不可用',410)
 return active.manager.associate(id,conversationAssociationSchema.parse(input))
}
export async function removeConversation(id:string){if(!active)throw new ContentError('CONVERSATION_AUTHORITY_UNAVAILABLE','会话目录服务暂不可用',410);await active.manager.remove(id)}
export const recoverConversationTransfers=(works:Workspaces)=>conversationTransfersFor(works)?.recover()??Promise.resolve([])
export async function startConversationNovel(scope:ChatExecutionScope,input:{title:string;premise?:string}){
 if(!active)throw new ContentError('DIRECTORY_REQUIRED','请在受信桌面窗口中选择作品目录',428)
 return active.manager.startNovel(scope,input)
}
export async function conversationHistory(id:string){
 if(!active)return[]
 const location=await active.manager.current(id),result=[]
 for(const operationId of location.historicalTransfers){const journal=await active.manager.ledger.journal(operationId);if(!journal||journal.conversationId!==id||!journal.bundle)throw new ContentError('CONVERSATION_GRAPH_INVALID','会话历史来源不完整');const bundle=parseConversationBundle(journal.bundle);if(conversationDigest(bundle)!==journal.bundleDigest)throw new ContentError('CONVERSATION_GRAPH_INVALID','会话历史证据不完整');result.push({sourceWorkspaceId:journal.source.workspaceId,sourceNovelId:journal.source.novelId,history:bundle.history})}
 return result
}

/** Only the original start tool may reconcile its own known durable journal.
 * Reuse the supplied inbox tx: borrowing that same engine would self-wait. */
export async function canResumeConversationCreation(id:string,operationId:string,transaction:Prisma.TransactionClient):Promise<boolean>{
 if(!active)return false
 const global=getDatabaseContext().workspaceId==='inbox'?transaction:undefined
 const journal=await active.manager.ledger.journal(operationId,global),location=await active.manager.ledger.location(id,global)
 if(!journal||!location||location.deleted||journal.userId!=='local-author'||journal.conversationId!==id||!journal.creationInput)return false
 if(['committed','cleanup-pending','complete'].includes(journal.phase))return !!journal.target&&location.workspaceId===journal.target.workspaceId&&location.novelId===journal.target.novelId&&location.historicalTransfers.includes(operationId)
 return ['authorizing','cancelled','prepared','copied'].includes(journal.phase)&&conversationDigest(location)===conversationDigest(journal.source)
}
