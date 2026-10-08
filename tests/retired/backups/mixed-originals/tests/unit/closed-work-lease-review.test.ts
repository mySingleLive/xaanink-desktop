import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,symlink,link} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {closedWorkLeaseTarget} from '../../desktop/service/closed-work-lease-target'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {guardFileExportTarget} from '../../desktop/main/file-export-target'

const serviceSource=ts.createSourceFile('worker.ts',readFileSync('desktop/service/index.ts','utf8'),ts.ScriptTarget.Latest,true)
let dispatch='';function scan(n:ts.Node){if(ts.isNewExpression(n)&&n.expression.getText(serviceSource)==='RpcPeer')dispatch=n.arguments![1].getText(serviceSource);ts.forEachChild(n,scan)}scan(serviceSource)
function workerFixture(){
 assert.ok(dispatch);let attempts=0,closeGate:Promise<void>|undefined;const responses=new Map(),starting=new Map(),pendingStarts=new Set<Promise<void>>()
 const rejected=async()=>{throw Error('CONTROLLED_ENTRY_REJECTED')}
 const deps={ready:Promise.resolve(),responses,starting,pendingStarts,localAttemptCount:()=>attempts,cancel:async()=>{},works:{close:async()=>{await closeGate},open:rejected,create:rejected,list:async()=>[]},closedWorkLeaseTarget:async(_works:unknown,_id:unknown,guard:()=>void)=>{guard();return'authorized-closed-target'},WorkBackupControl:class{handle=rejected},start:rejected}
 const run=new Function(...Object.keys(deps),transformSync(`let closing=false,closedForMaintenance=false;return ${dispatch}`,{loader:'ts'}).code)(...Object.values(deps)) as (method:string,data?:unknown)=>Promise<unknown>
 return{run,responses,starting,pendingStarts,setAttempts:(n:number)=>attempts=n,setCloseGate:(p:Promise<void>)=>closeGate=p}
}

test('WL90-W01: every potentially opening RPC revokes the closed proof even when its own entry is rejected',async()=>{
 for(const method of ['start','image-asset','work-backup','create-work','open-work']){
  const r=workerFixture();await r.run('close');assert.equal(await r.run('closed-work-lease-target',randomUUID()),'authorized-closed-target')
  await assert.rejects(r.run(method,method==='create-work'?{selection:null,input:null}:undefined),method==='image-asset'?/本地图片暂不可用/:/CONTROLLED_ENTRY_REJECTED/)
  await assert.rejects(r.run('closed-work-lease-target',randomUUID()),/尚未关闭/)
 }
})

test('WL90-W02: completed close cannot grant a target while any stream, start, pending flight or local attempt remains',async()=>{
 const r=workerFixture();await r.run('close')
 for(const kind of ['response','starting','pending','attempt']){
  if(kind==='response')r.responses.set('late',{})
  if(kind==='starting')r.starting.set('late',new AbortController())
  const pending=Promise.resolve();if(kind==='pending')r.pendingStarts.add(pending)
  if(kind==='attempt')r.setAttempts(1)
  await assert.rejects(r.run('closed-work-lease-target',randomUUID()),/尚未关闭/)
  r.responses.clear();r.starting.clear();r.pendingStarts.delete(pending);r.setAttempts(0)
  assert.equal(await r.run('closed-work-lease-target',randomUUID()),'authorized-closed-target')
 }
})

async function fsFixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xx-closed-review90-'))),path=join(base,'work'),id=randomUUID();await mkdir(path)
 const root=await directoryIdentity(path),manifest={schemaVersion:1,id,phase:'ready' as const,novelId:'novel-independent',title:'完整作品',requestId:randomUUID(),requestHash:'a'.repeat(64),createdAt:new Date().toISOString()}
 await writeFile(join(path,'xuanxiang-work.json'),JSON.stringify(manifest));await writeFile(join(path,'manuscript.txt'),'真实作者正文保留')
 const record={id,path,identity:{device:root.device,inode:root.inode},novelId:manifest.novelId,title:manifest.title,requestId:manifest.requestId,requestHash:manifest.requestHash,createdAt:manifest.createdAt}
 return{base,path,id,root,manifest,record,cleanup:()=>rm(base,{recursive:true,force:true})}
}
test('WL90-T01: duplicate catalog ownership, creating phase and different novel identity are refused without opening or modifying work',async()=>{const r=await fsFixture();try{
 await assert.rejects(closedWorkLeaseTarget({list:async()=>[r.record,r.record]},r.id,()=>{}),/CATALOG_INVALID/)
 for(const changed of [{...r.manifest,phase:'creating'},{...r.manifest,novelId:'another-novel'}]){
  await writeFile(join(r.path,'xuanxiang-work.json'),JSON.stringify(changed));await assert.rejects(closedWorkLeaseTarget({list:async()=>[r.record]},r.id,()=>{}),/TARGET_MISMATCH/)
  assert.deepEqual(JSON.parse(await readFile(join(r.path,'xuanxiang-work.json'),'utf8')),changed)
 }
 assert.equal(await readFile(join(r.path,'manuscript.txt'),'utf8'),'真实作者正文保留')
}finally{await r.cleanup()}})

test('WL90-T02: a manifest symlink or second hard link cannot be promoted to a closed recovery capability',async()=>{const r=await fsFixture();try{
 const manifestPath=join(r.path,'xuanxiang-work.json'),foreign=join(r.base,'retained.json'),bytes=await readFile(manifestPath);await writeFile(foreign,bytes);await rm(manifestPath);await symlink(foreign,manifestPath)
 await assert.rejects(closedWorkLeaseTarget({list:async()=>[r.record]},r.id,()=>{}));assert.deepEqual(await readFile(foreign),bytes)
 await rm(manifestPath);await link(foreign,manifestPath);await assert.rejects(closedWorkLeaseTarget({list:async()=>[r.record]},r.id,()=>{}));assert.deepEqual(await readFile(foreign),bytes)
}finally{await r.cleanup()}})

test('WL90-T03: export guards reserve case-folded audit/temp children under a registered work but permit ordinary author documents',async()=>{const r=await fsFixture();try{
 for(const name of ['.XUANXIANG-LEASE-RECOVERY.JSON',`.XUANXIANG-LEASE-RECOVERY-${randomUUID().toUpperCase()}.TMP`]){
  await assert.rejects(guardFileExportTarget(join(r.path,name),{dataRoots:[],workRoots:[r.path]}),/EXPORT_TARGET_PROTECTED/)
 }
 await guardFileExportTarget(join(r.path,'我的锁恢复记录.json'),{dataRoots:[],workRoots:[r.path]})
 assert.equal(await readFile(join(r.path,'manuscript.txt'),'utf8'),'真实作者正文保留')
}finally{await r.cleanup()}})
