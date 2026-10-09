import assert from 'node:assert/strict'
import {test} from 'node:test'
import {EventEmitter} from 'node:events'
import {mkdtemp,mkdir,realpath,rm,writeFile,readFile,rename,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {rootRelocationPreflight} from '../../desktop/main/root-relocation-preflight'

// Actual window/preload/controller/DirectoryAuthority/Core31/staticUI with real
// isolated filesystem. Electron surfaces controlled; never a native app run.
const require=createRequire(import.meta.url)
const bundle=build({entryPoints:['desktop/main/root-relocation-window.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false}).then(result=>result.outputFiles[0].text)
async function fixture(mode:'lost'|'blocked'='lost',persistent=false,platform='darwin',osDark=false){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-entry33-'))),bootstrap=join(base,'bootstrap'),source=join(base,'source'),target=join(base,'moved'),out=join(base,'out')
 for(const path of[bootstrap,source,out])await mkdir(path)
 await mkdir(join(source,'inbox/database'),{recursive:true});await writeFile(join(source,'inbox/database/PG_VERSION'),'17')
 await writeFile(join(source,'catalog.json'),JSON.stringify({revision:1,value:{works:[]}}));await writeFile(join(source,'private-data'),'untouched local data')
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}))
 await new DataRootManager(bootstrap,source).adopt(await directoryIdentity(source));await rename(source,target)
 if(mode==='blocked')await writeFile(join(bootstrap,'data-root.json'),'invalid pointer')
 await writeFile(join(out,'index.html'),'<p>restricted relocation</p>')
 const pointerBefore=await readFile(join(bootstrap,'data-root.json')),trace:string[]=[],ready=Promise.withResolvers<void>(),picker=Promise.withResolvers<{canceled:boolean,filePaths:string[]}>(),handlers=new Map<string,(...args:any[])=>any>(),instances:any[]=[],paths=new Map<string,string>()
 let locked=true,confirmResponse:unknown={response:0},calls=0,network:any,requestPermission:any,checkPermission:any,staticHandler:any,applicationMenu:any,popupMenu:any
 const isolated={storagePath:persistent?join(base,'unsafe-persistent'):null,setPermissionRequestHandler:(cb:any)=>requestPermission=cb,setPermissionCheckHandler:(cb:any)=>checkPermission=cb,webRequest:{onBeforeRequest:(cb:any)=>network=cb},protocol:{handle:(name:string,cb:any)=>{assert.equal(name,'xaanink');staticHandler=cb}}}
 const app=Object.assign(new EventEmitter(),{setPath:(key:string,value:string)=>{paths.set(key,value);trace.push('setPath')},getPath:(key:string)=>paths.get(key),hasSingleInstanceLock:()=>locked,whenReady:()=>{trace.push('ready');return ready.promise},getAppPath:()=>base,relaunch:()=>trace.push('relaunch'),quit:()=>trace.push('quit'),getVersion:()=>'0.1.0',setAboutPanelOptions:()=>trace.push('about-options'),showAboutPanel:()=>trace.push('about')})
 let nativeSource:'light'|'dark'|'system'='system'
 const nativeTheme={get themeSource(){return nativeSource},set themeSource(value:'light'|'dark'|'system'){nativeSource=value},get shouldUseDarkColors(){return nativeSource==='dark'||nativeSource==='system'&&osDark}}
 class Window extends EventEmitter{
  static getAllWindows(){return instances.filter(value=>!value.destroyed)}
  destroyed=false;preferences:any;webContents:any;nativeSourceAtConstruction=nativeTheme.themeSource
  constructor(value:any){super();this.preferences=value;this.webContents=Object.assign(new EventEmitter(),{id:17,mainFrame:{url:'xaanink://app/'},session:value.webPreferences.session,send:()=>trace.push('event'),setWindowOpenHandler:(cb:any)=>this.webContents.openHandler=cb});instances.push(this);trace.push('window')}
  isDestroyed(){return this.destroyed}setMenu(){}minimize(){trace.push('minimize')}show(){trace.push('show')}focus(){}async loadURL(url:string){assert.equal(url,'xaanink://app/');trace.push('load')}
 }
 const electron={app,BrowserWindow:Window,ipcMain:{handle:(id:string,cb:any)=>handlers.set(id,cb)},Menu:{buildFromTemplate:(value:any)=>({items:value,popup:({window}:any)=>{assert.equal(window,instances[0]);popupMenu=value}}),setApplicationMenu:(value:any)=>applicationMenu=value?.items},nativeTheme,dialog:{showOpenDialog:async(_parent:any,options:any)=>{calls++;assert.deepEqual(options.properties,['openDirectory']);trace.push('picker');return picker.promise},showMessageBox:async(_parent:any,options:any)=>{if(options.type==='info'){trace.push('about-box');assert.equal(options.title,'关于玄印写作');assert.match(options.detail,/0.1.0/);return{response:0}}trace.push('confirm');assert.equal(options.defaultId,1);assert.equal(options.cancelId,1);assert.match(options.detail,/原物理目录/);assert.match(options.detail,/未读迁移结果/);return confirmResponse}},session:{fromPartition:(name:string,options:any)=>{assert.equal(name,'xaanink-root-relocation');assert.deepEqual(options,{cache:false});return isolated},get defaultSession(){throw Error('must not open original session')}}}
 const module={exports:{}as{launchRootRelocation(bootstrap:string,preflight:ReturnType<typeof rootRelocationPreflight>):Promise<void>}}
 new Function('module','exports','require','__dirname','process',await bundle)(module,module.exports,(id:string)=>id==='electron'?electron:require(id),join(base,'bundle/main'),{...process,platform})
 const launched=module.exports.launchRootRelocation(bootstrap,rootRelocationPreflight(bootstrap));void launched.catch(()=>{})
 const state=()=>handlers.get('desktop:relocation-state')!({sender:instances[0].webContents,senderFrame:instances[0].webContents.mainFrame})
 const command=(value:unknown,event?:unknown)=>handlers.get('desktop:relocation-command')!(event??{sender:instances[0].webContents,senderFrame:instances[0].webContents.mainFrame},value)
 return{base,bootstrap,source,target,pointerBefore,trace,ready,picker,launched,app,instances,paths,handlers,state,command,get calls(){return calls},get applicationMenu(){return applicationMenu},get popupMenu(){return popupMenu},get network(){return network},get requestPermission(){return requestPermission},get checkPermission(){return checkPermission},get staticHandler(){return staticHandler},setConfirm(value:unknown){confirmResponse=value},loseLock(){locked=false},async close(){picker.resolve({canceled:true,filePaths:[]});ready.resolve();await launched.catch(()=>{});await new Promise(setImmediate);await rm(base,{recursive:true,force:true})}}
}
async function started(r:Awaited<ReturnType<typeof fixture>>){r.ready.resolve();await r.launched;for(let i=0;i<100&&r.state().phase==='checking';i++)await new Promise(resolve=>setTimeout(resolve,2))}

test('WCO-F03 relocation pins its OS snapshot before native window construction',async()=>{
 for(const osDark of[false,true]){const r=await fixture('lost',false,'win32',osDark);try{await started(r);assert.equal(r.state().theme,osDark?'ink':'paper');assert.equal(r.instances[0].nativeSourceAtConstruction,osDark?'dark':'light');assert.equal(r.instances[0].preferences.titleBarOverlay.color,'#00000000');assert.deepEqual(await readFile(join(r.bootstrap,'data-root.json')),r.pointerBefore)}finally{await r.close()}}
})

test('RW33-01 first synchronous turn uses bootstrap profile, memory-only session and no source DB session fallback',async()=>{
 const r=await fixture();try{assert.equal(r.paths.get('sessionData'),join(r.bootstrap,'session'));assert.deepEqual(r.trace,['setPath','ready']);assert.equal(r.instances.length,0);await started(r);assert.equal(r.state().phase,'unavailable');const p=r.instances[0].preferences.webPreferences;assert.equal(p.session.storagePath,null);assert.equal(p.nodeIntegration,false);assert.equal(p.contextIsolation,true);assert.equal(p.sandbox,true);assert.match(p.preload,/preload\/root-relocation.cjs$/);assert.deepEqual(await readFile(join(r.bootstrap,'data-root.json')),r.pointerBefore);assert.equal(await readFile(join(r.target,'private-data'),'utf8'),'untouched local data')}finally{await r.close()}
})
test('RW33-02 actual restricted IPC refuses child/stale/window/unknown commands; network/staticAPI/permissions are closed',async()=>{
 const r=await fixture();try{await started(r);const owned=r.instances[0],event={sender:owned.webContents,senderFrame:owned.webContents.mainFrame};assert.deepEqual([...r.handlers.keys()],['desktop:relocation-state','desktop:relocation-command']);for(const bad of[{sender:{},senderFrame:event.senderFrame},{sender:event.sender,senderFrame:{url:'xaanink://app/'}},{sender:event.sender,senderFrame:{url:'https://private.invalid'}}])assert.throws(()=>r.handlers.get('desktop:relocation-state')!(bad),/UNTRUSTED/);for(const bad of['settings',{type:'choose',path:r.target},'start'])await assert.rejects(r.command(bad));assert.equal(r.calls,0)
  const frame=owned.webContents.mainFrame;frame.url='xaanink://app/?reload';assert.throws(()=>r.state(),/UNTRUSTED/);frame.url='xaanink://app/'
  assert.deepEqual(owned.webContents.openHandler(),{action:'deny'});let prevented=0;for(const name of['will-navigate','will-attach-webview'])owned.webContents.emit(name,{preventDefault(){prevented++}});assert.equal(prevented,2)
  for(const url of['https://provider.invalid/api','file:///private/data','not a URL'])r.network({url},(value:{cancel:boolean})=>assert.equal(value.cancel,true));r.network({url:'xaanink://app/'},(value:{cancel:boolean})=>assert.equal(value.cancel,false));let allowed=true;r.requestPermission(null,'clipboard-read',(value:boolean)=>allowed=value);assert.equal(allowed,false);assert.equal(r.checkPermission(),false);assert.equal((await r.staticHandler(new Request('xaanink://app/api/models'))).status,404);assert.equal((await r.staticHandler(new Request('xaanink://asset/private'))).status,403)
 }finally{await r.close()}
})
test('RW33-03 blocked unknown pointer never opens native picker and stays unchanged',async()=>{
 const r=await fixture('blocked');try{await started(r);assert.equal(r.state().phase,'blocked');assert.equal(r.state().canChoose,false);await assert.rejects(r.command('choose'));assert.equal(r.calls,0);assert.deepEqual(await readFile(join(r.bootstrap,'data-root.json')),r.pointerBefore);await r.command('quit');assert.equal(r.trace.filter(v=>v==='quit').length,1)}finally{await r.close()}
})
test('RW33-04 actual native DirectoryAuthority/Core commit preserves original data and only then relaunches',async()=>{
 const r=await fixture();try{await started(r);const work=r.command('choose');r.picker.resolve({canceled:false,filePaths:[r.target]});await work;const pointer=JSON.parse(await readFile(join(r.bootstrap,'data-root.json'),'utf8'));assert.equal(pointer.root.path,r.target);assert.equal(await readFile(join(r.target,'private-data'),'utf8'),'untouched local data');assert.equal(r.trace.filter(v=>v==='confirm').length,1);assert.deepEqual(r.trace.filter(v=>['relaunch','quit'].includes(v)),['relaunch','quit']);assert.equal((await readdir(r.bootstrap)).filter(v=>v.startsWith('root-relocation-')).length,1)}finally{await r.close()}
})
test('RW33-05 native close/beforequit drain same pending picker; late selected path never gets a receipt or commit',async()=>{
 const r=await fixture();try{await started(r);const work=r.command('choose');await new Promise(setImmediate);let prevented=0;r.instances[0].emit('close',{preventDefault(){prevented++}});r.app.emit('before-quit',{preventDefault(){prevented++}});await new Promise(setImmediate);assert.equal(prevented,2);assert.ok(!r.trace.includes('quit'));r.picker.resolve({canceled:false,filePaths:[r.target]});await work.catch(()=>{});for(let i=0;i<100&&!r.trace.includes('quit');i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(r.trace.filter(v=>v==='quit').length,1);assert.equal(r.trace.filter(v=>v==='confirm').length,0);assert.deepEqual(await readFile(join(r.bootstrap,'data-root.json')),r.pointerBefore);assert.equal((await readdir(r.bootstrap)).filter(v=>v.startsWith('root-relocation-')).length,0)}finally{await r.close()}
})
test('RW33-06 persistent partition and late window loss never grant selected directory or restart',async()=>{
 const unsafe=await fixture('lost',true);try{unsafe.ready.resolve();await assert.rejects(unsafe.launched,/SESSION_NOT_ISOLATED/);assert.equal(unsafe.handlers.size,0);assert.equal(unsafe.instances.length,0)}finally{await unsafe.close()}
 const r=await fixture();try{await started(r);const work=r.command('choose');await new Promise(setImmediate);r.instances[0].destroyed=true;r.instances[0].emit('closed');r.picker.resolve({canceled:false,filePaths:[r.target]});await work.catch(()=>{});await new Promise(setImmediate);assert.ok(!r.trace.includes('relaunch'));assert.deepEqual(await readFile(join(r.bootstrap,'data-root.json')),r.pointerBefore);assert.equal((await readdir(r.bootstrap)).filter(v=>v.startsWith('root-relocation-')).length,0)}finally{await r.close()}
})
test('RW33-07 actual restricted preload exposes only enum commands and removes subscription',async()=>{
 const result=await build({entryPoints:['desktop/preload/root-relocation.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false}),module={exports:{}},ipc=new EventEmitter(),calls:unknown[][]=[],exposed=new Map<string,any>()
 new Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,()=>({contextBridge:{exposeInMainWorld:(name:string,value:unknown)=>exposed.set(name,value)},ipcRenderer:Object.assign(ipc,{invoke:async(...args:unknown[])=>{calls.push(args)}})}))
 assert.deepEqual([...exposed.keys()],['desktopRootRelocation']);const bridge=exposed.get('desktopRootRelocation');assert.deepEqual(Object.keys(bridge).sort(),['command','state','subscribe']);await bridge.state();await bridge.command('choose');assert.deepEqual(calls,[['desktop:relocation-state'],['desktop:relocation-command','choose']]);let events=0;const remove=bridge.subscribe(()=>events++);ipc.emit('desktop:relocation-event',{},{});remove();ipc.emit('desktop:relocation-event',{},{});assert.equal(events,1);assert.equal(ipc.listenerCount('desktop:relocation-event'),0)
})

function menuItem(menu:any[],top:string,label:string){return menu.find(item=>item.label===top)?.submenu.find((item:any)=>item.label===label)}
test('RW33-08 macOS six native menu groups keep text/window roles and CmdQ drains a pending native picker',async()=>{
 const r=await fixture();try{await started(r);assert.deepEqual(r.applicationMenu?.map((item:any)=>item.label),['玄印','文件','编辑','视图','窗口','帮助']);assert.deepEqual(r.applicationMenu.find((item:any)=>item.label==='编辑').submenu.filter((item:any)=>item.role).map((item:any)=>item.role),['undo','redo','cut','copy','paste','selectAll']);menuItem(r.applicationMenu,'玄印','关于玄印写作').click();assert.ok(r.trace.includes('about'));menuItem(r.applicationMenu,'窗口','最小化').click();assert.ok(r.trace.includes('minimize'));const work=r.command('choose');await new Promise(setImmediate);const quit=menuItem(r.applicationMenu,'玄印','退出玄印');assert.equal(quit.accelerator,'Cmd+Q');quit.click();menuItem(r.applicationMenu,'窗口','关闭窗口').click();await new Promise(setImmediate);assert.ok(!r.trace.includes('quit'));r.picker.resolve({canceled:true,filePaths:[]});await work.catch(()=>{});for(let i=0;i<100&&!r.trace.includes('quit');i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(r.trace.filter(value=>value==='quit').length,1);assert.deepEqual(await readFile(join(r.bootstrap,'data-root.json')),r.pointerBefore)}finally{await r.close()}
})
test('RW33-09 Windows restricted menu action creates only a fixed popup for the exact current frame and native about',async()=>{
 const r=await fixture('lost',false,'win32');try{await started(r);assert.equal(r.state().platform,'win32');await r.command('menu');assert.deepEqual(r.popupMenu?.map((item:any)=>item.label),['文件','编辑','视图','窗口','帮助']);await menuItem(r.popupMenu,'帮助','关于玄印写作').click();assert.ok(r.trace.includes('about-box'));assert.equal(r.calls,0);await assert.rejects(r.command({type:'menu',template:[{role:'quit'}]}));const old=r.popupMenu;r.instances[0].webContents.mainFrame.url='xaanink://app/?new';await assert.rejects(r.command('menu'));assert.equal(r.popupMenu,old)}finally{await r.close()}
})
test('RW33-10 loaded same-document navigation preserves the exact window and pending picker owner with Electron44 details or legacy shape',async()=>{
 for(const legacy of[false,true]){const r=await fixture();try{await started(r);const work=r.command('choose');await new Promise(setImmediate);const contents=r.instances[0].webContents;if(legacy)contents.emit('did-start-navigation',{url:'xaanink://app/',isMainFrame:true},'xaanink://app/',true,true,4,1);else contents.emit('did-start-navigation',{url:'xaanink://app/',isMainFrame:true,isSameDocument:true});await new Promise(setImmediate);assert.equal(r.state().phase,'picking');assert.ok(!r.trace.includes('quit'));r.picker.resolve({canceled:true,filePaths:[]});await work;assert.equal(r.state().phase,'cancelled');assert.ok(!r.trace.includes('quit'));assert.deepEqual(await readFile(join(r.bootstrap,'data-root.json')),r.pointerBefore)}finally{await r.close()}}
})
test('RW33-11 loaded cross-document or unknown navigation revokes the old frame and drains late native selection without commit',async()=>{
 for(const same of[false,undefined]){const r=await fixture();try{await started(r);const work=r.command('choose');await new Promise(setImmediate);r.instances[0].webContents.emit('did-start-navigation',{url:'xaanink://app/',isMainFrame:true,...(same===undefined?{}:{isSameDocument:same})});assert.throws(()=>r.state(),/UNTRUSTED/);assert.ok(!r.trace.includes('quit'));r.picker.resolve({canceled:false,filePaths:[r.target]});await work.catch(()=>{});for(let i=0;i<100&&!r.trace.includes('quit');i++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(r.trace.filter(value=>value==='quit').length,1);assert.ok(!r.trace.includes('confirm'));assert.deepEqual(await readFile(join(r.bootstrap,'data-root.json')),r.pointerBefore);assert.equal((await readdir(r.bootstrap)).filter(name=>name.startsWith('root-relocation-')).length,0)}finally{await r.close()}}
})
