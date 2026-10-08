import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {runInNewContext} from 'node:vm'
import {test} from 'node:test'
import ts from 'typescript'
import {ConversationTaskRuntime} from '../../desktop/service/conversation-task-runtime'
import type {ChatExecutionScope} from '../../src/lib/chat-execution'

const origin={requestId:'7975f95c-4ae3-4464-b85f-fc766dd8df66',nonce:'6f1ca252-1a03-41c8-9e62-7c5b33799888'}
const claimId='c51d40a2-e7be-4944-8c14-1be6c867976f',nextClaimId='fbc93134-2bd8-4f76-a2d5-41dac740c975'
const proof={path:'/isolated/native-grant',device:'1',inode:'2'}
async function fixture(mode:'detached'|'retry'|'replay'){
 const calls:{method:string;data?:unknown}[]=[],quota=Promise.withResolvers<void>(),quotaEntered=Promise.withResolvers<void>(),finalObservation=Promise.withResolvers<void>(),observationEntered=Promise.withResolvers<void>(),releaseAck=Promise.withResolvers<void>(),releaseEntered=Promise.withResolvers<void>(),unregistered=Promise.withResolvers<void>()
 let leases=0,claims=0,registrations=0
 const binding={replay:mode==='replay',conversation:{id:'chat',novelId:null,modelId:'model'},turn:{id:'turn',userMessageId:'user',action:null},attempt:{id:'attempt',assistantMessageId:'assistant',createdAt:new Date(),executionEpoch:7}}
 const runtime=new ConversationTaskRuntime(async(method,data)=>{
  calls.push({method,data})
  if(method==='conversation.claim')return{claimId:claims++?nextClaimId:claimId}
  if(method==='conversation.choose-directory')return proof
  if(method==='conversation.release'){releaseEntered.resolve();await releaseAck.promise;return true}
  throw Error('Unexpected private task transport')
 })
 class Meter{data:Record<string,unknown>={};modelEnd(){};end(status:unknown){this.data.status=status};startModel(){}}
 class FixtureError extends Error{}
 class ObservedStream extends ReadableStream<Uint8Array>{constructor(source:UnderlyingDefaultSource<Uint8Array>){calls.push({method:'stream-created'});super(source)}}
 const mocks:Record<string,unknown>={
  '@desktop/service/conversation-runtime':{
   runConversationTask:(scope:ChatExecutionScope,run:()=>Promise<Response>)=>{leases++;return runtime.run(origin,scope,run,()=>{leases--;calls.push({method:'database-release'})})},
   refreshConversationTask:(scope:ChatExecutionScope)=>runtime.refresh(scope),finishConversationTask:()=>runtime.finish(),
  },
  '@/lib/auth':{auth:async()=>({user:{id:'local-author'}})},
  '@/lib/services/attempt-observation':{AttemptMeter:Meter,saveAttemptObservation:async(scope:ChatExecutionScope,meter:Meter)=>{
   calls.push({method:'observation',data:scope.attemptId})
   if(meter.data.status==='failed'){observationEntered.resolve();await finalObservation.promise}
  }},
  '@/lib/local-chat-cancellation':{registerAttemptAbort:()=>{registrations++;return()=>{registrations--;calls.push({method:'unregister'});if(!registrations)unregistered.resolve()}}},
  '@/lib/services/chat-turn':{
   beginChatRequest:async()=>{calls.push({method:'begin'});return binding},
   scopeFor:(_c:unknown,_t:unknown,a:typeof binding.attempt)=>({userId:'local-author',conversationId:'chat',turnId:'turn',attemptId:a.id,epoch:a.executionEpoch}),
   getChatTurn:async()=>({attempts:[{id:'attempt',status:'succeeded'}]}),
   heartbeatChatAttempt:async()=>{},checkpointChatAttempt:async()=>{},
   finishChatAttempt:async(scope:ChatExecutionScope)=>{calls.push({method:'terminal-write',data:scope.attemptId});return true},
   nextChatAttempt:async()=>{calls.push({method:'next-attempt'});return{...binding,attempt:{...binding.attempt,id:'attempt-2',executionEpoch:8}}},
  },
  '@/lib/long-task':{acquireLongTask:async()=>()=>{},runInsideLongTask:(run:()=>unknown)=>run()},
  '@/lib/quota':{checkQuota:async()=>{quotaEntered.resolve();if(mode==='detached'){await quota.promise;await runtime.choose({userId:'local-author',conversationId:'chat',turnId:'turn',attemptId:'attempt',epoch:7,operationId:'operation34'},{title:'作者作品',requestId:'operation34'});throw Error('controlled preparation failure')}}},
  '@/lib/ai/cost-config':{getCostConfig:async()=>({enabled:false,maxConcurrentTasks:1})},
  '@/lib/ai/errors':{toErrorResponse:(error:unknown)=>new Response(String(error),{status:500})},
  '@/lib/ai/error-classification':{chatTerminalError:()=>({code:'FIXTURE_FAILURE',message:'controlled failure'})},
  '@/lib/content-errors':{ContentError:FixtureError},
  '@/lib/chat-protocol':{CHAT_HEARTBEAT_MS:15000,CHAT_LEASE_MS:60000,chatRequestSchema:{parse:(v:unknown)=>v}},
  '@/lib/ai/network-retry':{
   getMaxNetworkRetries:async()=>1,createNetworkRetryFetch:()=>()=>{throw Error('No network expected')},
   runWithNetworkRetry:async(_run:unknown,options:{onRetry:(event:{error:Error})=>Promise<void>})=>{await options.onRetry({error:Error('fixture interrupted stream')});throw Error('controlled retry terminal')},
  },
  '@/lib/ai/provider':{getModelByIdForUser:async()=>({model:{},modelRecord:{id:'model',modelId:'fixture',provider:'custom',contextWindow:32000}})},
  '@desktop/service/models':{snapshotForRecord:()=>({thinkingLevels:[]})},
  '@/lib/services/content-commit':{requestHash:()=>''},
  '@/lib/db':{prisma:{message:{findMany:async()=>[]}}},
  '@/lib/planning-adjustment':{planningAdjustmentOf:()=>null},
  '@/lib/services/chat-action':{chatActionNote:()=>''},
  '@/lib/ai/tools':{createAgentTools:()=>({})},
  '@/lib/services/chat-tool-execution':{bindChatTools:(tools:unknown)=>tools},
  '@/lib/ai/tool-names':{WRITE_TOOL_NAMES:new Set()},
  '@/lib/ai/prompt-budget':{estimateToolTokens:async()=>0,assertPromptFits:()=>0},
  '@/lib/ai/context-protection':{loadContextProtection:async()=>({})},
  '@/lib/chat-execution':{runInChatExecution:(_scope:unknown,run:()=>unknown)=>run()},
  '@/lib/ai/chat':{buildChatSystemPrompt:async()=>'',withTurnReminder:(value:unknown)=>value,toModelMessages:(value:unknown)=>value,turnFormatReminder:()=>''},
  '@/lib/ai/context-budget':{estimateTokens:()=>0,calibrationFactor:()=>1},
  '@/lib/ai/context-compression':{manageConversationContext:async()=>({system:'',messages:[]})},
  'next/server':{NextResponse:{json:Response.json}},
 }
 const source=await readFile(join(process.cwd(),'desktop/handlers/chat/route.ts'),'utf8')
 const exports={} as {POST:(request:Request)=>Promise<Response>}
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  exports,require:(id:string)=>mocks[id]??{},TextEncoder,ReadableStream:ObservedStream,Response,Request,AbortController,Date,Error,crypto,performance,
  console:{...console,error:()=>{},warn:()=>{}},setInterval:()=>1,clearInterval:()=>{},setTimeout,clearTimeout,
 })
 return{calls,quota,quotaEntered,finalObservation,observationEntered,releaseAck,releaseEntered,unregistered,leases:()=>leases,registrations:()=>registrations,request:()=>exports.POST(new Request('https://local.invalid/api/chat',{method:'POST',body:JSON.stringify({mode:'write',message:'fixture'})}))}
}

