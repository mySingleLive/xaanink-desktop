import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {PrismaClient} from '../../src/generated/prisma/client'
import {ConversationTransferLedger} from '../../desktop/service/conversation-ledger'
import {conversationDigest,CHAT_TABLES,HISTORY_TABLES,type ConversationBundle} from '../../desktop/service/conversation-bundle'
function fixture(){
 let values=new Map<string,{key:string;value:unknown}>(),failLocation=false;let queue=Promise.resolve()
 const model=(map:Map<string,{key:string;value:unknown}>)=>({findUnique:async({where}:{where:{key:string}})=>structuredClone(map.get(where.key)??null),findUniqueOrThrow:async({where}:{where:{key:string}})=>{const row=map.get(where.key);if(!row)throw Error('not found');return structuredClone(row)},findMany:async()=>structuredClone([...map.values()]),create:async({data}:{data:{key:string;value:unknown}})=>{if(map.has(data.key))throw Error('duplicate');map.set(data.key,structuredClone(data));return data},update:async({where,data}:{where:{key:string};data:{value:unknown}})=>{if(!map.has(where.key))throw Error('not found');map.set(where.key,{key:where.key,value:structuredClone(data.value)});if(failLocation&&where.key.startsWith('desktop:conversation-location:'))throw Error('controlled commit failure');return map.get(where.key)},upsert:async({where,create,update}:{where:{key:string};create:{key:string;value:unknown};update:{value:unknown}})=>{map.set(where.key,map.has(where.key)?{key:where.key,value:structuredClone(update.value)}:structuredClone(create));return map.get(where.key)}})
 const database={get systemConfig(){return model(values)},$transaction:(run:(tx:unknown)=>Promise<unknown>)=>{const operation=queue.then(async()=>{const isolated=structuredClone(values),result=await run({systemConfig:model(isolated),$executeRaw:async()=>0});values=isolated;return result});queue=operation.then(()=>{},()=>{});return operation}} as unknown as PrismaClient
 const ledger=new ConversationTransferLedger(run=>run(database))
 return{ledger,values:()=>values,failLocation(){failLocation=true},clearFailure(){failLocation=false},database}
}
async function prepared(f:ReturnType<typeof fixture>,op='operation-34'){
 const source=await f.ledger.register({conversationId:'chat',userId:'local-author',workspaceId:'inbox',novelId:null})
 const journal=await f.ledger.prepare({conversationId:'chat',operationId:op,requestHash:conversationDigest({title:'作品'}),source,target:{workspaceId:'work',novelId:'novel'}})
 return{source,journal}
}
function graph():ConversationBundle{
 const tables={Conversation:[{id:'chat',userId:'local-author',novelId:null,activeAttemptId:null,executionEpoch:0}],Message:[],ChatTurn:[],ChatAttempt:[],ChatRequest:[],ChatToolExecution:[],ChatWriteEffect:[],AttemptObservation:[],AIModel:[]}
 return{version:1,conversationId:'chat',sourceWorkspaceId:'inbox',sourceNovelId:null,columns:Object.fromEntries(CHAT_TABLES.map(name=>[name,Object.keys(tables[name][0]??{})])) as ConversationBundle['columns'],tables,history:Object.fromEntries(HISTORY_TABLES.map(name=>[name,[]])) as unknown as ConversationBundle['history']}
}
test('CHAT34-L01: same operation replays its durable prepared request and a conflicting request cannot change authority',async()=>{
 const f=fixture(),{source,journal}=await prepared(f)
 assert.deepEqual(await f.ledger.prepare({conversationId:'chat',operationId:journal.operationId,requestHash:journal.requestHash,source,target:journal.target}),journal)
 await assert.rejects(f.ledger.prepare({conversationId:'chat',operationId:journal.operationId,requestHash:conversationDigest('changed'),source,target:journal.target}),{code:'REQUEST_CONFLICT'})
 assert.deepEqual(await f.ledger.location('chat'),source)
})
test('CHAT34-L02: a copied graph alone cannot acknowledge target validity or publish authority',async()=>{
 const f=fixture(),{source,journal}=await prepared(f);await f.ledger.captured(journal.operationId,graph())
 await assert.rejects(f.ledger.commit(journal.operationId),{code:'CONVERSATION_TARGET_UNCONFIRMED'})
 assert.deepEqual(await f.ledger.location('chat'),source);assert.equal((await f.ledger.journal(journal.operationId))?.phase,'copied')
})
test('CHAT34-L03: cancellation before the native grant is durable without any target or association',async()=>{
 const f=fixture(),source=await f.ledger.register({conversationId:'chat',userId:'local-author',workspaceId:'inbox',novelId:null}),operationId='directory-cancel-34'
 await f.ledger.prepare({conversationId:'chat',operationId,requestHash:conversationDigest('same'),source,target:null,creationInput:{title:'原暂定名',requestId:operationId}})
 await f.ledger.cancel(operationId);assert.equal((await f.ledger.journal(operationId))?.phase,'cancelled');assert.equal((await f.ledger.journal(operationId))?.target,null)
 assert.deepEqual(await f.ledger.location('chat'),source)
 await f.ledger.target(operationId,{workspaceId:'work',novelId:'novel'});assert.equal((await f.ledger.journal(operationId))?.phase,'prepared');await assert.rejects(f.ledger.cancel(operationId),{code:'CONVERSATION_LOCATION_CHANGED'})
})
test('CHAT34-L04: malformed bundle digest never publishes a valid-looking copied journal',async()=>{
 const f=fixture(),{source,journal}=await prepared(f);await f.ledger.captured(journal.operationId,graph())
 const row=[...f.values().values()].find(row=>row.key.startsWith('desktop:conversation-transfer:'))!,value=row.value as Record<string,unknown>;value.bundleDigest=conversationDigest('foreign')
 await assert.rejects(f.ledger.commit(journal.operationId,async(_journal,publish)=>publish()),{code:'CONVERSATION_LOCATION_CHANGED'});assert.deepEqual(await f.ledger.location('chat'),source)
})

