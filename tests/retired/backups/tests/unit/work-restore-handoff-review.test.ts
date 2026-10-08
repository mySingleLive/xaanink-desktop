import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {z} from 'zod'
import {WorkRestoreHandoff} from '../../desktop/main/work-restore-handoff'
import {WorkRestoreDraftBarrier} from '../../desktop/main/work-restore-draft-barrier'
import {CloseCoordinator} from '../../desktop/main/close-coordinator'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {BusinessGate} from '../../desktop/main/business-gate'
import {workRestoreRequestSchema,restoreDraftAckSchema} from '../../desktop/shared/work-restore'
import {collectClosedRootFiles} from '../../desktop/main/owned-root-files'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {DesktopDraftSession} from '../../src/lib/desktop/draft-session'
import {DesktopSaveCoordinator} from '../../src/lib/desktop/save-coordinator'
import type {StoreOptions} from '../../desktop/core/versioned-store'
import type {DraftSnapshot} from '../../desktop/shared/drafts'
import type {DesktopEvent} from '../../desktop/shared/ipc'

// The callbacks and close services are extracted from the actual frozen main
// source. Main state machines, journal/barrier and FS are real; native prompts,
// renderer flush transport and worker closure are explicitly controlled gates.
// This is not Electron/session/engine shutdown or Windows acceptance.
const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
function declaration(name:string){
 const node=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)
 assert.ok(node,name);return node.getText(source)
}
function callback(channel:string){
 let code=''
 function scan(node:ts.Node){
  if(ts.isCallExpression(node)&&['ipcMain.handle','businessHandle'].includes(node.expression.getText(source))&&node.arguments[0]?.getText(source)===JSON.stringify(channel))code=node.arguments[1].getText(source)
  ts.forEachChild(node,scan)
 }
 scan(source);assert.ok(code,channel);return code
}
let closeServices=''
function scanServices(node:ts.Node){if(ts.isNewExpression(node)&&node.expression.getText(source)==='CloseCoordinator')closeServices=node.arguments![0].getText(source);ts.forEachChild(node,scanServices)}
scanServices(source);assert.ok(closeServices)
const snapshot=(revision=1,text='尚未批准的旧输入'):DraftSnapshot=>({version:1,revision,createdAt:new Date().toISOString(),autosaves:[],sources:{chat:{composerValue:text}},issues:[]})
async function rig(barrierOptions:StoreOptions={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'xx-review81-main-')))
 const barrier=new WorkRestoreDraftBarrier(root,barrierOptions),journal=new DraftJournal(root),gate=new BusinessGate()
 const owner={owner:41,id:randomUUID(),ready:true,restoreToken:undefined as string|undefined},contents={id:41},window={webContents:contents,isDestroyed:()=>false}
 journal.activate('41');let receipt=await journal.persist('41',snapshot())
 const calls:string[]=[],event={sender:contents},action={type:'start' as const,workId:randomUUID(),backupId:randomUUID()},candidate={id:randomUUID(),revision:2,backupId:action.backupId,createdAt:new Date().toISOString()}
 const hooks:{prepare?:()=>Promise<void>;stop?:()=>Promise<void>;activate?:()=>Promise<void>;cancel?:()=>Promise<void>;reclose?:()=>Promise<void>}={}
 let workerCloses=0
 const dependencies={window,draftSession:owner,event,randomUUID,z,dataRoot:root,nativeTheme:{shouldUseDarkColors:false},restoreDraftBarrier:barrier,draftJournal:journal,workRestoreRequestSchema,restoreDraftAckSchema,WorkRestoreHandoff,CloseCoordinator,businessGate:gate,
  trusted:(input:unknown)=>{if(input!==event)throw Error('untrusted')},workBackups:undefined,resumeWorkBackups:async()=>{calls.push('resume-backups')},
  modelService:{activeCount:0,close:async()=>{calls.push('stop-models')},resume:()=>calls.push('resume-models')},modelConfiguration:{activeCount:0,cancelOwner(){}},avatarAssets:{cancelOwner(){}},
  recoveryExports:{cancelWindow(){},flush:async()=>{}},fileExports:{cancelWindow(){},flush:async()=>{}},configurationFiles:{cancelWindow(){},flush:async()=>{calls.push('settings-flush')}},repository:{read:async()=>({revision:0,models:[],settings:{general:{restoreSession:true}}})},responseOwners:new Map(),
  closeChannel:{cancel(){},request:async()=>{calls.push('renderer-flush');return{status:'saved',receipt}}},
  service:{call:async(method:string,input?:{type:string})=>{
   const key=method==='work-backup'?input!.type:method;calls.push(key)
   if(key==='task-status')return{active:0}
   if(key==='prepare'){await hooks.prepare?.();return{type:'prepare',candidate}}
   if(key==='stop-tasks')await hooks.stop?.()
   if(key==='activate')await hooks.activate?.()
   if(key==='cancel')await hooks.cancel?.()
   if(key==='close'&&++workerCloses>1)await hooks.reclose?.()
   return key==='activate'?{type:'activate',revision:candidate.revision+1}:true
  }},
  dialog:{showMessageBox:async(_window:unknown,options:{title:string})=>{calls.push(`dialog:${options.title}`);return{response:options.title==='从备份恢复作品'?1:options.title==='恢复交接尚未完成'?1:2}}},
  app:{getVersion:()=> 'review81',relaunch:()=>calls.push('relaunch'),quit:()=>calls.push('quit')},worker:{terminate:async()=>{calls.push('terminate')}},
  send:(value:{type:string})=>calls.push(`event:${value.type}`),
 }
 const code=`let workLease=null,workRestore=null,migrationHandoff=null,businessClosed=false,closingFlow=null,closeCommitted=false,quitting=false;const closePermits=new WeakSet();
 ${declaration('restoreBusiness')}\n${declaration('retryMigrationCancellation')}\n${declaration('beginClose')}\n${declaration('flushDraftForClose')}
 const closeCoordinator=new CloseCoordinator(${closeServices});const restore=${callback('desktop:work-restore')},ack=${callback('desktop:restore-draft-ack')},bootstrap=${callback('desktop:bootstrap')},migrate=${callback('desktop:migrate-root')},read=${callback('desktop:draft-read')},persist=${callback('desktop:draft-persist')},ready=${callback('desktop:draft-ready')};
 return{run:input=>restore(event,input),ack:input=>ack(event,input),bootstrap:()=>bootstrap(event),migrate:input=>migrate(event,input),
  read:id=>read(event,id),persist:(id,value)=>persist(event,id,value),ready:id=>ready(event,id),
  state:()=>({pending:workRestore?.requiresRestart??false,closed:businessClosed,session:draftSession}),
  replaceSession:()=>{draftSession={...draftSession,id:randomUUID()};draftJournal.activate(String(event.sender.id))},
  setMigration:()=>{migrationHandoff={pending:true}},
 }`
 const api=new Function(...Object.keys(dependencies),transformSync(code,{loader:'ts'}).code)(...Object.values(dependencies)) as {
  run(input:unknown):Promise<string>;ack(input:unknown):Promise<void>;bootstrap():Promise<unknown>;migrate(input:unknown):Promise<unknown>
  read(id:string):Promise<DraftSnapshot|null>;persist(id:string,value:DraftSnapshot):Promise<unknown>;ready(id:string):Promise<void>
  state():{pending:boolean;closed:boolean;session:typeof owner};replaceSession():void;setMigration():void
 }
 return{...api,root,barrier,journal,gate,owner,event,action,candidate,calls,hooks,
  updateReceipt:async(revision:number)=>{receipt=await journal.persist('41',snapshot(revision,'新输入'));return receipt},
  cleanup:()=>rm(root,{recursive:true,force:true}),
 }
}

