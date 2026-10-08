import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {ApplicationBackupControl} from '../../desktop/service/application-backup-control'
import {randomUUID} from 'node:crypto'
const source=ts.createSourceFile('worker.ts',readFileSync('desktop/service/index.ts','utf8'),ts.ScriptTarget.Latest,true)
let callback='';const scan=(n:ts.Node)=>{if(ts.isNewExpression(n)&&n.expression.getText(source)==='RpcPeer')callback=n.arguments![1].getText(source);ts.forEachChild(n,scan)};scan(source)
function fixture(){
 const calls:string[]=[],receipt={id:randomUUID(),appId:randomUUID(),createdAt:new Date().toISOString(),bytes:1,phase:'verified'},dependencies={ready:Promise.resolve(),responses:new Map(),starting:new Map(),pendingStarts:new Set(),localAttemptCount:()=>0,cancel:async()=>{},ApplicationBackupControl,closedWorkLeaseTarget:async(_works:any,id:any,guard:()=>void)=>{guard();return id},works:{close:async()=>{calls.push('close')},applicationBackups:async(retention?:number)=>{calls.push(retention===undefined?'list':'now:'+retention);return retention===undefined?[receipt]:{receipt,retained:[],cleanupPending:[]}}}}
 const code=`let closing=false,closedForMaintenance=false;return {run:${callback},setClosing(value){closing=value}}`
 const result=new Function(...Object.keys(dependencies),transformSync(code,{loader:'ts'}).code)(...Object.values(dependencies)) as {run(method:string,data?:unknown):Promise<any>;setClosing(value:boolean):void};return{...result,calls,receipt}
}
test('AP27-01 application-backup is a semantic RPC and invalidates closed-target evidence before a possible engine reopen',async()=>{
 const r=fixture();await r.run('close');assert.equal(await r.run('closed-work-lease-target','work'),'work')
 assert.deepEqual(await r.run('application-backup',{type:'list'}),{type:'list',backups:[{id:r.receipt.id,appId:r.receipt.appId,createdAt:r.receipt.createdAt,bytes:1}]})
 await assert.rejects(r.run('closed-work-lease-target','work'),/尚未关闭/);await r.run('close');await assert.rejects(r.run('application-backup',{type:'list',path:'/outside'}),/APPLICATION_BACKUP_ACTION_INVALID/);await assert.rejects(r.run('closed-work-lease-target','work'),/尚未关闭/)
 assert.deepEqual(r.calls,['close','list','close'])
})
test('AP27-02 worker closing rejects application-backup before any storage; create summary remains public only',async()=>{
 const r=fixture();r.setClosing(true);await assert.rejects(r.run('application-backup',{type:'now',retention:1}),/关闭/);assert.deepEqual(r.calls,[]);r.setClosing(false)
 const result=await r.run('application-backup',{type:'now',retention:2});assert.equal(result.type,'now');assert.equal(result.backup.id,r.receipt.id);assert.deepEqual(r.calls,['now:2']);assert.deepEqual(Object.keys(result.backup).sort(),['appId','bytes','cleanupPending','createdAt','id','retained'])
})
