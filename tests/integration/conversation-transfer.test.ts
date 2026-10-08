import assert from 'node:assert/strict'
import {test,mock} from 'node:test'
import {PGlite} from '@electric-sql/pglite'
import {PrismaClient} from '../../src/generated/prisma/client'
import {LocalPGliteAdapter} from '../../desktop/service/database/pglite-adapter'
import {loadMigrations,migrateDatabase} from '../../desktop/service/database/migrations'
import {captureConversationBundle,copyConversationBundle,conversationDigest,withVerifiedConversationCopy} from '../../desktop/service/conversation-bundle'
import {ConversationTransferLedger} from '../../desktop/service/conversation-ledger'
import {createScopedClient,runInDatabaseContext,type DatabaseAuthority} from '../../desktop/service/context'
import {ConversationPhaseGate} from '../../desktop/service/conversation-phase'
import {assertChatExecution,runInChatExecution} from '../../src/lib/chat-execution'
import {join} from 'node:path'

// One serial original-schema fixture, no external service, no real model. All
// three stores below are actual PostgreSQL/PGlite connections and transactions.
test('CHAT34-I01: original-schema live graph copies with exact IDs/FKs, and a replay must verify its actual target rows', {timeout:600_000},async t=>{
 const sourceEngine=await PGlite.create(),targetEngine=await PGlite.create()
 const source=new PrismaClient({adapter:new LocalPGliteAdapter(sourceEngine)}),target=new PrismaClient({adapter:new LocalPGliteAdapter(targetEngine)})
 try{
  const migrations=await loadMigrations(join(process.cwd(),'prisma/migrations'))
  await migrateDatabase(sourceEngine,migrations);await migrateDatabase(targetEngine,migrations)
  for(const database of[source,target])await database.user.create({data:{id:'local-author',name:'隔离作者',email:'fixture@local.invalid',passwordHash:''}})
  await target.novel.create({data:{id:'target-novel',userId:'local-author',title:'作者授权的作品'}})
  await source.conversation.create({data:{id:'chat34',userId:'local-author',title:'完整活跃会话',activeAttemptId:'attempt34',executionEpoch:7,leaseExpiresAt:new Date(Date.now()+600_000),defaultsSnapshot:{version:1,mode:'plan',thinking:'high'}}})
  await source.message.createMany({data:[{id:'user34',conversationId:'chat34',turnId:'turn34',role:'USER',content:'未删减原文\n第二行'},{id:'assistant34',conversationId:'chat34',turnId:'turn34',attemptId:'attempt34',role:'ASSISTANT',content:'保留检查点',parts:[{type:'text',text:'原稿'}]}]})
  await source.chatTurn.create({data:{id:'turn34',userId:'local-author',conversationId:'chat34',userMessageId:'user34',clientRequestId:'request34',latestAttemptId:'attempt34',status:'running',defaultsSnapshot:{textModelId:'model34'}}})
  await source.chatAttempt.create({data:{id:'attempt34',turnId:'turn34',attemptNo:1,assistantMessageId:'assistant34',executionEpoch:7,status:'running',lastEventSeq:3}})
  await source.chatRequest.create({data:{id:'request-row34',userId:'local-author',clientRequestId:'request34',requestHash:'original-request-hash',turnId:'turn34',entryAttemptId:'attempt34'}})
  await source.chatToolExecution.create({data:{id:'tool34',turnId:'turn34',attemptId:'attempt34',toolCallId:'call34',toolName:'startNovelFromChat',operationId:'start-operation34',requestHash:'tool-hash',input:{confirmedTitle:'作者作品'},status:'started'}})
  await source.chatWriteEffect.create({data:{id:'effect34',toolExecutionId:'tool34',targetModel:'chapter',targetId:'original-receipt',operation:'update',receipt:{version:3}}})
  await source.attemptObservation.create({data:{attemptId:'attempt34',turnId:'turn34',data:{usage:'reported_only'}}})
  await source.aIModel.create({data:{id:'model34',name:'历史模型',provider:'openai',modelId:'history-text',apiKeyEncrypted:'',enabled:false,inputCostPer1k:0,outputCostPer1k:0}})
  await source.usageRecord.create({data:{id:'usage34',userId:'local-author',modelId:'model34',turnId:'turn34',attemptId:'attempt34',action:'original-chat',promptTokens:17,completionTokens:9,cost:0.019,modelSnapshot:{endpoint:'https://fixture.invalid/v1',modelId:'history-text'}}})
  const bundle=await captureConversationBundle(source,'inbox','chat34'),digest=conversationDigest(bundle)
  const ledger=new ConversationTransferLedger(run=>run(source)),location=await ledger.register({conversationId:'chat34',userId:'local-author',workspaceId:'inbox',novelId:null})
  await ledger.prepare({operationId:'transfer-operation34',conversationId:'chat34',requestHash:conversationDigest({novelId:'target-novel'}),source:location,target:{workspaceId:'work34',novelId:'target-novel'}})
  await ledger.captured('transfer-operation34',bundle)
  await t.test('original scalar graph and immutable usage stay exact without creating a ghost source novel',async()=>{
   await copyConversationBundle(target,bundle,'target-novel','transfer-operation34')
   assert.equal((await target.conversation.findUniqueOrThrow({where:{id:'chat34'}})).novelId,'target-novel')
   assert.deepEqual(await target.message.findMany({orderBy:{id:'asc'}}),await source.message.findMany({orderBy:{id:'asc'}}))
   assert.deepEqual(await target.chatTurn.findMany(),await source.chatTurn.findMany());assert.deepEqual(await target.chatAttempt.findMany(),await source.chatAttempt.findMany())
   assert.deepEqual(await target.chatRequest.findMany(),await source.chatRequest.findMany());assert.deepEqual(await target.chatToolExecution.findMany(),await source.chatToolExecution.findMany());assert.deepEqual(await target.chatWriteEffect.findMany(),await source.chatWriteEffect.findMany());assert.deepEqual(await target.attemptObservation.findMany(),await source.attemptObservation.findMany())
   assert.equal(await target.usageRecord.count(),0);assert.equal((await source.usageRecord.findUniqueOrThrow({where:{id:'usage34'}})).novelId,null);assert.equal(await target.novel.count(),1)
   assert.equal(conversationDigest(bundle),digest);await copyConversationBundle(target,bundle,'target-novel','transfer-operation34');assert.equal(await target.chatAttempt.count(),1)
  })
  await t.test('marker replay rejects a changed target row and preserves source authority',async()=>{
   await target.message.update({where:{id:'assistant34'},data:{content:'复制后被改动'}})
   await assert.rejects(copyConversationBundle(target,bundle,'target-novel','transfer-operation34'),{code:'CONVERSATION_TARGET_CHANGED'})
   assert.deepEqual(await ledger.location('chat34'),location)
   await target.message.update({where:{id:'assistant34'},data:{content:'保留检查点'}})
  })
  await t.test('shared inert model keeps editable metadata but never accepts a changed stable model identity',async()=>{
   await target.aIModel.update({where:{id:'model34'},data:{name:'作者更新的本地引用',inputCostPer1k:0.123,baseUrl:'https://editable-fixture.invalid/v1'}})
   await copyConversationBundle(target,bundle,'target-novel','transfer-operation34')
   assert.equal((await target.aIModel.findUniqueOrThrow({where:{id:'model34'}})).name,'作者更新的本地引用')
   assert.equal(bundle.tables.AIModel[0].name,'历史模型');assert.equal(conversationDigest(bundle),digest)
   await target.aIModel.update({where:{id:'model34'},data:{modelId:'different-stable-id'}})
   await assert.rejects(copyConversationBundle(target,bundle,'target-novel','transfer-operation34'),{code:'CONVERSATION_TARGET_CHANGED'})
   await target.aIModel.update({where:{id:'model34'},data:{modelId:'history-text'}})
  })
  await t.test('a fixed phase binding allows same-attempt fences and final audit only on the new authority',async()=>{
   const gate=new ConversationPhaseGate(),scoped=createScopedClient();let current={workspaceId:'inbox',database:source,globalDatabase:source}
   const authority:DatabaseAuthority={execute:run=>gate.run('chat34',()=>run({...current,authority}))}
   await runInDatabaseContext({...current,authority},async()=>{
    await gate.transfer('chat34',async()=>{
     await ledger.commit('transfer-operation34',async(_value,publish)=>withVerifiedConversationCopy(target,bundle,'target-novel','transfer-operation34',publish))
     current={workspaceId:'work34',database:target,globalDatabase:source}
    })
    await runInChatExecution({userId:'local-author',conversationId:'chat34',turnId:'turn34',attemptId:'attempt34',epoch:7},()=>scoped.$transaction(async tx=>{await assertChatExecution(tx,{userId:'local-author',conversationId:'chat34',turnId:'turn34',attemptId:'attempt34',epoch:7});await tx.chatToolExecution.update({where:{id:'tool34'},data:{status:'succeeded',output:{novelId:'target-novel'}}});await tx.message.update({where:{id:'assistant34'},data:{content:'同轮剩余工具与最后输出'}})}))
   })
   assert.equal((await source.chatToolExecution.findUniqueOrThrow({where:{id:'tool34'}})).status,'started');assert.equal((await target.chatToolExecution.findUniqueOrThrow({where:{id:'tool34'}})).status,'succeeded')
   assert.equal((await target.message.findUniqueOrThrow({where:{id:'assistant34'}})).content,'同轮剩余工具与最后输出');assert.equal((await source.message.findUniqueOrThrow({where:{id:'assistant34'}})).content,'保留检查点')
  })
  await t.test('original createNovelOnce rolls back Novel/Theme/Planning and request receipt after shared revocation during its awaited SQL write',async()=>{
   const {createNovelOnce}=await import('../../src/lib/services/novel-create'),{ContentError}=await import('../../src/lib/content-errors')
   const revocation=new SharedArrayBuffer(4)
   const guarded=source.$extends({query:{novel:{async create({args,query}){const result=await query(args);Atomics.store(new Int32Array(revocation),0,1);return result}}}})
   await assert.rejects(runInDatabaseContext({workspaceId:'inbox',database:guarded as unknown as PrismaClient,allowNovelCreation:true},()=>createNovelOnce('local-author',{title:'撤销后不能留下作品回执',requestId:'revoked-original-sql34'},()=>{if(Atomics.load(new Int32Array(revocation),0)!==0)throw new ContentError('EXECUTION_REVOKED','原窗口已撤销')})),{code:'EXECUTION_REVOKED'})
   assert.equal(await source.novel.count(),0);assert.equal(await source.theme.count(),0);assert.equal(await source.planningDocument.count(),0);assert.equal(await source.novelCreationRequest.count(),0)
  })
 }finally{await source.$disconnect();await target.$disconnect();await sourceEngine.close();await targetEngine.close()}
})

