import {app,BrowserWindow,dialog,ipcMain,Menu,nativeTheme,session,type IpcMainInvokeEvent,type MenuItemConstructorOptions} from 'electron'
import {Worker} from 'node:worker_threads'
import {randomUUID} from 'node:crypto'
import {mkdirSync,lstatSync} from 'node:fs'
import {join,dirname,basename} from 'node:path'
import {z} from 'zod'
import type {RootIdentity} from '../core/data-root'
import {directoryIdentity,sameIdentity} from '../core/root-ownership'
import {canonical,digest} from '../core/application-backup-files'
import {assertRootAuthorityHost,assertRootAuthorityDirectory,observeRootAuthority,readRootAuthority} from '../core/root-authority'
import type {ApplicationRestoreActivationPreview} from '../core/application-restore-activation'
import {applicationBackupSchema,type ApplicationBackup} from '../shared/application-backup'
import {applicationRestoreEntryCommandSchema,applicationRestoreEntryStateSchema,type ApplicationRestoreEntryCommand,type ApplicationRestoreEntryState} from '../shared/application-restore-entry'
import {ApplicationRestoreRequests,type ApplicationRestoreExecutionHandle} from './application-restore-request'
import {inspectApplicationRestoreProtection} from './application-restore-preflight'
import type {ApplicationRestoreRequest} from '../shared/application-restore-request'
import {createNativeApplicationRestoreLayout,bindApplicationRestoreLayout,inspectApplicationRestoreLayouts,loadApplicationRestoreLayout,flushApplicationRestoreLayouts,type NativeApplicationRestoreLayoutHandle} from './application-restore-layout'
import type {ApplicationRestoreWorkerInput} from '../service/application-restore-worker'
import {prepareSessionDirectory} from './session-directory'
import {staticUiResponse} from './static-ui'
type Outcome={type:'complete';receiptId:string}|{type:'failed';code:string}
export interface ApplicationRestoreWorkerFlight{result:Promise<Outcome>;exit:Promise<number>;cancel():void}
export interface ApplicationRestoreEntryControllerOptions{
 bootstrap:RootIdentity;ownerNonce:string;reason:'lost'|'bad-db'|'handoff';theme:'paper'|'ink';platform:'darwin'|'win32'|'linux';migrationsPath:string;locateAvailable?:boolean
 assertStableLock():void;assertOwner():void;assertCold():void
 chooseBackup():Promise<string|null>;chooseParent():Promise<string|null>
 confirmPreparation(request:Readonly<ApplicationRestoreRequest>):Promise<boolean>
 confirmActivation(preview:Readonly<ApplicationRestoreActivationPreview>):Promise<boolean>
 startWorker(input:ApplicationRestoreWorkerInput,confirm:(preview:Readonly<ApplicationRestoreActivationPreview>)=>Promise<boolean>,progress:()=>void):ApplicationRestoreWorkerFlight
 closePrepared(request:ApplicationRestoreRequest,manager:ApplicationRestoreRequests,layout?:NativeApplicationRestoreLayoutHandle):Promise<void>
 exit(kind:'quit'|'restart'|'locate'):Promise<void>;menu():void
}
function fail(code:string):never{throw Object.assign(Error(code),{code})}
function sourceAvailable(root:RootIdentity){let row;try{row=lstatSync(root.path,{bigint:true})}catch(cause){if(['ENOENT','ENOTDIR'].includes((cause as NodeJS.ErrnoException).code??''))return false;throw cause}if(!row.isDirectory()||row.isSymbolicLink()||!sameIdentity({device:String(row.dev),inode:String(row.ino)},root))return false;assertRootAuthorityDirectory(root);return true}
/** Only fixed commands enter this controller. Native paths and main private
 * lifecycle callbacks are never accepted from the renderer. */