test('WR81-01 actual IPC reserves one candidate before asynchronous preparation and rejects both a second restore and migration; a revoked owner cancels without activation',async()=>{
 const r=await rig(),entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>()
 try{
  r.hooks.prepare=async()=>{entered.resolve();await gate.promise}
  const first=r.run(r.action);await entered.promise
  await assert.rejects(r.run(r.action),/仍在处理中/)
  await assert.rejects(r.migrate('start'),/仍在处理中/)
  r.replaceSession();gate.resolve();await assert.rejects(first,/所属窗口/)
  assert.equal(r.calls.filter(x=>x==='prepare').length,1)
  assert.equal(r.calls.filter(x=>x==='cancel').length,1)
  assert.equal(r.calls.includes('activate'),false);assert.equal(r.calls.includes('renderer-flush'),false)
  assert.equal(await r.barrier.inspect(),null);assert.equal(r.gate.closed,false)
 }finally{gate.resolve();await r.cleanup()}
})

test('WR81-02 a rejected real main stop phase never flushes, closes or creates a barrier, and cancellation only retires the prepared candidate',async()=>{
 const r=await rig()
 try{
  r.hooks.stop=async()=>{throw Error('controlled worker refused task stop')}
  assert.equal(await r.run(r.action),'cancelled')
  assert.equal(r.calls.includes('renderer-flush'),false);assert.equal(r.calls.includes('close'),false);assert.equal(r.calls.includes('activate'),false)
  assert.equal(r.calls.filter(x=>x==='cancel').length,1);assert.equal(await r.barrier.inspect(),null)
  assert.equal(r.gate.closed,false);assert.equal(r.calls.includes('resume-models'),true)
  assert.deepEqual((await r.journal.read())?.sources.chat,{composerValue:'尚未批准的旧输入'})
 }finally{await r.cleanup()}
})

