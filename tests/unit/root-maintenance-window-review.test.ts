import assert from 'node:assert/strict'
import {test} from 'node:test'
import {EventEmitter} from 'node:events'
import {mkdtemp,mkdir,realpath,rm,writeFile,readFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {build,transformSync} from 'esbuild'
import ts from 'typescript'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import type {RootMaintenanceRunnerOptions} from '../../desktop/main/root-maintenance-runner'
import type {RootMaintenanceState} from '../../desktop/shared/root-maintenance'

// The actual maintenance-window module runs with real DataRoot/FS/static UI.
// Electron surfaces and runner IO are controlled. This is not an Electron run.
const require=createRequire(import.meta.url)
const windowBundle=build({entryPoints:['desktop/main/root-maintenance-window.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,
 plugins:[{name:'controlled-runner',setup(plugin){plugin.onResolve({filter:/^\.\/root-maintenance-runner$/},()=>({path:'review:runner',external:true}))}}],
}).then(result=>result.outputFiles[0].text)
const initial:RootMaintenanceState={version:1,revision:0,phase:'preparing',theme:'paper',sourcePath:null,targetPath:null,copiedFiles:0,totalFiles:null,canCancel:true,canContinue:false,pendingCount:0}
async function fixture(persistentPartition=false){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-window71-'))),bootstrap=join(base,'bootstrap'),source=join(base,'source'),out=join(base,'out')
 for(const path of [bootstrap,source,out])await mkdir(path)
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:false}))
 await writeFile(join(source,'state.json'),JSON.stringify({value:{settings:{appearance:{theme:'paper'}}}}))
 await new DataRootManager(bootstrap,source).adopt(await directoryIdentity(source));await writeFile(join(out,'index.html'),'<p>static maintenance</p>')
 const before=await readFile(join(source,'state.json')),trace:string[]=[],ready=Promise.withResolvers<void>(),cancelGate=Promise.withResolvers<void>(),handlers=new Map<string,(...args:any[])=>any>(),instances:any[]=[],paths=new Map<string,string>(),listeners=new Set<(state:RootMaintenanceState)=>void>()
 let options!:RootMaintenanceRunnerOptions,blockedCancel=false,lock=true,network:((details:{url:string},cb:(v:{cancel:boolean})=>void)=>void)|undefined,permissionRequest:any,permissionCheck:any,staticHandler:((request:Request)=>Promise<Response>)|undefined
 const isolated={storagePath:persistentPartition?join(base,'persistent-partition'):null,setPermissionRequestHandler:(value:any)=>{permissionRequest=value},setPermissionCheckHandler:(value:any)=>{permissionCheck=value},webRequest:{onBeforeRequest:(value:any)=>{network=value}},protocol:{handle:(name:string,handler:(request:Request)=>Promise<Response>)=>{assert.equal(name,'xaanink');staticHandler=handler}}}
 const app=Object.assign(new EventEmitter(),{setPath:(key:string,value:string)=>{paths.set(key,value);trace.push(`path:${key}`)},getPath:(key:string)=>paths.get(key),hasSingleInstanceLock:()=>lock,whenReady:()=>{trace.push('whenReady');return ready.promise},getAppPath:()=>base,getVersion:()=> '0.1.0',setAboutPanelOptions(){},showAboutPanel(){},relaunch:()=>trace.push('relaunch'),quit:()=>trace.push('quit')})
 let nativeSource:'light'|'dark'|'system'='system'
 const nativeTheme={get themeSource(){return nativeSource},set themeSource(value:'light'|'dark'|'system'){nativeSource=value},get shouldUseDarkColors(){return nativeSource!=='light'}}
 class Window extends EventEmitter{
  static getAllWindows(){return instances}
  destroyed=false;preferences:any;webContents:any;nativeSourceAtConstruction=nativeTheme.themeSource
  constructor(value:any){super();this.preferences=value;this.webContents=Object.assign(new EventEmitter(),{mainFrame:{url:'xaanink://app/'},session:value.webPreferences.session,send:(..._args:unknown[])=>trace.push('send'),setWindowOpenHandler:(cb:()=>unknown)=>{this.webContents.openHandler=cb}});instances.push(this);trace.push('window')}
  isDestroyed(){return this.destroyed}setMenu(){}show(){trace.push('show')}focus(){trace.push('focus')}async loadURL(url:string){assert.equal(url,'xaanink://app/');trace.push('load')}
 }
 class Runner{
  constructor(value:RootMaintenanceRunnerOptions){options=value;trace.push('runner')}
  state(){return{...initial}}
  subscribe(callback:(state:RootMaintenanceState)=>void){listeners.add(callback);return()=>listeners.delete(callback)}
  async start(){trace.push('start')}
  async cancel(){trace.push('cancel');if(blockedCancel)await cancelGate.promise;trace.push('cancel-done')}
  async continue(){await options.onContinue()}
  async quit(){trace.push('runner-quit');await options.onQuit()}
 }
 const electron={app,BrowserWindow:Window,ipcMain:{handle:(id:string,callback:(...args:any[])=>any)=>handlers.set(id,callback)},Menu:{buildFromTemplate:(value:unknown)=>value,setApplicationMenu(){}},nativeTheme,session:{fromPartition:(name:string,configuration:unknown)=>{assert.equal(name,'xaanink-maintenance');assert.deepEqual(configuration,{cache:false});trace.push('partition');return isolated},get defaultSession(){throw Error('maintenance must not touch source defaultSession')}}}
 const module={exports:{} as {launchRootMaintenance(bootstrap:string,root:string):Promise<void>}}
 new Function('module','exports','require','__dirname',await windowBundle)(module,module.exports,(id:string)=>id==='electron'?electron:id==='review:runner'?{RootMaintenanceRunner:Runner}:require(id),join(base,'bundle/main'))
 const launched=module.exports.launchRootMaintenance(bootstrap,source);void launched.catch(()=>{})
 return{base,bootstrap,source,out,before,trace,ready,launched,app,instances,handlers,paths,listeners,
  get options(){return options},get staticHandler(){return staticHandler!},get permissionRequest(){return permissionRequest},get permissionCheck(){return permissionCheck},get network(){return network!},
  blockCancel(){blockedCancel=true},releaseCancel(){cancelGate.resolve()},loseLock(){lock=false},
  async close(){cancelGate.resolve();ready.resolve();await launched.catch(()=>{});await rm(base,{recursive:true,force:true})},
 }
}

