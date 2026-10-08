import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {WorkBackupManager} from '../../desktop/main/work-backup-manager'
import {runDesktopBackupBatch} from '../../desktop/main/desktop-backup-batch'
import {BusinessGate} from '../../desktop/main/business-gate'
const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
let initializer=''
function visit(node:ts.Node){if(ts.isNewExpression(node)&&node.expression.getText(source)==='WorkBackupManager')initializer=node.getText(source);ts.forEachChild(node,visit)}visit(source);assert.ok(initializer)
async function fixture(call:(method:string,input:any)=>Promise<unknown>){
 const root=await mkdtemp(join(tmpdir(),'xx-backup-main-')),gate=new BusinessGate(),notices:unknown[]=[],deps={WorkBackupManager,runDesktopBackupBatch,dataRoot:root,businessGate:gate,service:{call},send:(notice:unknown)=>notices.push(notice)}
 const manager=new Function(...Object.keys(deps),transformSync(`return ${initializer}`,{loader:'ts'}).code)(...Object.values(deps)) as WorkBackupManager
 await manager.start({backupIntervalMinutes:1440,backupRetention:4})
 return{root,gate,notices,manager,async close(){await manager.pause();await rm(root,{recursive:true,force:true})}}
}
const receipt=()=>({type:'now',backup:{id:randomUUID(),appId:randomUUID(),createdAt:new Date().toISOString(),bytes:1,retained:[],cleanupPending:0}})
test('actual main manager invokes both worker scopes with confirmed settings, and close waits for both real promises',async()=>{
 const appEntered=Promise.withResolvers<void>(),appRelease=Promise.withResolvers<void>(),workEntered=Promise.withResolvers<void>(),workRelease=Promise.withResolvers<void>(),calls:unknown[]=[]
 const f=await fixture(async(method,input)=>{calls.push([method,input]);if(method==='application-backup'){appEntered.resolve();await appRelease.promise;return receipt()}if(method==='work-backup'){workEntered.resolve();await workRelease.promise;return{type:'now',saved:[],failed:[]}}throw Error('unexpected worker request')})
 try{const backup=f.manager.runNow();await appEntered.promise;let closed=false;const closing=Promise.all([f.manager.pause(),f.gate.close()]).then(()=>{closed=true});await new Promise(setImmediate);assert.equal(closed,false)
 appRelease.resolve();await workEntered.promise;assert.equal(closed,false);await assert.rejects(readFile(join(f.root,'backup-plan.json')),/ENOENT/)
 workRelease.resolve();await backup;await closing;assert.equal(closed,true);assert.deepEqual(calls,[['application-backup',{type:'now',retention:4}],['work-backup',{type:'now',retention:4}]]);assert.ok(JSON.parse(await readFile(join(f.root,'backup-plan.json'),'utf8')).value.lastSuccess>0)
 }finally{appRelease.resolve();workRelease.resolve();await f.close()}
})
test('actual main application failure still attempts work backup and leaves durable success unchanged',async()=>{
 const calls:string[]=[],f=await fixture(async method=>{calls.push(method);if(method==='application-backup')throw Error('受控应用库备份失败');return{type:'now',saved:[],failed:[]}})
 try{await assert.rejects(f.manager.runNow(),/受控应用库备份失败/);assert.deepEqual(calls,['application-backup','work-backup']);await assert.rejects(readFile(join(f.root,'backup-plan.json')),/ENOENT/)}finally{await f.close()}
})
