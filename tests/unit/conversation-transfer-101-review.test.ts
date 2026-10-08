import test, {mock} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import type {PrismaClient} from '../../src/generated/prisma/client'
import type {Workspaces} from '../../desktop/service/workspaces'
import {ConversationDirectoryAuthorizations} from '../../desktop/main/conversation-directory-authorizations'
import {ConversationTransferLedger} from '../../desktop/service/conversation-ledger'
import {configureConversationTransfers,conversationTransfersFor,runConversationTask,finishConversationTask} from '../../desktop/service/conversation-runtime'
import {runInDatabaseContext,type DatabaseContext} from '../../desktop/service/context'
import {LocalDispatcher} from '../../desktop/service/dispatcher'
import type {ConversationTransfers} from '../../desktop/service/conversation-transfer'
import {CHAT_TABLES,HISTORY_TABLES,conversationDigest,type ConversationBundle} from '../../desktop/service/conversation-bundle'
import {ConversationTaskRuntime} from '../../desktop/service/conversation-task-runtime'

// Independent reviewer oracle: window authority must survive until creation
// admission. These fixtures control the actual production host callback's IO;
// no original author test or expectation is changed.
test('REVIEW101-R01: losing the original window after native selection but before create admission creates no work',async t=>{
 const selected=Promise.withResolvers<void>(),continueLookup=Promise.withResolvers<void>()
 const scope={userId:'local-author',conversationId:'review-chat',turnId:'review-turn',attemptId:'review-attempt',epoch:1,operationId:'review-start-operation',signal:new AbortController().signal}
 const location={version:1 as const,conversationId:scope.conversationId,userId:'local-author' as const,workspaceId:'inbox',novelId:null,revision:0,historicalTransfers:[],deleted:false}
 const proof={path:'/isolated/reviewer-chosen-work',device:'1',inode:'2'},workId=randomUUID()
 let ownerAlive=true,chosen=false,created=0
 const registry=new ConversationDirectoryAuthorizations({choose:async()=>{chosen=true;return proof},revoke(){}})
 const origin=registry.begin(randomUUID(),'original-window',()=>{if(!ownerAlive)throw Error('window destroyed')})
 const locationMock=mock.method(ConversationTransferLedger.prototype,'location',async()=>{
  if(chosen){selected.resolve();await continueLookup.promise}
  return location
 })
 const indexMock=mock.method(ConversationTransferLedger.prototype,'indexEntity',async()=>{})
 const database={conversation:{findFirst:async()=>({id:scope.conversationId,userId:scope.userId,novelId:null})},novel:{findFirstOrThrow:async()=>({id:'review-novel',title:'独立测试作品',status:'ACTIVE',currentStage:'THEME',createdAt:new Date(0),updatedAt:new Date(0)})},$transaction:async(run:(tx:unknown)=>Promise<unknown>)=>run({$queryRaw:async()=>[{activeAttemptId:scope.attemptId,executionEpoch:scope.epoch,live:true,cancelRequestedAt:null}]})} as unknown as PrismaClient
 const context=(id:string):DatabaseContext=>({workspaceId:id,database,globalDatabase:database,requestOrigin:origin,retainTask:()=>()=>{}})
 const works={run:(id:string,run:()=>Promise<unknown>)=>runInDatabaseContext(context(id),run),runWithGlobal:(id:string,run:()=>Promise<unknown>)=>runInDatabaseContext(context(id),run),create:async()=>{created++;return{id:workId,novelId:'review-novel'}},list:async()=>[]} as unknown as Workspaces
 const dispose=configureConversationTransfers(works,async(method,input)=>{
  if(method==='conversation.claim')return registry.claim(input)
  if(method==='conversation.release')return registry.release(input)
  if(method==='conversation.choose-directory')return registry.choose(input)
  if(method==='conversation.create-admission')return registry.createAdmission(input)
  if(method==='conversation.create-finished')return registry.finishCreate(input)
  throw Error(`unexpected RPC ${method}`)
 })
 try{
  const manager=conversationTransfersFor(works)!
  const operation=runInDatabaseContext(context('inbox'),()=>runConversationTask(scope,async()=>{
   try{return await manager.host.createWork(scope,{title:'独立测试作品',requestId:scope.operationId})}
   finally{await finishConversationTask()}
  }))
  await selected.promise
  ownerAlive=false;registry.revokeOwner('original-window');continueLookup.resolve()
  await assert.rejects(operation.finally(()=>t.diagnostic(`actual create calls after revocation: ${created}`)),/DIRECTORY_AUTHORIZATION_REVOKED|EXECUTION_REVOKED/)
  assert.equal(created,0,'revoked original-window proof must not create a work')
 }finally{continueLookup.resolve();dispose();locationMock.mock.restore();indexMock.mock.restore();await registry.flush()}
})