test('WCO-F03 maintenance uses its saved paper snapshot for the native source before construction on a dark OS',async()=>{
 const r=await fixture();try{r.ready.resolve();await r.launched;assert.equal(r.options.theme,'paper');assert.equal(r.instances[0].nativeSourceAtConstruction,'light');assert.equal(r.instances[0].preferences.backgroundColor,'#f4edda');assert.deepEqual(await readFile(join(r.source,'state.json')),r.before)}finally{await r.close()}
})

test('W71-01: actual maintenance launch synchronously selects bootstrap profile and creates only a memory session, without opening source session',async()=>{
 const r=await fixture()
 try{
  assert.equal(r.paths.get('sessionData'),join(r.bootstrap,'session'));assert.deepEqual(r.trace,['path:sessionData','whenReady']);assert.equal(r.instances.length,0)
  assert.deepEqual(await readdir(r.source),['state.json','xuanxiang-app.json']);r.ready.resolve();await r.launched
  const owned=r.instances[0];assert.equal(owned.preferences.webPreferences.session.storagePath,null);assert.equal(owned.preferences.webPreferences.nodeIntegration,false);assert.equal(owned.preferences.webPreferences.contextIsolation,true);assert.equal(owned.preferences.webPreferences.sandbox,true);assert.equal(owned.preferences.webPreferences.webSecurity,true);assert.match(owned.preferences.webPreferences.preload,/preload[\\/]maintenance\.cjs$/)
  assert.equal(owned.preferences.backgroundColor,'#f4edda','actual saved theme wins over system dark');assert.deepEqual(await readdir(r.source),['state.json','xuanxiang-app.json']);assert.deepEqual(await readFile(join(r.source,'state.json')),r.before)
  r.options.host.assertMaintenanceClosed();r.instances.push({webContents:{session:{storagePath:null}}});assert.throws(()=>r.options.host.assertMaintenanceClosed(),/SOURCE_NOT_CLOSED/);r.instances.pop();owned.webContents.session={storagePath:'/source/session'};assert.throws(()=>r.options.host.assertMaintenanceClosed(),/SOURCE_NOT_CLOSED/)
 }finally{await r.close()}
})

test('W71-02: maintenance IPC accepts only current main frame and its narrow actions, while native navigation/network/permissions are denied',async()=>{
 const r=await fixture();r.ready.resolve();await r.launched
 try{
  const owned=r.instances[0],event={sender:owned.webContents,senderFrame:owned.webContents.mainFrame},state=r.handlers.get('desktop:maintenance-state')!,command=r.handlers.get('desktop:maintenance-command')!
  assert.deepEqual([...r.handlers.keys()],['desktop:maintenance-state','desktop:maintenance-command']);assert.equal(state(event).version,1)
  for(const bad of [{...event,sender:{}},{...event,senderFrame:{url:'xaanink://app/'}},{...event,senderFrame:{url:'file:///source/state.json'}}])assert.throws(()=>state(bad),/UNTRUSTED_MAINTENANCE_REQUEST/)
  for(const action of ['start','settings',{type:'continue'}])await assert.rejects(command(event,action));assert.ok(!r.trace.includes('relaunch'))
  const frame=owned.webContents.mainFrame;frame.url='xaanink://app/?other-document';assert.throws(()=>state(event),/UNTRUSTED/);frame.url='xaanink://app/'
  assert.deepEqual(owned.webContents.openHandler(),{action:'deny'});let prevented=0;for(const name of ['will-navigate','will-attach-webview'])owned.webContents.emit(name,{preventDefault(){prevented++}});assert.equal(prevented,2)
  let allowed=true;r.permissionRequest(owned.webContents,'local-fonts',(value:boolean)=>{allowed=value});assert.equal(allowed,false);assert.equal(r.permissionCheck(),false)
  for(const url of ['https://provider.invalid/v1','file:///source/state.json'])r.network({url},value=>assert.equal(value.cancel,true))
  r.network({url:'xaanink://app/'},value=>assert.equal(value.cancel,false));assert.equal((await r.staticHandler(new Request('xaanink://app/'))).status,200);assert.equal((await r.staticHandler(new Request('xaanink://asset/global/'+randomUUID()))).status,403);assert.equal((await r.staticHandler(new Request('xaanink://app/api/models'))).status,404)
  owned.destroyed=true;assert.throws(()=>state(event),/UNTRUSTED/)
 }finally{await r.close()}
})

