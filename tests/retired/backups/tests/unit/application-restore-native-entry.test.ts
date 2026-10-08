import assert from 'node:assert/strict'
import {test} from 'node:test'
import {EventEmitter} from 'node:events'
import {createRequire} from 'node:module'
import {join,dirname} from 'node:path'
import {rename,mkdir,writeFile,readFile,readdir} from 'node:fs/promises'
import {build} from 'esbuild'
import {entryFixture,armedEntryChild} from '../fixtures/application-restore-entry'
import type {ApplicationRestoreEntryState} from '../../desktop/shared/application-restore-entry'
const require=createRequire(import.meta.url)
const bundle=build({entryPoints:['desktop/main/application-restore-window.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false}).then(result=>result.outputFiles[0].text)
async function nativeFixture(platform='darwin',armed=false){
 const f=await entryFixture();if(!armed)await rename(f.source,f.source+'.preserved');else{const child=await armedEntryChild(f);await child.stop()}
 await mkdir(join(f.root,'out'));await writeFile(join(f.root,'out/index.html'),'<p>restricted recovery</p>')
 const trace:string[]=[],ready=Promise.withResolvers<void>(),workerCreated=Promise.withResolvers<void>(),pick=Promise.withResolvers<{canceled:boolean;filePaths:string[]}>(),handlers=new Map<string,(...args:any[])=>any>(),instances:any[]=[],workers:any[]=[],paths=new Map<string,string>();let network:any,applicationMenu:any,popupMenu:any,locked=true
 const isolated={storagePath:null,setPermissionRequestHandler(){},setPermissionCheckHandler(){},flushStorageData:async()=>{trace.push('flush-storage')},webRequest:{onBeforeRequest:(callback:any)=>network=callback},protocol:{handle:(name:string)=>assert.equal(name,'xuanxiang')}}
 const app=Object.assign(new EventEmitter(),{setPath(key:string,path:string){paths.set(key,path);trace.push('setPath')},getPath:(key:string)=>paths.get(key),hasSingleInstanceLock:()=>locked,whenReady:()=>ready.promise,getAppPath:()=>f.root,relaunch(){trace.push('relaunch')},quit(){trace.push('quit')},getVersion:()=>'0.1.0',setAboutPanelOptions(){trace.push('about-options')},showAboutPanel(){trace.push('about')}})
 class Window extends EventEmitter{
  static getAllWindows(){return instances.filter(row=>!row.destroyed)}destroyed=false;preferences:any;webContents:any
  constructor(value:any){super();this.preferences=value;this.webContents=Object.assign(new EventEmitter(),{mainFrame:{url:'xaanink://app/'},session:value.webPreferences.session,send(){},setWindowOpenHandler:(callback:any)=>this.webContents.openHandler=callback});instances.push(this);trace.push('window')}
  isDestroyed(){return this.destroyed}destroy(){if(this.destroyed)return;this.destroyed=true;trace.push('destroy');this.emit('closed')}setMenu(){}minimize(){}show(){}focus(){}async loadURL(url:string){assert.equal(url,'xaanink://app/');trace.push('load')}
 }
 class Worker extends EventEmitter{input:any;constructor(_path:string,value:any){super();this.input=value.workerData;workers.push(this);trace.push('worker');workerCreated.resolve()}postMessage(message:any){if(message.type==='cancel')trace.push('worker-cancel')}}
 const electron={app,BrowserWindow:Window,nativeTheme:{shouldUseDarkColors:false},session:{fromPartition(name:string,value:any){assert.match(name,/^application-recovery-[a-f0-9-]{36}$/);assert.deepEqual(value,{cache:false});return isolated},get defaultSession(){throw Error('must not access ordinary persistent session')}},ipcMain:{handle:(name:string,callback:any)=>handlers.set(name,callback),removeHandler:(name:string)=>handlers.delete(name)},dialog:{showOpenDialog:()=>pick.promise,showMessageBox:async(_window:any,input:any)=>{if(input.type==='info'){trace.push('about-box');return{response:0}}assert.equal(input.defaultId,1);assert.equal(input.cancelId,1);return{response:1}}},Menu:{buildFromTemplate:(items:any)=>({items,popup(){popupMenu=items}}),setApplicationMenu:(menu:any)=>applicationMenu=menu.items}}
 const module={exports:{} as {launchApplicationRestoreWindow(path:string,root:undefined,initial:unknown):Promise<void>}}
 new Function('module','exports','require','__dirname','process',await bundle)(module,module.exports,(id:string)=>id==='electron'?electron:id==='node:worker_threads'?{...require(id),Worker}:require(id),join(f.root,'bundle/main'),{...process,platform})
 const launched=module.exports.launchApplicationRestoreWindow(f.boot,undefined,{reason:armed?'handoff':'lost',onLocate:async()=>{trace.push('locate')}});void launched.catch(()=>{})
 const event=()=>({sender:instances[0].webContents,senderFrame:instances[0].webContents.mainFrame}),state=()=>handlers.get('desktop:application-recovery-state')!(event()) as ApplicationRestoreEntryState,command=(input:unknown,override?:unknown)=>handlers.get('desktop:application-recovery-command')!(override??event(),input)
 return{...f,trace,ready,workerCreated:workerCreated.promise,pick,handlers,instances,workers,paths,launched,state,command,get applicationMenu(){return applicationMenu},get popupMenu(){return popupMenu},get network(){return network},loseLock(){locked=false},async close(){pick.resolve({canceled:true,filePaths:[]});ready.resolve();await launched.catch(()=>{});await f.close()}}
}
test('ENTRY36-N01 actual restricted window selects unique bootstrap cache before readiness and has only fixed trusted IPC',{timeout:20000},async()=>{
 const f=await nativeFixture()
 try{
  assert.equal(dirname(f.paths.get('sessionData')!),join(f.boot,'session'));assert.equal(f.instances.length,0);f.ready.resolve();await f.launched
  const window=f.instances[0],preferences=window.preferences.webPreferences;assert.equal(preferences.session.storagePath,null);assert.equal(preferences.nodeIntegration,false);assert.equal(preferences.contextIsolation,true);assert.equal(preferences.sandbox,true)
  assert.deepEqual([...f.handlers.keys()],['desktop:application-recovery-state','desktop:application-recovery-command']);assert.equal(f.state().canLocate,true)
  for(const event of[{sender:{},senderFrame:window.webContents.mainFrame},{sender:window.webContents,senderFrame:{url:'xaanink://app/'}}])assert.throws(()=>f.handlers.get('desktop:application-recovery-state')!(event),/UNTRUSTED/)
  await assert.rejects(f.command({type:'choose-backup',path:f.backup}));assert.deepEqual(window.webContents.openHandler(),{action:'deny'})
  for(const url of['https://provider.invalid','file:///private/data'])f.network({url},(result:any)=>assert.equal(result.cancel,true))
  window.webContents.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});assert.throws(()=>f.state(),/UNTRUSTED/)
  for(let i=0;i<20&&!f.trace.includes('quit');i++)await new Promise(setImmediate);assert.equal(f.trace.includes('quit'),true)
 }finally{await f.close()}
})
test('ENTRY36-N02 mac six and Windows five native menu groups preserve actual native about and menu remains fixed',{timeout:20000},async()=>{
 for(const platform of['darwin','win32']){const f=await nativeFixture(platform)
  try{f.ready.resolve();await f.launched;if(platform==='win32')await f.command({type:'menu'});const menu=platform==='darwin'?f.applicationMenu:f.popupMenu;assert.deepEqual(menu.map((row:any)=>row.label),platform==='darwin'?['玄印','文件','编辑','视图','窗口','帮助']:['文件','编辑','视图','窗口','帮助']);await menu.find((row:any)=>row.label==='帮助').submenu.find((row:any)=>row.label==='关于玄印写作').click();assert.equal(f.trace.includes(platform==='darwin'?'about':'about-box'),true);assert.equal(menu.find((row:any)=>row.label==='文件').submenu[0].enabled,false);await assert.rejects(f.command({type:'menu',items:[]}))}finally{await f.close()}
 }
})
test('ENTRY36-N03 actual owner destruction synchronously revokes SAB; settled cancellation audit waits worker physical exit',{timeout:20000},async()=>{
 const f=await nativeFixture('darwin',true)
 try{
  f.ready.resolve();await f.launched;const operationId=f.state().operationId!,flight=f.command({type:'continue',operationId});void flight.catch(()=>{})
  await Promise.race([f.workerCreated,flight.then(()=>{throw Error('worker did not start')})]);assert.equal(f.workers.length,1);const worker=f.workers[0]
  f.instances[0].destroy();assert.equal(Atomics.load(new Int32Array(worker.input.revocation),0),1);assert.equal(f.trace.includes('quit'),false)
  worker.emit('message',{type:'failed',code:'OPERATION_CANCELLED'});await new Promise(setImmediate);assert.equal(f.trace.includes('quit'),false)
  worker.emit('exit',0);await flight.catch(()=>{});for(let i=0;i<100&&!f.trace.includes('quit');i++)await new Promise(setImmediate)
  assert.equal(f.trace.includes('quit'),true);assert.equal(JSON.parse(await readFile(join(f.boot,'application-recovery-request.json'),'utf8')).state.operations[0].phase,'cancelled');assert.equal(f.manager().startup().mode,'normal')
 }finally{await f.close()}
})
test('ENTRY36-N05 abnormal actual worker exit keeps durable unknown and safe close waits exit',{timeout:20000},async()=>{
 const f=await nativeFixture('darwin',true)
 try{
  f.ready.resolve();await f.launched;const operationId=f.state().operationId!,flight=f.command({type:'continue',operationId});void flight.catch(()=>{});await Promise.race([f.workerCreated,flight.then(()=>{throw Error('worker did not start')})]);const worker=f.workers[0]
  f.instances[0].destroy();assert.equal(f.trace.includes('quit'),false);worker.emit('error',Error('worker crash'));assert.equal(f.trace.includes('quit'),false);worker.emit('exit',1);await flight.catch(()=>{});for(let i=0;i<100&&!f.trace.includes('quit');i++)await new Promise(setImmediate)
  assert.equal(f.trace.includes('quit'),true);assert.equal(f.manager().startup().request?.phase,'unknown');assert.equal(f.manager().startup().mode,'cold')
 }finally{await f.close()}
})
test('ENTRY36-N04 actual preload accepts bounded state/fixed commands only and removes subscriptions',{timeout:15000},async()=>{
 const f=await nativeFixture();f.ready.resolve();await f.launched
 try{
  const built=await build({entryPoints:['desktop/preload/application-restore.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false}),module={exports:{}},ipc=new EventEmitter(),calls:unknown[][]=[],exposed=new Map<string,any>(),electron={contextBridge:{exposeInMainWorld:(name:string,value:unknown)=>exposed.set(name,value)},ipcRenderer:Object.assign(ipc,{invoke:async(...args:unknown[])=>{calls.push(args);return f.state()}})}
  new Function('module','exports','require',built.outputFiles[0].text)(module,module.exports,(id:string)=>id==='electron'?electron:require(id))
  assert.deepEqual([...exposed.keys()],['desktopApplicationRestore']);const bridge=exposed.get('desktopApplicationRestore');await bridge.state();await bridge.command({type:'inspect'});await assert.rejects(bridge.command({type:'choose-backup',path:'/forged'}));assert.equal(calls.length,2)
  let events=0;const remove=bridge.subscribe(()=>events++);ipc.emit('desktop:application-recovery-event',{},{});ipc.emit('desktop:application-recovery-event',{},f.state());remove();ipc.emit('desktop:application-recovery-event',{},f.state());assert.equal(events,1);assert.equal(ipc.listenerCount('desktop:application-recovery-event'),0)
 }finally{await f.close()}
})
test('ENTRY36-N06 first-turn bootstrap/cache identity stays pinned across readiness; replacement creates no window or foreign cache',{timeout:15000},async()=>{
 const f=await nativeFixture()
 try{
  const pointer=await readFile(join(f.boot,'data-root.json'));await rename(f.boot,f.boot+'.preserved');await mkdir(f.boot);await writeFile(join(f.boot,'data-root.json'),pointer);f.ready.resolve()
  await assert.rejects(f.launched);assert.equal(f.instances.length,0);assert.deepEqual(await readdir(f.boot),['data-root.json'])
 }finally{await f.close()}
})
