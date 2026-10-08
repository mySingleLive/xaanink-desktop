import assert from 'node:assert/strict'
import {test} from 'node:test'
import {ConversationTaskRuntime} from '../../desktop/service/conversation-task-runtime'
const origin={requestId:'7975f95c-4ae3-4464-b85f-fc766dd8df66',nonce:'6f1ca252-1a03-41c8-9e62-7c5b33799888'},scope={userId:'local-author',conversationId:'chat',turnId:'turn',attemptId:'attempt',epoch:7,operationId:'operation34'}
const claimId='c51d40a2-e7be-4944-8c14-1be6c867976f',nextClaimId='fbc93134-2bd8-4f76-a2d5-41dac740c975',proof={path:'/isolated/native-grant',device:'1',inode:'2'}
test('CHAT34-O01: task claim outlives returned HTTP callback, and real finalization releases once',async()=>{
 const calls:{method:string;data:unknown}[]=[],end=Promise.withResolvers<void>();let task!:Promise<void>
 const runtime=new ConversationTaskRuntime(async(method,data)=>{calls.push({method,data});return method==='conversation.claim'?{claimId}:method==='conversation.choose-directory'?proof:true})
 const response=await runtime.run(origin,scope,async()=>{task=(async()=>{await end.promise;assert.deepEqual(await runtime.choose(scope,{title:'作者作品',requestId:scope.operationId}),proof);await Promise.all([runtime.finish(),runtime.finish()])})();return 'headers-returned'})
 assert.equal(response,'headers-returned');assert.deepEqual(calls.map(row=>row.method),['conversation.claim']);end.resolve();await task
 assert.deepEqual(calls.map(row=>row.method),['conversation.claim','conversation.choose-directory','conversation.release'])
 const chosen=calls[1].data as {origin:unknown;task:unknown;claimId:unknown};assert.deepEqual(chosen.origin,origin);assert.deepEqual(chosen.task,{conversationId:'chat',turnId:'turn',attemptId:'attempt',epoch:7});assert.equal(chosen.claimId,claimId)
})
test('CHAT34-O02: origin-free old worker fixtures cannot manufacture directory authorization',async()=>{
 let calls=0;const runtime=new ConversationTaskRuntime(async()=>{calls++;return{claimId}})
 await runtime.run(undefined,scope,async()=>{await assert.rejects(runtime.choose(scope,{title:'作品',requestId:scope.operationId}),{code:'DIRECTORY_REQUIRED'});await runtime.finish()});assert.equal(calls,0)
})
test('CHAT34-O03: retry atomically replaces its previous exact tuple with the new attempt',async()=>{
 const calls:{method:string;data:unknown}[]=[];let count=0;const next={...scope,attemptId:'attempt-2',epoch:8}
 const runtime=new ConversationTaskRuntime(async(method,data)=>{calls.push({method,data});return method==='conversation.claim'?{claimId:count++?nextClaimId:claimId}:method==='conversation.choose-directory'?proof:true})
 await runtime.run(origin,scope,async()=>{await runtime.refresh(next);await assert.rejects(runtime.choose(scope,{title:'旧',requestId:scope.operationId}),{code:'EXECUTION_REVOKED'});await runtime.choose(next,{title:'新',requestId:scope.operationId});await runtime.finish()})
 assert.deepEqual(calls.map(row=>row.method),['conversation.claim','conversation.claim','conversation.choose-directory','conversation.release']);assert.equal((calls[2].data as {claimId:string}).claimId,nextClaimId);assert.deepEqual((calls[1].data as {previous:unknown}).previous,{task:{conversationId:'chat',turnId:'turn',attemptId:'attempt',epoch:7},claimId})
})
test('CHAT34-O04: failure before callback admission releases issued claim and late chooser cannot use a finished task',async()=>{
 let selects=0,releases=0;const runtime=new ConversationTaskRuntime(async(method)=>{if(method==='conversation.choose-directory')selects++;if(method==='conversation.release')releases++;return method==='conversation.claim'?{claimId}:proof})
 await assert.rejects(runtime.run(origin,scope,async()=>{await runtime.finish();await assert.rejects(runtime.choose(scope,{title:'旧',requestId:scope.operationId}),{code:'EXECUTION_REVOKED'});throw Error('controlled callback failure')}),/controlled callback failure/)
 assert.equal(selects,0);assert.equal(releases,1)
})
test('CHAT34-O05: background executor owns its database lease before headers return and releases after final claim ACK',async()=>{
 let released=0;const end=Promise.withResolvers<void>(),ack=Promise.withResolvers<void>();let task!:Promise<void>
 const runtime=new ConversationTaskRuntime(async method=>method==='conversation.claim'?{claimId}:ack.promise)
 await runtime.run(origin,scope,async()=>{task=(async()=>{await end.promise;await runtime.finish()})();return 'headers'},()=>{released++})
 assert.equal(released,0);end.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(released,0);ack.resolve();await task;assert.equal(released,1)
})
test('CHAT34-O06: shared admission revocation rejects a creation before its first mutation and always acknowledges admission finish',{timeout:15000},async()=>{
 const revoked=new SharedArrayBuffer(4),methods:string[]=[];let creates=0
 const runtime=new ConversationTaskRuntime(async method=>{methods.push(method);if(method==='conversation.claim')return{claimId};if(method==='conversation.create-admission'){Atomics.store(new Int32Array(revoked),0,1);return{admissionId:nextClaimId,revocation:revoked}}return true})
 await runtime.run(origin,scope,async()=>{await assert.rejects(runtime.withCreateAdmission(scope,{title:'作品',requestId:scope.operationId},proof,async assertCurrent=>{assertCurrent();creates++}),{code:'EXECUTION_REVOKED'});await runtime.finish()})
 assert.equal(creates,0);assert.deepEqual(methods,['conversation.claim','conversation.create-admission','conversation.create-finished','conversation.release'])
})
test('CHAT34-O07: every synchronous creation guard sees a later original-window revoke across asynchronous IO',{timeout:15000},async()=>{
 const revoked=new SharedArrayBuffer(4),entered=Promise.withResolvers<void>(),continueIO=Promise.withResolvers<void>();let writes=0
 const runtime=new ConversationTaskRuntime(async method=>method==='conversation.claim'?{claimId}:method==='conversation.create-admission'?{admissionId:nextClaimId,revocation:revoked}:true)
 const task=runtime.run(origin,scope,async()=>{try{return await runtime.withCreateAdmission(scope,{title:'作品',requestId:scope.operationId},proof,async assertCurrent=>{assertCurrent();entered.resolve();await continueIO.promise;assertCurrent();writes++})}finally{await runtime.finish()}})
 await entered.promise;Atomics.store(new Int32Array(revoked),0,1);continueIO.resolve();await assert.rejects(task,{code:'EXECUTION_REVOKED'});assert.equal(writes,0)
})