test('CHAT34-C01: original POST claims after begin before SSE and detached final writes precede release ACK and database lease release',{timeout:15000},async()=>{
 const f=await fixture('detached')
 try{
  const response=await f.request();assert.equal(response.status,200)
  assert.deepEqual(f.calls.slice(0,3).map(row=>row.method),['begin','conversation.claim','stream-created'])
  await response.body!.cancel();await f.quotaEntered.promise
  assert.equal(f.leases(),1);assert.equal(f.registrations(),1);assert.equal(f.calls.some(row=>row.method==='conversation.release'),false)
  f.quota.resolve();await f.observationEntered.promise
  assert.equal(f.calls.some(row=>row.method==='conversation.choose-directory'),true,'cancelled follower does not revoke its actual executing task')
  assert.equal(f.calls.some(row=>row.method==='conversation.release'),false,'final observation retains the directory claim')
  f.finalObservation.resolve();await f.releaseEntered.promise
  assert.equal(f.leases(),1);assert.equal(f.registrations(),1)
  f.releaseAck.resolve();await f.unregistered.promise
  assert.equal(f.leases(),0);assert.equal(f.registrations(),0)
  assert.ok(f.calls.findIndex(row=>row.method==='terminal-write')<f.calls.findIndex(row=>row.method==='conversation.release'))
  assert.ok(f.calls.findIndex(row=>row.method==='conversation.release')<f.calls.findIndex(row=>row.method==='database-release'))
 }finally{f.quota.resolve();f.finalObservation.resolve();f.releaseAck.resolve()}
})
test('CHAT34-C02: original retry hook replaces the exact old claim after durable nextAttempt and finalizes the new attempt',{timeout:15000},async()=>{
 const f=await fixture('retry')
 try{
  const response=await f.request();await f.observationEntered.promise
  const claims=f.calls.filter(row=>row.method==='conversation.claim');assert.equal(claims.length,2)
  assert.deepEqual((claims[1].data as {previous:unknown}).previous,{task:{conversationId:'chat',turnId:'turn',attemptId:'attempt',epoch:7},claimId})
  assert.equal((claims[1].data as {task:{attemptId:string;epoch:number}}).task.attemptId,'attempt-2')
  assert.ok(f.calls.findIndex(row=>row.method==='next-attempt')<f.calls.indexOf(claims[1]))
  assert.equal(f.calls.find(row=>row.method==='terminal-write')?.data,'attempt-2')
  f.finalObservation.resolve();await f.releaseEntered.promise
  const released=f.calls.find(row=>row.method==='conversation.release')?.data as {claimId:string;task:{attemptId:string}}
  assert.equal(released.claimId,nextClaimId);assert.equal(released.task.attemptId,'attempt-2')
  f.releaseAck.resolve();await response.text();assert.equal(f.leases(),0)
 }finally{f.quota.resolve();f.finalObservation.resolve();f.releaseAck.resolve()}
})
test('CHAT34-C03: replayed original request has no new executor, claim or directory task lease',{timeout:15000},async()=>{
 const f=await fixture('replay');const response=await f.request();assert.equal(response.status,200);assert.deepEqual(f.calls.map(row=>row.method),['begin']);assert.equal(f.leases(),0)
})
