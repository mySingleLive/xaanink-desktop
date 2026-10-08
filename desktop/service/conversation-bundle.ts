import {createHash} from 'node:crypto'
import {Prisma,type PrismaClient} from '../../src/generated/prisma/client'
import {assertChatExecution,type ChatExecutionScope} from '../../src/lib/chat-execution'
import {ContentError} from '../../src/lib/content-errors'
import {LOCAL_AUTHOR_ID} from './context'
import {z} from 'zod'

export const CHAT_TABLES=['Conversation','Message','ChatTurn','ChatAttempt','ChatRequest','ChatToolExecution','ChatWriteEffect','AttemptObservation','AIModel'] as const
export const HISTORY_TABLES=['UsageRecord','SubAgentRun','SopPlan','SopNodeRun','ContentImprovementRun','ContentCandidate','CandidateCommentEffect'] as const
export type ChatTable=typeof CHAT_TABLES[number]
export type HistoryTable=typeof HISTORY_TABLES[number]
export type JsonRow=Record<string,Prisma.JsonValue>
export const CONVERSATION_TRANSFER_LIMITS=Object.freeze({bytes:64*1024*1024,rows:100_000})
export interface ConversationBundle{version:1;conversationId:string;sourceWorkspaceId:string;sourceNovelId:string|null;columns:Record<ChatTable,string[]>;tables:Record<ChatTable,JsonRow[]>;history:Record<HistoryTable,JsonRow[]>}
const rowsSchema=z.array(z.record(z.string(),z.json()))
const bundleSchema=z.object({version:z.literal(1),conversationId:z.string().min(1).max(256),sourceWorkspaceId:z.string().min(1).max(256),sourceNovelId:z.string().nullable(),columns:z.object(Object.fromEntries(CHAT_TABLES.map(table=>[table,z.array(z.string())])) as Record<ChatTable,z.ZodArray<z.ZodString>>).strict(),tables:z.object(Object.fromEntries(CHAT_TABLES.map(table=>[table,rowsSchema])) as Record<ChatTable,typeof rowsSchema>).strict(),history:z.object(Object.fromEntries(HISTORY_TABLES.map(table=>[table,rowsSchema])) as Record<HistoryTable,typeof rowsSchema>).strict()}).strict()
function invalid():never{throw new ContentError('CONVERSATION_GRAPH_INVALID','会话关系不完整，原会话已保留')}
function canonical(value:unknown):string{if(Array.isArray(value))return'['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';return JSON.stringify(value)}
export function conversationDigest(value:unknown){return createHash('sha256').update(canonical(value)).digest('hex')}
function id(row:JsonRow,key='id'):string{const value=row[key];if(typeof value!=='string'||!value.length||value.length>256)invalid();return value}
function idSet(rows:JsonRow[],key='id'){const result=new Set<string>();for(const row of rows){const value=id(row,key);if(result.has(value))invalid();result.add(value)}return result}
export function parseConversationBundle(input:unknown):ConversationBundle{
 const parsed=bundleSchema.safeParse(input);if(!parsed.success)invalid()
 const value=parsed.data as ConversationBundle
 if(Buffer.byteLength(JSON.stringify(value))>CONVERSATION_TRANSFER_LIMITS.bytes||[...Object.values(value.tables),...Object.values(value.history)].reduce((n,rows)=>n+rows.length,0)>CONVERSATION_TRANSFER_LIMITS.rows)throw new ContentError('CONVERSATION_TOO_LARGE','会话超过本地转移容量，原数据已保留')
 const table=value.tables,c=table.Conversation[0]
 if(table.Conversation.length!==1||id(c)!==value.conversationId||c.userId!==LOCAL_AUTHOR_ID||c.novelId!==value.sourceNovelId)invalid()
 for(const name of CHAT_TABLES){idSet(table[name],name==='AttemptObservation'?'attemptId':'id');const columns=value.columns[name];if(new Set(columns).size!==columns.length||table[name].some(row=>canonical(Object.keys(row).sort())!==canonical([...columns].sort())))invalid()}
 const messages=idSet(table.Message),turns=idSet(table.ChatTurn),attempts=idSet(table.ChatAttempt),tools=idSet(table.ChatToolExecution),models=idSet(table.AIModel)
 const attemptFor=new Map(table.ChatAttempt.map(row=>[id(row),row]))
 for(const row of table.Message){if(row.conversationId!==c.id||row.turnId!==null&&!turns.has(String(row.turnId))||row.attemptId!==null&&!attempts.has(String(row.attemptId)))invalid();if(row.attemptId&&row.turnId&&attemptFor.get(String(row.attemptId))?.turnId!==row.turnId)invalid()}
 for(const row of table.ChatTurn){if(row.conversationId!==c.id||row.userId!==LOCAL_AUTHOR_ID||!messages.has(String(row.userMessageId))||row.latestAttemptId!==null&&!attempts.has(String(row.latestAttemptId)))invalid();if(row.latestAttemptId&&attemptFor.get(String(row.latestAttemptId))?.turnId!==row.id)invalid()}
 for(const row of table.ChatAttempt)if(!turns.has(String(row.turnId))||!messages.has(String(row.assistantMessageId))||!Number.isSafeInteger(row.executionEpoch))invalid()
 for(const row of table.ChatRequest)if(row.userId!==LOCAL_AUTHOR_ID||!turns.has(String(row.turnId))||attemptFor.get(String(row.entryAttemptId))?.turnId!==row.turnId)invalid()
 for(const row of table.ChatToolExecution)if(attemptFor.get(String(row.attemptId))?.turnId!==row.turnId)invalid()
 for(const row of table.ChatWriteEffect)if(!tools.has(String(row.toolExecutionId)))invalid()
 for(const row of table.AttemptObservation)if(attemptFor.get(String(row.attemptId))?.turnId!==row.turnId)invalid()
 for(const row of table.AIModel)if(row.apiKeyEncrypted!==''||row.enabled!==false)invalid()
 for(const row of value.history.UsageRecord){if(row.userId!==LOCAL_AUTHOR_ID||row.novelId!==null&&row.novelId!==value.sourceNovelId||!models.has(String(row.modelId))||!(turns.has(String(row.turnId))||attempts.has(String(row.attemptId))))invalid();if(row.turnId&&row.attemptId&&attemptFor.get(String(row.attemptId))?.turnId!==row.turnId)invalid()}
 if(c.activeAttemptId!==null){const active=attemptFor.get(String(c.activeAttemptId));if(!active||active.executionEpoch!==c.executionEpoch)invalid()}
 for(const table of HISTORY_TABLES)idSet(value.history[table])
 const history=value.history,candidates=idSet(history.ContentCandidate),nodes=idSet(history.SopNodeRun)
 for(const name of HISTORY_TABLES.filter(name=>name!=='UsageRecord'))for(const row of history[name]){
  if(row.novelId!==value.sourceNovelId||'userId'in row&&row.userId!==LOCAL_AUTHOR_ID)invalid()
  if('conversationId'in row&&row.conversationId!==null&&row.conversationId!==c.id)invalid()
  if('attemptId'in row&&row.attemptId!==null&&!attempts.has(String(row.attemptId)))invalid()
  if('turnId'in row&&row.turnId!==null&&!turns.has(String(row.turnId)))invalid()
 }
 for(const row of history.SopNodeRun)if(row.parentRunId!==null&&!nodes.has(String(row.parentRunId)))invalid()
 for(const row of history.CandidateCommentEffect)if(!candidates.has(String(row.candidateId)))invalid()
 for(const row of history.SubAgentRun){if(row.sopNodeRunId!==null&&!nodes.has(String(row.sopNodeRunId)))invalid();if(row.candidateId!==null&&!candidates.has(String(row.candidateId)))invalid()}
 for(const row of history.ContentImprovementRun){if(!Array.isArray(row.candidateIds)||row.candidateIds.some(value=>!candidates.has(String(value))))invalid()}
 for(const plan of history.SopPlan)if(Array.isArray(plan.items))for(const item of plan.items)if(item&&typeof item==='object'&&!Array.isArray(item)&&item.sopNodeRunId&&!nodes.has(String(item.sopNodeRunId)))invalid()
 return value
}
/** Capture/insert use fixed table names and the installed PostgreSQL schema.
 * row_to_json retains every original scalar (including timestamp precision),
 * while json_populate_record and original FKs validate the target transaction. */
const quoted=(table:ChatTable|HistoryTable)=>Prisma.raw('"'+table+'"')
async function rows(tx:Prisma.TransactionClient,table:ChatTable|HistoryTable,where:Prisma.Sql){return(await tx.$queryRaw<{row:JsonRow}[]>(Prisma.sql`SELECT row_to_json(record)::jsonb AS row FROM ${quoted(table)} record WHERE ${where} ORDER BY ${Prisma.raw(table==='AttemptObservation'?'"attemptId"':'"id"')}`)).map(value=>value.row)}
const inIds=(field:string,values:readonly string[])=>values.length?Prisma.sql`${Prisma.raw('"'+field+'"')} IN (${Prisma.join(values)})`:Prisma.sql`FALSE`
async function columns(tx:Prisma.TransactionClient){const values=await tx.$queryRaw<{table_name:ChatTable;column_name:string}[]>(Prisma.sql`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN (${Prisma.join(CHAT_TABLES)}) ORDER BY table_name,ordinal_position`);return Object.fromEntries(CHAT_TABLES.map(name=>[name,values.filter(row=>row.table_name===name).map(row=>row.column_name)])) as Record<ChatTable,string[]>}
export async function captureConversationBundle(database:PrismaClient,workspaceId:string,conversationId:string,scope?:ChatExecutionScope):Promise<ConversationBundle>{return database.$transaction(async tx=>{if(scope)await assertChatExecution(tx,scope);return captureConversationBundleInTransaction(tx,workspaceId,conversationId)},{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:60_000})}
export async function captureConversationBundleInTransaction(tx:Prisma.TransactionClient,workspaceId:string,conversationId:string):Promise<ConversationBundle>{
  await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id=${conversationId} AND "userId"=${LOCAL_AUTHOR_ID} FOR UPDATE`
  const conversation=await rows(tx,'Conversation',Prisma.sql`id=${conversationId} AND "userId"=${LOCAL_AUTHOR_ID}`);if(conversation.length!==1)throw new ContentError('CONVERSATION_NOT_FOUND','会话不存在或无权访问',404)
  const sourceNovelId=conversation[0].novelId as string|null
  const messages=await rows(tx,'Message',Prisma.sql`"conversationId"=${conversationId}`),turns=await rows(tx,'ChatTurn',Prisma.sql`"conversationId"=${conversationId}`),turnIds=turns.map(row=>id(row))
  const attempts=await rows(tx,'ChatAttempt',inIds('turnId',turnIds)),attemptIds=attempts.map(row=>id(row)),requests=await rows(tx,'ChatRequest',inIds('turnId',turnIds)),tools=await rows(tx,'ChatToolExecution',inIds('attemptId',attemptIds)),toolIds=tools.map(row=>id(row))
  const effects=await rows(tx,'ChatWriteEffect',inIds('toolExecutionId',toolIds)),observations=await rows(tx,'AttemptObservation',inIds('attemptId',attemptIds)),usage=await rows(tx,'UsageRecord',Prisma.sql`(${inIds('turnId',turnIds)} OR ${inIds('attemptId',attemptIds)})`)
  const modelIds=[...new Set(usage.map(row=>String(row.modelId)).concat(typeof conversation[0].modelId==='string'?[conversation[0].modelId]:[]))],models=await rows(tx,'AIModel',inIds('id',modelIds))
  const subagents=await rows(tx,'SubAgentRun',Prisma.sql`"conversationId"=${conversationId} OR ${inIds('attemptId',attemptIds)}`),plans=await rows(tx,'SopPlan',Prisma.sql`"conversationId"=${conversationId}`),improvements=await rows(tx,'ContentImprovementRun',Prisma.sql`(${inIds('turnId',turnIds)} OR ${inIds('attemptId',attemptIds)})`)
  const candidateIds=new Set<string>(subagents.flatMap(row=>typeof row.candidateId==='string'?[row.candidateId]:[]))
  for(const row of improvements)if(Array.isArray(row.candidateIds))for(const candidate of row.candidateIds)if(typeof candidate==='string')candidateIds.add(candidate)
  for(const row of effects)if(row.targetModel==='contentCandidate'&&typeof row.targetId==='string')candidateIds.add(row.targetId)
  const candidates=await rows(tx,'ContentCandidate',Prisma.sql`${inIds('id',[...candidateIds])} OR ${inIds('improvementId',improvements.map(row=>id(row)))} OR ${inIds('sourceRunId',subagents.map(row=>id(row)))}`)
  const candidateEffects=await rows(tx,'CandidateCommentEffect',inIds('candidateId',candidates.map(row=>id(row))))
  const nodeIds=new Set(subagents.flatMap(row=>typeof row.sopNodeRunId==='string'?[row.sopNodeRunId]:[]))
  for(const plan of plans)if(Array.isArray(plan.items))for(const item of plan.items)if(item&&typeof item==='object'&&!Array.isArray(item)&&typeof item.sopNodeRunId==='string')nodeIds.add(item.sopNodeRunId)
  const nodeRows=new Map<string,JsonRow>()
  for(let ids=[...nodeIds];ids.length;){const batch=await rows(tx,'SopNodeRun',inIds('id',ids));ids=[];for(const row of batch){const key=id(row);if(nodeRows.has(key))continue;nodeRows.set(key,row);if(typeof row.parentRunId==='string'&&!nodeRows.has(row.parentRunId))ids.push(row.parentRunId)}if(nodeRows.size>CONVERSATION_TRANSFER_LIMITS.rows)invalid()}
  return parseConversationBundle({version:1,conversationId,sourceWorkspaceId:workspaceId,sourceNovelId,columns:await columns(tx),tables:{Conversation:conversation,Message:messages,ChatTurn:turns,ChatAttempt:attempts,ChatRequest:requests,ChatToolExecution:tools,ChatWriteEffect:effects,AttemptObservation:observations,AIModel:models},history:{UsageRecord:usage,SubAgentRun:subagents,SopPlan:plans,SopNodeRun:[...nodeRows.values()].sort((a,b)=>id(a).localeCompare(id(b))),ContentImprovementRun:improvements,ContentCandidate:candidates,CandidateCommentEffect:candidateEffects}})
}
export function mappedConversationTables(bundle:ConversationBundle,targetNovelId:string|null):Record<ChatTable,JsonRow[]>{return{...bundle.tables,Conversation:bundle.tables.Conversation.map(row=>({...row,novelId:targetNovelId}))}}
function copyReceipt(bundle:ConversationBundle,targetNovelId:string|null,operationId:string){return{version:1,operationId,conversationId:bundle.conversationId,sourceWorkspaceId:bundle.sourceWorkspaceId,targetNovelId,digest:conversationDigest(mappedConversationTables(bundle,targetNovelId))}}
function targetChanged():never{throw new ContentError('CONVERSATION_TARGET_CHANGED','目标会话副本已变化，原会话已保留')}
/** Use the existing transaction when target is inbox: a second global engine
 * transaction would wait on our own location/CAS lease. The conversation row
 * lock remains held until the location publish callback completes. */
export async function verifyConversationCopyInTransaction(tx:Prisma.TransactionClient,input:ConversationBundle,targetNovelId:string|null,operationId:string):Promise<void>{
 const bundle=parseConversationBundle(input),expected=mappedConversationTables(bundle,targetNovelId)
 await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id=${bundle.conversationId} AND "userId"=${LOCAL_AUTHOR_ID} FOR UPDATE`
 if(targetNovelId){const owned=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Novel" WHERE id=${targetNovelId} AND "userId"=${LOCAL_AUTHOR_ID} AND status!='DELETED' FOR SHARE`;if(owned.length!==1)targetChanged()}
 const marker=await tx.systemConfig.findUnique({where:{key:'desktop:conversation-copy:'+conversationDigest(operationId)}})
 if(!marker||conversationDigest(marker.value)!==conversationDigest(copyReceipt(bundle,targetNovelId,operationId)))targetChanged()
 const turnIds=expected.ChatTurn.map(row=>id(row)),attemptIds=expected.ChatAttempt.map(row=>id(row)),toolIds=expected.ChatToolExecution.map(row=>id(row))
 const conditions:Record<ChatTable,Prisma.Sql>={Conversation:Prisma.sql`id=${bundle.conversationId}`,Message:Prisma.sql`"conversationId"=${bundle.conversationId}`,ChatTurn:Prisma.sql`"conversationId"=${bundle.conversationId}`,ChatAttempt:inIds('turnId',turnIds),ChatRequest:inIds('turnId',turnIds),ChatToolExecution:inIds('attemptId',attemptIds),ChatWriteEffect:inIds('toolExecutionId',toolIds),AttemptObservation:inIds('attemptId',attemptIds),AIModel:inIds('id',expected.AIModel.map(row=>id(row)))}
 for(const name of CHAT_TABLES){
  const actual=await rows(tx,name,conditions[name])
  if(name==='AIModel'){
   if(actual.length!==expected.AIModel.length)targetChanged()
   for(const original of expected.AIModel){const model=actual.find(row=>row.id===original.id);if(!model||model.apiKeyEncrypted!==''||model.enabled!==false||model.provider!==original.provider||model.modelId!==original.modelId||model.kind!==original.kind)targetChanged()}
  }else if(conversationDigest(actual)!==conversationDigest([...expected[name]].sort((a,b)=>id(a,name==='AttemptObservation'?'attemptId':'id').localeCompare(id(b,name==='AttemptObservation'?'attemptId':'id')))))targetChanged()
 }
}
export function withVerifiedConversationCopy<T>(database:PrismaClient,bundle:ConversationBundle,targetNovelId:string|null,operationId:string,publish:()=>Promise<T>):Promise<T>{return database.$transaction(async tx=>{await verifyConversationCopyInTransaction(tx,bundle,targetNovelId,operationId);return publish()},{timeout:60_000})}
export async function copyConversationBundle(database:PrismaClient,input:ConversationBundle,targetNovelId:string|null,operationId:string):Promise<void>{
 const bundle=parseConversationBundle(input),tables=mappedConversationTables(bundle,targetNovelId),markerKey='desktop:conversation-copy:'+conversationDigest(operationId),receipt=copyReceipt(bundle,targetNovelId,operationId)
 await database.$transaction(async tx=>{
  if(targetNovelId&&!await tx.novel.findFirst({where:{id:targetNovelId,userId:LOCAL_AUTHOR_ID,status:{not:'DELETED'}}}))throw new ContentError('NOVEL_UNAVAILABLE','目标作品不可用',410)
  if(!await tx.user.findUnique({where:{id:LOCAL_AUTHOR_ID}}))invalid()
  if(conversationDigest(await columns(tx))!==conversationDigest(bundle.columns))throw new ContentError('CONVERSATION_SCHEMA_MISMATCH','作品数据库版本不一致，原会话已保留')
  const previous=await tx.systemConfig.findUnique({where:{key:markerKey}})
  if(previous){if(conversationDigest(previous.value)!==conversationDigest(receipt))throw new ContentError('REQUEST_CONFLICT','该转移编号已用于其他会话');await verifyConversationCopyInTransaction(tx,bundle,targetNovelId,operationId);return}
  for(const name of CHAT_TABLES)for(const row of tables[name]){
   if(name==='AIModel'){const existing=await tx.aIModel.findUnique({where:{id:id(row)}});if(existing){if(existing.apiKeyEncrypted!==''||existing.enabled||existing.provider!==row.provider||existing.modelId!==row.modelId||existing.kind!==row.kind)invalid();continue}}
   await tx.$executeRaw(Prisma.sql`INSERT INTO ${quoted(name)} SELECT * FROM json_populate_record(NULL::${quoted(name)},${JSON.stringify(row)}::json)`)
  }
  await tx.systemConfig.create({data:{key:markerKey,value:receipt}})
  await verifyConversationCopyInTransaction(tx,bundle,targetNovelId,operationId)
 },{timeout:60_000})
}

/** Deletion owns only the exact inert target copy. A changed/foreign copy is
 * retained; historic UsageRecord/domain rows never participate in deletion. */
export function discardConversationCopy(database:PrismaClient,bundle:ConversationBundle,targetNovelId:string|null,operationId:string):Promise<void>{return database.$transaction(async tx=>{
 const key='desktop:conversation-copy:'+conversationDigest(operationId),marker=await tx.systemConfig.findUnique({where:{key}})
 if(!marker){if(await tx.conversation.findUnique({where:{id:bundle.conversationId}}))targetChanged();return}
 await verifyConversationCopyInTransaction(tx,bundle,targetNovelId,operationId)
 await tx.conversation.delete({where:{id:bundle.conversationId}});await tx.systemConfig.delete({where:{key}})
},{timeout:60_000})}
export function cleanupConversationSource(database:PrismaClient,bundle:ConversationBundle):Promise<void>{return database.$transaction(async tx=>{
 if(!await tx.conversation.findUnique({where:{id:bundle.conversationId}}))return
 const current=await captureConversationBundleInTransaction(tx,bundle.sourceWorkspaceId,bundle.conversationId)
 if(conversationDigest(current)!==conversationDigest(bundle))throw new ContentError('CONVERSATION_SOURCE_CHANGED','源会话已变化，原数据已保留')
 await tx.conversation.delete({where:{id:bundle.conversationId}})
},{timeout:60_000})}
