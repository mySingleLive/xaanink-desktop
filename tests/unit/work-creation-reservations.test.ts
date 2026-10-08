import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {PrismaClient} from '../../src/generated/prisma/client'
import {WorkCreationReservations} from '../../desktop/service/work-creation-reservations'

function fixture(){
 let rows=new Map<string,{key:string;value:unknown}>(),afterRead=()=>{},afterWrite=()=>{}
 const database={$transaction:async(run:(tx:unknown)=>Promise<unknown>)=>{
  const pending=structuredClone(rows)
  const result=await run({$executeRaw:async()=>0,systemConfig:{
   findUnique:async({where}:{where:{key:string}})=>{const found=structuredClone(pending.get(where.key)??null);afterRead();return found},
   create:async({data}:{data:{key:string;value:unknown}})=>{assert(!pending.has(data.key));pending.set(data.key,structuredClone(data));afterWrite();return data},
   update:async({where,data}:{where:{key:string};data:{value:unknown}})=>{assert(pending.has(where.key));pending.set(where.key,{key:where.key,value:structuredClone(data.value)});afterWrite();return data},
  }})
  rows=pending;return result
 },systemConfig:{findMany:async()=>structuredClone([...rows.values()]),findUnique:async({where}:{where:{key:string}})=>structuredClone(rows.get(where.key)??null)}} as unknown as PrismaClient
 return{database,reservations:new WorkCreationReservations(run=>run(database)),rows:()=>rows,afterRead(run:()=>void){afterRead=run},afterWrite(run:()=>void){afterWrite=run}}
}
const original={requestId:'operation-reservation34',requestHash:'a'.repeat(64),selection:{path:'/private/tmp/original-authorized',device:'1',inode:'34'}}

test('CHAT34-CR01: original request reserves one exact directory; changed hash, path and inode cannot replace it',{timeout:15000},async()=>{
 const f=fixture(),pending=await f.reservations.reserve(original,()=>{})
 await assert.rejects(f.reservations.assertNoPendingCreation(original.requestId),{code:'WORK_CREATION_PENDING'})
 assert.equal(pending.phase,'pending');assert.deepEqual(pending.selection,original.selection)
 assert.deepEqual(await f.reservations.reserve(original,()=>{}),pending)
 for(const input of [{...original,requestHash:'b'.repeat(64)},{...original,selection:{...original.selection,path:'/private/tmp/another-empty'}},{...original,selection:{...original.selection,inode:'35'}}]){
  await assert.rejects(f.reservations.reserve(input,()=>{}),{code:'REQUEST_CONFLICT'})
  assert.deepEqual([...f.rows().values()][0].value,pending)
 }
 assert.equal(f.rows().size,1)
})
test('CHAT34-CR02: revocation after awaited reservation writes rolls back its transaction; completing is equally guarded',{timeout:15000},async()=>{
 const f=fixture();let revoked=false
 const guard=()=>{if(revoked)throw Object.assign(Error('withdrawn'),{code:'EXECUTION_REVOKED'})}
 f.afterWrite(()=>{revoked=true})
 await assert.rejects(f.reservations.reserve(original,guard),{code:'EXECUTION_REVOKED'});assert.equal(f.rows().size,0)
 revoked=false;f.afterWrite(()=>{})
 const pending=await f.reservations.reserve(original,guard)
 f.afterWrite(()=>{revoked=true})
 await assert.rejects(f.reservations.complete(original,guard),{code:'EXECUTION_REVOKED'})
 assert.deepEqual([...f.rows().values()][0].value,pending)
 revoked=false;f.afterWrite(()=>{})
 assert.equal((await f.reservations.complete(original,guard)).phase,'complete')
 await f.reservations.assertNoPendingCreation('unused-operation34')
 assert.equal((await f.reservations.reserve(original,guard)).phase,'complete')
})
test('CHAT34-CR03: reservation reads fail closed on malformed private records and guard all awaited reads',{timeout:15000},async()=>{
 const f=fixture();await f.reservations.reserve(original,()=>{})
 assert.deepEqual(await f.reservations.directories(),[original.selection.path])
 f.afterRead(()=>{throw Error('request revoked while reading')})
 await assert.rejects(f.reservations.reserve(original,()=>{}),/revoked while reading/)
 f.afterRead(()=>{})
 const row=[...f.rows().values()][0];row.value={...(row.value as object),unexpected:'field'}
 await assert.rejects(f.reservations.directories())
})

test('CHAT34-CR04: actual creation host distinguishes a fresh picker cancellation from an unresolved reserved request',{timeout:15000},async t=>{
 const {configureConversationTransfers,conversationTransfersFor,runConversationTask,finishConversationTask}=await import('../../desktop/service/conversation-runtime')
 const {runInDatabaseContext}=await import('../../desktop/service/context'),{ConversationTransferLedger}=await import('../../desktop/service/conversation-ledger'),{mock}=await import('node:test')
 const {randomUUID}=await import('node:crypto')
 for(const reserved of [false,true])await t.test(reserved?'pending needs original directory reauthorization':'fresh cancel has no created work',async()=>{
  const f=fixture();if(reserved)await f.reservations.reserve(original,()=>{})
  const scope={userId:'local-author',conversationId:'cancel-chat',turnId:'cancel-turn',attemptId:'cancel-attempt',epoch:1,operationId:original.requestId}
  const origin={requestId:randomUUID(),nonce:randomUUID()}
  const location=mock.method(ConversationTransferLedger.prototype,'location',async()=>({version:1,conversationId:scope.conversationId,userId:'local-author',workspaceId:'inbox',novelId:null,revision:0,historicalTransfers:[],deleted:false}))
  const index=mock.method(ConversationTransferLedger.prototype,'indexEntity',async()=>{})
  const context={workspaceId:'inbox',database:f.database,retainTask:()=>()=>{},requestOrigin:origin}
  let creates=0
  const works={run:(_id:string,run:()=>Promise<unknown>)=>runInDatabaseContext(context,run),list:async()=>[],assertNoPendingCreation:(id:string)=>f.reservations.assertNoPendingCreation(id),create:async()=>{creates++;throw Error('unexpected create')}} as unknown as import('../../desktop/service/workspaces').Workspaces
  const dispose=configureConversationTransfers(works,async method=>{if(method==='conversation.claim')return{claimId:randomUUID()};if(method==='conversation.choose-directory')return null;if(method==='conversation.release')return true;throw Error('unexpected call')})
  try{
   await runInDatabaseContext(context,()=>runConversationTask(scope,async()=>{
    try{
     const operation=conversationTransfersFor(works)!.host.createWork(scope,{title:'原请求',requestId:original.requestId})
     if(reserved)await assert.rejects(operation,{code:'WORK_CREATION_PENDING'});else assert.equal(await operation,null)
    }finally{await finishConversationTask()}
   }))
   assert.equal(creates,0);assert.equal(f.rows().size,reserved?1:0)
  }finally{dispose();location.mock.restore();index.mock.restore()}
 })
})
