import {app,BrowserWindow,ipcMain,Menu,nativeTheme,session,type IpcMainInvokeEvent} from 'electron'
import {join} from 'node:path'
import {z} from 'zod'
import {DataRootManager} from '../core/data-root'
import {readMetadata} from '../core/root-ownership'
import {RootMigrationRequests} from './root-migration-request'
import {RootMaintenanceRunner} from './root-maintenance-runner'
import {prepareSessionDirectory} from './session-directory'
import {staticUiResponse} from './static-ui'
import {nativeWindowAppearance,syncNativeThemeSource} from './window-appearance'
/** Separate process entry. Never constructs the workspaces worker or model vault. */
export async function launchRootMaintenance(bootstrap:string,defaultRoot:string){
 // Must run in the first synchronous turn, before Chromium's ready event.
 const profile=prepareSessionDirectory(bootstrap)
 app.setPath('sessionData',profile)
 let current:BrowserWindow|null=null,exiting=false,closeFlight:Promise<void>|null=null
 const assertLock=()=>{if(!app.hasSingleInstanceLock())throw Error('LOCK_REQUIRED')}
 const manager=new DataRootManager(bootstrap,defaultRoot)
 const requests=new RootMigrationRequests(bootstrap,{resolveSource:()=>manager.resolve(),assertStableLock:assertLock,assertOwner(){throw Error('NO_WORKBENCH_OWNER')},assertClosed:()=>assertClosed()})
 const assertClosed=()=>{
  assertLock()
  if(app.getPath('sessionData')!==profile)throw Error('SOURCE_NOT_CLOSED')
  for(const owned of BrowserWindow.getAllWindows())if(owned!==current||owned.webContents.session.storagePath!==null)throw Error('SOURCE_NOT_CLOSED')
 }
 await app.whenReady()
 const isolated=session.fromPartition('xaanink-maintenance',{cache:false})
 if(isolated.storagePath!==null)throw Error('MAINTENANCE_SESSION_NOT_ISOLATED')
 isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
 isolated.setPermissionCheckHandler(()=>false)
 isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!['xaanink:','data:','blob:','devtools:'].includes(new URL(details.url).protocol)}))
 isolated.protocol.handle('xaanink',request=>staticUiResponse(request,join(app.getAppPath(),'out')))
 let theme:'paper'|'ink'=nativeTheme.shouldUseDarkColors?'ink':'paper'
 try{const root=await manager.resolve();if(root.state==='existing'){const state=await readMetadata(join(root.pointer.root.path,'state.json')) as {value?:{settings?:{appearance?:{theme?:string}}}};const choice=state.value?.settings?.appearance?.theme;if(choice==='paper'||choice==='ink')theme=choice}}catch{ /* The runner presents the authoritative failure without opening a fallback. */ }
 const runner=new RootMaintenanceRunner({requests,bootstrap,defaultRoot,theme,host:{assertMaintenanceClosed:assertClosed},onContinue:async()=>{assertLock();app.relaunch();exiting=true;app.quit()},onQuit:async()=>{exiting=true;app.quit()}})
 const trusted=(event:IpcMainInvokeEvent)=>{if(!current||current.isDestroyed()||event.sender!==current.webContents||event.senderFrame!==current.webContents.mainFrame||event.senderFrame.url!=='xaanink://app/')throw Error('UNTRUSTED_MAINTENANCE_REQUEST')}
 ipcMain.handle('desktop:maintenance-state',event=>{trusted(event);return runner.state()})
 ipcMain.handle('desktop:maintenance-command',async(event,input)=>{trusted(event);const command=z.enum(['cancel','continue','quit']).parse(input);if(command==='cancel')await runner.cancel();else if(command==='continue')await runner.continue();else await runner.quit()})
 const close=()=>{
  if(closeFlight)return
  closeFlight=(async()=>{const snapshot=runner.state();if(snapshot.canCancel)await runner.cancel();await runner.quit()})().catch(()=>{}).finally(()=>{closeFlight=null})
 }
 syncNativeThemeSource(nativeTheme,theme)
 const nativeAppearance=nativeWindowAppearance(theme,nativeTheme.shouldUseDarkColors)
 current=new BrowserWindow({width:680,height:510,minWidth:560,minHeight:440,show:false,title:'迁移应用数据 · 玄印写作',backgroundColor:nativeAppearance.backgroundColor,titleBarStyle:'hidden',trafficLightPosition:{x:14,y:14},...(process.platform==='win32'?{titleBarOverlay:nativeAppearance.titleBarOverlay}:{}),webPreferences:{session:isolated,preload:join(__dirname,'../preload/maintenance.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}})
 const owned=current
 owned.webContents.setWindowOpenHandler(()=>({action:'deny'}))
 owned.webContents.on('will-navigate',event=>event.preventDefault())
 owned.webContents.on('will-attach-webview',event=>event.preventDefault())
 owned.on('close',event=>{if(!exiting){event.preventDefault();close()}})
 const unsubscribe=runner.subscribe(state=>{if(!owned.isDestroyed())owned.webContents.send('desktop:maintenance-event',state)})
 owned.on('closed',()=>{unsubscribe();current=null})
 app.on('before-quit',event=>{if(!exiting){event.preventDefault();close()}})
 app.on('second-instance',()=>{owned.show();owned.focus()})
 app.on('activate',()=>{owned.show();owned.focus()})
 if(process.platform==='darwin')Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'玄印',submenu:[{label:'关于玄印写作',click:()=>{app.setAboutPanelOptions({applicationName:'玄印写作',applicationVersion:app.getVersion()});app.showAboutPanel()}},{type:'separator'},{label:'退出玄印',click:close}]},...['文件','编辑','视图','窗口','帮助'].map(label=>({label,submenu:[]}))]))
 else owned.setMenu(null)
 owned.once('ready-to-show',()=>owned.show())
 await owned.loadURL('xaanink://app/')
 void runner.start()
}
