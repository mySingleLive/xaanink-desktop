import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {runDesktopBackupBatch} from '../../desktop/main/desktop-backup-batch'
import {WorkBackupManager} from '../../desktop/main/work-backup-manager'
import {BusinessGate} from '../../desktop/main/business-gate'
const backup=()=>({id:randomUUID(),appId:randomUUID(),createdAt:new Date().toISOString(),bytes:100,retained:[],cleanupPending:0})
test('a desktop batch backs up application data even without works, and waits before admitting work backup',async()=>{
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),calls:string[]=[],receipt=backup()
 const flight=runDesktopBackupBatch(7,{application:async retention=>{assert.equal(retention,7);calls.push('application');entered.resolve();await release.promise;return{type:'now',backup:receipt}},works:async retention=>{assert.equal(retention,7);calls.push('works');return{type:'now',saved:[],failed:[]}}})
 await entered.promise;assert.deepEqual(calls,['application']);release.resolve();const result=await flight
 assert.deepEqual(calls,['application','works']);assert.deepEqual(result.application,{status:'saved',backup:receipt});assert.deepEqual(result.saved,[])
})
test('one scope failing does not suppress the other scope, and failed receipts cannot look complete',async()=>{
 let works=0
 const first=await runDesktopBackupBatch(2,{application:async()=>{throw Error('应用备份验证失败')},works:async()=>{works++;return{type:'now',saved:[],failed:[]}}})
 assert.equal(works,1);assert.deepEqual(first.application,{status:'failed',message:'应用备份验证失败'})
 const receipt=backup(),second=await runDesktopBackupBatch(2,{application:async()=>({type:'now',backup:receipt}),works:async()=>{throw Error('作品库暂不可用')}})
 assert.deepEqual(second.application,{status:'saved',backup:receipt});assert.equal(second.workError,'作品库暂不可用')
 const invalid=await runDesktopBackupBatch(2,{application:async()=>({type:'list',backups:[]}),works:async()=>({type:'now',saved:[],failed:[]})})
 assert.equal(invalid.application.status,'failed')
})
test('invalid retention is rejected before either worker request',async()=>{
 let calls=0;const impossible=async()=>{calls++;throw Error('must not run')}
 for(const value of [0,1001,NaN,2.5])await assert.rejects(runDesktopBackupBatch(value,{application:impossible,works:impossible}))
 assert.equal(calls,0)
})
test('scheduler persists completion only when both scopes succeed; cleanup leftovers keep the verified backup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xx-desktop-batch-')),clock={now:()=>4000,setTimer:()=>0,clearTimer:()=>{}},gate=new BusinessGate();let fail=true
 const manager=new WorkBackupManager({root,clock,gate,notify:()=>{},run:retention=>runDesktopBackupBatch(retention,{application:async()=>{if(fail)throw Error('应用备份未完成');return{type:'now',backup:{...backup(),cleanupPending:1}}},works:async()=>({type:'now',saved:[],failed:[]})})})
 try{await manager.start({backupIntervalMinutes:30,backupRetention:2});await assert.rejects(manager.runNow(),/应用备份未完成/);await assert.rejects(readFile(join(root,'backup-plan.json')),/ENOENT/)
 fail=false;const saved=await manager.runNow();assert.equal(saved.application?.status,'saved');assert.equal(JSON.parse(await readFile(join(root,'backup-plan.json'),'utf8')).value.lastSuccess,4000)
 }finally{await manager.pause();await rm(root,{recursive:true,force:true})}
})
