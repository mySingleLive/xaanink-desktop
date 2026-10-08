import assert from 'node:assert/strict'
import {test} from 'node:test'
import {parseConversationWorkerRequest} from '../../desktop/service/conversation-request'
const request={version:1 as const,id:'7975f95c-4ae3-4464-b85f-fc766dd8df66',path:'/api/chat',method:'POST' as const,headers:{}}
const origin={requestId:request.id,nonce:'6f1ca252-1a03-41c8-9e62-7c5b33799888'}
test('CHAT34-R01: main-private envelope returns its validated exact origin without altering original request',()=>{assert.deepEqual(parseConversationWorkerRequest({request,origin}),{request,origin})})
test('CHAT34-R02: plain compatibility cannot smuggle origins or invalid request paths',()=>{assert.deepEqual(parseConversationWorkerRequest(request),{request});assert.throws(()=>parseConversationWorkerRequest({...request,origin}));assert.throws(()=>parseConversationWorkerRequest({...request,path:'/other'}))})
test('CHAT34-R03: private origin must match exact chat POST and nonce envelope has no additional fields',()=>{for(const value of [{request,origin:{...origin,requestId:origin.nonce}},{request:{...request,method:'GET'},origin},{request:{...request,path:'/api/novels'},origin},{request,origin,extra:true},{request,origin:{...origin,key:'secret'}}])assert.throws(()=>parseConversationWorkerRequest(value))})
