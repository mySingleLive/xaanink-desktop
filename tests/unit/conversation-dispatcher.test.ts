import assert from 'node:assert/strict'
import {test} from 'node:test'
import {LocalDispatcher} from '../../desktop/service/dispatcher'
import type {Workspaces} from '../../desktop/service/workspaces'
import type {ConversationTransfers} from '../../desktop/service/conversation-transfer'
import {runInDatabaseContext} from '../../desktop/service/context'
import type {PrismaClient} from '../../src/generated/prisma/client'
import type {LocalRequest} from '../../desktop/shared/ipc'
const request=(path:string):LocalRequest=>({version:1,id:'a463091e-661f-438c-b30f-3bc7b2a27fba',path,method:'GET',headers:{}})
function fixture(pointer=true,missing=false,sourceMissing=false){
 const calls:string[]=[],row={id:'chat',userId:'local-author',novelId:'novel',title:'唯一权威会话',createdAt:new Date(0),updatedAt:new Date(1),_count:{messages:2}}
 const location={version:1,conversationId:'chat',userId:'local-author',workspaceId:'work',novelId:'novel',revision:1,historicalTransfers:['transfer34'],deleted:false}
 const works={list:async()=>[{id:'work',novelId:'novel'},...(sourceMissing?[{id:'former-work',novelId:'old-novel'}]:[])],run:async(id:string,run:()=>Promise<unknown>)=>{calls.push(id);if(sourceMissing&&id==='former-work')throw Error('former directory missing');if(missing&&id==='work')throw Error('authoritative directory missing');return runInDatabaseContext({workspaceId:id,database:{conversation:{findFirst:async()=>row,findMany:async()=>[row]}} as unknown as PrismaClient},run)}} as unknown as Workspaces
 const transfers={ledger:{location:async()=>pointer?location:null,locations:async()=>pointer?[location]:[],entity:async()=>null},current:async()=>location,bind:async(_id:string,run:()=>Promise<unknown>)=>run()} as unknown as ConversationTransfers
 const dispatcher=new LocalDispatcher(works,transfers)
 return{dispatcher,works,calls}
}
test('CHAT34-D01: durable authority wins over an old inbox copy without scanning it',async()=>{
 const f=fixture();assert.equal(await f.dispatcher.workspaceFor(request('/api/chat/conversations/chat')),'work');assert.deepEqual(f.calls,[])
})
test('CHAT34-D02: lost authoritative work never falls back to an old inbox copy',async()=>{
 const f=fixture(true,true),id=await f.dispatcher.workspaceFor(request('/api/chat/conversations/chat'))
 await assert.rejects(f.works.run(id,async()=>null),/authoritative directory missing/);assert.deepEqual(f.calls,['work'])
})
test('CHAT34-D03: unindexed duplicate legacy conversations reject instead of choosing the first database',async()=>{
 const f=fixture(false);await assert.rejects(f.dispatcher.workspaceFor(request('/api/chat/conversations/chat')),{code:'CONVERSATION_AUTHORITY_AMBIGUOUS'});assert.deepEqual(f.calls,['inbox','work'])
})
test('CHAT34-D04: global list displays the authoritative conversation once, never a cleanup-pending source copy',async()=>{
 const f=fixture(),response=await f.dispatcher.handle(request('/api/chat/conversations'),new AbortController().signal),body=await response.json() as {conversations:{id:string}[]}
 assert.equal(body.conversations.length,1);assert.equal(body.conversations[0].id,'chat')
})
test('CHAT34-D05: lost old source does not hide the still available durable authority',{timeout:15000},async()=>{
 const f=fixture(true,false,true),response=await f.dispatcher.handle(request('/api/chat/conversations'),new AbortController().signal),body=await response.json() as {conversations:{id:string}[]}
 assert.deepEqual(body.conversations.map(row=>row.id),['chat'])
})
test('CHAT34-D06: list cannot report success after losing a required authoritative directory',{timeout:15000},async()=>{
 const f=fixture(true,true);await assert.rejects(f.dispatcher.handle(request('/api/chat/conversations'),new AbortController().signal),/authoritative directory missing/)
})
test('CHAT34-D07: legacy registration cannot guess uniqueness while another candidate database is unavailable',{timeout:15000},async()=>{
 const f=fixture(false,false,true);await assert.rejects(f.dispatcher.handle(request('/api/chat/conversations'),new AbortController().signal),{code:'CONVERSATION_AUTHORITY_UNAVAILABLE'})
})
