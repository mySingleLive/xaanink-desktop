import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {PrismaClient} from '../../src/generated/prisma/client'
import type {ConversationTransferLedger} from '../../desktop/service/conversation-ledger'
import {ConversationTransfers,type ConversationTransferHost,type ConversationTransferOperations} from '../../desktop/service/conversation-transfer'
import {runInDatabaseContext,getDatabaseContext,createScopedClient,type DatabaseContext} from '../../desktop/service/context'
import {conversationDigest,CHAT_TABLES,HISTORY_TABLES,type ConversationBundle} from '../../desktop/service/conversation-bundle'
import type {ConversationLocation,ConversationTransferJournal,CreatedConversationWork} from '../../desktop/shared/conversation-transfer'
const scope={userId:'local-author',conversationId:'chat',turnId:'turn',attemptId:'attempt',epoch:7,operationId:'start-operation34'}
function fixture(){
 let location:ConversationLocation={version:1,conversationId:'chat',userId:'local-author',workspaceId:'inbox',novelId:null,revision:0,historicalTransfers:[],deleted:false},journal:ConversationTransferJournal|null=null
 let grants=0,copies=0,cleanups=0,cancel=true,failPublish=false,leases=0
 const conversations=new Map([['inbox',{id:'chat',userId:'local-author',novelId:null as string|null,activeAttemptId:'attempt',executionEpoch:7}],['work',{id:'chat',userId:'local-author',novelId:'novel' as string|null,activeAttemptId:'attempt',executionEpoch:7}]])
 const context=(workspaceId:string):DatabaseContext=>({workspaceId:workspaceId==='work'?'8e52b045-efbe-4daa-b4f3-9c78ff9c4b64':workspaceId,assets:{marker:workspaceId} as unknown as DatabaseContext['assets'],database:{conversation:{findFirst:async()=>conversations.get(workspaceId)??null},subAgentRun:{count:async()=>0},message:{findMany:async()=>[{workspaceId:getDatabaseContext().workspaceId}]}} as unknown as PrismaClient,retainTask:()=>{leases++;let done=false;return()=>{if(!done){done=true;leases--}}}})
 const created:CreatedConversationWork={workspaceId:'8e52b045-efbe-4daa-b4f3-9c78ff9c4b64',novelId:'novel',receipt:{id:'novel',title:'作者作品',status:'ACTIVE',currentStage:'THEME',createdAt:'2026-10-08T00:00:00.000Z',updatedAt:'2026-10-08T00:00:00.000Z'}}
 const host:ConversationTransferHost={withWorkspace:(id,run)=>runInDatabaseContext(context(id===created.workspaceId?'work':id),()=>run(getDatabaseContext())),createWork:async()=>{grants++;return cancel?null:created},findCreatedWork:async()=>null,findNovel:async()=>({workspaceId:created.workspaceId,novelId:'novel'})}
 const bundle=():ConversationBundle=>{const tables={Conversation:[{id:'chat',userId:'local-author',novelId:null,activeAttemptId:null,executionEpoch:7}],Message:[],ChatTurn:[],ChatAttempt:[],ChatRequest:[],ChatToolExecution:[],ChatWriteEffect:[],AttemptObservation:[],AIModel:[]};return{version:1,conversationId:'chat',sourceWorkspaceId:'inbox',sourceNovelId:null,columns:Object.fromEntries(CHAT_TABLES.map(id=>[id,Object.keys(tables[id][0]??{})])) as ConversationBundle['columns'],tables,history:Object.fromEntries(HISTORY_TABLES.map(id=>[id,[]])) as unknown as ConversationBundle['history']}}
 const ledger={location:async()=>location,register:async()=>location,journal:async()=>journal,prepare:async(input:unknown)=>{if(journal)return journal;const data=input as ConversationTransferJournal;journal={...data,version:1,userId:'local-author',phase:data.target?'prepared':'authorizing',createdAt:'2026-10-08T00:00:00.000Z',updatedAt:'2026-10-08T00:00:00.000Z'};return journal},cancel:async()=>{journal!.phase='cancelled'},target:async(_id:unknown,target:unknown,receipt:unknown)=>{journal={...journal!,target:target as ConversationTransferJournal['target'],creationReceipt:receipt as CreatedConversationWork,phase:'prepared'};return journal},captured:async(_id:unknown,value:ConversationBundle)=>{journal={...journal!,bundle:JSON.parse(JSON.stringify(value)),bundleDigest:conversationDigest(value),phase:'copied'};return journal},commit:async(_id:unknown,guard:(value:ConversationTransferJournal,publish:()=>Promise<ConversationLocation>,tx:unknown)=>Promise<ConversationLocation>)=>guard(journal!,async()=>{if(failPublish)throw Error('controlled authority commit failure');location={...location,...journal!.target!,revision:location.revision+1,historicalTransfers:[scope.operationId]};journal!.phase='committed';return location},{}),finish:async(_id:unknown,code?:'SOURCE_CHANGED'|'SOURCE_UNAVAILABLE')=>{journal!.phase=code?'cleanup-pending':'complete';journal!.cleanupCode=code;return journal}} as unknown as ConversationTransferLedger
 const operations:ConversationTransferOperations={capture:async()=>bundle(),copy:async()=>{copies++},confirm:async(_c,_b,_n,_o,publish)=>publish(),discard:async()=>{},cleanup:async()=>{cleanups++}}
 Object.assign(ledger,{journals:async()=>journal?[journal]:[]})
 const manager=new ConversationTransfers(host,ledger,undefined,operations),root=context('inbox')
 return{manager,root,granted(){cancel=false},stop(){for(const row of conversations.values())row.activeAttemptId=null as unknown as string},loseAuthority(){conversations.delete(location.workspaceId==='inbox'?'inbox':'work')},fail(value:boolean){failPublish=value},counts:()=>({grants,copies,cleanups,leases}),location:()=>structuredClone(location),journal:()=>structuredClone(journal),context}
}
test('CHAT34-T01: cancelling a native directory request creates no target and same operation cannot reopen the picker',async()=>{
 const f=fixture();const result=await runInDatabaseContext(f.root,()=>f.manager.startNovel(scope,{title:'作者作品',premise:'原故事核心'}))
 assert.equal(result,null);assert.equal(f.journal()?.phase,'cancelled');assert.equal(f.location().novelId,null);assert.deepEqual(f.counts(),{grants:1,copies:0,cleanups:0,leases:0})
 f.granted();assert.equal(await runInDatabaseContext(f.root,()=>f.manager.startNovel(scope,{title:'作者作品',premise:'原故事核心'})),null);assert.equal(f.counts().grants,1)
})
test('CHAT34-T02: accepted directory is copied before publishing, and replay returns its receipt without another create',async()=>{
 const f=fixture();f.granted();const result=await runInDatabaseContext(f.root,()=>f.manager.startNovel(scope,{title:'作者作品',premise:'原故事核心'}))
 assert.equal(result?.novelId,'novel');assert.equal(f.location().workspaceId,result!.workspaceId);assert.equal(f.journal()?.phase,'complete');assert.deepEqual(f.counts(),{grants:1,copies:1,cleanups:1,leases:0})
 assert.deepEqual(await runInDatabaseContext(f.root,()=>f.manager.startNovel(scope,{title:'作者作品',premise:'原故事核心'})),result);assert.equal(f.counts().grants,1);assert.equal(f.counts().copies,1)
})
test('CHAT34-T03: failed authority publish leaves source authoritative and preserves a retryable copied journal',async()=>{
 const f=fixture();f.granted();f.fail(true)
 await assert.rejects(runInDatabaseContext(f.root,()=>f.manager.startNovel(scope,{title:'作者作品'})),/controlled authority commit failure/)
 assert.equal(f.location().workspaceId,'inbox');assert.equal(f.journal()?.phase,'copied');assert.equal(f.journal()?.creationReceipt?.novelId,'novel');assert.equal(f.counts().cleanups,0)
 f.fail(false);await runInDatabaseContext(f.root,()=>f.manager.startNovel(scope,{title:'作者作品'}));assert.equal(f.counts().grants,1);assert.equal(f.location().novelId,'novel')
})
test('CHAT34-T04: subsequent tool uses authoritative assets/workspace, and background database writes retain task binding',async()=>{
 const f=fixture();f.granted();const scoped=createScopedClient()
 await runInDatabaseContext(f.root,()=>f.manager.bind('chat',async()=>{
  await f.manager.startNovel(scope,{title:'作者作品'})
  await f.manager.withToolContext('chat',async()=>{assert.equal(getDatabaseContext().workspaceId,'8e52b045-efbe-4daa-b4f3-9c78ff9c4b64');assert.equal((getDatabaseContext().assets as unknown as {marker:string}).marker,'work');assert.deepEqual(await scoped.message.findMany(),[{workspaceId:'8e52b045-efbe-4daa-b4f3-9c78ff9c4b64'}])})
  assert.deepEqual(await scoped.message.findMany(),[{workspaceId:'8e52b045-efbe-4daa-b4f3-9c78ff9c4b64'}])
 }))
})
test('CHAT34-T05: restart recovery resumes an inactive copied operation through verification without reopening authorization or creating again',{timeout:15000},async()=>{
 const f=fixture();f.granted();f.fail(true)
 await assert.rejects(runInDatabaseContext(f.root,()=>f.manager.startNovel(scope,{title:'作者作品'})),/controlled authority commit failure/)
 f.stop();f.fail(false)
 const result=await runInDatabaseContext(f.root,()=>f.manager.recover())
 assert.equal(result[0].phase,'complete');assert.equal(f.location().novelId,'novel');assert.equal(f.counts().grants,1);assert.equal(f.counts().copies,2)
})
test('CHAT34-T06: restart preserves active pending transfer and cannot silently restart its model or native picker',{timeout:15000},async()=>{
 const f=fixture();f.granted();f.fail(true)
 await assert.rejects(runInDatabaseContext(f.root,()=>f.manager.startNovel(scope,{title:'作者作品'})),/controlled authority commit failure/)
 const before=f.counts();const result=await runInDatabaseContext(f.root,()=>f.manager.recover())
 assert.equal(result[0].phase,'pending');assert.deepEqual(f.counts(),before);assert.equal(f.location().workspaceId,'inbox')
})
test('CHAT34-T07: restart records unavailable committed authority and never selects the old source as fallback',{timeout:15000},async()=>{
 const f=fixture();f.granted();await runInDatabaseContext(f.root,()=>f.manager.startNovel(scope,{title:'作者作品'}));f.loseAuthority()
 const result=await runInDatabaseContext(f.root,()=>f.manager.recover())
 assert.equal(result[0].phase,'unavailable');assert.equal(f.location().novelId,'novel');assert.equal(f.journal()?.phase,'complete');assert.equal(f.counts().grants,1)
})
