import type {Prisma,PrismaClient} from '../../src/generated/prisma/client'
import {ContentError} from '../../src/lib/content-errors'
import {lockContentOperation} from '../../src/lib/services/content-commit'
import {conversationLocationSchema,transferJournalSchema,type ConversationLocation,type ConversationTransferJournal} from '../shared/conversation-transfer'
import {conversationDigest,parseConversationBundle,type ConversationBundle} from './conversation-bundle'
import {z} from 'zod'
type WithGlobal=<T>(run:(database:PrismaClient)=>Promise<T>)=>Promise<T>
const locationKey=(id:string)=>'desktop:conversation-location:'+conversationDigest(id)
const transferKey=(id:string)=>'desktop:conversation-transfer:'+conversationDigest(id)
const deletionKey=(id:string)=>'desktop:conversation-deletion:'+conversationDigest(id)
const deletionSchema=z.object({version:z.literal(1),source:conversationLocationSchema,revision:z.number().int().nonnegative(),phase:z.enum(['committed','complete'])}).strict()
export const conversationEntityKey=(kind:'turn'|'attempt'|'subagent',id:string)=>'desktop:conversation-entity:'+kind+':'+conversationDigest(id)
const encoded=(value:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(value))
function changed():never{throw new ContentError('CONVERSATION_LOCATION_CHANGED','会话位置已变化，请重新读取后重试')}
export type ConversationTargetGuard=(journal:ConversationTransferJournal,publish:()=>Promise<ConversationLocation>,globalTransaction:Prisma.TransactionClient)=>Promise<ConversationLocation>
export interface PrepareConversationTransfer {conversationId:string;operationId:string;requestHash:string;source:ConversationLocation;target:ConversationTransferJournal['target'];creationInput?:ConversationTransferJournal['creationInput']}
/** All authority changes and journal transitions commit in the existing inbox
 * DB, under the same original advisory lock and local transaction. */
