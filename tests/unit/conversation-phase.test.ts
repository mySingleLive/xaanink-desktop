import assert from 'node:assert/strict'
import {test} from 'node:test'
import {ConversationPhaseGate} from '../../desktop/service/conversation-phase'
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve))
const deferred=<T=void>()=>Promise.withResolvers<T>()

test('CHAT34-P01: transfer drains prior database writes, blocks later writes, then follows new authority',async()=>{
 const gate=new ConversationPhaseGate(),first=deferred(),entered=deferred(),trace:string[]=[];let authority='inbox'
 const pending=gate.run('chat',async()=>{trace.push(`first:${authority}`);entered.resolve();await first.promise;trace.push('first-durable')})
 await entered.promise
 const moving=gate.transfer('chat',async()=>{trace.push('copy');authority='work';trace.push('authority-durable')})
 const late=gate.run('chat',async()=>{trace.push(`late:${authority}`)})
 await settle();assert.deepEqual(trace,['first:inbox'])
 first.resolve();await Promise.all([pending,moving,late])
 assert.deepEqual(trace,['first:inbox','first-durable','copy','authority-durable','late:work'])
})
test('CHAT34-P02: transfer invoked by the active startNovel phase excludes itself, nested control work is reentrant',async()=>{
 const gate=new ConversationPhaseGate(),trace:string[]=[]
 await gate.run('chat',async()=>{trace.push('tool-start');await gate.transfer('chat',async()=>{await gate.run('chat',async()=>{trace.push('copy-transaction')})});trace.push('tool-receipt')})
 assert.deepEqual(trace,['tool-start','copy-transaction','tool-receipt'])
})
test('CHAT34-P03: exclusive transfer does not block an unrelated conversation, and overlap is explicitly rejected',async()=>{
 const gate=new ConversationPhaseGate(),release=deferred(),entered=deferred();let other=false
 const moving=gate.transfer('A',async()=>{entered.resolve();await release.promise});await entered.promise
 try{await gate.run('B',async()=>{other=true});assert.equal(other,true);await assert.rejects(gate.transfer('A',async()=>{}),{code:'CONVERSATION_TRANSFER_BUSY'})}finally{release.resolve();await moving}
})
test('CHAT34-P04: cancelled wait never starts a database write, while failed transfer releases the queue',async()=>{
 const gate=new ConversationPhaseGate(),release=deferred(),entered=deferred(),abort=new AbortController();let writes=0
 const moving=gate.transfer('chat',async()=>{entered.resolve();await release.promise;throw Error('copy failed')});void moving.catch(()=>{})
 await entered.promise
 const queued=gate.run('chat',async()=>{writes++},abort.signal);void queued.catch(()=>{});abort.abort(Error('cancelled'))
 await assert.rejects(queued,/cancelled/);assert.equal(writes,0);release.resolve();await assert.rejects(moving,/copy failed/)
 await gate.run('chat',async()=>{writes++});assert.equal(writes,1)
})
test('CHAT34-P05: ownership revoked while draining prevents copy and preserves the source operation',async()=>{
 const gate=new ConversationPhaseGate(),release=deferred(),entered=deferred(),abort=new AbortController();let copied=false
 const old=gate.run('chat',async()=>{entered.resolve();await release.promise});await entered.promise
 const moving=gate.transfer('chat',async()=>{copied=true},abort.signal);void moving.catch(()=>{})
 abort.abort(Error('revoked'));await assert.rejects(moving,/revoked/);assert.equal(copied,false)
 release.resolve();await old;await gate.run('chat',async()=>{assert.equal(copied,false)})
})
test('CHAT34-P06: reentrant transfer attempt fails instead of waiting for its own exclusive operation',async()=>{
 const gate=new ConversationPhaseGate()
 await gate.transfer('chat',async()=>{await assert.rejects(gate.transfer('chat',async()=>{}),{code:'CONVERSATION_TRANSFER_BUSY'})})
})
