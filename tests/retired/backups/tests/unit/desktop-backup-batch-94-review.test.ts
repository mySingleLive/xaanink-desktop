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
const initializers:string[]=[]
function walk(node:ts.Node){if(ts.isNewExpression(node)&&node.expression.getText(source)==='WorkBackupManager')initializers.push(node.getText(source));ts.forEachChild(node,walk)}walk(source)
assert.equal(initializers.length,1,'review must exercise the actual singleton main initializer')
const receipt=(cleanupPending=0)=>({type:'now' as const,backup:{id:randomUUID(),appId:randomUUID(),createdAt:new Date().toISOString(),bytes:8,retained:[],cleanupPending}})
type Call=(method:string,input:{type:string;retention?:number})=>Promise<unknown>
async function fixture(call:Call){
 const root=await mkdtemp(join(tmpdir(),'xx-backup-review94-')),gate=new BusinessGate(),notices:unknown[]=[],deps={WorkBackupManager,runDesktopBackupBatch,dataRoot:root,businessGate:gate,service:{call},send:(value:unknown)=>notices.push(value)}
 const manager=new Function(...Object.keys(deps),transformSync(`return ${initializers[0]}`,{loader:'ts'}).code)(...Object.values(deps)) as WorkBackupManager
 await manager.start({backupIntervalMinutes:1440,backupRetention:5})
 return{root,gate,manager,notices,async close(){await manager.pause();await rm(root,{recursive:true,force:true})}}
}

test('DB94-01: a rejected work scope with an empty Error message cannot persist desktop backup success',async()=>{
 const calls:string[]=[],f=await fixture(async method=>{calls.push(method);if(method==='application-backup')return receipt();throw Error('')})
 try{
  let failure:unknown;try{await f.manager.runNow()}catch(error){failure=error}
  assert.deepEqual(calls,['application-backup','work-backup'])
  assert.ok(failure instanceof Error,'physical work backup rejected, so the main batch must reject even when its Error.message is empty')
  await assert.rejects(readFile(join(f.root,'backup-plan.json')),{code:'ENOENT'})
 }finally{await f.close()}
})

test('DB94-02: a partial result retains the verified application cleanup count in the real main failure message',async()=>{
 const f=await fixture(async method=>method==='application-backup'?receipt(3):({type:'now',saved:[],failed:[{workId:randomUUID(),title:'作者作品',message:'目录暂不可读'}]}))
 try{
  await assert.rejects(f.manager.runNow(),error=>error instanceof Error&&error.message.includes('已完成应用数据备份')&&error.message.includes('3 项临时数据待清理')&&error.message.includes('目录暂不可读'))
  await assert.rejects(readFile(join(f.root,'backup-plan.json')),{code:'ENOENT'})
 }finally{await f.close()}
})

test('DB94-03: the actual main singleton shares a pending mixed batch and both pause and close drain a failing final worker scope',async()=>{
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),calls:string[]=[],f=await fixture(async method=>{
  calls.push(method);if(method==='application-backup')return receipt();entered.resolve();await release.promise;throw Error('受控最后作品失败')
 })
 try{
  const first=f.manager.runNow(),observed=first.catch(error=>error),second=f.manager.runNow();assert.equal(first,second)
  await entered.promise;let paused=false,closed=false
  const pause=f.manager.pause().then(()=>{paused=true}),close=f.gate.close().then(()=>{closed=true})
  await new Promise(setImmediate);assert.equal(paused,false);assert.equal(closed,false)
  await assert.rejects(f.gate.run(async()=>{}),/BUSINESS_CLOSED/)
  release.resolve();assert.match(String(await observed),/受控最后作品失败/);await Promise.all([pause,close])
  assert.equal(paused,true);assert.equal(closed,true);assert.deepEqual(calls,['application-backup','work-backup'])
  await assert.rejects(readFile(join(f.root,'backup-plan.json')),{code:'ENOENT'})
 }finally{release.resolve();await f.close()}
})

test('DB94-04: invalid application success data still runs the work scope and does not alter a previous durable success',async()=>{
 const calls:string[]=[],valid=receipt(),f=await fixture(async method=>{
  calls.push(method);if(method==='application-backup')return valid;return{type:'now',saved:[],failed:[]}
 })
 try{
  await f.manager.runNow();const before=await readFile(join(f.root,'backup-plan.json'))
  valid.backup.cleanupPending=-1;await assert.rejects(f.manager.runNow())
  assert.deepEqual(calls,['application-backup','work-backup','application-backup','work-backup'])
  assert.deepEqual(await readFile(join(f.root,'backup-plan.json')),before)
 }finally{await f.close()}
})
