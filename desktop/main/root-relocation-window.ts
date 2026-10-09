import {app,BrowserWindow,dialog,ipcMain,Menu,nativeTheme,session,type IpcMainInvokeEvent,type MenuItemConstructorOptions} from 'electron'
import {randomUUID} from 'node:crypto'
import {lstatSync,realpathSync} from 'node:fs'
import {join} from 'node:path'
import {RootRelocationController} from './root-relocation-controller'
import {rootRelocationPreflight,type RootRelocationPreflight} from './root-relocation-preflight'
import {prepareSessionDirectory} from './session-directory'
import {staticUiResponse} from './static-ui'
import type {RootRelocationCommand} from '../shared/root-relocation'
import {nativeWindowAppearance,syncNativeThemeSource} from './window-appearance'

/** Separate first-turn entry: never imports/constructs the service worker, model
 * vault or workbench bridge. Caller already holds the stable instance lock. */
export async function launchRootRelocation(bootstrap:string,_initial:RootRelocationPreflight):Promise<void>{
 const assertLock=()=>{if(!app.hasSingleInstanceLock())throw Error('LOCK_REQUIRED')}
 assertLock()
 // Recompute authority, rather than trusting a cached startup classification.
 const initial=rootRelocationPreflight(bootstrap)
 if(initial.mode==='none')throw Error('ROOT_RELOCATION_NOT_REQUIRED')
 const before=lstatSync(bootstrap,{bigint:true})
 if(!before.isDirectory()||before.isSymbolicLink()||realpathSync(bootstrap)!==bootstrap)throw Error('BOOTSTRAP_UNSAFE')
 const identity={path:bootstrap,device:String(before.dev),inode:String(before.ino)}
 const profile=prepareSessionDirectory(bootstrap)
 app.setPath('sessionData',profile)
 let current:BrowserWindow|null=null,exiting=false,closeFlight:Promise<void>|null=null,ownerAlive=true,loaded=false
 const assertCold=()=>{
  assertLock()
  if(app.getPath('sessionData')!==profile)throw Error('SOURCE_NOT_CLOSED')
  for(const window of BrowserWindow.getAllWindows())if(!window.isDestroyed()&&(window!==current||window.webContents.session.storagePath!==null))throw Error('SOURCE_NOT_CLOSED')
 }
 await app.whenReady()
 assertCold()
 const isolated=session.fromPartition('xaanink-root-relocation',{cache:false})
 if(isolated.storagePath!==null)throw Error('RELOCATION_SESSION_NOT_ISOLATED')
 isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
 isolated.setPermissionCheckHandler(()=>false)
 isolated.webRequest.onBeforeRequest((details,callback)=>{
  let allowed=false;try{allowed=['xaanink:','data:','blob:','devtools:'].includes(new URL(details.url).protocol)}catch{}
  callback({cancel:!allowed})
 })
 isolated.protocol.handle('xaanink',request=>staticUiResponse(request,join(app.getAppPath(),'out')))
 const theme=nativeTheme.shouldUseDarkColors?'ink':'paper'
 syncNativeThemeSource(nativeTheme,theme)
 const nativeAppearance=nativeWindowAppearance(theme,nativeTheme.shouldUseDarkColors)
 const platform=process.platform==='win32'?'win32':process.platform==='darwin'?'darwin':'linux'
 current=new BrowserWindow({width:680,height:540,minWidth:360,minHeight:440,show:false,title:'定位原数据目录 · 玄印写作',backgroundColor:nativeAppearance.backgroundColor,titleBarStyle:'hidden',trafficLightPosition:{x:14,y:14},...(process.platform==='win32'?{titleBarOverlay:nativeAppearance.titleBarOverlay}:{}),webPreferences:{session:isolated,preload:join(__dirname,'../preload/root-relocation.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}})
 const owned=current,owner=randomUUID(),contentsId=owned.webContents.id
 const assertOwner=(nonce:string)=>{assertCold();if(nonce!==owner||!ownerAlive||current!==owned||owned.isDestroyed()||owned.webContents.id!==contentsId)throw Error('OWNER_EXPIRED')}
 const controller=new RootRelocationController({bootstrap:identity,mode:initial.mode,theme,sourcePath:initial.pointer?.root.path??null,notice:'pointer-invalid',assertStableLock:assertLock,assertCold,assertOwner,
  chooseDirectory:async nonce=>{
   assertOwner(nonce)
   const result=await dialog.showOpenDialog(owned,{title:'定位原数据目录',buttonLabel:'选择原目录',properties:['openDirectory']})
   assertOwner(nonce)
   if(result.canceled)return null
   if(!Array.isArray(result.filePaths)||result.filePaths.length!==1||typeof result.filePaths[0]!=='string')throw Error('NATIVE_DIRECTORY_INVALID')
   return result.filePaths[0]
  },
  confirm:async preview=>{
   assertOwner(owner)
   const result=await dialog.showMessageBox(owned,{type:'question',title:'确认原数据目录',message:'使用找到的原数据目录并重新打开应用？',detail:`原目录：${preview.source.root.path}\n所选目录：${preview.target.path}\n\n仅接受同一原物理目录，不会复制、清理或恢复副本。\n保留 ${preview.unreadMigrationResults} 条未读迁移结果，重新打开后仍需明确确认。`,buttons:['使用原目录并重新打开','取消'],defaultId:1,cancelId:1,noLink:true})
   assertOwner(owner)
   if(result.response!==0&&result.response!==1)throw Error('INVALID_CONFIRMATION')
   return result.response===0
  },
  restart:async()=>{assertOwner(owner);exiting=true;app.relaunch();app.quit()},
  quit:async()=>{assertCold();exiting=true;app.quit()},
 })
 const trusted=(event:IpcMainInvokeEvent)=>{
  if(!ownerAlive||current!==owned||owned.isDestroyed()||event.sender!==owned.webContents||event.senderFrame!==owned.webContents.mainFrame||event.senderFrame.url!=='xaanink://app/')throw Error('UNTRUSTED_RELOCATION_REQUEST')
 }
 const state=()=>({...controller.state(),platform})
 let popup:ReturnType<typeof Menu.buildFromTemplate>|null=null
 ipcMain.handle('desktop:relocation-state',event=>{trusted(event);return state()})
 ipcMain.handle('desktop:relocation-command',async(event,input:unknown)=>{
  trusted(event)
  if(typeof input!=='string'||!['choose','cancel','restart','quit','menu'].includes(input))throw Error('INVALID_RELOCATION_COMMAND')
  const action=input as RootRelocationCommand
  if(action==='menu'){assertOwner(owner);if(platform!=='win32'||!popup||exiting)throw Error('INVALID_RELOCATION_COMMAND');popup.popup({window:owned});return}
  try{if(action==='choose')await controller.choose(owner);else if(action==='cancel')await controller.cancel(owner);else if(action==='restart')await controller.restart(owner);else await controller.quit(owner)}
  catch{throw Error('RELOCATION_COMMAND_NOT_COMPLETED')}
 })
 const close=()=>{
  if(closeFlight||exiting)return
  const flight=Promise.resolve().then(()=>controller.quit(owner)).catch(()=>{}).finally(()=>{if(closeFlight===flight)closeFlight=null})
  closeFlight=flight
 }
 owned.webContents.setWindowOpenHandler(()=>({action:'deny'}))
 owned.webContents.on('will-navigate',event=>event.preventDefault())
 owned.webContents.on('will-attach-webview',event=>event.preventDefault())
 // A new document/render process cannot inherit the original native attempt.
 owned.webContents.on('did-start-navigation',(details,_url,isInPlace,isMainFrame)=>{
  // Electron44 typings expose isSameDocument; installed native44 still also
  // supplies legacy isInPlace (including hydration replaceState). An explicit
  // new details value takes precedence; only strict true retains authority.
  const sameDocument=details.isSameDocument??isInPlace,mainFrame=details.isMainFrame??isMainFrame
  if(loaded&&mainFrame!==false&&sameDocument!==true){ownerAlive=false;close()}
 })
 owned.webContents.on('render-process-gone',()=>{ownerAlive=false;close()})
 owned.on('close',event=>{if(!exiting){event.preventDefault();close()}})
 const unsubscribe=controller.subscribe(()=>{if(ownerAlive&&!owned.isDestroyed())owned.webContents.send('desktop:relocation-event',state())})
 owned.on('closed',()=>{ownerAlive=false;unsubscribe();current=null;if(!exiting)close()})
 app.on('before-quit',event=>{if(!exiting){event.preventDefault();close()}})
 const focus=()=>{if(!exiting&&!owned.isDestroyed()){owned.show();owned.focus()}}
 app.on('second-instance',focus);app.on('activate',focus)
 const safe=(action:()=>void)=>()=>{try{assertOwner(owner);if(!exiting)action()}catch{/* Fixed native actions cannot transfer authority to another window. */}}
 const about=safe(()=>{
  if(platform==='darwin'){app.setAboutPanelOptions({applicationName:'玄印写作',applicationVersion:app.getVersion()});app.showAboutPanel()}
  else void dialog.showMessageBox(owned,{type:'info',title:'关于玄印写作',message:'玄印写作',detail:`当前版本：${app.getVersion()}`,buttons:['关闭'],noLink:true}).catch(()=>{})
 })
 // Native menu templates stay in main. No renderer template, command ID or
 // path is accepted, and quit/close both use the same physical-IO drain.
 const groups:MenuItemConstructorOptions[]=[
  {label:'文件',submenu:[{label:'新建作品',enabled:false},...(platform==='darwin'?[]:[{label:'退出玄印',click:close}])]},
  {label:'编辑',submenu:[{label:'撤销',role:'undo'},{label:'重做',role:'redo'},{type:'separator'},{label:'剪切',role:'cut'},{label:'复制',role:'copy'},{label:'粘贴',role:'paste'},{label:'全选',role:'selectAll'}]},
  {label:'视图',submenu:[{label:'实际大小',role:'resetZoom'},{label:'放大',role:'zoomIn'},{label:'缩小',role:'zoomOut'},{type:'separator'},{label:'进入全屏',role:'togglefullscreen'}]},
  {label:'窗口',submenu:[{label:'最小化',click:safe(()=>owned.minimize())},{label:'关闭窗口',click:safe(close)}]},
  {label:'帮助',submenu:[{label:'关于玄印写作',click:about},{label:'帮助文档',enabled:false}]},
 ]
 if(platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'玄印',submenu:[{label:'关于玄印写作',click:about},{type:'separator'},{label:'隐藏玄印',role:'hide'},{label:'隐藏其他',role:'hideOthers'},{label:'显示全部',role:'unhide'},{type:'separator'},{label:'退出玄印',accelerator:'Cmd+Q',click:close}]},...groups]))
 else{owned.setMenu(null);if(platform==='win32')popup=Menu.buildFromTemplate(groups)}
 owned.once('ready-to-show',()=>{if(!exiting&&!owned.isDestroyed())owned.show()})
 // Reserve owner synchronously before load/ready/close callbacks can run.
 const started=controller.start(owner);void started.catch(()=>{})
 await owned.loadURL('xaanink://app/');loaded=true
 await started
}
