import assert from 'node:assert/strict'
import {test} from 'node:test'
import {CHAT_TABLES,HISTORY_TABLES,parseConversationBundle,conversationDigest,mappedConversationTables,type ConversationBundle} from '../../desktop/service/conversation-bundle'
function bundle():ConversationBundle{
 const tables={Conversation:[{id:'chat',userId:'local-author',novelId:'old',activeAttemptId:'attempt',executionEpoch:7,modelId:'model',summary:'原摘要',defaultsSnapshot:{thinking:'high'}}],Message:[{id:'user',conversationId:'chat',turnId:'turn',attemptId:null,role:'USER',content:'原输入'},{id:'assistant',conversationId:'chat',turnId:'turn',attemptId:'attempt',role:'ASSISTANT',content:'原草稿'}],ChatTurn:[{id:'turn',userId:'local-author',conversationId:'chat',userMessageId:'user',latestAttemptId:'attempt',clientRequestId:'client',action:{approve:'原作品版本'},defaultsSnapshot:{imageModelId:'old-image'}}],ChatAttempt:[{id:'attempt',turnId:'turn',assistantMessageId:'assistant',executionEpoch:7,status:'running'}],ChatRequest:[{id:'request',userId:'local-author',turnId:'turn',entryAttemptId:'attempt',clientRequestId:'client'}],ChatToolExecution:[{id:'tool',turnId:'turn',attemptId:'attempt',toolName:'startNovelFromChat',operationId:'original-operation'}],ChatWriteEffect:[{id:'effect',toolExecutionId:'tool',targetModel:'chapter',targetId:'old-chapter',receipt:{version:3}}],AttemptObservation:[{attemptId:'attempt',turnId:'turn',data:{usage:'reported_only'}}],AIModel:[{id:'model',apiKeyEncrypted:'',enabled:false,provider:'openai',modelId:'saved-model',kind:'TEXT'}]}
 const history={UsageRecord:[{id:'usage',userId:'local-author',novelId:'old',turnId:'turn',attemptId:'attempt',modelId:'model',cost:0.012,modelSnapshot:{modelId:'saved-model'}}],SubAgentRun:[],SopPlan:[],SopNodeRun:[],ContentImprovementRun:[],ContentCandidate:[],CandidateCommentEffect:[]}
 return{version:1,conversationId:'chat',sourceWorkspaceId:'source',sourceNovelId:'old',columns:Object.fromEntries(CHAT_TABLES.map(name=>[name,Object.keys(tables[name][0]??{})])) as ConversationBundle['columns'],tables,history}
}
test('CHAT34-G01: complete original graph, epoch, tool receipt and usage provenance survive a local novel mapping',()=>{
 const value=bundle(),before=conversationDigest(value),parsed=parseConversationBundle(value),mapped=mappedConversationTables(parsed,'new')
 assert.equal(mapped.Conversation[0].novelId,'new');assert.equal(value.tables.Conversation[0].novelId,'old');assert.equal(conversationDigest(value),before)
 assert.deepEqual(mapped.Message,value.tables.Message);assert.deepEqual(mapped.ChatWriteEffect,value.tables.ChatWriteEffect)
 assert.equal(value.history.UsageRecord[0].novelId,'old');assert.equal(value.history.UsageRecord[0].cost,0.012)
})
test('CHAT34-G02: any broken live FK/scalar closure rejects the whole bundle',()=>{
 const probes:((value:ConversationBundle)=>void)[]=[value=>{value.tables.ChatWriteEffect[0].toolExecutionId='missing'},value=>{value.tables.ChatRequest[0].entryAttemptId='other'},value=>{value.tables.ChatTurn[0].userMessageId='missing'},value=>{value.tables.ChatAttempt[0].executionEpoch=9},value=>{value.tables.Message[1].turnId='other'},value=>{value.tables.ChatToolExecution[0].turnId='other'}]
 for(const mutate of probes){const value=bundle();mutate(value);assert.throws(()=>parseConversationBundle(value),{code:'CONVERSATION_GRAPH_INVALID'})}
})
test('CHAT34-G03: model credentials or enabled references never enter transfer evidence',()=>{
 for(const mutate of [(value:ConversationBundle)=>{value.tables.AIModel[0].apiKeyEncrypted='private-encrypted-key'},(value:ConversationBundle)=>{value.tables.AIModel[0].enabled=true}]){const value=bundle();mutate(value);assert.throws(()=>parseConversationBundle(value),{code:'CONVERSATION_GRAPH_INVALID'})}
})
test('CHAT34-G04: historical usage from another novel is never re-labelled as this conversation provenance',()=>{
 const value=bundle();value.history.UsageRecord[0].novelId='foreign-novel'
 assert.throws(()=>parseConversationBundle(value),{code:'CONVERSATION_GRAPH_INVALID'})
})
test('CHAT34-G05: historical domain snapshots retain source ownership and cannot smuggle a foreign candidate',()=>{
 for(const name of ['SubAgentRun','SopPlan','SopNodeRun','ContentImprovementRun','ContentCandidate','CandidateCommentEffect'] as const){const value=bundle();value.history[name]=[{id:'history',novelId:'foreign-novel',userId:'foreign-author'}];assert.throws(()=>parseConversationBundle(value),{code:'CONVERSATION_GRAPH_INVALID'})}
})
test('CHAT34-G06: orphaned SOP parent and candidate/comment references are not accepted as a complete historical closure',()=>{
 const value=bundle();value.history.SopNodeRun=[{id:'node',novelId:'old',parentRunId:'missing'}]
 assert.throws(()=>parseConversationBundle(value),{code:'CONVERSATION_GRAPH_INVALID'})
 const comments=bundle();comments.history.CandidateCommentEffect=[{id:'comment-effect',novelId:'old',candidateId:'missing'}]
 assert.throws(()=>parseConversationBundle(comments),{code:'CONVERSATION_GRAPH_INVALID'})
})
test('CHAT34-G07: unknown bundle tables, duplicate rows and unexpected scalar columns fail closed',()=>{
 const value=bundle();value.tables.Message.push({...value.tables.Message[0]});assert.throws(()=>parseConversationBundle(value),{code:'CONVERSATION_GRAPH_INVALID'})
 const columns=bundle();columns.tables.Message[0].untrusted='extra';assert.throws(()=>parseConversationBundle(columns),{code:'CONVERSATION_GRAPH_INVALID'})
 assert.throws(()=>parseConversationBundle({...bundle(),history:{...bundle().history,UntrustedCommand:[{request:'execute'}]}}),{code:'CONVERSATION_GRAPH_INVALID'})
 assert.equal(HISTORY_TABLES.length,7)
})
test('CHAT34-G08: usage issued before startNovel retains null provenance after the conversation has a novel',()=>{
 const value=bundle();value.history.UsageRecord[0].novelId=null
 const result=parseConversationBundle(value)
 assert.equal(result.history.UsageRecord[0].novelId,null);assert.equal(result.history.UsageRecord[0].cost,0.012)
})
