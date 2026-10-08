import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {runInNewContext} from 'node:vm'
import {test} from 'node:test'
import ts from 'typescript'
import {z} from 'zod'
import {ContentError} from '../../src/lib/content-errors'
import * as transfer from '../../desktop/shared/conversation-transfer'

async function fixture(){
 const calls:{id:string;input:unknown}[]=[],history=[{sourceWorkspaceId:'source-work',sourceNovelId:'old-novel',history:{UsageRecord:[{id:'old-usage',novelId:'old-novel',cost:0.19}],ContentCandidate:[{id:'old-candidate',chapterId:'old-chapter'}]}}]
 let row={id:'chat',userId:'local-author',novelId:null as string|null,modelId:null,thinkingEffort:null},busy=false
 const mocks:Record<string,unknown>={
  'zod':{z},'next/server':{NextResponse:{json:Response.json}},
  '@/lib/auth':{auth:async()=>({user:{id:'local-author'}})},
  '@/lib/db':{prisma:{conversation:{findUnique:async()=>row,findUniqueOrThrow:async()=>row,update:async()=>{throw Error('Direct association update is forbidden')}},chatTurn:{findFirst:async()=>null,findMany:async()=>[]},chatAttempt:{findMany:async()=>[]},message:{findMany:async()=>[]}}},
  '@/lib/staged-save':{parseStagedSaveAction:()=>null},'@desktop/shared/task-defaults':{restoreTaskDefaults:()=>null},
  '@/lib/content-errors':{ContentError},'@desktop/shared/conversation-transfer':transfer,
  '@desktop/service/conversation-runtime':{conversationLocation:async()=>({revision:4}),conversationHistory:async()=>history,
   associateConversation:async(id:string,input:unknown)=>{calls.push({id,input:structuredClone(input)});if(busy)throw new ContentError('CONVERSATION_BUSY','请先停止并保存当前创作任务');row={...row,novelId:'new-novel'};return{novelId:'new-novel',revision:5}},
  },
 }
 const exports={} as {GET:(req:Request,ctx:unknown)=>Promise<Response>;PATCH:(req:Request,ctx:unknown)=>Promise<Response>}
 const source=await readFile(join(process.cwd(),'desktop/handlers/chat/conversations/[id]/route.ts'),'utf8')
 runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:(id:string)=>mocks[id]??{},Response,Error})
 return{calls,history,busy(){busy=true},get:()=>exports.GET(new Request('https://local.invalid/api/chat/conversations/chat'),{params:Promise.resolve({id:'chat'})}),patch:(body:unknown)=>exports.PATCH(new Request('https://local.invalid/api/chat/conversations/chat',{method:'PATCH',body:JSON.stringify(body)}),{params:Promise.resolve({id:'chat'})})}
}
const command={conversationId:'chat',targetNovelId:'new-novel',operationId:'associate-operation34',expectedLocationRevision:4}
test('CHAT34-H01: original detail exposes authority revision and inert historical provenance without remapping old novel/candidate IDs',{timeout:15000},async()=>{
 const f=await fixture(),body=await(await f.get()).json() as {conversation:{locationRevision:number};history:unknown}
 assert.equal(body.conversation.locationRevision,4);assert.deepEqual(body.history,f.history)
})
test('CHAT34-H02: original PATCH routes an exact association command through the recoverable transfer service',{timeout:15000},async()=>{
 const f=await fixture(),response=await f.patch(command),body=await response.json() as {conversation:{novelId:string;locationRevision:number}}
 assert.equal(response.status,200);assert.deepEqual(f.calls,[{id:'chat',input:{operationId:command.operationId,novelId:'new-novel',expectedLocationRevision:4}}]);assert.equal(body.conversation.novelId,'new-novel');assert.equal(body.conversation.locationRevision,5)
})
test('CHAT34-H03: association path ID, revision, operation and payload remain strict and cannot accept workspace/path or model fields',{timeout:15000},async()=>{
 const f=await fixture()
 for(const body of [{...command,conversationId:'other'},{...command,workspaceId:'untrusted'},{...command,path:'/untrusted'},{...command,expectedLocationRevision:-1},{...command,modelId:'model',thinkingEffort:null},{targetNovelId:'new-novel'}])assert.equal((await f.patch(body)).status,400)
 assert.equal(f.calls.length,0)
})
test('CHAT34-H04: active association returns its original CONVERSATION_BUSY error without patching the conversation directly',{timeout:15000},async()=>{
 const f=await fixture();f.busy();const response=await f.patch(command),body=await response.json() as {code:string}
 assert.equal(response.status,409);assert.equal(body.code,'CONVERSATION_BUSY')
})
