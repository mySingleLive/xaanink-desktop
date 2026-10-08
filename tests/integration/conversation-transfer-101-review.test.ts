import test, {mock} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,realpath,stat,rename,rm,readFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Workspaces} from '../../desktop/service/workspaces'
import {getDatabaseContext} from '../../desktop/service/context'
import {configureConversationTransfers,conversationTransfersFor,conversationHistory} from '../../desktop/service/conversation-runtime'
import {LocalDispatcher} from '../../desktop/service/dispatcher'
import {captureConversationBundle,conversationDigest} from '../../desktop/service/conversation-bundle'
import {acceptContentCandidate} from '../../src/lib/services/content-candidate'

// Reviewer-owned original-schema scenario. Static transfer is intentionally
// exercised independently of the author's live start-tool fixtures.
test('REVIEW101-I01: A to B to inbox preserves original history and approvals, and a lost A never becomes authority', {timeout:600_000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'xx-review101-conversation-'))
 const appRoot=join(root,'application'),migrations=join(process.cwd(),'prisma/migrations')
 let works=new Workspaces(appRoot,migrations)
 let dispose=()=>{}
 const proof=async(name:string)=>{const directory=join(root,name);await mkdir(directory);const path=await realpath(directory),info=await stat(path,{bigint:true});return{path,device:String(info.dev),inode:String(info.ino)}}
 try{
  await works.initialize()
  const a=await works.create(await proof('source-a'),{title:'原作品A',requestId:'review101-create-a'})
  const b=await works.create(await proof('target-b'),{title:'目标作品B',requestId:'review101-create-b'})
  dispose=configureConversationTransfers(works,async()=>{throw Error('Static migration must never call a model or directory transport')})
  let original!:Awaited<ReturnType<typeof captureConversationBundle>>
  await works.runWithGlobal(a.id,async()=>{
   const db=getDatabaseContext().database
   await db.conversation.create({data:{id:'review101-chat',userId:'local-author',novelId:a.novelId,title:'跨作品历史会话',modelId:'review101-model',executionEpoch:12,summary:'不可删改的原摘要'}})
   await db.message.createMany({data:[{id:'review101-user',conversationId:'review101-chat',turnId:'review101-turn',role:'USER',content:'原书批准仅指原章节 v4\n第二行保留'},{id:'review101-assistant',conversationId:'review101-chat',turnId:'review101-turn',attemptId:'review101-attempt',role:'ASSISTANT',content:'原候选仍等待作者选择',parts:[{type:'text',text:'原稿字节'}]}]})
   await db.chatTurn.create({data:{id:'review101-turn',userId:'local-author',conversationId:'review101-chat',userMessageId:'review101-user',clientRequestId:'review101-client',latestAttemptId:'review101-attempt',status:'succeeded',action:{kind:'approve',novelId:a.novelId,targetId:'review101-chapter',expectedVersion:4},defaultsSnapshot:{textModelId:'review101-model',thinking:'high'}}})
   await db.chatAttempt.create({data:{id:'review101-attempt',turnId:'review101-turn',assistantMessageId:'review101-assistant',attemptNo:1,executionEpoch:12,status:'succeeded',lastEventSeq:8}})
   await db.chatRequest.create({data:{id:'review101-request',userId:'local-author',turnId:'review101-turn',entryAttemptId:'review101-attempt',clientRequestId:'review101-client',requestHash:'immutable-client-request-hash'}})
   await db.chatToolExecution.create({data:{id:'review101-tool',turnId:'review101-turn',attemptId:'review101-attempt',toolCallId:'review101-call',toolName:'drawChapterCandidates',operationId:'review101-original-draw',requestHash:'immutable-tool-request-hash',input:{chapterId:'review101-chapter'},output:{candidateId:'review101-candidate'},status:'succeeded'}})
   await db.chatWriteEffect.create({data:{id:'review101-effect',toolExecutionId:'review101-tool',targetModel:'contentCandidate',targetId:'review101-candidate',operation:'create',receipt:{novelId:a.novelId,chapterId:'review101-chapter',baseVersion:4}}})
   await db.attemptObservation.create({data:{attemptId:'review101-attempt',turnId:'review101-turn',data:{estimatedTokens:23,source:'original'}}})
   await db.aIModel.create({data:{id:'review101-model',name:'原历史模型',provider:'custom',modelId:'historical-model',apiKeyEncrypted:'',enabled:false,inputCostPer1k:0.2,outputCostPer1k:0.4}})
   await db.usageRecord.create({data:{id:'review101-usage',userId:'local-author',novelId:a.novelId,modelId:'review101-model',turnId:'review101-turn',attemptId:'review101-attempt',action:'original-review',promptTokens:17,completionTokens:6,cost:0.0064,modelSnapshot:{name:'原历史模型',inputCostPer1k:0.2,outputCostPer1k:0.4}}})
   await db.volume.create({data:{id:'review101-volume',novelId:a.novelId,title:'原卷',index:1,summary:'原作品的卷纲'}})
   await db.chapter.create({data:{id:'review101-chapter',volumeId:'review101-volume',title:'原章',index:1,outline:'原作品的章纲',content:'未采用候选的原正文',version:4}})
   await db.sopNodeRun.createMany({data:[{id:'review101-parent',novelId:a.novelId,nodeId:'novel',status:'done',finalScore:7.2},{id:'review101-node',novelId:a.novelId,nodeId:'content',targetId:'review101-chapter',parentRunId:'review101-parent',status:'done',finalScore:7.7}]})
   await db.contentImprovementRun.create({data:{id:'review101-improvement',userId:'local-author',novelId:a.novelId,chapterId:'review101-chapter',operationId:'review101-improvement-op',requestHash:'original-improvement-hash',turnId:'review101-turn',attemptId:'review101-attempt',baseVersion:4,baseHash:'original-base-hash',baseContent:'未采用候选的原正文',authorInstructions:'候选仅供比较',comments:[],boundaries:{},wordRequirement:{},writerCalls:2,baselineCalls:1,candidateCalls:2,candidateIds:['review101-candidate'],status:'done'}})
   await db.contentCandidate.create({data:{id:'review101-candidate',userId:'local-author',novelId:a.novelId,chapterId:'review101-chapter',operationId:'review101-candidate-op',baseVersion:4,baseHash:'original-base-hash',baseContent:'未采用候选的原正文',content:'原作未采用的候选',contentHash:'original-candidate-hash',source:'writer',sourceRunId:'review101-subagent',status:'ready',checks:[],improvementId:'review101-improvement'}})
   await db.subAgentRun.create({data:{id:'review101-subagent',novelId:a.novelId,conversationId:'review101-chat',attemptId:'review101-attempt',agentKind:'writer',task:'原作候选',status:'done',transcript:{text:'原作候选证据'},result:{candidateId:'review101-candidate'},tokenUsage:{input:17,output:6},candidateId:'review101-candidate',sopNodeRunId:'review101-node',targetId:'review101-chapter'}})
   await db.sopPlan.create({data:{id:'review101-plan',novelId:a.novelId,conversationId:'review101-chat',title:'原作未完成计划',status:'active',items:[{id:'original-node',nodeId:'content',targetId:'review101-chapter',status:'done',sopNodeRunId:'review101-node'}]}})
   await db.candidateCommentEffect.create({data:{id:'review101-comment-effect',novelId:a.novelId,candidateId:'review101-candidate',commentId:'review101-old-comment',beforeStatus:'OPEN',afterStatus:'APPLIED',afterUpdatedAt:new Date('2026-10-01T00:00:00.123Z'),replyId:'review101-old-reply'}})
   original=await captureConversationBundle(db,a.id,'review101-chat')
  })
  const manager=conversationTransfersFor(works)!
  const initial=await works.runWithGlobal(a.id,()=>manager.current('review101-chat'))
  const first=await works.runWithGlobal(a.id,()=>manager.associate('review101-chat',{operationId:'review101-a-to-b',novelId:b.novelId,expectedLocationRevision:initial.revision}))
  await t.test('the target has the exact executable graph but no original work domain history',async()=>{
   await works.runWithGlobal(b.id,async()=>{
    const db=getDatabaseContext().database,copy=await captureConversationBundle(db,b.id,'review101-chat')
    for(const name of ['Message','ChatTurn','ChatAttempt','ChatRequest','ChatToolExecution','ChatWriteEffect','AttemptObservation'] as const)assert.deepEqual(copy.tables[name],original.tables[name])
    assert.equal(copy.tables.Conversation[0].novelId,b.novelId)
    for(const name of ['UsageRecord','SubAgentRun','SopPlan','SopNodeRun','ContentImprovementRun','ContentCandidate','CandidateCommentEffect'] as const)assert.equal(copy.history[name].length,0)
    assert.equal(await db.chapter.count(),0)
    await assert.rejects(acceptContentCandidate({userId:'local-author',novelId:b.novelId,chapterId:'review101-chapter'},'review101-candidate',{expectedVersion:4,operationId:'review101-illegal-accept',candidateHash:'original-candidate-hash'}))
    assert.equal(await db.contentMutation.count({where:{operationId:'review101-illegal-accept'}}),0)
   })
   await works.runWithGlobal(a.id,async()=>{const db=getDatabaseContext().database;assert.equal(await db.conversation.count(),0);assert.equal((await db.usageRecord.findUniqueOrThrow({where:{id:'review101-usage'}})).novelId,a.novelId);assert.equal((await db.contentImprovementRun.findUniqueOrThrow({where:{id:'review101-improvement'}})).writerCalls,2);assert.equal((await db.chapter.findUniqueOrThrow({where:{id:'review101-chapter'}})).version,4);assert.equal((await db.contentCandidate.findUniqueOrThrow({where:{id:'review101-candidate'}})).status,'ready')})
  })
  const second=await works.runWithGlobal(b.id,()=>manager.associate('review101-chat',{operationId:'review101-b-to-inbox',novelId:null,expectedLocationRevision:first.revision}))
  await t.test('a second migration retains the first original provenance and immutable model/fee evidence',async()=>{
   assert.equal(second.workspaceId,'inbox');assert.equal(second.novelId,null);assert.deepEqual(second.historicalTransfers,['review101-a-to-b','review101-b-to-inbox'])
   const history=await works.runWithGlobal('inbox',()=>conversationHistory('review101-chat'))
   const serialized=JSON.stringify(history)
   assert.ok(serialized.includes('review101-usage'));assert.ok(serialized.includes('review101-candidate'));assert.ok(serialized.includes('original-candidate-hash'))
   assert.deepEqual(await manager.ledger.entity('subagent','review101-subagent'),{conversationId:'review101-chat',historicalWorkspaceId:a.id})
   const journal=await manager.ledger.journal('review101-a-to-b')
   assert.equal(conversationDigest(journal!.bundle),journal!.bundleDigest)
   await works.runWithGlobal('inbox',async()=>{const db=getDatabaseContext().database;assert.equal(await db.usageRecord.count(),0);assert.equal(await db.contentCandidate.count(),0);assert.deepEqual((await captureConversationBundle(db,'inbox','review101-chat')).tables.ChatTurn,original.tables.ChatTurn)})
  })
  await works.close();dispose();await rename(a.path,join(root,'temporarily-missing-a'))
  works=new Workspaces(appRoot,migrations);await works.initialize()
  dispose=configureConversationTransfers(works,async()=>{throw Error('Recovery must not reopen a model or native directory picker')})
  await t.test('reopening reads inbox authority despite missing original source, preserves historical entity read-only, and closes all leases',async()=>{
   const reopened=conversationTransfersFor(works)!,dispatcher=new LocalDispatcher(works,reopened)
   assert.deepEqual((await reopened.recover()).map(row=>row.phase),['complete','complete'])
   const request={version:1 as const,id:randomUUID(),method:'GET' as const,path:'/api/chat/conversations',headers:{}}
   assert.equal(await dispatcher.workspaceFor({...request,path:'/api/chat/conversations/review101-chat'}),'inbox')
   const response=await dispatcher.handle(request,new AbortController().signal),body=await response.json() as {conversations:{id:string}[]}
   assert.deepEqual(body.conversations.map(row=>row.id),['review101-chat'])
   const historical=await works.runWithGlobal('inbox',()=>conversationHistory('review101-chat'))
   assert.ok(JSON.stringify(historical).includes('review101-subagent'),'durable evidence remains available without executing the missing source')
   assert.equal(await dispatcher.workspaceFor({...request,path:'/api/subagent-runs/review101-subagent'}),a.id,'historical entity retains its true source instead of executing in inbox')
   const mutation=await dispatcher.handle({...request,method:'DELETE',path:'/api/subagent-runs/review101-subagent'},new AbortController().signal)
   assert.equal(mutation.status,404,'the original read-only subagent route admits no mutation')
   await works.close()
  })
 }finally{dispose();await works.close();await rm(root,{recursive:true,force:true})}
})

