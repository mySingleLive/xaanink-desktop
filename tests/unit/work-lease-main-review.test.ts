import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir,hostname} from 'node:os'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {WorkLeaseHandoff} from '../../desktop/main/work-lease-handoff'
import {workLeaseRequestSchema} from '../../desktop/shared/work-lease'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {workNames} from '../../desktop/core/brand-names'
import {BusinessGate} from '../../desktop/main/business-gate'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
import {CloseCoordinator} from '../../desktop/main/close-coordinator'
import {closedWorkLeaseTarget} from '../../desktop/service/closed-work-lease-target'

const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
const declaration=(name:string)=>{const node=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node);return node.getText(source)}
let callback='',services=''
function scan(n:ts.Node){
 if(ts.isCallExpression(n)&&n.expression.getText(source)==='ipcMain.handle'&&n.arguments[0]?.getText(source)==='"desktop:work-lease"')callback=n.arguments[1].getText(source)
 if(ts.isNewExpression(n)&&n.expression.getText(source)==='CloseCoordinator')services=n.arguments![0].getText(source)
 ts.forEachChild(n,scan)
}
scan(source)
const deadPid=(async()=>{const p=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});await once(p,'exit');assert.ok(p.pid);assert.throws(()=>process.kill(p.pid!,0),{code:'ESRCH'});return p.pid!})()