test('CHAT34-I02: actual original startNovel tool requires the native grant, transfers its current audit and permits same-turn remaining tools', {timeout:600_000},async()=>{
 const {mkdtemp,mkdir,realpath,stat,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{Workspaces}=await import('../../desktop/service/workspaces')
 const {configureConversationTransfers,runConversationTask,finishConversationTask}=await import('../../desktop/service/conversation-runtime'),{createAgentTools}=await import('../../src/lib/ai/tools'),{bindChatTools}=await import('../../src/lib/services/chat-tool-execution'),{registerAttemptAbort}=await import('../../src/lib/local-chat-cancellation'),{getDatabaseContext}=await import('../../desktop/service/context')
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-chat-transfer-')),works=new Workspaces(join(root,'app'),join(process.cwd(),'prisma/migrations'))
 const selected=join(root,'chosen-work');await mkdir(selected);const path=await realpath(selected),info=await stat(path,{bigint:true}),calls:string[]=[]
 const origin={requestId:'d904b8af-8ddf-4524-afab-c6d609edb768',nonce:'b6a2ee0b-cda0-4af6-b358-88f340c45e5b'},abort=new AbortController(),scope={userId:'local-author',conversationId:'live-chat34',turnId:'live-turn34',attemptId:'live-attempt34',epoch:7,signal:abort.signal}
 const dispose=configureConversationTransfers(works,async method=>{calls.push(method);if(method==='conversation.claim')return{claimId:'4e40e9cb-b0f4-4f4b-a8ec-2e6959950443'};if(method==='conversation.choose-directory')return{path,device:String(info.dev),inode:String(info.ino)};if(method==='conversation.create-admission')return{admissionId:'391a2acd-bbea-4938-b068-a546b8faf7d1',revocation:new SharedArrayBuffer(4)};if(method==='conversation.create-finished'||method==='conversation.release')return true;throw Error('unexpected private call')})
 try{
  await works.initialize()
  await works.runWithGlobal('inbox',async()=>{
   const database=getDatabaseContext().database
   await database.conversation.create({data:{id:scope.conversationId,userId:'local-author',title:'从灵感开始',activeAttemptId:scope.attemptId,executionEpoch:7,leaseExpiresAt:new Date(Date.now()+600_000)}})
   await database.message.createMany({data:[{id:'live-user34',conversationId:scope.conversationId,turnId:scope.turnId,role:'USER',content:'确认故事核心和书名，选择目录后继续共创'},{id:'live-assistant34',conversationId:scope.conversationId,turnId:scope.turnId,attemptId:scope.attemptId,role:'ASSISTANT',content:'保留正在生成的检查点'}]})
   await database.chatTurn.create({data:{id:scope.turnId,userId:'local-author',conversationId:scope.conversationId,userMessageId:'live-user34',clientRequestId:'live-request34',status:'running',latestAttemptId:scope.attemptId}})
   await database.chatAttempt.create({data:{id:scope.attemptId,turnId:scope.turnId,attemptNo:1,assistantMessageId:'live-assistant34',executionEpoch:7,status:'running'}})
   await runInDatabaseContext({...getDatabaseContext(),requestOrigin:origin},()=>runConversationTask(scope,async()=>{
    const release=registerAttemptAbort(scope.attemptId,abort)
    try{
     const tools=bindChatTools(createAgentTools({userId:'local-author',novelId:null,conversationId:scope.conversationId}),()=>scope)
     const invoke=async(name:string,input:unknown,toolCallId:string)=>await (tools[name].execute as unknown as (input:unknown,options:{toolCallId:string;messages:never[];abortSignal:AbortSignal})=>Promise<{ok:boolean;novel?:{id:string};result?:unknown}>)(input,{toolCallId,messages:[],abortSignal:abort.signal})
     assert.equal((await works.list()).length,0,'no book exists before directory permission')
     const result=await invoke('startNovelFromChat',{title:'作者确认书名',premise:'主角在故乡失踪后寻找真相'},'native-start34')
     assert.equal(result.ok,true,'the original start tool must create through its authorized local directory')
     assert.equal(calls.filter(name=>name==='conversation.choose-directory').length,1)
     const records=await works.list();assert.equal(records.length,1);assert.equal(records[0].novelId,result.novel?.id)
     assert.equal(await database.conversation.count({where:{id:scope.conversationId}}),0,'owned source copy was safely cleaned, not selected as another authority')
     const planning=await invoke('getNovelPlanning',{includeSchema:false},'after-start34');assert.equal(planning.ok,true,'later original tool reads the new work in this same attempt')
     await assert.rejects(works.close(),/创作任务运行/,'whole detached task holds both actual connection leases')
     await works.runWithGlobal(records[0].id,async()=>{const target=getDatabaseContext().database;assert.equal((await target.chatToolExecution.findFirstOrThrow({where:{toolCallId:'native-start34'}})).status,'succeeded');assert.equal((await target.chatToolExecution.findFirstOrThrow({where:{toolCallId:'after-start34'}})).status,'succeeded');assert.equal((await target.theme.findUniqueOrThrow({where:{novelId:records[0].novelId}})).synopsis,'主角在故乡失踪后寻找真相')})
    }finally{await finishConversationTask();release()}
   }))
  })
  assert.equal(calls.filter(name=>name==='conversation.release').length,1);await works.close()
 }finally{dispose();await works.close();await rm(root,{recursive:true,force:true})}
})

test('CHAT34-I03: exact failed creation audit resumes only its owned durable operation without a second directory or novel', {timeout:600_000},async()=>{
 const {mkdtemp,mkdir,realpath,stat,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{Workspaces}=await import('../../desktop/service/workspaces')
 const {configureConversationTransfers,runConversationTask,finishConversationTask}=await import('../../desktop/service/conversation-runtime'),{createAgentTools}=await import('../../src/lib/ai/tools'),{bindChatTools}=await import('../../src/lib/services/chat-tool-execution'),{registerAttemptAbort}=await import('../../src/lib/local-chat-cancellation'),{getDatabaseContext}=await import('../../desktop/service/context')
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-chat-transfer-')),works=new Workspaces(join(root,'app'),join(process.cwd(),'prisma/migrations'))
 const selected=join(root,'chosen-work');await mkdir(selected);const path=await realpath(selected),info=await stat(path,{bigint:true}),calls:string[]=[]
 const origin={requestId:'d904b8af-8ddf-4524-afab-c6d609edb768',nonce:'b6a2ee0b-cda0-4af6-b358-88f340c45e5b'},abort=new AbortController(),scope={userId:'local-author',conversationId:'live-chat34',turnId:'live-turn34',attemptId:'live-attempt34',epoch:7,signal:abort.signal}
 let failPublish=true
 const originalCommit=ConversationTransferLedger.prototype.commit
 const failedCommit=mock.method(ConversationTransferLedger.prototype,'commit',async function(this:ConversationTransferLedger,operationId:string,guard?:import('../../desktop/service/conversation-ledger').ConversationTargetGuard){if(failPublish){failPublish=false;throw Error('controlled copy-before-pointer failure')}return originalCommit.call(this,operationId,guard)})
 const dispose=configureConversationTransfers(works,async method=>{calls.push(method);if(method==='conversation.claim')return{claimId:'4e40e9cb-b0f4-4f4b-a8ec-2e6959950443'};if(method==='conversation.choose-directory')return{path,device:String(info.dev),inode:String(info.ino)};if(method==='conversation.create-admission')return{admissionId:'391a2acd-bbea-4938-b068-a546b8faf7d1',revocation:new SharedArrayBuffer(4)};if(method==='conversation.create-finished'||method==='conversation.release')return true;throw Error('unexpected private call')})
 try{
  await works.initialize()
  await works.runWithGlobal('inbox',async()=>{
   const database=getDatabaseContext().database
   await database.conversation.create({data:{id:scope.conversationId,userId:'local-author',title:'从灵感开始',activeAttemptId:scope.attemptId,executionEpoch:7,leaseExpiresAt:new Date(Date.now()+600_000)}})
   await database.message.createMany({data:[{id:'live-user34',conversationId:scope.conversationId,turnId:scope.turnId,role:'USER',content:'确认故事核心和书名，选择目录后继续共创'},{id:'live-assistant34',conversationId:scope.conversationId,turnId:scope.turnId,attemptId:scope.attemptId,role:'ASSISTANT',content:'保留正在生成的检查点'}]})
   await database.chatTurn.create({data:{id:scope.turnId,userId:'local-author',conversationId:scope.conversationId,userMessageId:'live-user34',clientRequestId:'live-request34',status:'running',latestAttemptId:scope.attemptId}})
   await database.chatAttempt.create({data:{id:scope.attemptId,turnId:scope.turnId,attemptNo:1,assistantMessageId:'live-assistant34',executionEpoch:7,status:'running'}})
   await runInDatabaseContext({...getDatabaseContext(),requestOrigin:origin},()=>runConversationTask(scope,async()=>{
    const release=registerAttemptAbort(scope.attemptId,abort)
    try{
     const tools=bindChatTools(createAgentTools({userId:'local-author',novelId:null,conversationId:scope.conversationId}),()=>scope)
     const invoke=async(name:string,input:unknown,toolCallId:string)=>await (tools[name].execute as unknown as (input:unknown,options:{toolCallId:string;messages:never[];abortSignal:AbortSignal})=>Promise<{ok:boolean;novel?:{id:string};result?:unknown}>)(input,{toolCallId,messages:[],abortSignal:abort.signal})
     assert.equal((await works.list()).length,0,'no book exists before directory permission')
     const first=await invoke('startNovelFromChat',{title:'作者确认书名',premise:'主角在故乡失踪后寻找真相'},'native-start34')
     assert.equal(first.ok,false);assert.equal((await works.list()).length,1,'the authorized original novel exists once despite failed authority commit')
     assert.equal((await database.conversation.findUniqueOrThrow({where:{id:scope.conversationId}})).novelId,null,'source remains authoritative after the controlled pointer failure')
     const failed=await database.chatToolExecution.findFirstOrThrow({where:{toolCallId:'native-start34'}})
     await database.chatToolExecution.update({where:{id:failed.id},data:{status:'unknown'}})
     const result=await invoke('startNovelFromChat',{title:'作者确认书名',premise:'主角在故乡失踪后寻找真相'},'native-start34')
     assert.equal(result.ok,true,'the original start tool must create through its authorized local directory')
     assert.equal(calls.filter(name=>name==='conversation.choose-directory').length,1)
     const records=await works.list();assert.equal(records.length,1);assert.equal(records[0].novelId,result.novel?.id)
     assert.equal(await database.conversation.count({where:{id:scope.conversationId}}),0,'owned source copy was safely cleaned, not selected as another authority')
     const journals=await database.systemConfig.findMany({where:{key:{startsWith:'desktop:conversation-transfer:'}}});assert.equal(journals.length,1)
     const record=journals[0].value as unknown as {bundle:{tables:{ChatToolExecution:{id:string;status:string;output:unknown}[]}}};assert.equal(record.bundle.tables.ChatToolExecution.find(row=>row.id===failed.id)?.status,'unknown');assert.deepEqual(record.bundle.tables.ChatToolExecution.find(row=>row.id===failed.id)?.output,failed.output,'original failed audit survives as immutable transfer evidence')
     const planning=await invoke('getNovelPlanning',{includeSchema:false},'after-start34');assert.equal(planning.ok,true,'later original tool reads the new work in this same attempt')
     await assert.rejects(works.close(),/创作任务运行/,'whole detached task holds both actual connection leases')
     await works.runWithGlobal(records[0].id,async()=>{const target=getDatabaseContext().database;assert.equal((await target.chatToolExecution.findFirstOrThrow({where:{toolCallId:'native-start34'}})).status,'succeeded');assert.equal((await target.chatToolExecution.findFirstOrThrow({where:{toolCallId:'after-start34'}})).status,'succeeded');assert.equal((await target.theme.findUniqueOrThrow({where:{novelId:records[0].novelId}})).synopsis,'主角在故乡失踪后寻找真相')})
    }finally{await finishConversationTask();release()}
   }))
  })
  assert.equal(calls.filter(name=>name==='conversation.release').length,1);await works.close()
 }finally{failedCommit.mock.restore();dispose();await works.close();await rm(root,{recursive:true,force:true})}
})

test('CHAT34-I05: catalog failure after actual novel commit survives restart; a new approved directory cannot duplicate the request',{timeout:600_000},async()=>{
 const {mkdtemp,mkdir,readdir,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os')
 const {Workspaces}=await import('../../desktop/service/workspaces'),{DirectoryAuthority}=await import('../../desktop/main/directory-authority')
 const {getDatabaseContext}=await import('../../desktop/service/context')
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-reserved-work34-')),app=join(root,'app'),migrations=join(process.cwd(),'prisma/migrations')
 const original=join(root,'original-authorized'),other=join(root,'another-authorized'),request={title:'作者确认的同一作品',requestId:'catalog-outcome-operation34'}
 await mkdir(original);await mkdir(other)
 const directories=new DirectoryAuthority(),approve=async(path:string)=>directories.consume((await directories.issue(path,'create-work','isolated-native34')).id,'create-work','isolated-native34')
 let works=new Workspaces(app,migrations)
 try{
  await works.initialize()
  const catalog=(works as unknown as {catalog:import('../../desktop/core/versioned-store').VersionedStore<import('../../desktop/service/workspaces').WorkRecord[]>}).catalog
  const originalProof=await approve(original)
  const failure=mock.method(catalog,'update',async()=>{throw Error('controlled catalog registration failure after ready')})
  await assert.rejects(works.create(originalProof,request,()=>{}),/controlled catalog registration failure/)
  failure.mock.restore()
  const manifest=JSON.parse(await readFile(join(original,'xaanink-work.json'),'utf8')) as {phase:string;novelId:string;id:string}
  assert.equal(manifest.phase,'ready');assert(manifest.novelId)
  assert.deepEqual(await works.list(),[],'pending metadata is not a ready catalog work')
  await works.run('inbox',async()=>{
   const rows=await getDatabaseContext().database.systemConfig.findMany({where:{key:{startsWith:'desktop:work-creation-reservation:'}}})
   assert.equal(rows.length,1);assert.equal((rows[0].value as {phase:string}).phase,'pending')
   assert.equal(await getDatabaseContext().database.systemConfig.count({where:{key:{startsWith:'desktop:conversation-transfer:'}}}),0,'directory reservations never enter transferable conversation evidence')
  })
  await works.close();works=new Workspaces(app,migrations);await works.initialize()
  const otherProof=await approve(other)
  await assert.rejects(works.create(otherProof,request,()=>{}),{code:'REQUEST_CONFLICT'})
  assert.deepEqual(await readdir(other),[],'a new native grant cannot write even a second manifest or lease')
  await assert.rejects(works.create(await approve(original),{...request,title:'被修改的作品'},()=>{}),{code:'REQUEST_CONFLICT'})
  const protectedPaths=await works.protectedDirectories();assert(protectedPaths.includes(originalProof.path));assert(!protectedPaths.includes(otherProof.path))
  const recovered=await works.create(await approve(original),request,()=>{})
  assert.equal(recovered.novelId,manifest.novelId);assert.equal(recovered.id,manifest.id)
  assert.equal((await works.list()).length,1)
  await works.run(recovered.id,async()=>{
   const db=getDatabaseContext().database
   assert.equal(await db.novel.count(),1);assert.equal(await db.novelCreationRequest.count(),1);assert.equal(await db.planningDocument.count(),1)
  })
  await works.run('inbox',async()=>{
   const rows=await getDatabaseContext().database.systemConfig.findMany({where:{key:{startsWith:'desktop:work-creation-reservation:'}}})
   assert.equal(rows.length,1);assert.equal((rows[0].value as {phase:string}).phase,'complete')
  })
  assert.equal((await works.create(await approve(original),request,()=>{})).novelId,manifest.novelId)
 }finally{await works.close();await rm(root,{recursive:true,force:true})}
})