test('REVIEW101-R04: revoking an admitted physical creation aborts the actual workspace before its first write and drain waits for IO',async()=>{
 const {mkdtemp,mkdir,realpath,stat,readdir,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{Workspaces}=await import('../../desktop/service/workspaces')
 const root=await mkdtemp(join(tmpdir(),'xx-review101-admission-')),selected=join(root,'selected');await mkdir(selected)
 const path=await realpath(selected),info=await stat(path,{bigint:true}),proof={path,device:String(info.dev),inode:String(info.ino)}
 const works=new Workspaces(join(root,'application'),join(process.cwd(),'prisma/migrations'))
 const entered=Promise.withResolvers<void>(),proceed=Promise.withResolvers<void>()
 const registry=new ConversationDirectoryAuthorizations({choose:async()=>proof,revoke(){}}),origin=registry.begin(randomUUID(),'physical-owner',()=>{})
 const scope={userId:'local-author',conversationId:'physical-chat',turnId:'physical-turn',attemptId:'physical-attempt',epoch:3,operationId:'physical-operation'}
 const runtime=new ConversationTaskRuntime(async(method,input)=>{
  if(method==='conversation.claim')return registry.claim(input)
  if(method==='conversation.release')return registry.release(input)
  if(method==='conversation.choose-directory')return registry.choose(input)
  if(method==='conversation.create-admission')return registry.createAdmission(input)
  if(method==='conversation.create-finished')return registry.finishCreate(input)
  throw Error(`unexpected RPC ${method}`)
 })
 const physical=works as unknown as {verifySelection(input:typeof proof):Promise<string>},original=physical.verifySelection.bind(works)
 const delayed=mock.method(physical,'verifySelection',async(input:typeof proof)=>{entered.resolve();await proceed.promise;return original(input)})
 try{
  await works.initialize()
  const task=runtime.run(origin,scope,async()=>{
   try{const picked=await runtime.choose(scope,{title:'应被撤销的作品',requestId:scope.operationId});assert.ok(picked);return await runtime.withCreateAdmission(scope,{title:'应被撤销的作品',requestId:scope.operationId},picked,guard=>works.create(picked,{title:'应被撤销的作品',requestId:scope.operationId},guard))}
   finally{await runtime.finish()}
  })
  const rejected=assert.rejects(task,{code:'EXECUTION_REVOKED'})
  await entered.promise;registry.revokeOwner('physical-owner')
  let drained=false;const drain=registry.flush().then(()=>{drained=true})
  await new Promise(setImmediate);assert.equal(drained,false,'revocation cannot claim that still pending physical IO has drained')
  proceed.resolve();await rejected;await drain
  assert.equal(drained,true);assert.deepEqual(await readdir(selected),[]);assert.deepEqual(await works.list(),[])
 }finally{proceed.resolve();delayed.mock.restore();registry.workerStopped();await registry.flush();await works.close();await rm(root,{recursive:true,force:true})}
})

test('REVIEW101-R03: committing a transfer cannot overwrite another conversation\'s global turn identity',async()=>{
 let values=new Map<string,{key:string;value:unknown}>()
 const config=(map:typeof values)=>({
  findUnique:async({where}:{where:{key:string}})=>structuredClone(map.get(where.key)??null),
  findUniqueOrThrow:async({where}:{where:{key:string}})=>{const value=map.get(where.key);assert.ok(value);return structuredClone(value)},
  create:async({data}:{data:{key:string;value:unknown}})=>{assert.equal(map.has(data.key),false);map.set(data.key,structuredClone(data));return data},
  update:async({where,data}:{where:{key:string};data:{value:unknown}})=>{assert.ok(map.has(where.key));map.set(where.key,{key:where.key,value:structuredClone(data.value)});return map.get(where.key)},
  upsert:async({where,create,update}:{where:{key:string};create:{key:string;value:unknown};update:{value:unknown}})=>{map.set(where.key,map.has(where.key)?{key:where.key,value:structuredClone(update.value)}:structuredClone(create));return map.get(where.key)},
 })
 const database={get systemConfig(){return config(values)},$transaction:async(run:(tx:unknown)=>Promise<unknown>)=>{const snapshot=structuredClone(values);const result=await run({systemConfig:config(snapshot),$executeRaw:async()=>0});values=snapshot;return result}} as unknown as PrismaClient
 const ledger=new ConversationTransferLedger(run=>run(database))
 await ledger.register({conversationId:'original-chat',userId:'local-author',workspaceId:'original-work',novelId:'original-novel'})
 await ledger.indexEntity('original-chat','turn','same-turn-id')
 const source=await ledger.register({conversationId:'incoming-chat',userId:'local-author',workspaceId:'incoming-work',novelId:'incoming-novel'})
 const tables={Conversation:[{id:'incoming-chat',userId:'local-author',novelId:'incoming-novel',activeAttemptId:null,executionEpoch:0}],Message:[{id:'incoming-message',conversationId:'incoming-chat',turnId:'same-turn-id',attemptId:null}],ChatTurn:[{id:'same-turn-id',userId:'local-author',conversationId:'incoming-chat',userMessageId:'incoming-message',latestAttemptId:null}],ChatAttempt:[],ChatRequest:[],ChatToolExecution:[],ChatWriteEffect:[],AttemptObservation:[],AIModel:[]}
 const bundle:ConversationBundle={version:1,conversationId:'incoming-chat',sourceWorkspaceId:'incoming-work',sourceNovelId:'incoming-novel',columns:Object.fromEntries(CHAT_TABLES.map(name=>[name,Object.keys(tables[name][0]??{})])) as ConversationBundle['columns'],tables,history:Object.fromEntries(HISTORY_TABLES.map(name=>[name,[]])) as unknown as ConversationBundle['history']}
 await ledger.prepare({operationId:'review101-collision',conversationId:'incoming-chat',requestHash:conversationDigest('request'),source,target:{workspaceId:'new-work',novelId:'new-novel'}})
 await ledger.captured('review101-collision',bundle)
 await assert.rejects(ledger.commit('review101-collision',async(_value,publish)=>publish()),/CONVERSATION_LOCATION_CHANGED|CONVERSATION_GRAPH_INVALID|会话/)
 assert.deepEqual(await ledger.entity('turn','same-turn-id'),{conversationId:'original-chat',historicalWorkspaceId:undefined})
 assert.deepEqual(await ledger.location('incoming-chat'),source)
})

test('REVIEW101-R02: an unavailable former source cannot hide the committed target conversation from the list',async()=>{
 const row={id:'moved-chat',userId:'local-author',novelId:'target-novel',title:'已提交到目标的会话',createdAt:new Date(0),updatedAt:new Date(1),_count:{messages:2}}
 const location={version:1,conversationId:row.id,userId:'local-author',workspaceId:'target-work',novelId:row.novelId,revision:1,historicalTransfers:['committed-operation'],deleted:false}
 const calls:string[]=[]
 const works={list:async()=>[{id:'former-source',novelId:'former-novel'},{id:'target-work',novelId:'target-novel'}],run:async(id:string,run:()=>Promise<unknown>)=>{
  calls.push(id)
  if(id==='former-source')throw Error('former source directory unavailable')
  return runInDatabaseContext({workspaceId:id,database:{conversation:{findMany:async()=>id==='target-work'?[row]:[]}} as unknown as PrismaClient},run)
 }} as unknown as Workspaces
 const transfers={ledger:{locations:async()=>[location],location:async(id:string)=>id===row.id?location:null,entity:async()=>null},current:async()=>location,bind:async(_id:string,run:()=>Promise<unknown>)=>run()} as unknown as ConversationTransfers
 const dispatcher=new LocalDispatcher(works,transfers)
 const input={version:1 as const,id:randomUUID(),method:'GET' as const,path:'/api/chat/conversations',headers:{}}
 assert.equal(await dispatcher.workspaceFor({...input,path:'/api/chat/conversations/moved-chat'}),'target-work','detail authority remains readable without scanning the former source')
 const response=await dispatcher.handle(input,new AbortController().signal)
 const body=await response.json() as {conversations:{id:string}[]}
 assert.deepEqual(body.conversations.map(value=>value.id),[row.id])
 assert.ok(calls.includes('target-work'))
})

test('REVIEW101-R05: the original DELETE of an indexed conversation leaves a usable empty list and cannot revive old copies',async()=>{
 let exists=true,values=new Map<string,{key:string;value:unknown}>()
 const row={id:'delete-chat',userId:'local-author',novelId:null,title:'待删除会话',createdAt:new Date(0),updatedAt:new Date(1),_count:{messages:2}}
 const conversation={findFirst:async()=>exists?row:null,findUnique:async()=>exists?row:null,findMany:async()=>exists?[row]:[],delete:async()=>{exists=false;return row}}
 const config=(map:typeof values)=>({
  findUnique:async({where}:{where:{key:string}})=>structuredClone(map.get(where.key)??null),
  findUniqueOrThrow:async({where}:{where:{key:string}})=>{const value=map.get(where.key);assert.ok(value);return structuredClone(value)},
  findMany:async({where}:{where:{key:{startsWith:string}}})=>structuredClone([...map.values()].filter(value=>value.key.startsWith(where.key.startsWith))),
  create:async({data}:{data:{key:string;value:unknown}})=>{assert.equal(map.has(data.key),false);map.set(data.key,structuredClone(data));return data},
  update:async({where,data}:{where:{key:string};data:{value:unknown}})=>{assert.ok(map.has(where.key));map.set(where.key,{key:where.key,value:structuredClone(data.value)});return map.get(where.key)},
 })
 const database={conversation,get systemConfig(){return config(values)},$transaction:async(run:(tx:unknown)=>Promise<unknown>)=>{const snapshot=structuredClone(values),result=await run({conversation,systemConfig:config(snapshot),$executeRaw:async()=>0});values=snapshot;return result}} as unknown as PrismaClient
 const context:DatabaseContext={workspaceId:'inbox',database,globalDatabase:database}
 const works={list:async()=>[],run:(_id:string,run:()=>Promise<unknown>)=>runInDatabaseContext(context,run),runWithGlobal:(_id:string,run:()=>Promise<unknown>)=>runInDatabaseContext(context,run)} as unknown as Workspaces
 const dispose=configureConversationTransfers(works,async()=>{throw Error('DELETE must not call native/model transports')})
 try{
  const manager=conversationTransfersFor(works)!,dispatcher=new LocalDispatcher(works,manager)
  await runInDatabaseContext(context,()=>manager.current(row.id))
  const request={version:1 as const,id:randomUUID(),method:'DELETE' as const,path:'/api/chat/conversations/delete-chat',headers:{}}
  const deleted=await runInDatabaseContext(context,()=>dispatcher.handle(request,new AbortController().signal))
  assert.equal(deleted.status,200);assert.equal(exists,false)
  const listed=await dispatcher.handle({...request,id:randomUUID(),method:'GET',path:'/api/chat/conversations'},new AbortController().signal)
  assert.deepEqual((await listed.json() as {conversations:unknown[]}).conversations,[])
  assert.equal((await manager.ledger.location(row.id))?.deleted,true,'the durable authority must distinguish authorized deletion from an unavailable target')
  await assert.rejects(dispatcher.workspaceFor({...request,id:randomUUID(),method:'GET'}),{code:'CONVERSATION_NOT_FOUND'})
 }finally{dispose()}
})
