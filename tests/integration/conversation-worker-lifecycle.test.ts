import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Worker} from 'node:worker_threads'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {RpcPeer} from '../../desktop/service/rpc'
import {ConversationDirectoryAuthorizations} from '../../desktop/main/conversation-directory-authorizations'
import {conversationClaimSchema} from '../../desktop/shared/conversation-task'
import {defaultState} from '../../desktop/core/settings'
import {freezeTaskDefaults} from '../../desktop/shared/task-defaults'
import type {LocalResponse} from '../../desktop/shared/ipc'

test('CHAT34-I04: built worker forwards a private origin only to the real post-begin task and retains it through final settlement',{timeout:600_000},async()=>{
 await import('../../scripts/build-desktop.mjs')
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-conversation-worker-')),releaseEntered=Promise.withResolvers<void>(),releaseAck=Promise.withResolvers<void>()
 const worker=new Worker(join(process.cwd(),'dist/service/index.cjs'),{workerData:{root:join(root,'app'),migrations:join(process.cwd(),'prisma/migrations')}})
 const privateCalls:{method:string;input:unknown}[]=[],requestId=randomUUID()
 const registry=new ConversationDirectoryAuthorizations({choose:async()=>{throw Error('No picker expected without a selected model')},revoke(){}})
 const origin=registry.begin(requestId,'original-worker-fixture',()=>{})
 const rpc=new RpcPeer(worker,async(method,input)=>{
  if(method==='model.defaults')return freezeTaskDefaults(defaultState.settings.agent,0)
  if(method==='model.resolve')throw Error('MODEL_NOT_SELECTED')
  privateCalls.push({method,input})
  if(method==='conversation.claim')return registry.claim(input)
  if(method==='conversation.release'){releaseEntered.resolve();await releaseAck.promise;return registry.release(input)}
  throw Error(`Unexpected private transport: ${method}`)
 })
 worker.on('error',()=>rpc.dispose());worker.on('exit',()=>rpc.dispose())
 const drain=async(id:string)=>{const chunks:Uint8Array[]=[];for(;;){const frame=await rpc.call<{done:boolean;bytes?:Uint8Array}>('read',id);if(frame.done)break;chunks.push(frame.bytes!)}return Buffer.concat(chunks).toString('utf8')}
 try{
  await rpc.call('ready')
  const request={version:1,id:requestId,path:'/api/chat',method:'POST',headers:{'content-type':'application/json'},body:Array.from(Buffer.from(JSON.stringify({clientRequestId:randomUUID(),message:'无外部模型的真实生命周期'})))}
  const response=await rpc.call<LocalResponse>('start',{request,origin});assert.equal(response.status,200)
  await releaseEntered.promise
  assert.equal(privateCalls.filter(row=>row.method==='conversation.claim').length,1)
  const claim=conversationClaimSchema.parse(privateCalls.find(row=>row.method==='conversation.claim')!.input)
  assert.deepEqual(claim.origin,origin);assert.equal(claim.task.conversationId,response.headers['x-conversation-id']);assert.equal(claim.task.attemptId,response.headers['x-attempt-id'])
  assert.equal((await rpc.call<{active:number}>('task-status')).active,1,'the real detached executor is still waiting for final claim ACK')
  await rpc.call('cancel',requestId)
  assert.equal((await rpc.call<{active:number}>('task-status')).active,1,'follower cancellation cannot finalize the task prematurely')
  releaseAck.resolve()
  for(let count=0;(await rpc.call<{active:number}>('task-status')).active&&count<300;count++)await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal((await rpc.call<{active:number}>('task-status')).active,0)
  const detailId=randomUUID(),detail=await rpc.call<LocalResponse>('start',{version:1,id:detailId,path:`/api/chat/conversations/${claim.task.conversationId}`,method:'GET',headers:{}})
  assert.equal(detail.status,200)
  const body=JSON.parse(await drain(detailId)) as {conversation:{id:string;locationRevision:number};turnState:{attempts:{id:string;status:string}[]};history:unknown[]}
  assert.equal(body.conversation.id,claim.task.conversationId);assert.equal(body.conversation.locationRevision,0);assert.deepEqual(body.history,[])
  assert.equal(body.turnState.attempts.find(row=>row.id===claim.task.attemptId)?.status,'failed')
  assert.equal(privateCalls.filter(row=>row.method==='conversation.choose-directory').length,0)
  await assert.rejects(rpc.call('start',{...request,id:randomUUID(),origin}),/Unrecognized|origin|key/i)
  await rpc.call('close')
 }finally{releaseAck.resolve();await rpc.call('close').catch(()=>{});rpc.dispose();await worker.terminate();await registry.flush();await rm(root,{recursive:true,force:true})}
})