export class ConversationTransferLedger{
 constructor(private readonly withGlobal:WithGlobal){}
 async location(id:string,transaction?:Prisma.TransactionClient):Promise<ConversationLocation|null>{const read=async(database:Prisma.TransactionClient)=>{const row=await database.systemConfig.findUnique({where:{key:locationKey(id)}});return row?conversationLocationSchema.parse(row.value):null};return transaction?read(transaction):this.withGlobal(read)}
 async journal(operationId:string,transaction?:Prisma.TransactionClient):Promise<ConversationTransferJournal|null>{const read=async(database:Prisma.TransactionClient)=>{const row=await database.systemConfig.findUnique({where:{key:transferKey(operationId)}});return row?transferJournalSchema.parse(row.value):null};return transaction?read(transaction):this.withGlobal(read)}
 async register(input:Omit<ConversationLocation,'version'|'revision'|'historicalTransfers'|'deleted'>):Promise<ConversationLocation>{
  return this.transaction(input.conversationId,async tx=>{
   const old=await tx.systemConfig.findUnique({where:{key:locationKey(input.conversationId)}})
   if(old)return conversationLocationSchema.parse(old.value)
   const value=conversationLocationSchema.parse({...input,version:1,revision:0,historicalTransfers:[],deleted:false})
   await tx.systemConfig.create({data:{key:locationKey(input.conversationId),value:encoded(value)}});return value
  })
 }
 async prepare(input:PrepareConversationTransfer):Promise<ConversationTransferJournal>{
  return this.transaction(input.conversationId,async tx=>{
   const previous=await tx.systemConfig.findUnique({where:{key:transferKey(input.operationId)}})
   if(previous){const value=transferJournalSchema.parse(previous.value);if(value.conversationId!==input.conversationId||value.requestHash!==input.requestHash)throw new ContentError('REQUEST_CONFLICT','转移编号已用于不同请求');return value}
   await this.assertSource(tx,input.source)
   const now=new Date().toISOString(),value=transferJournalSchema.parse({...input,userId:'local-author',version:1,phase:input.target?'prepared':'authorizing',createdAt:now,updatedAt:now})
   await tx.systemConfig.create({data:{key:transferKey(input.operationId),value:encoded(value)}});return value
  })
 }
 async target(operationId:string,target:NonNullable<ConversationTransferJournal['target']>,creationReceipt?:ConversationTransferJournal['creationReceipt']):Promise<ConversationTransferJournal>{return this.mutate(operationId,async(tx,value)=>{
  if(value.target){if(conversationDigest(value.target)!==conversationDigest(target))throw new ContentError('REQUEST_CONFLICT','该转移已有其他目标');return value}
  if(!['authorizing','cancelled'].includes(value.phase))changed();await this.assertSource(tx,value.source)
  return transferJournalSchema.parse({...value,target,creationReceipt,phase:'prepared',updatedAt:new Date().toISOString()})
 })}
 async captured(operationId:string,bundle:ConversationBundle):Promise<ConversationTransferJournal>{return this.mutate(operationId,async(tx,value)=>{
  const parsed=parseConversationBundle(bundle)
  if(!['prepared','copied'].includes(value.phase)||!value.target||parsed.conversationId!==value.conversationId||parsed.sourceWorkspaceId!==value.source.workspaceId||parsed.sourceNovelId!==value.source.novelId)changed()
  await this.assertSource(tx,value.source)
  return transferJournalSchema.parse({...value,bundle:encoded(parsed),bundleDigest:conversationDigest(parsed),phase:'copied',updatedAt:new Date().toISOString()})
 })}
 async commit(operationId:string,guard?:ConversationTargetGuard):Promise<ConversationLocation>{return this.mutate(operationId,async(tx,value)=>{
  if(['committed','cleanup-pending','complete'].includes(value.phase))return this.commitInTransaction(tx,value)
  if(!guard)throw new ContentError('CONVERSATION_TARGET_UNCONFIRMED','目标会话尚未验证，原会话已保留')
  // The trusted guard holds the target's original row/connection lease through
  // the global CAS. A copied/captured journal is never itself target proof.
  let published:Promise<ConversationLocation>|undefined
  const result=await guard(value,()=>published??=this.commitInTransaction(tx,value),tx)
  if(!published)throw new ContentError('CONVERSATION_TARGET_UNCONFIRMED','目标会话尚未验证，原会话已保留')
  const actual=await published
  if(conversationDigest(actual)!==conversationDigest(result))changed()
  return actual
 },true) as Promise<ConversationLocation>}
 private async commitInTransaction(tx:Prisma.TransactionClient,value:ConversationTransferJournal):Promise<ConversationLocation>{
  if(['committed','cleanup-pending','complete'].includes(value.phase)){const row=await tx.systemConfig.findUniqueOrThrow({where:{key:locationKey(value.conversationId)}});const current=conversationLocationSchema.parse(row.value);if(!value.target||current.workspaceId!==value.target.workspaceId||current.novelId!==value.target.novelId||!current.historicalTransfers.includes(value.operationId))changed();return current}
  if(value.phase!=='copied'||!value.target||!value.bundle||!value.bundleDigest)changed()
  const bundle=parseConversationBundle(value.bundle);if(conversationDigest(bundle)!==value.bundleDigest)changed()
  await this.assertSource(tx,value.source)
  const location=conversationLocationSchema.parse({...value.source,...value.target,revision:value.source.revision+1,historicalTransfers:[...value.source.historicalTransfers,value.operationId]})
  await tx.systemConfig.update({where:{key:locationKey(value.conversationId)},data:{value:encoded(location)}})
  const committed={...value,phase:'committed',updatedAt:new Date().toISOString()};await tx.systemConfig.update({where:{key:transferKey(value.operationId)},data:{value:encoded(committed)}})
  const entities=[...bundle.tables.ChatTurn.map(row=>({kind:'turn' as const,id:String(row.id)})),...bundle.tables.ChatAttempt.map(row=>({kind:'attempt' as const,id:String(row.id)})),...bundle.history.SubAgentRun.map(row=>({kind:'subagent' as const,id:String(row.id),historicalWorkspaceId:value.source.workspaceId}))]
  // Cross-conversation identities share an advisory lock, acquired in stable
  // order. A prior route is an ownership contract, never an upsert overwrite.
  for(const entity of entities.sort((a,b)=>conversationEntityKey(a.kind,a.id).localeCompare(conversationEntityKey(b.kind,b.id))))await this.writeEntity(tx,value.conversationId,entity.kind,entity.id,'historicalWorkspaceId'in entity?entity.historicalWorkspaceId:undefined)
  return location
 }
 async finish(operationId:string,cleanupCode?:ConversationTransferJournal['cleanupCode']){return this.mutate(operationId,async(_tx,value)=>{if(!['committed','cleanup-pending','complete'].includes(value.phase))changed();return{...value,phase:cleanupCode?'cleanup-pending':'complete',cleanupCode,updatedAt:new Date().toISOString()}})}
 async cancel(operationId:string){return this.mutate(operationId,async(_tx,value)=>{if(value.target||!['authorizing','cancelled'].includes(value.phase))changed();return{...value,phase:'cancelled',updatedAt:new Date().toISOString()}})}
 async indexEntity(conversationId:string,kind:'turn'|'attempt'|'subagent',id:string,historicalWorkspaceId?:string){return this.transaction(conversationId,async tx=>{
  const owned=await tx.systemConfig.findUnique({where:{key:locationKey(conversationId)}})
  if(!owned||conversationLocationSchema.parse(owned.value).deleted)changed()
  await this.writeEntity(tx,conversationId,kind,id,historicalWorkspaceId)
 })}
 private async writeEntity(tx:Prisma.TransactionClient,conversationId:string,kind:'turn'|'attempt'|'subagent',id:string,historicalWorkspaceId?:string){
  const key=conversationEntityKey(kind,id),value={version:1,conversationId,kind,id,...(historicalWorkspaceId?{historicalWorkspaceId}:{})}
  await lockContentOperation(tx,'local-author',key)
  const previous=await tx.systemConfig.findUnique({where:{key}})
  if(previous){if(conversationDigest(previous.value)!==conversationDigest(value))changed();return}
  await tx.systemConfig.create({data:{key,value}})
 }
 async journals(){return this.withGlobal(async database=>(await database.systemConfig.findMany({where:{key:{startsWith:'desktop:conversation-transfer:'}}})).map(row=>transferJournalSchema.parse(row.value)))}
 async locations(){return this.withGlobal(async database=>(await database.systemConfig.findMany({where:{key:{startsWith:'desktop:conversation-location:'}}})).map(row=>conversationLocationSchema.parse(row.value)))}
 async deletion(id:string,tx?:Prisma.TransactionClient){const read=async(database:Prisma.TransactionClient)=>{const row=await database.systemConfig.findUnique({where:{key:deletionKey(id)}});return row?deletionSchema.parse(row.value):null};return tx?read(tx):this.withGlobal(read)}
 async deletions(){return this.withGlobal(async database=>(await database.systemConfig.findMany({where:{key:{startsWith:'desktop:conversation-deletion:'}}})).map(row=>deletionSchema.parse(row.value)))}
 async remove(source:ConversationLocation,deleteInInbox?:(tx:Prisma.TransactionClient)=>Promise<void>):Promise<ConversationLocation>{return this.transaction(source.conversationId,async tx=>{
  await this.assertSource(tx,source)
  if(deleteInInbox)await deleteInInbox(tx)
  const location=conversationLocationSchema.parse({...source,revision:source.revision+1,deleted:true})
  await tx.systemConfig.update({where:{key:locationKey(source.conversationId)},data:{value:encoded(location)}})
  await tx.systemConfig.create({data:{key:deletionKey(source.conversationId),value:encoded({version:1,source,revision:location.revision,phase:deleteInInbox?'complete':'committed'})}})
  return location
 })}
 async finishDeletion(id:string){return this.transaction(id,async tx=>{const deletion=await this.deletion(id,tx),location=await this.location(id,tx);if(!deletion||!location?.deleted||location.revision!==deletion.revision)changed();await tx.systemConfig.update({where:{key:deletionKey(id)},data:{value:encoded({...deletion,phase:'complete'})}})})}
 async entity(kind:'turn'|'attempt'|'subagent',id:string){return this.withGlobal(async database=>{const row=await database.systemConfig.findUnique({where:{key:conversationEntityKey(kind,id)}});if(!row)return null;const value=row.value;if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||value.kind!==kind||value.id!==id||typeof value.conversationId!=='string'||('historicalWorkspaceId'in value&&typeof value.historicalWorkspaceId!=='string'))throw new ContentError('CONVERSATION_GRAPH_INVALID','会话索引不完整');return{conversationId:value.conversationId,historicalWorkspaceId:typeof value.historicalWorkspaceId==='string'?value.historicalWorkspaceId:undefined}})}
 private async assertSource(tx:Prisma.TransactionClient,source:ConversationLocation){const row=await tx.systemConfig.findUnique({where:{key:locationKey(source.conversationId)}});if(!row||conversationDigest(conversationLocationSchema.parse(row.value))!==conversationDigest(source)||source.deleted)changed()}
 private async transaction<T>(conversationId:string,run:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{return this.withGlobal(database=>database.$transaction(async tx=>{await lockContentOperation(tx,'local-author','conversation-transfer:'+conversationId);return run(tx)},{timeout:60_000}))}
 private async mutate<T>(operationId:string,run:(tx:Prisma.TransactionClient,value:ConversationTransferJournal)=>Promise<T>,alreadyWritten=false):Promise<T>{
  const previous=await this.journal(operationId);if(!previous)throw new ContentError('CONVERSATION_TRANSFER_NOT_FOUND','转移记录不存在',404)
  return this.transaction(previous.conversationId,async tx=>{const row=await tx.systemConfig.findUniqueOrThrow({where:{key:transferKey(operationId)}}),value=transferJournalSchema.parse(row.value),next=await run(tx,value);if(!alreadyWritten)await tx.systemConfig.update({where:{key:transferKey(operationId)},data:{value:encoded(transferJournalSchema.parse(next))}});return next})
 }
}