export class ApplicationRestoreEntryController{
 readonly #options:ApplicationRestoreEntryControllerOptions
 readonly #requests:ApplicationRestoreRequests
 #layout:NativeApplicationRestoreLayoutHandle|undefined
 #backup:{directory:RootIdentity;receipt:ApplicationBackup}|null=null
 #worker:ApplicationRestoreWorkerFlight|null=null
 #workerExited=true
 #fence:SharedArrayBuffer|null=null
 #handle:ApplicationRestoreExecutionHandle|null=null
 #flight:Promise<void>|null=null
 #exitFlight:Promise<void>|null=null
 #ticket=0
 #leaving=false
 #state:ApplicationRestoreEntryState
 readonly #listeners=new Set<(state:ApplicationRestoreEntryState)=>void>()
 constructor(options:ApplicationRestoreEntryControllerOptions){
  this.#options=Object.freeze({...options,bootstrap:Object.freeze(structuredClone(options.bootstrap))});const o=this.#options
  this.#requests=new ApplicationRestoreRequests(o.bootstrap,{assertStableLock:()=>o.assertStableLock(),assertOwner:nonce=>{if(nonce!==o.ownerNonce)fail('OWNER_EXPIRED');o.assertOwner()},assertQuiesced:()=>{o.assertCold();if(this.#worker&&!this.#workerExited)fail('IO_PENDING')},assertOldProcessExited(){},assertCold:()=>o.assertCold(),assertExecutionSettled:()=>{if(!this.#workerExited)fail('IO_PENDING')},inspectPendingEvidence:()=>{const layout=inspectApplicationRestoreLayouts(o.bootstrap,{allowed:this.#layout}),drafts=inspectApplicationRestoreProtection(o.bootstrap,()=>o.assertStableLock());return{operationIds:[...new Set([...layout.operationIds,...drafts.operationIds])],unknown:layout.unknown||drafts.unknown}}})
  this.#state={version:1,revision:0,theme:o.theme,platform:o.platform,phase:'blocked',operationId:null,sourcePath:null,targetPath:null,backup:null,notice:'inspection-required',canChooseBackup:false,canChooseParent:false,canContinue:false,canCancel:false,canRestart:true,canLocate:false};this.refresh()
 }
 state(){return structuredClone(this.#state)}
 subscribe(listener:(state:ApplicationRestoreEntryState)=>void){this.#listeners.add(listener);listener(this.state());return()=>this.#listeners.delete(listener)}
 private publish(update:Partial<ApplicationRestoreEntryState>){this.#state=applicationRestoreEntryStateSchema.parse({...this.#state,...update,revision:this.#state.revision+1});for(const listener of this.#listeners)try{listener(this.state())}catch{/* observers have no authority */}}
 private guard(ticket?:number){assertRootAuthorityHost(()=>this.#options.assertStableLock(),'LOCK_REQUIRED');assertRootAuthorityHost(()=>this.#options.assertOwner(),'OWNER_EXPIRED');if(this.#leaving||ticket!==undefined&&ticket!==this.#ticket)fail('OPERATION_CANCELLED')}
 private refresh(){
  const startup=this.#requests.startup(),request=startup.request;let sourcePath:string|null=null,available=false
  try{const source=readRootAuthority(this.#options.bootstrap,()=>this.#options.assertStableLock()).pointer.root;sourcePath=source.path;available=sourceAvailable(source)}catch{this.publish({phase:'blocked',notice:'inspection-required',canChooseBackup:false,canChooseParent:false,canContinue:false,canCancel:false,canLocate:false,canRestart:true});return}
  const fresh=startup.mode==='normal'&&!inspectApplicationRestoreLayouts(this.#options.bootstrap).unknown&&(this.#options.reason==='lost'?!available:this.#options.reason==='bad-db'&&available)
  let departed=false;if(startup.mode==='execute-ready'&&request)try{process.kill(request.oldProcess.pid,0)}catch(cause){departed=(cause as NodeJS.ErrnoException).code==='ESRCH'}
  this.publish({sourcePath,operationId:request?.operationId??null,targetPath:startup.activation?.pointer.root.path??request?.parent.path??null,phase:fresh?'selecting':startup.mode==='execute-ready'?'armed':startup.mode==='protected'?'complete':request?.phase==='prepared'?'prepared':'inspection',notice:fresh?'choose-backup':startup.mode==='execute-ready'&&!departed?'old-process-active':startup.mode==='protected'?'activated':request?.phase==='prepared'?'ready':'inspection-required',canChooseBackup:fresh,canChooseParent:fresh&&!!this.#backup,canContinue:startup.mode==='execute-ready'&&departed||request?.phase==='prepared'&&startup.mode==='cold',canCancel:request?.phase==='prepared',canRestart:!fresh&&request?.phase!=='prepared'&&startup.mode!=='execute-ready',canLocate:fresh&&this.#options.reason==='lost'&&this.#options.locateAvailable===true})
 }
 private run(action:(ticket:number)=>Promise<void>){if(this.#flight||this.#leaving)return Promise.reject(Error('APPLICATION_RESTORE_ENTRY_BUSY'));const ticket=++this.#ticket,flight=Promise.resolve().then(()=>{this.guard(ticket);return action(ticket)}).catch(cause=>{this.publish({phase:'inspection',notice:'failed',canContinue:false,canChooseBackup:false,canChooseParent:false,canCancel:false,canLocate:false,canRestart:true});throw cause}).finally(()=>{if(this.#flight===flight)this.#flight=null});this.#flight=flight;return flight}
 command(input:ApplicationRestoreEntryCommand):Promise<void>{
  const parsed=applicationRestoreEntryCommandSchema.parse(input);this.guard()
  if(parsed.type==='state')return Promise.resolve()
  if(parsed.type==='quit'||parsed.type==='restart'||parsed.type==='locate')return this.leave(parsed.type)
  if(parsed.type==='menu'){assertRootAuthorityHost(()=>this.#options.menu(),'MENU_NOT_AVAILABLE');return Promise.resolve()}
  if(parsed.type==='inspect'){if(this.#flight)return Promise.reject(Error('APPLICATION_RESTORE_ENTRY_BUSY'));this.refresh();return Promise.resolve()}
  if(parsed.type==='cancel')return this.cancel(parsed.operationId)
  return this.run(async ticket=>{
   if(parsed.type==='choose-backup'){
    if(!this.#state.canChooseBackup)fail('COMMAND_NOT_ALLOWED');const path=await this.#options.chooseBackup();this.guard(ticket);if(path===null)return
    const directory=await directoryIdentity(path);this.guard(ticket);const observed=observeRootAuthority(directory,'xuanxiang-app-backup.json',16*1024*1024)!,receipt=applicationBackupSchema.parse(JSON.parse(observed.text)),{checksum,...body}=receipt,authority=readRootAuthority(this.#options.bootstrap,()=>this.guard(ticket))
    if(receipt.phase!=='verified'||checksum!==digest(canonical(body))||receipt.appId!==authority.pointer.rootId||basename(directory.path)!==receipt.id)fail('BACKUP_INVALID')
    this.#backup={directory,receipt};this.publish({backup:{id:receipt.id,createdAt:receipt.createdAt,bytes:receipt.bytes},canChooseParent:true,notice:'choose-parent'});return
   }
   if(parsed.type==='choose-parent'){
    if(!this.#state.canChooseParent||!this.#backup)fail('COMMAND_NOT_ALLOWED');const path=await this.#options.chooseParent();this.guard(ticket);if(path===null)return
    const base=await directoryIdentity(path);this.guard(ticket);const kind=this.#options.reason==='bad-db'?'closed-source':this.#options.reason==='lost'?'missing':'healthy'
    this.#layout=await createNativeApplicationRestoreLayout(this.#options.bootstrap,base,this.#options.ownerNonce,kind,()=>this.guard(ticket),[this.#backup.directory]);this.guard(ticket)
    const request=await this.#requests.prepare(this.#options.ownerNonce,{backup:{directory:this.#backup.directory,backupId:this.#backup.receipt.id},parent:this.#layout.layout.parents.candidate});this.guard(ticket);await bindApplicationRestoreLayout(this.#layout,request);this.guard(ticket);this.refresh();return
   }
   if(parsed.type!=='continue')fail('COMMAND_NOT_ALLOWED')
   if(!this.#state.canContinue||parsed.operationId!==this.#state.operationId)fail('COMMAND_NOT_ALLOWED')
   const startup=this.#requests.startup(),request=startup.request;if(!request||request.operationId!==parsed.operationId)fail('REQUEST_MISMATCH')
   if(request.phase==='prepared'){
    const accepted:unknown=await this.#options.confirmPreparation(request);this.guard(ticket);if(accepted!==true&&accepted!==false)fail('INVALID_CONFIRMATION')
    if(accepted===false){await this.#requests.cancelPrepared(this.#options.ownerNonce,request.operationId);this.refresh();return}
    await this.#options.closePrepared(request,this.#requests,this.#layout);return
   }
   if(startup.mode!=='execute-ready')fail('INSPECTION_REQUIRED')
   this.#handle=await this.#requests.beginExecution(this.#options.ownerNonce,request.operationId);this.guard(ticket)
   const executing=this.#requests.inspect().request!;this.#fence=new SharedArrayBuffer(4);this.#handle.assertCurrent()
   let flight:ApplicationRestoreWorkerFlight
   try{flight=this.#options.startWorker({kind:'application-restore36',request:executing,layout:loadApplicationRestoreLayout(this.#options.bootstrap,executing),migrationsPath:this.#options.migrationsPath,revocation:this.#fence},async preview=>{this.guard(ticket);this.#handle!.assertCurrent();if(preview.operationId!==request.operationId||preview.backupId!==request.backup.backupId||dirname(preview.target.path)!==request.parent.path||canonical(preview.source)!==canonical(request.source))fail('CONFIRMATION_CONTEXT_INVALID');this.publish({phase:'confirming'});const accepted:unknown=await this.#options.confirmActivation(preview);this.guard(ticket);this.#handle!.assertCurrent();if(accepted!==true&&accepted!==false)fail('INVALID_CONFIRMATION');return accepted===true},()=>{try{this.guard(ticket)}catch{this.revoke()}})}catch(cause){await this.#requests.unknown(this.#handle,'WORKER_EXIT');this.#handle=null;throw cause}
   this.#worker=flight;this.#workerExited=false;this.publish({phase:'running',canCancel:true,canContinue:false,canRestart:false,canLocate:false})
   const[output,exit]=await Promise.allSettled([flight.result,flight.exit]);this.#workerExited=exit.status==='fulfilled'
   if(!this.#workerExited)fail('IO_PENDING')
   if(exit.status!=='fulfilled'||exit.value!==0||output.status!=='fulfilled'||output.value.type==='failed'&&output.value.code==='WORKER_EXIT')await this.#requests.unknown(this.#handle,'WORKER_EXIT')
   else if(output.value.type==='complete')await this.#requests.activated(this.#handle)
   else if(output.value.code==='DURABILITY_UNCONFIRMED')await this.#requests.unknown(this.#handle,'COMMIT_UNCERTAIN')
   else await this.#requests.cancelExecution(this.#handle)
   this.#worker=null;this.#handle=null;this.refresh()
  })
 }
 revoke(){this.#ticket++;if(this.#fence)Atomics.store(new Int32Array(this.#fence),0,1);this.#worker?.cancel()}
 /** Native owner destruction cannot use renderer commands. Keep the physical
  * worker alive until exit, then leave without granting any new business write. */
 drainRevokedWindow(){return this.leave('quit')}
 private async cancel(operationId:string){if(operationId!==this.#state.operationId||!this.#state.canCancel)fail('COMMAND_NOT_ALLOWED');this.revoke();this.publish({notice:'cancel-pending',canCancel:false});await this.#flight?.catch(()=>{});if(!this.#workerExited)fail('IO_PENDING');const request=this.#requests.inspect().request;if(request?.phase==='prepared')await this.#requests.cancelPrepared(this.#options.ownerNonce,operationId);this.refresh()}
 private leave(kind:'quit'|'restart'|'locate'){if(this.#exitFlight)return this.#exitFlight;if(kind==='restart'&&!this.#state.canRestart||kind==='locate'&&(!this.#state.canLocate||this.#flight||this.#worker))return Promise.reject(Error('COMMAND_NOT_ALLOWED'));this.#leaving=true;this.revoke();const flight=(async()=>{await this.#flight?.catch(()=>{});await this.#requests.flush();await flushApplicationRestoreLayouts(this.#options.bootstrap,this.#layout);if(!this.#workerExited)fail('IO_PENDING');await this.#options.exit(kind)})();this.#exitFlight=flight;return flight}
}
export interface ApplicationRestoreWindowInitial{reason?:'lost'|'bad-db'|'handoff';onLocate?:()=>Promise<void>}
/** Separate nonpersistent entry. Caller owns the stable instance lock and has
 * not constructed an ordinary service/engine/session in this process. */
export async function launchApplicationRestoreWindow(bootstrapPath:string,_defaultRoot?:string,initial:ApplicationRestoreWindowInitial={}):Promise<void>{
 const sourceReason=initial.reason??'handoff',onLocate=initial.onLocate
 const assertLock=()=>{if(!app.hasSingleInstanceLock())fail('LOCK_REQUIRED')};assertLock()
 const pin=(path:string):RootIdentity=>{const row=lstatSync(path,{bigint:true}),identity=Object.freeze({path,device:String(row.dev),inode:String(row.ino)});assertRootAuthorityDirectory(identity);return identity},bootstrap=pin(bootstrapPath)
 const profile=prepareSessionDirectory(bootstrapPath),profileIdentity=pin(profile),cache=join(profile,randomUUID());mkdirSync(cache,{mode:0o700});const cacheIdentity=pin(cache);assertRootAuthorityDirectory(bootstrap);app.setPath('sessionData',cache)
 let current:BrowserWindow|null=null,exiting=false,arming=false,ownerAlive=true,loaded=false;const ownerNonce=randomUUID()
 const assertCold=()=>{assertLock();for(const directory of[bootstrap,profileIdentity,cacheIdentity])assertRootAuthorityDirectory(directory);if(app.getPath('sessionData')!==cache)fail('SOURCE_NOT_CLOSED');for(const window of BrowserWindow.getAllWindows())if(!window.isDestroyed()&&(window!==current||window.webContents.session.storagePath!==null))fail('SOURCE_NOT_CLOSED')}
 await app.whenReady();assertCold();const isolated=session.fromPartition(`application-recovery-${randomUUID()}`,{cache:false});if(isolated.storagePath!==null)fail('SESSION_NOT_ISOLATED')
 isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));isolated.setPermissionCheckHandler(()=>false)
 isolated.webRequest.onBeforeRequest((details,callback)=>{let allowed=false;try{allowed=['xaanink:','data:','blob:','devtools:'].includes(new URL(details.url).protocol)}catch{}callback({cancel:!allowed})});isolated.protocol.handle('xuanxiang',request=>staticUiResponse(request,join(app.getAppPath(),'out')))
 const theme=nativeTheme.shouldUseDarkColors?'ink':'paper',backgroundColor=theme==='ink'?'#171312':'#faf5e8',platform=process.platform==='darwin'?'darwin':process.platform==='win32'?'win32':'linux'
 current=new BrowserWindow({width:720,height:570,minWidth:380,minHeight:460,title:'恢复应用数据 · 玄印写作',show:false,backgroundColor,titleBarStyle:'hidden',trafficLightPosition:{x:14,y:14},...(platform==='win32'?{titleBarOverlay:{color:backgroundColor,symbolColor:theme==='ink'?'#ece7e1':'#2b251b',height:44}}:{}),webPreferences:{session:isolated,preload:join(__dirname,'../preload/application-restore.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}})
 const owned=current,assertOwner=()=>{assertCold();if(arming&&owned.isDestroyed())return;if(!ownerAlive||exiting||current!==owned||owned.isDestroyed())fail('OWNER_EXPIRED')}
 let popup:ReturnType<typeof Menu.buildFromTemplate>|null=null
 const choose=async(title:string)=>{assertOwner();const result=await dialog.showOpenDialog(owned,{title,properties:['openDirectory'],buttonLabel:'选择目录'});assertOwner();if(result.canceled)return null;if(result.filePaths.length!==1)fail('NATIVE_SELECTION_INVALID');return result.filePaths[0]}
 const controller=new ApplicationRestoreEntryController({bootstrap,ownerNonce,reason:sourceReason,locateAvailable:typeof onLocate==='function',theme,platform,migrationsPath:join(app.getAppPath(),'prisma/migrations'),assertStableLock:assertLock,assertOwner,assertCold,chooseBackup:()=>choose('选择应用备份包（UUID目录）'),chooseParent:()=>choose('选择独立的空恢复目录'),async confirmPreparation(request){assertOwner();const result=await dialog.showMessageBox(owned,{type:'question',title:'完整退出后恢复',message:'关闭当前应用并从所选备份恢复？',detail:`备份：${request.backup.backupId}\n原数据目录：${request.source.root.path}\n恢复目录：${request.parent.path}\n\n完整退出后才验证副本，最后仍需确认实际启用目录。`,buttons:['关闭并继续恢复','取消'],defaultId:1,cancelId:1,noLink:true});assertOwner();return result.response===0},async confirmActivation(preview){assertOwner();const preservation=preview.closedSource?`原始闭源保留：${preview.closedSource.directory.path}（未验证为健康数据库）`:`恢复前备份：${preview.beforeSnapshot?.path??'原目录物理失联'}`;const result=await dialog.showMessageBox(owned,{type:'question',title:'确认启用恢复副本',message:'启用已验证的恢复副本并重新打开应用？',detail:`原目录：${preview.source.root.path}\n实际目标：${preview.target.path}\n备份：${preview.backupId}\n${preservation}\n\n原目录和副本保留，下一次启动需完成两次草稿保护检查。`,buttons:['启用并重新打开','取消'],defaultId:1,cancelId:1,noLink:true});assertOwner();return result.response===0},startWorker(input,confirm,progress){
  assertOwner();const worker=new Worker(join(__dirname,'../service/application-restore-worker.cjs'),{workerData:input}),result=Promise.withResolvers<Outcome>(),exit=Promise.withResolvers<number>();let completed=false
  worker.on('message',(message:unknown)=>{const item=message as {type?:string;id?:string;preview?:ApplicationRestoreActivationPreview;result?:{receiptId?:string};code?:string};if(item.type==='progress'){progress();return}if(item.type==='confirm'&&z.uuid().safeParse(item.id).success&&item.preview){void confirm(item.preview).then(accepted=>{try{worker.postMessage({type:'confirmed',id:item.id,accepted})}catch{}},()=>{try{worker.postMessage({type:'confirmed',id:item.id,accepted:false})}catch{}});return}if(completed)return;if(item.type==='complete'&&item.result?.receiptId===input.request.operationId){completed=true;result.resolve({type:'complete',receiptId:item.result.receiptId})}else if(item.type==='failed'){completed=true;result.resolve({type:'failed',code:typeof item.code==='string'?item.code:'APPLICATION_RESTORE_FAILED'})}})
  worker.once('error',()=>{if(!completed){completed=true;result.resolve({type:'failed',code:'WORKER_EXIT'})}});worker.once('exit',code=>{if(!completed){completed=true;result.resolve({type:'failed',code:'WORKER_EXIT'})}exit.resolve(code)})
  return{result:result.promise,exit:exit.promise,cancel(){Atomics.store(new Int32Array(input.revocation),0,1);try{worker.postMessage({type:'cancel'})}catch{}}}
 },async closePrepared(request,manager,layout){arming=true;try{await manager.flush();await flushApplicationRestoreLayouts(bootstrap,layout);await isolated.flushStorageData();assertCold();if(!ownerAlive)fail('OWNER_EXPIRED');owned.destroy();current=null;assertCold();await manager.arm(ownerNonce,request.operationId);exiting=true;app.relaunch();app.quit()}finally{arming=false}},async exit(kind){await isolated.flushStorageData();assertCold();exiting=true;ownerAlive=false;if(!owned.isDestroyed())owned.destroy();current=null;assertCold();if(kind==='locate'){if(!onLocate)fail('LOCATE_UNAVAILABLE');await onLocate();return}if(kind==='restart')app.relaunch();app.quit()},menu(){assertOwner();if(platform!=='win32'||!popup)fail('MENU_NOT_AVAILABLE');popup.popup({window:owned})}})
 const trusted=(event:IpcMainInvokeEvent)=>{if(!ownerAlive||owned.isDestroyed()||event.sender!==owned.webContents||event.senderFrame!==owned.webContents.mainFrame||event.senderFrame.url!=='xaanink://app/')fail('UNTRUSTED_RECOVERY_REQUEST')}
 ipcMain.handle('desktop:application-recovery-state',event=>{trusted(event);return controller.state()});ipcMain.handle('desktop:application-recovery-command',async(event,input:unknown)=>{trusted(event);try{await controller.command(applicationRestoreEntryCommandSchema.parse(input))}catch{throw Error('APPLICATION_RECOVERY_COMMAND_NOT_COMPLETED')}})
 const close=()=>{void controller.command({type:'quit'}).catch(()=>{})},revokeWindow=()=>{controller.revoke();ownerAlive=false;void controller.drainRevokedWindow().catch(()=>{})};owned.webContents.setWindowOpenHandler(()=>({action:'deny'}));owned.webContents.on('will-navigate',event=>event.preventDefault());owned.webContents.on('will-attach-webview',event=>event.preventDefault());owned.webContents.on('did-start-navigation',(details,_url,isInPlace,isMainFrame)=>{if(loaded&&(details.isMainFrame??isMainFrame)!==false&&(details.isSameDocument??isInPlace)!==true)revokeWindow()});owned.webContents.on('render-process-gone',revokeWindow);owned.on('close',event=>{if(!exiting&&!arming){event.preventDefault();close()}})
 const unsubscribe=controller.subscribe(state=>{if(ownerAlive&&!owned.isDestroyed())owned.webContents.send('desktop:application-recovery-event',state)});owned.on('closed',()=>{controller.revoke();ownerAlive=false;unsubscribe();current=null;ipcMain.removeHandler('desktop:application-recovery-state');ipcMain.removeHandler('desktop:application-recovery-command');if(!exiting&&!arming)void controller.drainRevokedWindow().catch(()=>{})});app.on('before-quit',event=>{if(!exiting){event.preventDefault();if(ownerAlive)close();else void controller.drainRevokedWindow().catch(()=>{})}})
 const safe=(action:()=>void)=>()=>{try{assertOwner();action()}catch{}}
 const about=safe(()=>{if(platform==='darwin'){app.setAboutPanelOptions({applicationName:'玄印写作',applicationVersion:app.getVersion()});app.showAboutPanel()}else void dialog.showMessageBox(owned,{type:'info',title:'关于玄印写作',message:'玄印写作',detail:`当前版本：${app.getVersion()}`,buttons:['关闭'],noLink:true}).catch(()=>{})})
 const groups:MenuItemConstructorOptions[]=[{label:'文件',submenu:[{label:'新建作品',enabled:false},...(platform==='darwin'?[]:[{label:'退出玄印写作',click:close}])]},{label:'编辑',submenu:[{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},{label:'视图',submenu:[{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大'},{role:'zoomOut',label:'缩小'},{role:'togglefullscreen',label:'进入全屏'}]},{label:'窗口',submenu:[{label:'最小化',click:safe(()=>owned.minimize())},{label:'关闭窗口',click:close}]},{label:'帮助',submenu:[{label:'关于玄印写作',click:about},{label:'帮助文档',enabled:false}]}]
 if(platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'玄印',submenu:[{label:'关于玄印写作',click:about},{type:'separator'},{role:'hide',label:'隐藏玄印写作'},{role:'hideOthers',label:'隐藏其他'},{role:'unhide',label:'显示全部'},{type:'separator'},{label:'退出玄印写作',accelerator:'Cmd+Q',click:close}]},...groups]));else{owned.setMenu(null);if(platform==='win32')popup=Menu.buildFromTemplate(groups)}
 const focus=()=>{if(!exiting&&!owned.isDestroyed()){owned.show();owned.focus()}};app.on('second-instance',focus);app.on('activate',focus);owned.once('ready-to-show',focus);await owned.loadURL('xaanink://app/');loaded=true
}