test('W71-03: native window close and before-quit share cancellation wait; continue only schedules cold relaunch and requires lock',async()=>{
 const r=await fixture();r.ready.resolve();await r.launched
 try{
  r.blockCancel();let prevented=0;r.instances[0].emit('close',{preventDefault(){prevented++}});r.app.emit('before-quit',{preventDefault(){prevented++}})
  await new Promise(setImmediate);assert.equal(prevented,2);assert.equal(r.trace.filter(value=>value==='cancel').length,1);assert.ok(!r.trace.includes('runner-quit'));assert.ok(!r.trace.includes('quit'))
  r.releaseCancel();await new Promise(setImmediate);assert.deepEqual(r.trace.slice(-3),['cancel-done','runner-quit','quit'])
  const before=r.trace.length;await r.options.onContinue();assert.deepEqual(r.trace.slice(before),['relaunch','quit']);r.loseLock();await assert.rejects(r.options.onContinue(),/LOCK_REQUIRED/)
 }finally{await r.close()}
})

test('W71-04: a disk-backed maintenance partition fails closed before creating a window or registering IPC',async()=>{
 const r=await fixture(true)
 try{r.ready.resolve();await assert.rejects(r.launched,/MAINTENANCE_SESSION_NOT_ISOLATED/);assert.equal(r.instances.length,0);assert.equal(r.handlers.size,0);assert.deepEqual(await readdir(r.source),['state.json','xuanxiang-app.json'])}finally{await r.close()}
})

test('W71-05: actual restricted preload exposes only state/actions/subscription and cleans its event listener',async()=>{
 const result=await build({entryPoints:['desktop/preload/maintenance.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false}),module={exports:{}},ipc=new EventEmitter(),calls:unknown[][]=[],exposed=new Map<string,any>()
 const electron={contextBridge:{exposeInMainWorld:(name:string,bridge:unknown)=>exposed.set(name,bridge)},ipcRenderer:Object.assign(ipc,{invoke:async(...args:unknown[])=>{calls.push(args);return true}})}
 new Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,(id:string)=>id==='electron'?electron:require(id))
 assert.deepEqual([...exposed.keys()],['desktopMaintenance']);const bridge=exposed.get('desktopMaintenance');assert.deepEqual(Object.keys(bridge).sort(),['command','state','subscribe'])
 await bridge.state();await bridge.command('cancel');assert.deepEqual(calls,[['desktop:maintenance-state'],['desktop:maintenance-command','cancel']]);let progress=0;const dispose=bridge.subscribe(()=>{progress++});ipc.emit('desktop:maintenance-event',{},initial);assert.equal(progress,1);dispose();ipc.emit('desktop:maintenance-event',{},initial);assert.equal(progress,1);assert.equal(ipc.listenerCount('desktop:maintenance-event'),0)
})

test('W71-06: actual main startup branch dispatches preflight maintenance before launch and never opens workbench for uncertain state',async()=>{
 const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true),branch=source.statements.at(-1);assert.ok(branch&&ts.isIfStatement(branch));const code=transformSync(branch.getText(source),{loader:'ts'}).code
 for(const state of ['maintenance','ordinary','lock-denied']as const){
  const calls:string[]=[],app={requestSingleInstanceLock:()=>state!=='lock-denied',hasSingleInstanceLock:()=>true,quit:()=>calls.push('quit'),exit:()=>calls.push('exit')}
  const dependencies={app,startupPaths:{defaultRoot:'/test/data'},startupSelectionError:null,rootMaintenanceRequired:()=>{calls.push('preflight');return state==='maintenance'},launchRootMaintenance:async()=>{calls.push('maintenance')},launch:async()=>{calls.push('workbench')},bootstrapPath:'/test/bootstrap',isolatedRoot:null,dialog:{showErrorBox(){throw Error('unexpected failure')}},rootRelocationPreflight:()=>({mode:'none',pointer:null}),launchRootRelocation:async()=>{throw Error('unexpected relocation')},assertNoLegacyBackupRecovery:()=>{},inboxLeaseRecoveryRequired:()=>false,launchInboxLeaseRecovery:async()=>{throw Error('unexpected inbox repair')}}
  new Function(...Object.keys(dependencies),code)(...Object.values(dependencies));await new Promise(setImmediate)
  assert.deepEqual(calls,state==='maintenance'?['preflight','maintenance']:state==='ordinary'?['preflight','workbench']:['quit'])
 }
})