async function fixture(){
 assert.ok(callback);assert.ok(services)
 const root=await realpath(await mkdtemp(join(tmpdir(),'xx-main-review90-'))),gate=new BusinessGate(),events:string[]=[],id=randomUUID(),session={owner:52,id:randomUUID(),ready:true},frame={url:'xaanink://app/'},contents={id:52,mainFrame:frame},window={webContents:contents,isDestroyed:()=>false},event={sender:contents,senderFrame:frame}
 await mkdir(join(root,'.xuanxiang-lock'))
 const ownerBytes=JSON.stringify({token:randomUUID(),pid:await deadPid,host:hostname()});await writeFile(join(root,'.xuanxiang-lock/owner.json'),ownerBytes);await writeFile(join(root,'author.txt'),'作者正文，保持字节不变')
 const directory=await directoryIdentity(root),manifest={schemaVersion:1,id,phase:'ready' as const,novelId:'novel-review90',title:'真实FS夹具',requestId:randomUUID(),requestHash:'a'.repeat(64),createdAt:new Date().toISOString()};await writeFile(join(root,'xuanxiang-work.json'),JSON.stringify(manifest))
 const record={...manifest,path:root,identity:{device:directory.device,inode:directory.inode}};const {schemaVersion:_v,phase:_p,...catalogRecord}=record
 let active=0,declineStop=false,confirmResponse=1,noticeFails=false,host=true,workerClosed=false,stopGate:Promise<void>|undefined,confirmGate:Promise<void>|undefined
 const stopEntered=Promise.withResolvers<void>(),confirmEntered=Promise.withResolvers<void>()
 const dependencies={applicationBlocked:()=>false,applicationRequests:null,applicationHandoff:null,ordinaryWorkerExited:false,sessionFlushed:false,applicationMetadata:new ApplicationMetadataGate(),draftJournal:{read:async()=>null},window,draftSession:session,event,workRestore:null,migrationHandoff:null,WorkLeaseHandoff,workLeaseRequestSchema,CloseCoordinator,businessGate:gate,workBackups:undefined,resumeWorkBackups:async()=>{},modelService:{activeCount:0,close:async()=>{events.push('model-stop')},resume:()=>events.push('resume')},modelConfiguration:{activeCount:0,cancelOwner(){}},avatarAssets:{cancelOwner(){}},recoveryExports:{cancelWindow(){},flush:async()=>{}},fileExports:{cancelWindow(){},flush:async()=>{}},configurationFiles:{cancelWindow(){},flush:async()=>{}},repository:{read:async()=>{}},responseOwners:new Map(),conversationDirectories:{revokeAll(){},flush:async()=>{}},closeChannel:{cancel(){}},flushDraftForClose:async()=>{events.push('flush')},service:{call:async(method:string,value?:unknown)=>{
  events.push(method)
  if(method==='task-status')return{active}
  if(method==='stop-tasks'){stopEntered.resolve();await stopGate;active=0;return true}
  if(method==='close'){workerClosed=true;return true}
  if(method==='closed-work-lease-target')return closedWorkLeaseTarget({list:async()=>[catalogRecord]},value,()=>{assert.equal(workerClosed,true);assert.equal(gate.closed,true)})
  return true
 }},dialog:{showMessageBox:async(_window:unknown,options:{title:string;signal?:AbortSignal;detail?:string})=>{
  events.push('dialog:'+options.title)
  if(options.title==='仍有创作任务运行')return{response:declineStop?0:1}
  if(options.title==='修复异常退出锁'){assert.ok(options.signal);assert.ok(options.detail?.includes(root));confirmEntered.resolve();await confirmGate;return{response:confirmResponse}}
  if(options.title==='作品锁恢复结果'){if(noticeFails)throw Error('untrusted secret error is not a success');return{response:0}}
  return{response:1}
 }},app:{hasSingleInstanceLock:()=>host,relaunch:()=>events.push('relaunch'),quit:()=>events.push('quit')},worker:{terminate:async()=>{}},send:(value:{type:string})=>events.push('event:'+value.type)}
 const code=`let workLease=null,businessClosed=false,closingFlow=null,closeCommitted=false,quitting=false;const closePermits=new WeakSet();${declaration('trusted')}\n${declaration('restoreBusiness')}\n${declaration('beginClose')}\nconst closeCoordinator=new CloseCoordinator(${services});const handler=${callback};return{run:(input,origin=event)=>handler(origin,input),state:()=>({closed:businessClosed,pending:workLease?.requiresRestart??false})}`
 const bindings={...dependencies,workNames}
 const api=new Function(...Object.keys(bindings),transformSync(code,{loader:'ts'}).code)(...Object.values(bindings)) as {run(input:unknown,origin?:unknown):Promise<string>;state():{closed:boolean;pending:boolean}}
 return{...api,root,gate,events,frame,ownerBytes,action:{type:'start',workId:id},stopEntered:stopEntered.promise,confirmEntered:confirmEntered.promise,setActive:(value:number)=>active=value,setStopGate:(value:Promise<void>)=>stopGate=value,setConfirmGate:(value:Promise<void>)=>confirmGate=value,declineStop:()=>declineStop=true,setConfirm:(value:number)=>confirmResponse=value,failNotice:(value:boolean)=>noticeFails=value,loseHost:()=>host=false,cleanup:()=>rm(root,{recursive:true,force:true})}
}

test('WL90-M01: declining task stop cannot flush, close, confirm recovery or touch the real lease',async()=>{const r=await fixture();try{
 r.setActive(1);r.declineStop();assert.equal(await r.run(r.action),'cancelled')
 for(const key of ['flush','close','stop-tasks','closed-work-lease-target','dialog:修复异常退出锁','relaunch','quit'])assert.equal(r.events.includes(key),false,key)
 assert.equal(r.gate.closed,false);assert.equal(await readFile(join(r.root,'.xuanxiang-lock/owner.json'),'utf8'),r.ownerBytes)
}finally{await r.cleanup()}})

test('WL90-M02: physical stop is awaited before flush and declined deletion still cold restarts without changing work bytes',async()=>{const r=await fixture();try{
 const stop=Promise.withResolvers<void>();r.setActive(1);r.setStopGate(stop.promise);r.setConfirm(0)
 const flight=r.run(r.action);await r.stopEntered;await new Promise(setImmediate)
 assert.equal(r.events.includes('flush'),false);assert.equal(r.events.includes('close'),false);assert.equal(r.events.includes('closed-work-lease-target'),false)
 stop.resolve();assert.equal(await flight,'restarting');assert.equal(r.events.filter(e=>e==='flush').length,1);assert.ok(r.events.indexOf('stop-tasks')<r.events.indexOf('flush'))
 assert.equal(r.events.includes('resume'),false);assert.equal(await readFile(join(r.root,'.xuanxiang-lock/owner.json'),'utf8'),r.ownerBytes);assert.equal(await readFile(join(r.root,'author.txt'),'utf8'),'作者正文，保持字节不变')
}finally{await r.cleanup()}})

