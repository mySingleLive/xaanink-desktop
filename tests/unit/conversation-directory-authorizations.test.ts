import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {ConversationDirectoryAuthorizations} from '../../desktop/main/conversation-directory-authorizations'

const tuple=(epoch=1)=>({conversationId:'conversation-a',turnId:'turn-a',attemptId:`attempt-${epoch}`,epoch})
const proof={path:'/isolated/selected-work',device:'1',inode:'2'}
function fixture(){
 let alive=true,calls=0
 const waits:Array<ReturnType<typeof Promise.withResolvers<typeof proof|null>>>=[],revoked:string[]=[]
 const registry=new ConversationDirectoryAuthorizations({choose:async(_input,guard)=>{guard();calls++;const wait=Promise.withResolvers<typeof proof|null>();waits.push(wait);return wait.promise},revoke:owner=>{revoked.push(owner)}})
 const origin=registry.begin(randomUUID(),'window:session',()=>{if(!alive)throw Error('old window')})
 const claim=registry.claim({origin,task:tuple()})
 const request=(operationId='operation-one')=>({origin,task:tuple(),claimId:claim.claimId,operationId,input:{title:'作品',requestId:operationId}})
 return{registry,origin,claim,request,waits,revoked,get calls(){return calls},expire(){alive=false}}
}
const tick=()=>new Promise(setImmediate)

test('a forged origin or a finished unclaimed request cannot borrow the current window',()=>{
 const registry=new ConversationDirectoryAuthorizations({choose:async()=>proof,revoke(){}}),id=randomUUID(),origin=registry.begin(id,'owner',()=>{})
 assert.throws(()=>registry.claim({origin:{...origin,nonce:randomUUID()},task:tuple()}),/DIRECTORY_AUTHORIZATION_REVOKED/)
 registry.endRequest(origin)
 assert.throws(()=>registry.claim({origin,task:tuple()}),/DIRECTORY_AUTHORIZATION_REVOKED/)
 const next=registry.begin(id,'owner',()=>{});assert.notEqual(next.nonce,origin.nonce)
 registry.endRequest(origin);assert.ok(registry.claim({origin:next,task:tuple()}))
})
test('the true task retains its directory authority after the response stream ends, then releases it',async()=>{
 const f=fixture();f.registry.endRequest(f.origin)
 const selected=f.registry.choose(f.request());await tick();assert.equal(f.calls,1);f.waits[0].resolve(proof)
 assert.deepEqual(await selected,proof);assert.equal(f.registry.release({origin:f.origin,task:tuple(),claimId:f.claim.claimId}),true)
 await assert.rejects(f.registry.choose(f.request()),/DIRECTORY_AUTHORIZATION_REVOKED/)
})
test('one operation displays one picker and preserves cancellation on replay, while changed input is refused',async()=>{
 const f=fixture(),one=f.registry.choose(f.request()),two=f.registry.choose(f.request());await tick();assert.equal(f.calls,1)
 await assert.rejects(f.registry.choose({...f.request(),input:{title:'被替换的标题',requestId:'operation-one'}}),/DIRECTORY_OPERATION_CHANGED/)
 f.waits[0].resolve(null);assert.equal(await one,null);assert.equal(await two,null);assert.equal(await f.registry.choose(f.request()),null);assert.equal(f.calls,1)
})
test('a replacement window cannot accept an old native picker result and flush waits for physical completion',async()=>{
 const f=fixture(),selected=f.registry.choose(f.request());const rejected=assert.rejects(selected,/DIRECTORY_AUTHORIZATION_REVOKED/)
 await tick();f.expire();f.registry.revokeOwner('window:session');let drained=false;const flush=f.registry.flush().then(()=>{drained=true})
 await tick();assert.equal(drained,false);f.waits[0].resolve(proof);await rejected;await flush;assert.equal(drained,true);assert.ok(f.revoked.length)
})
test('retry atomically replaces an attempt after stream end, revoking old picker and late release without removing the new claim',async()=>{
 const f=fixture();f.registry.endRequest(f.origin);const old=f.registry.choose(f.request()),oldRejected=assert.rejects(old,/DIRECTORY_AUTHORIZATION_REVOKED/);await tick()
 const next=f.registry.claim({origin:f.origin,task:tuple(2),previous:{task:tuple(),claimId:f.claim.claimId}})
 assert.throws(()=>f.registry.release({origin:f.origin,task:tuple(),claimId:f.claim.claimId}),/DIRECTORY_AUTHORIZATION_REVOKED/)
 assert.throws(()=>f.registry.claim({origin:f.origin,task:{...tuple(3),turnId:'another-turn'},previous:{task:tuple(2),claimId:next.claimId}}),/DIRECTORY_AUTHORIZATION_REVOKED/)
 const selected=f.registry.choose({...f.request(),task:tuple(2),claimId:next.claimId});await tick();assert.equal(f.calls,1)
 f.waits[0].resolve(proof);await oldRejected;await tick();assert.equal(f.calls,2);f.waits[1].resolve(proof);assert.deepEqual(await selected,proof)
})
test('native dialogs are serialized and a revoked queued task never opens a picker',async()=>{
 const f=fixture(),one=f.registry.choose(f.request());await tick()
 const origin=f.registry.begin(randomUUID(),'another-owner',()=>{}),claim=f.registry.claim({origin,task:tuple()})
 const two=f.registry.choose({...f.request(),origin,claimId:claim.claimId}),rejected=assert.rejects(two,/DIRECTORY_AUTHORIZATION_REVOKED/)
 await tick();assert.equal(f.calls,1);f.registry.revokeOwner('another-owner');f.waits[0].resolve(proof);await one;await rejected;assert.equal(f.calls,1)
})
test('untrusted fields, tuples and missing active claims cannot reach the native directory chooser',async()=>{
 const f=fixture()
 await assert.rejects(f.registry.choose({...f.request(),path:'/forged'}))
 await assert.rejects(f.registry.choose({...f.request(),task:tuple(2)}),/DIRECTORY_AUTHORIZATION_REVOKED/)
 assert.throws(()=>f.registry.claim({origin:f.origin,task:tuple(2)}),/DIRECTORY_AUTHORIZATION_REVOKED/)
 assert.equal(f.calls,0)
})
test('worker disconnect revokes every origin and a delayed old request completion cannot revoke a new one',async()=>{
 const f=fixture(),old=f.registry.choose(f.request()),rejected=assert.rejects(old,/DIRECTORY_AUTHORIZATION_REVOKED/);await tick();f.registry.revokeAll()
 const replacement=f.registry.begin(f.origin.requestId,'new-owner',()=>{});f.registry.endRequest(f.origin)
 assert.ok(f.registry.claim({origin:replacement,task:tuple()}));f.waits[0].resolve(proof);await rejected
})
test('a failed native operation can be retried without accepting an invalid directory proof',async()=>{
 let count=0
 const registry=new ConversationDirectoryAuthorizations({choose:async()=>{if(++count===1)return{...proof,inode:'invalid'};return proof},revoke(){}})
 const origin=registry.begin(randomUUID(),'owner',()=>{}),claim=registry.claim({origin,task:tuple()}),request={origin,task:tuple(),claimId:claim.claimId,operationId:'operation-one',input:{title:'作品',requestId:'operation-one'}}
 await assert.rejects(registry.choose(request));assert.deepEqual(await registry.choose(request),proof);assert.equal(count,2)
})