test('CHAT34-L05: target guard failure and global CAS failure roll back both authority and committed receipt',async()=>{
 const f=fixture(),{source,journal}=await prepared(f);await f.ledger.captured(journal.operationId,graph())
 await assert.rejects(f.ledger.commit(journal.operationId,async()=>{throw Error('target disappeared')}),/target disappeared/)
 assert.deepEqual(await f.ledger.location('chat'),source)
 f.failLocation();await assert.rejects(f.ledger.commit(journal.operationId,async(_value,publish)=>publish()),/controlled commit failure/)
 assert.deepEqual(await f.ledger.location('chat'),source);assert.equal((await f.ledger.journal(journal.operationId))?.phase,'copied')
 f.clearFailure();const next=await f.ledger.commit(journal.operationId,async(_value,publish)=>{const [a,b]=await Promise.all([publish(),publish()]);assert.deepEqual(a,b);return a})
 assert.equal(next.revision,1);assert.deepEqual(next.historicalTransfers,[journal.operationId]);assert.equal((await f.ledger.journal(journal.operationId))?.phase,'committed')
 assert.deepEqual(await f.ledger.commit(journal.operationId),next)
})
test('CHAT34-L06: a guard cannot acknowledge its own location without invoking the atomic publish',async()=>{
 const f=fixture(),{source,journal}=await prepared(f);await f.ledger.captured(journal.operationId,graph())
 await assert.rejects(f.ledger.commit(journal.operationId,async()=>({...source,workspaceId:'work',novelId:'novel'})),{code:'CONVERSATION_TARGET_UNCONFIRMED'})
 assert.deepEqual(await f.ledger.location('chat'),source);assert.equal((await f.ledger.journal(journal.operationId))?.phase,'copied')
})
test('CHAT34-L07: transfer identity conflicts atomically preserve foreign turn, attempt and historical subagent routes',{timeout:15000},async t=>{
 for(const kind of ['turn','attempt','subagent'] as const)await t.test(kind,async()=>{
  const f=fixture(),{source,journal}=await prepared(f),bundle=graph()
  bundle.tables.Message=[{id:'user',conversationId:'chat',turnId:'turn',attemptId:null},{id:'assistant',conversationId:'chat',turnId:'turn',attemptId:'attempt'}]
  bundle.tables.ChatTurn=[{id:'turn',userId:'local-author',conversationId:'chat',userMessageId:'user',latestAttemptId:'attempt'}]
  bundle.tables.ChatAttempt=[{id:'attempt',turnId:'turn',assistantMessageId:'assistant',executionEpoch:0}]
  bundle.history.SubAgentRun=[{id:'subagent',novelId:null,conversationId:'chat',attemptId:'attempt',sopNodeRunId:null,candidateId:null}]
  for(const name of CHAT_TABLES)bundle.columns[name]=Object.keys(bundle.tables[name][0]??{})
  await f.ledger.register({conversationId:'foreign-chat',userId:'local-author',workspaceId:'foreign-work',novelId:'foreign-novel'})
  await f.ledger.indexEntity('foreign-chat',kind,kind,kind==='subagent'?'foreign-work':undefined)
  await f.ledger.captured(journal.operationId,bundle)
  await assert.rejects(f.ledger.commit(journal.operationId,async(_value,publish)=>publish()),{code:'CONVERSATION_LOCATION_CHANGED'})
  assert.deepEqual(await f.ledger.entity(kind,kind),{conversationId:'foreign-chat',historicalWorkspaceId:kind==='subagent'?'foreign-work':undefined})
  assert.deepEqual(await f.ledger.location('chat'),source);assert.equal((await f.ledger.journal(journal.operationId))?.phase,'copied')
 })
})
test('CHAT34-L08: deletion CAS tombstones authority and a prepared copied transfer cannot revive it',{timeout:15000},async()=>{
 const f=fixture(),{source,journal}=await prepared(f);await f.ledger.captured(journal.operationId,graph());let deletes=0
 const deleted=await f.ledger.remove(source,async()=>{deletes++})
 assert.equal(deleted.deleted,true);assert.equal(deleted.revision,source.revision+1);assert.equal(deletes,1)
 assert.equal((await f.ledger.deletion('chat'))?.phase,'complete')
 await assert.rejects(f.ledger.commit(journal.operationId,async(_value,publish)=>publish()),{code:'CONVERSATION_LOCATION_CHANGED'})
 assert.deepEqual(await f.ledger.location('chat'),deleted)
})
test('CHAT34-L09: target delete preparation atomically records its recoverable pending tombstone and rejects stale source CAS',{timeout:15000},async()=>{
 const f=fixture(),{source}=await prepared(f),deleted=await f.ledger.remove(source)
 assert.equal(deleted.deleted,true);assert.equal((await f.ledger.deletion('chat'))?.phase,'committed')
 await assert.rejects(f.ledger.remove(source),{code:'CONVERSATION_LOCATION_CHANGED'})
 await f.ledger.finishDeletion('chat');assert.equal((await f.ledger.deletion('chat'))?.phase,'complete')
})
