import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {ConversationDirectoryAuthorizations} from '../../desktop/main/conversation-directory-authorizations'

const task=(epoch=1)=>({conversationId:'admission-chat',turnId:'admission-turn',attemptId:`attempt-${epoch}`,epoch})
const proof={path:'/isolated/native-selection',device:'3',inode:'7'}
const tick=()=>new Promise(setImmediate)
async function fixture(){
 let alive=true
 const registry=new ConversationDirectoryAuthorizations({choose:async()=>proof,revoke(){}})
 const origin=registry.begin(randomUUID(),'original-window',()=>{if(!alive)throw Error('owner lost')})
 const claim=registry.claim({origin,task:task()})
 const request={origin,task:task(),claimId:claim.claimId,operationId:'create-operation',input:{title:'本地作品',requestId:'create-operation'}}
 await registry.choose(request)
 const admissionInput={origin,task:task(),claimId:claim.claimId,operationId:request.operationId,selection:proof}
 const finish=(admissionId:string)=>({origin,task:task(),claimId:claim.claimId,admissionId})
 return{registry,origin,claim,request,admissionInput,finish,expire(){alive=false}}
}

test('creation admission rechecks the original live owner after all worker-side awaited work',async()=>{
 const f=await fixture();f.expire()
 assert.throws(()=>f.registry.createAdmission(f.admissionInput),/DIRECTORY_AUTHORIZATION_REVOKED/)
 await f.registry.flush()
})
test('creation admission accepts only the exact completed native proof and operation',async()=>{
 const f=await fixture()
 for(const selection of [{...proof,path:'/model-invented-path'},{...proof,inode:'8'}])assert.throws(()=>f.registry.createAdmission({...f.admissionInput,selection}),/DIRECTORY_AUTHORIZATION_REVOKED/)
 assert.throws(()=>f.registry.createAdmission({...f.admissionInput,operationId:'unselected-operation'}),/DIRECTORY_AUTHORIZATION_REVOKED/)
 assert.throws(()=>f.registry.createAdmission({...f.admissionInput,extra:true}))
 const receipt=f.registry.createAdmission(f.admissionInput)
 assert.equal(receipt.revocation.byteLength,4)
 assert.equal(Atomics.load(new Int32Array(receipt.revocation),0),0)
 assert.equal(f.registry.finishCreate(f.finish(receipt.admissionId)),true)
})
test('an uncompleted or cancelled picker never creates an admission',async()=>{
 const wait=Promise.withResolvers<typeof proof|null>()
 const registry=new ConversationDirectoryAuthorizations({choose:async()=>wait.promise,revoke(){}})
 const origin=registry.begin(randomUUID(),'owner',()=>{}),claim=registry.claim({origin,task:task()})
 const request={origin,task:task(),claimId:claim.claimId,operationId:'cancelled-operation',input:{title:'作品',requestId:'cancelled-operation'}}
 const selected=registry.choose(request);await tick()
 const input={origin,task:task(),claimId:claim.claimId,operationId:request.operationId,selection:proof}
 assert.throws(()=>registry.createAdmission(input),/DIRECTORY_AUTHORIZATION_REVOKED/)
 wait.resolve(null);assert.equal(await selected,null)
 assert.throws(()=>registry.createAdmission(input),/DIRECTORY_AUTHORIZATION_REVOKED/)
})
for(const revoke of ['window','task','retry','all'] as const)test(`the worker's shared revocation seal changes synchronously on ${revoke} revocation`,async()=>{
 const f=await fixture(),receipt=f.registry.createAdmission(f.admissionInput)
 // Structured clone is the real worker transport semantics: both processes
 // observe one shared cell, rather than an independently copied flag.
 const remote=structuredClone(receipt),cell=new Int32Array(remote.revocation)
 assert.equal(Atomics.load(cell,0),0)
 if(revoke==='window')f.registry.revokeOwner('original-window')
 else if(revoke==='task')f.registry.release({origin:f.origin,task:task(),claimId:f.claim.claimId})
 else if(revoke==='retry')f.registry.claim({origin:f.origin,task:task(2),previous:{task:task(),claimId:f.claim.claimId}})
 else f.registry.revokeAll()
 assert.equal(Atomics.load(cell,0),1)
 assert.equal(f.registry.finishCreate(f.finish(receipt.admissionId)),true)
 await f.registry.flush()
})
test('revocation blocks new writes while drain waits for actual admitted creation to finish',async()=>{
 const f=await fixture(),receipt=f.registry.createAdmission(f.admissionInput)
 f.registry.revokeOwner('original-window')
 let drained=false;const flush=f.registry.flush().then(()=>{drained=true})
 await tick();assert.equal(drained,false)
 assert.throws(()=>f.registry.finishCreate({...f.finish(receipt.admissionId),origin:{...f.origin,nonce:randomUUID()}}),/DIRECTORY_AUTHORIZATION_REVOKED/)
 await tick();assert.equal(drained,false)
 f.registry.finishCreate(f.finish(receipt.admissionId));await flush;assert.equal(drained,true)
 assert.equal(f.registry.finishCreate(f.finish(receipt.admissionId)),true)
})
test('one native operation cannot admit concurrent physical creations',async()=>{
 const f=await fixture(),one=f.registry.createAdmission(f.admissionInput)
 assert.throws(()=>f.registry.createAdmission(f.admissionInput),/DIRECTORY_OPERATION_IN_PROGRESS/)
 f.registry.finishCreate(f.finish(one.admissionId))
 const replay=f.registry.createAdmission(f.admissionInput)
 assert.notEqual(replay.admissionId,one.admissionId)
 f.registry.finishCreate(f.finish(replay.admissionId));await f.registry.flush()
})
test('confirmed worker exit settles creation flights but still drains physical main-process pickers',async()=>{
 const f=await fixture(),receipt=f.registry.createAdmission(f.admissionInput)
 const wait=Promise.withResolvers<typeof proof|null>()
 const registry=new ConversationDirectoryAuthorizations({choose:async()=>wait.promise,revoke(){}})
 const origin=registry.begin(randomUUID(),'owner',()=>{}),claim=registry.claim({origin,task:task()})
 const picker=registry.choose({origin,task:task(),claimId:claim.claimId,operationId:'exit-operation',input:{title:'作品',requestId:'exit-operation'}})
 const rejected=assert.rejects(picker,/DIRECTORY_AUTHORIZATION_REVOKED/);await tick()
 f.registry.workerStopped();assert.equal(Atomics.load(new Int32Array(receipt.revocation),0),1);await f.registry.flush()
 registry.workerStopped();let drained=false;const flush=registry.flush().then(()=>{drained=true})
 await tick();assert.equal(drained,false);wait.resolve(proof);await rejected;await flush;assert.equal(drained,true)
})