test('WL90-M03: native confirmation joins a retry but rejects a second start; only one physical recovery and restart is permitted',async()=>{const r=await fixture();try{
 const confirm=Promise.withResolvers<void>();r.setConfirmGate(confirm.promise);const start=r.run(r.action);await r.confirmEntered
 await assert.rejects(r.run(r.action),/处理中/);const retry=r.run({type:'retry'});await new Promise(setImmediate)
 assert.equal(await readFile(join(r.root,'.xuanxiang-lock/owner.json'),'utf8'),r.ownerBytes);assert.equal(r.events.includes('relaunch'),false)
 confirm.resolve();assert.deepEqual(await Promise.all([start,retry]),['restarting','restarting'])
 for(const key of ['flush','close','closed-work-lease-target','dialog:修复异常退出锁','relaunch','quit'])assert.equal(r.events.filter(e=>e===key).length,1,key)
 await assert.rejects(lstat(join(r.root,'.xuanxiang-lock')),{code:'ENOENT'})
}finally{await r.cleanup()}})

test('WL90-M04: failed result notice after physical recovery stays blocked; retry cannot flush stale buffers or replay the audit',async()=>{const r=await fixture();try{
 r.failNotice(true);assert.equal(await r.run(r.action),'pending');assert.equal(r.gate.closed,true);await assert.rejects(lstat(join(r.root,'.xuanxiang-lock')),{code:'ENOENT'})
 const path=join(r.root,'.xuanxiang-lease-recovery.json'),bytes=await readFile(path),before=await lstat(path,{bigint:true})
 r.failNotice(false);assert.equal(await r.run({type:'retry'}),'restarting');assert.deepEqual(await readFile(path),bytes)
 const after=await lstat(path,{bigint:true});assert.equal(after.ino,before.ino);assert.equal(after.mtimeNs,before.mtimeNs)
 for(const key of ['flush','close','closed-work-lease-target','dialog:修复异常退出锁','relaunch'])assert.equal(r.events.filter(e=>e===key).length,1,key)
 assert.equal(r.events.includes('resume'),false)
}finally{await r.cleanup()}})

test('WL90-M05: frame navigation while native confirmation waits cannot authorize deletion, restart or reopening',async()=>{const r=await fixture();try{
 const confirm=Promise.withResolvers<void>();r.setConfirmGate(confirm.promise);const flight=r.run(r.action);await r.confirmEntered
 r.frame.url='https://foreign.invalid/';confirm.resolve();assert.equal(await flight,'pending')
 assert.equal(r.gate.closed,true);assert.equal(r.events.includes('relaunch'),false);assert.equal(r.events.includes('resume'),false);assert.equal(await readFile(join(r.root,'.xuanxiang-lock/owner.json'),'utf8'),r.ownerBytes)
 await assert.rejects(r.run({type:'retry'}),/不受信/)
}finally{await r.cleanup()}})

test('WL90-M06: loss of the stable instance lock fails before close; retry and start cannot accept extra filesystem authority',async()=>{const r=await fixture();try{
 for(const input of [{type:'retry',path:r.root},{...r.action,pid:process.pid},{...r.action,confirmed:true}])await assert.rejects(r.run(input))
 assert.equal(r.events.length,0);r.loseHost();await assert.rejects(r.run(r.action),/HANDOFF_HOST_LOST/)
 assert.equal(r.events.length,0);assert.equal(r.gate.closed,false);assert.equal(await readFile(join(r.root,'.xuanxiang-lock/owner.json'),'utf8'),r.ownerBytes)
}finally{await r.cleanup()}})
