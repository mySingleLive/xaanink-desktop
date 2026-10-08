import assert from 'node:assert/strict'
import {test} from 'node:test'
import {EventEmitter} from 'node:events'
import {createRequire} from 'node:module'
import {randomUUID} from 'node:crypto'
import {mkdtemp,realpath,mkdir,writeFile,readFile,rename,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {build} from 'esbuild'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {rootRelocationPreflight} from '../../desktop/main/root-relocation-preflight'

// Original module, actual FS/authority records; only Electron is controlled.
// Optional archived v1 source permits a reproducible pre-fix behavior RED.
const require=createRequire(import.meta.url)
const entry=process.env.REVIEW100_NAVIGATION_SOURCE
const bundle=(async()=>{
 const options={bundle:true,platform:'node' as const,format:'cjs' as const,packages:'external' as const,write:false}
 const result=entry?await build({...options,stdin:{contents:await readFile(resolve(entry),'utf8'),resolveDir:resolve('desktop/main'),loader:'ts',sourcefile:resolve(entry)}}):await build({...options,entryPoints:['desktop/main/root-relocation-window.ts']})
 const output=result.outputFiles?.[0];assert.ok(output);return output.text
})()
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review100-nav-'))),bootstrap=join(base,'bootstrap'),root=join(base,'root'),moved=join(base,'moved')
 for(const directory of[bootstrap,root,join(base,'out')])await mkdir(directory)
 await mkdir(join(root,'inbox/database'),{recursive:true})
 await writeFile(join(root,'inbox/database/PG_VERSION'),'17\n')
 await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}))
 await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 await new DataRootManager(bootstrap,root).adopt(await directoryIdentity(root));await rename(root,moved)
 const trace:string[]=[],handlers=new Map<string,(...args:any[])=>any>(),windows:any[]=[],paths=new Map<string,string>(),entered=Promise.withResolvers<void>(),picker=Promise.withResolvers<{canceled:boolean;filePaths:string[]}>()
 const memory={storagePath:null,setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}},protocol:{handle(){}}}
 const app=Object.assign(new EventEmitter(),{hasSingleInstanceLock:()=>true,setPath:(key:string,value:string)=>paths.set(key,value),getPath:(key:string)=>paths.get(key),whenReady:async()=>{},getAppPath:()=>base,getVersion:()=> '0.1.0',setAboutPanelOptions(){},showAboutPanel(){},relaunch(){trace.push('relaunch')},quit(){trace.push('quit')}})
 class Window extends EventEmitter{
  static getAllWindows(){return windows}
  webContents:any
  constructor(preferences:any){super();this.webContents=Object.assign(new EventEmitter(),{id:801,mainFrame:{url:'xaanink://app/'},session:preferences.webPreferences.session,send(){},setWindowOpenHandler(){}});windows.push(this)}
  isDestroyed(){return false}setMenu(){}show(){}focus(){}minimize(){}async loadURL(){}
 }
 const electron={app,BrowserWindow:Window,ipcMain:{handle:(key:string,run:(...args:any[])=>any)=>handlers.set(key,run)},Menu:{buildFromTemplate:()=>({popup(){}}),setApplicationMenu(){}},nativeTheme:{shouldUseDarkColors:false},session:{fromPartition:()=>memory,get defaultSession():never{throw Error('ORIGINAL_SESSION_FORBIDDEN')}},dialog:{async showOpenDialog(){entered.resolve();return picker.promise},async showMessageBox(){return{response:1}}}}
 const module={exports:{}as{launchRootRelocation(bootstrap:string,initial:ReturnType<typeof rootRelocationPreflight>):Promise<void>}}
 new Function('module','exports','require','__dirname','process',await bundle)(module,module.exports,(id:string)=>id==='electron'?electron:require(id),join(base,'bundle/main'),{...process,platform:'darwin'})
 await module.exports.launchRootRelocation(bootstrap,rootRelocationPreflight(bootstrap))
 const event=()=>({sender:windows[0].webContents,senderFrame:windows[0].webContents.mainFrame})
 const state=()=>handlers.get('desktop:relocation-state')!(event())
 assert.equal(state().phase,'unavailable')
 return{base,bootstrap,moved,trace,entered,picker,contents:windows[0].webContents,state,choose:()=>handlers.get('desktop:relocation-command')!(event(),'choose'),async close(){picker.resolve({canceled:true,filePaths:[]});await new Promise(setImmediate);await rm(base,{recursive:true,force:true})}}
}

test('RL100-08 modern same-document details and installed legacy replaceState events keep the exact restricted bridge live',async()=>{
 const f=await fixture()
 try{
  f.contents.emit('did-start-navigation',{isMainFrame:true,isSameDocument:true,url:'xaanink://app/'},'xaanink://app/',false,true)
  assert.equal(f.state().phase,'unavailable','explicit modern true takes priority over legacy false')
  await new Promise(setImmediate);assert.deepEqual(f.trace,[])
  f.contents.emit('did-start-navigation',{url:'xaanink://app/'},'xaanink://app/',true,true)
  assert.equal(f.state().phase,'unavailable','installed hydration replaceState uses legacy isInPlace')
  await new Promise(setImmediate);assert.deepEqual(f.trace,[])
 }finally{await f.close()}
})

test('RL100-09 explicit new-document false overrides legacy true and drains the real pending picker; unknown navigation is also denied',async()=>{
 for(const details of[{isMainFrame:true,isSameDocument:false},{isMainFrame:true}]){
  const f=await fixture()
  try{
   const pointer=await readFile(join(f.bootstrap,'data-root.json')),choice=f.choose();void choice.catch(()=>{});await f.entered.promise
   // Same URL is insufficient. Unknown legacy status must remain fail closed.
   f.contents.emit('did-start-navigation',details,'xaanink://app/',details.isSameDocument===false?true:undefined,true)
   assert.throws(()=>f.state(),/UNTRUSTED/)
   await new Promise(setImmediate);assert.equal(f.trace.includes('quit'),false)
   f.picker.resolve({canceled:false,filePaths:[f.moved]});await choice.catch(()=>{})
   for(let count=0;count<100&&!f.trace.includes('quit');count++)await new Promise(resolve=>setTimeout(resolve,2))
   assert.deepEqual(f.trace,['quit'],'one drain; no commit/relaunch after a new or unknown document')
   assert.deepEqual(await readFile(join(f.bootstrap,'data-root.json')),pointer)
  }finally{await f.close()}
 }
})
