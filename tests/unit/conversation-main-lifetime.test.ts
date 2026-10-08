import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {Worker} from 'node:worker_threads'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {z} from 'zod'
import {ConversationDirectoryAuthorizations} from '../../desktop/main/conversation-directory-authorizations'
import {requestSchema} from '../../desktop/shared/ipc'
import {RpcPeer} from '../../desktop/service/rpc'

const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
function find(predicate:(node:ts.Node)=>boolean){const found:ts.Node[]=[];const walk=(node:ts.Node)=>{if(predicate(node))found.push(node);ts.forEachChild(node,walk)};walk(source);assert.equal(found.length,1);return found[0]}
const evaluate=(node:ts.Node,deps:Record<string,unknown>)=>new Function(...Object.keys(deps),transformSync(`return (${node.getText(source)})`,{loader:'ts'}).code)(...Object.values(deps))
const task={conversationId:'main-chat',turnId:'main-turn',attemptId:'main-attempt',epoch:1}
const proof={path:'/isolated/main-native-choice',device:'3',inode:'7'}
function registry(){return new ConversationDirectoryAuthorizations({choose:async()=>proof,revoke(){}})}

test('the actual main reverse RPC dispatch admits only strict worker task payloads',async()=>{
 const directories=registry(),node=find(n=>ts.isNewExpression(n)&&n.expression.getText(source)==='RpcPeer') as ts.NewExpression
 const dispatch=evaluate(node.arguments![1],{z,applicationBlocked:()=>false,applicationHandoff:null,applicationMetadata:{},modelService:{},conversationDirectories:directories})
 const origin=directories.begin(randomUUID(),'owner',()=>{}),claim=await dispatch('conversation.claim',{origin,task})
 const choose={origin,task,claimId:claim.claimId,operationId:'actual-main-operation',input:{title:'作品',requestId:'actual-main-operation'}}
 assert.deepEqual(await dispatch('conversation.choose-directory',choose),proof)
 const input={origin,task,claimId:claim.claimId,operationId:choose.operationId,selection:proof}
 await assert.rejects(dispatch('conversation.create-admission',{...input,path:'/forged'}))
 const receipt=await dispatch('conversation.create-admission',input)
 directories.revokeOwner('owner');assert.equal(Atomics.load(new Int32Array(receipt.revocation),0),1)
 assert.equal(await dispatch('conversation.create-finished',{origin,task,claimId:claim.claimId,admissionId:receipt.admissionId}),true)
 await directories.flush()
 await assert.rejects(dispatch('conversation.create-work',input),/未知主进程/)
})

class Port{
 readonly listeners=new Map<string,(input:any)=>Promise<void>|void>()
 on(name:string,listener:(input:any)=>Promise<void>|void){this.listeners.set(name,listener)}
 postMessage(){}
 start(){}
 close(){this.listeners.get('close')?.({})}
 async pull(){await this.listeners.get('message')?.({data:{type:'pull',seq:0}})}
}
test('the actual request handler ends HTTP authority without revoking its detached real task, then window loss revokes creation',async()=>{
 const directories=registry(),responseOwners=new Map(),channels:Array<{port1:Port;port2:Port}>=[]
 const session={owner:42,id:'ready-session',ready:true},window={isDestroyed:()=>false}
 const sender={id:42,isDestroyed:()=>false,postMessage(){}},event={sender}
 let origin:any,claim:any,cancels=0
 const service={call:async(method:string,value:any)=>{
  if(method==='start'){assert.equal(value.request.id,input.id);origin=value.origin;claim=directories.claim({origin,task});return{id:input.id,status:200,headers:{}}}
  if(method==='read')return{done:true}
  if(method==='cancel'){cancels++;return true}
  throw Error(`unexpected ${method}`)
 }}
 const node=find(n=>ts.isCallExpression(n)&&n.expression.getText(source)==='businessHandle'&&n.arguments[0]?.getText(source)==='"desktop:request"') as ts.CallExpression
 const handler=evaluate(node.arguments[1],{trusted(){},requestSchema,responseOwners,businessGate:{closed:false},window,draftSession:session,closingFlow:false,quitting:false,conversationDirectories:directories,service,MessageChannelMain:class{port1=new Port();port2=new Port();constructor(){channels.push(this)}}})
 const input={version:1,id:randomUUID(),path:'/api/chat',method:'POST',headers:{},body:[]}
 await handler(event,input)
 await channels[0].port1.pull();assert.equal(responseOwners.size,0);assert.equal(cancels,0)
 const choose={origin,task,claimId:claim.claimId,operationId:'detached-operation',input:{title:'作品',requestId:'detached-operation'}}
 assert.deepEqual(await directories.choose(choose),proof)
 const admitted=directories.createAdmission({origin,task,claimId:claim.claimId,operationId:choose.operationId,selection:proof})
 directories.revokeOwner(String(sender.id));assert.equal(Atomics.load(new Int32Array(admitted.revocation),0),1)
 directories.finishCreate({origin,task,claimId:claim.claimId,admissionId:admitted.admissionId});await directories.flush()
})

test('the actual request handler cannot mint chat task origins before the original draft owner is ready',async()=>{
 const directories=registry(),responseOwners=new Map();let started=false
 const node=find(n=>ts.isCallExpression(n)&&n.expression.getText(source)==='businessHandle'&&n.arguments[0]?.getText(source)==='"desktop:request"') as ts.CallExpression
 const handler=evaluate(node.arguments[1],{trusted(){},requestSchema,responseOwners,businessGate:{closed:false},window:{isDestroyed:()=>false},draftSession:{owner:42,id:'unready',ready:false},closingFlow:false,quitting:false,conversationDirectories:directories,service:{call:async()=>{started=true}}})
 await assert.rejects(handler({sender:{id:42,isDestroyed:()=>false}},{version:1,id:randomUUID(),path:'/api/chat',method:'POST',headers:{},body:[]}),/DIRECTORY_AUTHORIZATION_REVOKED/)
 assert.equal(started,false);assert.equal(responseOwners.size,0)
})

test('actual worker-thread transport observes revocation on the same shared admission cell',async()=>{
 const directories=registry(),origin=directories.begin(randomUUID(),'owner',()=>{}),claim=directories.claim({origin,task})
 const choose={origin,task,claimId:claim.claimId,operationId:'transport-operation',input:{title:'作品',requestId:'transport-operation'}}
 await directories.choose(choose)
 const receipt=directories.createAdmission({origin,task,claimId:claim.claimId,operationId:choose.operationId,selection:proof})
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');let cell;parentPort.on('message',m=>{if(m.method==='inspect'){if(m.value)cell=new Int32Array(m.value);parentPort.postMessage({rpc:1,id:m.id,value:Atomics.load(cell,0)})}})`,{eval:true})
 const peer=new RpcPeer(worker,async()=>{throw Error('unexpected reverse RPC')})
 try{assert.equal(await peer.call('inspect',receipt.revocation),0);directories.revokeOwner('owner');assert.equal(await peer.call('inspect'),1)}
 finally{peer.dispose();await worker.terminate();directories.workerStopped();await directories.flush()}
})