test('REVIEW101-I02: a ready but unregistered creation cannot make another physical novel in a different directory after restart',{timeout:600_000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'xx-review101-creation-reservation-')),appRoot=join(root,'application'),migrations=join(process.cwd(),'prisma/migrations')
 let works=new Workspaces(appRoot,migrations)
 const proof=async(name:string)=>{const directory=join(root,name);await mkdir(directory);const path=await realpath(directory),info=await stat(path,{bigint:true});return{path,device:String(info.dev),inode:String(info.ino)}}
 const originalSelection=await proof('original-selection'),otherSelection=await proof('another-selection'),input={title:'一次授权的原作品',premise:'原核心保持不变',requestId:'review101-interrupted-registration'}
 let interrupted:ReturnType<typeof mock.method>|undefined
 try{
  await works.initialize()
  const catalog=(works as unknown as {catalog:{update(revision:number,value:unknown,guard?:()=>void):Promise<unknown>}}).catalog,originalUpdate=catalog.update.bind(catalog)
  interrupted=mock.method(catalog,'update',async(revision:number,value:unknown,guard?:()=>void)=>{
   if(Array.isArray(value)&&value.some(row=>row.requestId===input.requestId))throw Error('controlled ready-before-catalog failure')
   return originalUpdate(revision,value,guard)
  })
  await assert.rejects(works.create(originalSelection,input),/controlled ready-before-catalog failure/)
  const manifest=JSON.parse(await readFile(join(originalSelection.path,'xaanink-work.json'),'utf8')) as {id:string;novelId:string;phase:string;requestId:string}
  assert.equal(manifest.phase,'ready');assert.ok(manifest.novelId);assert.equal(manifest.requestId,input.requestId);assert.deepEqual(await works.list(),[])
  interrupted.mock.restore();interrupted=undefined;await works.close()
  works=new Workspaces(appRoot,migrations);await works.initialize()
  await assert.rejects(works.create(otherSelection,input),/REQUEST_CONFLICT|建书|目录|请求/)
  assert.deepEqual(await readdir(otherSelection.path),[],'a different directory must receive no partial files, migrations, or novel')
  const recovered=await works.create(originalSelection,input)
  assert.equal(recovered.id,manifest.id);assert.equal(recovered.novelId,manifest.novelId)
  assert.equal((await works.list()).length,1)
  await works.runWithGlobal(recovered.id,async()=>{const db=getDatabaseContext().database;assert.equal(await db.novel.count(),1);assert.equal((await db.novelCreationRequest.findUniqueOrThrow({where:{userId_requestId:{userId:'local-author',requestId:input.requestId}}})).novelId,manifest.novelId)})
  await works.close()
 }finally{interrupted?.mock.restore();await works.close();await rm(root,{recursive:true,force:true})}
})