test('WR81-03 actual post-rename barrier fsync failure keeps the closed handoff blocked; retry confirms durability before one activation and never reflushes old buffers',async()=>{
 let synchronizations=0
 const r=await rig({beforeDirectorySync:async()=>{if(++synchronizations===1)throw Error('injected begin directory sync failure')}})
 try{
  assert.equal(await r.run(r.action),'pending')
  assert.equal((await r.barrier.inspect())?.outcome.status,'pending')
  assert.equal(r.state().pending,true);assert.equal(r.state().closed,true);assert.equal(r.gate.closed,true)
  assert.equal(r.calls.includes('activate'),false);assert.equal(r.calls.includes('relaunch'),false);assert.equal(r.calls.includes('resume-models'),false)
  assert.equal(await r.run({type:'retry'}),'restarting')
  assert.ok(synchronizations>=3)
  assert.equal(r.calls.filter(x=>x==='activate').length,1);assert.equal(r.calls.filter(x=>x==='renderer-flush').length,1);assert.equal(r.calls.filter(x=>x==='stop-tasks').length,1)
  assert.equal(r.calls.filter(x=>x==='relaunch').length,1);assert.equal((await r.barrier.inspect())?.outcome.status,'activated')
 }finally{await r.cleanup()}
})

test('WR81-04 actual settle rename followed by failed directory sync remains uncertain and retries the known result without another activation or old draft save',async()=>{
 let synchronizations=0
 const r=await rig({beforeDirectorySync:async()=>{if(++synchronizations===2)throw Error('injected settle directory sync failure')}})
 try{
  assert.equal(await r.run(r.action),'pending')
  assert.equal((await r.barrier.inspect())?.outcome.status,'activated')
  assert.equal(r.gate.closed,true);assert.equal(r.calls.includes('relaunch'),false)
  assert.equal(await r.run({type:'retry'}),'restarting')
  assert.equal(r.calls.filter(x=>x==='activate').length,1);assert.equal(r.calls.filter(x=>x==='renderer-flush').length,1)
  assert.equal(r.calls.filter(x=>x==='close').length,2);assert.equal(r.calls.includes('resume-models'),false)
 }finally{await r.cleanup()}
})

test('WR81-05 real main ACK with an owner revoked in the last disk commit guard retains the protective barrier and never clears the replacement session',async()=>{
 let revoke:(()=>void)|undefined
 const r=await rig({beforeRename:async()=>{revoke?.()}})
 try{
  const record=await r.barrier.begin({workId:r.action.workId,candidateId:r.candidate.id},async()=>{})
  r.owner.restoreToken=record.token
  const receipt=await r.updateReceipt(2),oldId=r.owner.id
  revoke=()=>{revoke=undefined;r.replaceSession()}
  await assert.rejects(r.ack({sessionId:oldId,token:record.token,receipt}),/所属窗口|未确认/)
  assert.equal((await r.barrier.inspect())?.token,record.token)
  assert.notEqual(r.state().session.id,oldId)
  assert.equal(r.state().session.restoreToken,record.token)
 }finally{await r.cleanup()}
})

test('WR81-06 main ACK requires the current journal generation, not an earlier valid digest, and only the exact fresh receipt clears the barrier',async()=>{
 const r=await rig()
 try{
  const record=await r.barrier.begin({workId:r.action.workId,candidateId:r.candidate.id},async()=>{})
  r.owner.restoreToken=record.token
  const older=await r.updateReceipt(2),fresh=await r.updateReceipt(3)
  await assert.rejects(r.ack({sessionId:r.owner.id,token:record.token,receipt:older}),/未确认/)
  assert.equal((await r.barrier.inspect())?.token,record.token);assert.equal(r.owner.restoreToken,record.token)
  await r.ack({sessionId:r.owner.id,token:record.token,receipt:fresh})
  assert.equal(await r.barrier.inspect(),null);assert.equal(r.owner.restoreToken,undefined)
  await assert.rejects(r.ack({sessionId:r.owner.id,token:record.token,receipt:fresh}),/所属窗口|令牌/)
  assert.equal((await r.journal.read())?.revision,3)
 }finally{await r.cleanup()}
})

