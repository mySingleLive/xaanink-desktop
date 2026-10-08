import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {transformSync} from 'esbuild'
const source=ts.createSourceFile('service.ts',readFileSync('desktop/service/index.ts','utf8'),ts.ScriptTarget.Latest,true)
let callback='';const scan=(n:ts.Node)=>{if(ts.isNewExpression(n)&&n.expression.getText(source)==='RpcPeer')callback=n.arguments![1].getText(source);ts.forEachChild(n,scan)};scan(source)
function fixture(){
 let fail=false,wait:Promise<void>|null=null,lookup:Promise<void>|null=null;const calls:string[]=[],pendingStarts=new Set<Promise<void>>()
 const dependencies={ready:Promise.resolve(),responses:new Map(),starting:new Map(),pendingStarts,localAttemptCount:()=>0,cancel:async()=>{},works:{close:async()=>{calls.push('close-enter');await wait;if(fail)throw Error('close failed');calls.push('closed')},open:async()=>calls.push('opened'),list:async()=>[],protectedDirectories:async()=>[]},closedWorkLeaseTarget:async(_works:unknown,id:string,guard:()=>void)=>{guard();calls.push('target');await lookup;guard();return id}}
 const code=`let closing=false,closedForMaintenance=false;return ${callback}`
 const run=new Function(...Object.keys(dependencies),transformSync(code,{loader:'ts'}).code)(...Object.values(dependencies)) as (method:string,data?:unknown)=>Promise<unknown>
 return{run,calls,pendingStarts,fail:(value:boolean)=>fail=value,wait:(value:Promise<void>|null)=>wait=value,lookup:(value:Promise<void>|null)=>lookup=value}
}
test('worker grants a target only after actual close ACK; in-flight and failed closure grant nothing',async()=>{
 const r=fixture(),closed=Promise.withResolvers<void>();r.wait(closed.promise)
 await assert.rejects(r.run('closed-work-lease-target','id'),/尚未关闭/)
 const flight=r.run('close');await new Promise(setImmediate)
 await assert.rejects(r.run('closed-work-lease-target','id'),/尚未关闭/)
 assert.deepEqual(r.calls,['close-enter']);closed.resolve();await flight
 assert.equal(await r.run('closed-work-lease-target','id'),'id')
 r.fail(true);await assert.rejects(r.run('close'),/close failed/)
 await assert.rejects(r.run('closed-work-lease-target','id'),/尚未关闭/)
})
test('read-only calls preserve closure proof, reopening or undrained work revokes it even during lookup',async()=>{
 const r=fixture();await r.run('close');await r.run('protected-directories');await r.run('task-status');await r.run('ready')
 assert.equal(await r.run('closed-work-lease-target','id'),'id')
 const pending=Promise.resolve();r.pendingStarts.add(pending);await assert.rejects(r.run('closed-work-lease-target','id'),/尚未关闭/);r.pendingStarts.delete(pending)
 const lookup=Promise.withResolvers<void>();r.lookup(lookup.promise);const target=r.run('closed-work-lease-target','id');await new Promise(setImmediate)
 await r.run('open-work',{});lookup.resolve();await assert.rejects(target,/尚未关闭/)
 await assert.rejects(r.run('closed-work-lease-target','id'),/尚未关闭/)
})
