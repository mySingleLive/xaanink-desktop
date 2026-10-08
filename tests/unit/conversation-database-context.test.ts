import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {PrismaClient} from '../../src/generated/prisma/client'
import {ConversationPhaseGate} from '../../desktop/service/conversation-phase'
import {createScopedClient,runInDatabaseContext,getDatabaseContext,type DatabaseContext,type DatabaseAuthority} from '../../desktop/service/context'
import {outsideChatExecution} from '../../src/lib/chat-execution'
const deferred=()=>Promise.withResolvers<void>()
class Query<T> implements PromiseLike<T>{
 readonly [Symbol.toStringTag]='PrismaPromise';private promise?:Promise<T>
 constructor(readonly db:string,private readonly action:()=>T|Promise<T>){}
 then<A=T,B=never>(ok?:((value:T)=>A|PromiseLike<A>)|null,fail?:((reason:unknown)=>B|PromiseLike<B>)|null){return(this.promise??=Promise.resolve().then(this.action)).then(ok,fail)}
}
function fixture(){
 const calls:string[]=[]
 const client=(name:string)=>({message:{findMany:()=>new Query(name,()=>{calls.push(`read:${name}:${getDatabaseContext().workspaceId}`);return name}),create:()=>new Query(name,()=>{calls.push(`write:${name}`);return name})},$transaction:async(run:unknown)=>{
  calls.push(`tx:${name}`)
  if(Array.isArray(run)){assert.ok(run.every(query=>query.db===name),'batch must contain native promises from the chosen fixed client');return Promise.all(run)}
  return(run as (tx:unknown)=>unknown)({message:{create:async()=>{calls.push(`tx-write:${name}`);return name},findMany:async()=>name}})
 }})as unknown as PrismaClient
 const A=client('A'),B=client('B'),G=client('GLOBAL'),gate=new ConversationPhaseGate();let current:DatabaseContext={workspaceId:'A',database:A,globalDatabase:G}
 const authority:DatabaseAuthority={execute:run=>gate.run('chat',()=>run({...current,authority}))}
 const source={...current,authority}
 return{A,B,G,gate,authority,source,calls,switch(){current={workspaceId:'B',database:B,globalDatabase:G}},db:createScopedClient(),global:createScopedClient('global')}
}
test('CHAT34-C01: a lazy query follows durable authority at execution, and repeated await does not replay it',async()=>{
 const f=fixture()
 await runInDatabaseContext(f.source,async()=>{
  const query=f.db.message.findMany();assert.deepEqual(f.calls,[]);f.switch()
  assert.equal(await query,'B');assert.equal(await query,'B');assert.deepEqual(f.calls,['read:B:B'])
 })
})
test('CHAT34-C02: transfer waits the callback transaction and never replaces an already supplied tx',async()=>{
 const f=fixture(),entered=deferred(),release=deferred();let changed=false
 const tx=runInDatabaseContext(f.source,()=>f.db.$transaction(async inner=>{entered.resolve();await release.promise;assert.equal(await inner.message.create({data:{conversationId:'chat',role:'USER',content:'held'}}),'A');return getDatabaseContext().workspaceId}))
 await entered.promise
 const moving=f.gate.transfer('chat',async()=>{f.switch();changed=true})
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(changed,false)}finally{release.resolve();assert.equal(await tx,'A');await moving}
 await runInDatabaseContext(f.source,async()=>{assert.equal(await f.db.message.findMany(),'B')})
})
test('CHAT34-C03: batch transaction materializes real promises on one current authority and rejects foreign bindings',async()=>{
 const f=fixture()
 await runInDatabaseContext(f.source,async()=>{
  const first=f.db.message.findMany(),second=f.db.message.create({data:{conversationId:'chat',role:'USER',content:'batch'}});f.switch()
  assert.deepEqual(await f.db.$transaction([first,second]),['B','B'])
  const otherAuthority:DatabaseAuthority={execute:async operation=>operation({workspaceId:'A',database:f.A})}
  const foreign=runInDatabaseContext({...f.source,authority:otherAuthority},()=>f.db.message.findMany())
  await assert.rejects(async()=>f.db.$transaction([f.db.message.findMany(),foreign]),/another database context/)
 })
})
test('CHAT34-C04: global/control source remains global and cannot recursively route its index through conversation authority',async()=>{
 const f=fixture();let phases=0
 const authority:DatabaseAuthority={execute:async()=>{phases++;throw Error('global must not enter conversation phase')}}
 await runInDatabaseContext({...f.source,authority},async()=>{assert.equal(await f.global.message.findMany(),'GLOBAL');assert.equal(phases,0)})
})
test('CHAT34-C05: background usage outside the chat fence retains the binding, and borrowing a supplied transaction still fails',async()=>{
 const f=fixture()
 await runInDatabaseContext(f.source,async()=>{
  f.switch();await outsideChatExecution(async()=>assert.equal(await f.db.message.create({data:{conversationId:'chat',role:'USER',content:'background'}}),'B'))
  await f.db.$transaction(async()=>{assert.throws(()=>f.db.message.findMany(),/supplied transaction/);return null})
 })
})