test('WR81-07 migration inventory includes the exact active restore barrier and preserves lookalike author files byte-for-byte',async()=>{
 const r=await rig()
 try{
  await mkdir(join(r.root,'inbox'))
  await writeFile(join(r.root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}))
  await writeFile(join(r.root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
  const record=await r.barrier.begin({workId:r.action.workId,candidateId:r.candidate.id},async()=>{})
  const lookalike='restore-draft-barrier.backup.json';await writeFile(join(r.root,lookalike),'作者的未知恢复记录')
  const inventory=await collectClosedRootFiles(await directoryIdentity(r.root),async()=>{})
  assert.ok(inventory.files.includes('restore-draft-barrier.json'))
  assert.equal(inventory.files.includes(lookalike),false);assert.ok(inventory.preserved.includes(lookalike))
  assert.equal(await readFile(join(r.root,lookalike),'utf8'),'作者的未知恢复记录')
  assert.equal((await r.barrier.inspect())?.token,record.token)
 }finally{await r.cleanup()}
})

const desktopSource=ts.createSourceFile('DesktopApp.tsx',readFileSync('src/components/desktop/DesktopApp.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let startupEffect=''
function scanStartup(node:ts.Node){
 if(ts.isCallExpression(node)&&node.expression.getText(desktopSource)==='useEffect'&&node.arguments[0]?.getText(desktopSource).includes('installDesktopTransport(bridge)'))startupEffect=node.arguments[0].getText(desktopSource)
 ts.forEachChild(node,scanStartup)
}
scanStartup(desktopSource);assert.ok(startupEffect)
async function startupRig(main:Awaited<ReturnType<typeof rig>>,failAck=false){
 const notices:string[]=[],errors:string[]=[],replies:unknown[]=[],events:string[]=[],published:unknown[]=[],initialized=Promise.withResolvers<void>(),replied=Promise.withResolvers<void>()
 const coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null}),cleanupEntered=Promise.withResolvers<void>(),cleanupGate=Promise.withResolvers<void>(),ackEntered=Promise.withResolvers<void>(),ackGate=Promise.withResolvers<void>()
 let observedRestoreSession:unknown,listener:((value:DesktopEvent)=>void)|undefined,changed:()=>void=()=>{},activeText='原缓存输入',archiveText=''
 const bridge={bootstrap:()=>main.bootstrap(),subscribe:(callback:(value:DesktopEvent)=>void)=>{listener=callback;return()=>{listener=undefined}},
  readDraft:(id:string)=>main.read(id),markDraftReady:(id:string)=>main.ready(id),persistDraft:(id:string,value:DraftSnapshot)=>main.persist(id,value),
  acknowledgeWorkRestore:async(input:unknown)=>{events.push('ack');ackEntered.resolve();await ackGate.promise;if(failAck)throw Error('controlled acknowledgement transport loss');await main.ack(input)},
  replyClose:async(...args:unknown[])=>{replies.push(args);replied.resolve();return true},
 }
 const deps={window:{desktop:bridge,addEventListener(){},removeEventListener(){}},installDesktopTransport(){},browserSessionStorage:()=>({}),DesktopDraftSession,desktopSaveCoordinator:coordinator,
  restoreDesktopDraft:async(_value:unknown,options:{restoreSession:boolean})=>{observedRestoreSession=options.restoreSession;archiveText=activeText;return{retained:1,requiresCheckpoint:true,afterCheckpoint:async()=>{cleanupEntered.resolve();await cleanupGate.promise;activeText='';changed();events.push('clean')}}},
  createRecoveryVerifier:()=>{},installDesktopDraftSources:()=>{
   const removeChat=coordinator.registerSource('chat',{read:()=>({composerValue:activeText}),subscribe:cb=>{changed=cb;return()=>{changed=()=>{}}}})
   const removeRecovery=coordinator.registerSource('recovery',{read:()=>({items:[{value:archiveText}]})})
   return()=>{removeRecovery();removeChat()}
  },installWorkspaceDraftSource:()=>()=>{},installRecoveryDraftSource:()=>()=>{},installCommentDraftSource:()=>()=>{},flushDesktopSettings:async()=>{},
  closingRef:{current:false},setClosing:()=>{},setError:(message:string)=>{errors.push(message);initialized.resolve()},setRecoveryOpen:()=>{},drafts:{current:null},
  useDesktopStore:{setState:(value:unknown)=>{published.push(value);events.push('published');initialized.resolve()}},toast:{info:(value:string)=>notices.push(value),success:(value:string)=>notices.push(value),error:(value:string)=>notices.push(value)},
  queryClient:{invalidateQueries:async()=>{}},receiveDesktopState:()=>{},setModelRequired:()=>{},setSettingsSection:()=>{},setSettingsOpen:()=>{},useChatStore:{getState:()=>({})},setMigrationPending:()=>{},setRestorePending:()=>{},
 }
 const effect=new Function(...Object.keys(deps),transformSync(`return ${startupEffect}`,{loader:'ts'}).code)(...Object.values(deps)) as ()=>()=>void
 const dispose=effect()
 return{coordinator,cleanupEntered,cleanupGate,ackEntered,ackGate,initialized,replied,events,published,notices,errors,replies,dispose,
  restoreSession:()=>observedRestoreSession,send:(value:DesktopEvent)=>{assert.ok(listener);listener(value)},
 }
}

test('WR81-08 actual bootstrap effect with real session/coordinator and main journal IPC waits for archived then clean receipts and exact ACK before publishing; close waits for the same sequence',{timeout:5000},async()=>{
 const main=await rig();let view:Awaited<ReturnType<typeof startupRig>>|undefined
 try{
  await main.barrier.begin({workId:main.action.workId,candidateId:main.candidate.id},async()=>{})
  main.owner.ready=false;view=await startupRig(main)
  await view.cleanupEntered.promise
  assert.equal(view.restoreSession(),false);assert.equal(view.published.length,0)
  const archived=await main.journal.read();assert.deepEqual(archived?.sources.chat,{composerValue:'原缓存输入'});assert.deepEqual(archived?.sources.recovery,{items:[{value:'原缓存输入'}]})
  view.send({type:'prepare-close',sessionId:main.owner.id,id:randomUUID(),action:'flush',retryFailures:false})
  await new Promise(setImmediate);assert.deepEqual(view.replies,[])
  view.cleanupGate.resolve();await view.ackEntered.promise
  const clean=await main.journal.read();assert.deepEqual(clean?.sources.chat,{composerValue:''});assert.deepEqual(clean?.sources.recovery,archived?.sources.recovery)
  assert.equal(view.published.length,0);assert.deepEqual(view.replies,[]);assert.notEqual(await main.barrier.inspect(),null)
  view.ackGate.resolve();await view.initialized.promise;await view.replied.promise
  assert.equal(await main.barrier.inspect(),null);assert.equal(view.published.length,1)
  assert.deepEqual(view.events,['clean','ack','published'])
  assert.equal(view.notices.some(text=>text.includes('恢复完成')),false)
  assert.equal(view.notices.some(text=>text.includes('尚未确认')),true)
  assert.equal(view.replies.length,1)
  const reply=view.replies[0] as [string,string,{status:string;receipt:{revision:number;digest:string;clientRevision:number}}]
  assert.equal(reply[2].status,'saved');await main.journal.confirm('41',reply[2].receipt)
  assert.equal(main.calls.includes('activate'),false)
 }finally{view?.cleanupGate.resolve();view?.ackGate.resolve();view?.dispose();await main.cleanup()}
})

test('WR81-09 a lost bootstrap ACK never publishes editable state or success; clean journal retains old data and a failed initialization may still safely close with the barrier intact',{timeout:5000},async()=>{
 const main=await rig();let view:Awaited<ReturnType<typeof startupRig>>|undefined
 try{
  const record=await main.barrier.begin({workId:main.action.workId,candidateId:main.candidate.id},async()=>{})
  main.owner.ready=false;view=await startupRig(main,true)
  await view.cleanupEntered.promise;view.cleanupGate.resolve();await view.ackEntered.promise;view.ackGate.resolve();await view.initialized.promise
  assert.equal(view.published.length,0);assert.equal(view.errors.length,1)
  assert.equal(view.notices.some(text=>text.includes('恢复完成')),false)
  assert.equal((await main.barrier.inspect())?.token,record.token)
  assert.deepEqual((await main.journal.read())?.sources.recovery,{items:[{value:'原缓存输入'}]})
  view.send({type:'prepare-close',sessionId:main.owner.id,id:randomUUID(),action:'flush',retryFailures:false})
  await view.replied.promise
  assert.equal(view.replies.length,1)
  const reply=view.replies[0] as [string,string,{status:string;receipt:{revision:number;digest:string;clientRevision:number}}]
  assert.equal(reply[2].status,'saved');await main.journal.confirm('41',reply[2].receipt)
  assert.equal((await main.barrier.inspect())?.token,record.token)
  assert.equal(main.calls.includes('activate'),false)
 }finally{view?.cleanupGate.resolve();view?.ackGate.resolve();view?.dispose();await main.cleanup()}
})
