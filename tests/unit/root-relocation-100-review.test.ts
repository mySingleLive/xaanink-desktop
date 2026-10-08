import assert from 'node:assert/strict'
import {test} from 'node:test'
import {EventEmitter} from 'node:events'
import {createRequire} from 'node:module'
import {build} from 'esbuild'
import {randomUUID,createHash} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {mkdtemp,realpath,mkdir,writeFile,readFile,rename,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DataRootManager,type RootPointer} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {RootRelocation} from '../../desktop/core/root-relocation'
import {RootRelocationController} from '../../desktop/main/root-relocation-controller'
import {RootMigrationRequests} from '../../desktop/main/root-migration-request'
import {RootMaintenanceRunner} from '../../desktop/main/root-maintenance-runner'
import {rootRelocationPreflight} from '../../desktop/main/root-relocation-preflight'

// Actual canonical FS/Core31/control records. These small database bytes prove
// directory/receipt ownership only; no PGlite or database health is claimed.
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)])):value
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
async function fixture(pending=false){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review100-'))),bootstrap=join(base,'bootstrap'),source=join(base,'source'),root=join(base,'root'),moved=join(base,'moved'),owner=randomUUID(),rootId=randomUUID(),migrationId=randomUUID()
 for(const directory of[bootstrap,source,root])await mkdir(directory)
 await mkdir(join(root,'inbox/database'),{recursive:true})
 await writeFile(join(root,'inbox/database/PG_VERSION'),'17\n')
 await writeFile(join(root,'inbox/database/bytes'),'original owned bytes')
 await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:rootId,phase:'ready',inboxReady:true}))
 await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 const sourcePointer:RootPointer={schemaVersion:1,revision:1,rootId,migrationId:null,root:await directoryIdentity(source)},target=await directoryIdentity(root)
 const pointer= pending?{...sourcePointer,revision:2,migrationId,root:target}:await new DataRootManager(bootstrap,root).adopt(target)
 const completion={requestId:randomUUID(),ownerNonce:owner,source:sourcePointer,target,createdAt:new Date().toISOString(),receiptId:randomUUID(),executionNonce:migrationId,finishedAt:new Date().toISOString(),outcome:{status:'cleanup-pending' as const,migrationId,root:pointer,pendingCount:1}}
 if(pending){
  const journal={schemaVersion:1,migrationId,phase:'cleanup-pending',source:sourcePointer,target,stage:`.xuanxiang-migration-${migrationId}`,sourceInboxIdentity:{...sourcePointer.root,path:join(source,'inbox')},files:[],createdAt:new Date().toISOString(),pending:['preserved-owned-file']}
  await writeFile(join(bootstrap,'data-root.json'),JSON.stringify(pointer))
  await writeFile(join(bootstrap,'root-migration.json'),JSON.stringify({journal,sha256:digest(journal)})+'\n')
  await writeFile(join(bootstrap,'root-migration-request.json'),JSON.stringify({schemaVersion:1,revision:4,active:null,results:[completion]})+'\n')
 }
 await rename(root,moved)
 const identity=await directoryIdentity(bootstrap),host={assertStableLock(){},assertCold(){},assertOwner(nonce:string){assert.equal(nonce,owner)},async confirm(){return true}}
 return{base,bootstrap,source,root,moved,owner,pointer,completion,identity,host,async close(){await rm(base,{recursive:true,force:true})}}
}

test('RL100-01 mutation after complete publication cannot reuse an obsolete proof for automatic cold restart',async()=>{
 const f=await fixture();let restarts=0,changed=false
 try{
  const controller=new RootRelocationController({bootstrap:f.identity,mode:'lost',theme:'paper',...f.host,async chooseDirectory(){return f.moved},async restart(){restarts++},async quit(){}})
  await controller.start(f.owner)
  controller.subscribe(state=>{if(state.phase==='complete'&&state.canRestart&&!changed){changed=true;writeFileSync(join(f.bootstrap,'data-root.json'),'foreign pointer bytes')}})
  await controller.choose(f.owner).catch(()=>{})
  assert.equal(changed,true,'the real commit and fresh getter reached complete')
  assert.equal(restarts,0,'a fresh proof must still hold after observers and physical flight cleanup')
  assert.equal(controller.state().canRestart,false)
  assert.equal(await readFile(join(f.bootstrap,'data-root.json'),'utf8'),'foreign pointer bytes')
  assert.equal(await readFile(join(f.moved,'inbox/database/bytes'),'utf8'),'original owned bytes')
 }finally{await f.close()}
})

test('RL100-02 changed completion with the same ids after display seal must not be acknowledged or cold continued',async()=>{
 const f=await fixture(true);let continued=0,changed=false
 try{
  const relocation=new RootRelocation(f.identity,f.host),prepared=await relocation.prepare(f.owner,await directoryIdentity(f.moved));await relocation.commit(f.owner,prepared.attemptId)
  const requests=new RootMigrationRequests(f.bootstrap,{resolveSource:()=>new DataRootManager(f.bootstrap,f.source).resolve(),assertStableLock(){},assertClosed(){},assertOwner(){}})
  const runner=new RootMaintenanceRunner({bootstrap:f.bootstrap,defaultRoot:f.source,requests,theme:'paper',host:{assertMaintenanceClosed(){}},async onContinue(){continued++},async onQuit(){}})
  assert.equal((await runner.start()).canContinue,true)
  const foreign={...f.completion,outcome:{...f.completion.outcome,pendingCount:2}}
  runner.subscribe(state=>{if(state.phase==='cleanup-pending'&&!state.canContinue&&!changed){changed=true;writeFileSync(join(f.bootstrap,'root-migration-request.json'),JSON.stringify({schemaVersion:1,revision:5,active:null,results:[foreign]})+'\n')}})
  await runner.continue().catch(()=>{})
  assert.equal(changed,true,'the last display seal precedes the injected file mutation')
  // An unchanged class-owned reader must reject the foreign record. The
  // preservation oracle reads its actual bytes without granting the API ACK.
  assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap,'root-migration-request.json'),'utf8')).results,[foreign],'same ids cannot authorize deletion of different completion content')
  assert.equal(continued,0)
 }finally{await f.close()}
})

test('RL100-03 failed process handoff cannot grant a later explicit restart after the authority file changes',async()=>{
 const f=await fixture();let attempted=0
 try{
  const controller=new RootRelocationController({bootstrap:f.identity,mode:'lost',theme:'paper',...f.host,async chooseDirectory(){return f.moved},async restart(){attempted++;throw Error('controlled process handoff failed')},async quit(){}})
  await controller.start(f.owner)
  await assert.rejects(controller.choose(f.owner))
  assert.equal(attempted,1)
  assert.equal(controller.state().canRestart,true,'a valid committed root permits an explicit process retry')
  writeFileSync(join(f.bootstrap,'data-root.json'),'foreign post-failure pointer')
  await controller.restart(f.owner).catch(()=>{})
  assert.equal(attempted,1,'the second attempt must freshly prove the committed authority before calling host restart')
  assert.equal(controller.state().canRestart,false)
  assert.equal(await readFile(join(f.bootstrap,'data-root.json'),'utf8'),'foreign post-failure pointer')
 }finally{await f.close()}
})

const require=createRequire(import.meta.url)
const windowBundle=build({entryPoints:['desktop/main/root-relocation-window.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false}).then(result=>result.outputFiles[0].text)
async function windowFixture(platform:'darwin'|'win32'='darwin'){
 const f=await fixture(),ready=Promise.withResolvers<void>(),picker=Promise.withResolvers<{canceled:boolean;filePaths:string[]}>(),entered=Promise.withResolvers<void>(),handlers=new Map<string, (...args:any[])=>any>(),windows:any[]=[],paths=new Map<string,string>(),trace:string[]=[]
 await mkdir(join(f.base,'out'));await writeFile(join(f.base,'out/index.html'),'<main>restricted fixture</main>')
 const memory={storagePath:null,setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}},protocol:{handle(){}}}
 const app=Object.assign(new EventEmitter(),{hasSingleInstanceLock:()=>true,setPath:(key:string,value:string)=>paths.set(key,value),getPath:(key:string)=>paths.get(key),whenReady:()=>ready.promise,getAppPath:()=>f.base,getVersion:()=> '0.1.0',setAboutPanelOptions(options:{applicationName:string;applicationVersion:string}){assert.deepEqual(options,{applicationName:'玄印写作',applicationVersion:'0.1.0'})},showAboutPanel(){trace.push('about')},relaunch(){trace.push('relaunch')},quit(){trace.push('quit')}})
 class Window extends EventEmitter{
  static getAllWindows(){return windows.filter(window=>!window.isDestroyed())}
  preferences:any;webContents:any;destroyed=false
  constructor(preferences:any){super();this.preferences=preferences;this.webContents=Object.assign(new EventEmitter(),{id:501,mainFrame:{url:'xaanink://app/'},session:preferences.webPreferences.session,send(){},setWindowOpenHandler(){}});windows.push(this)}
  isDestroyed(){return this.destroyed}setMenu(){}show(){}focus(){}minimize(){trace.push('minimize')}async loadURL(url:string){assert.equal(url,'xaanink://app/')}
 }
 const templates:any[][]=[],popupOwners:any[]=[],menu={buildFromTemplate(template:any[]){templates.push(template);return{items:template,popup(options:{window:unknown}){popupOwners.push(options.window);trace.push('popup')}}},setApplicationMenu(){}}
 const electron={app,BrowserWindow:Window,ipcMain:{handle:(key:string,run:(...args:any[])=>any)=>handlers.set(key,run)},Menu:menu,nativeTheme:{shouldUseDarkColors:false},session:{fromPartition:()=>memory,get defaultSession():never{throw Error('ORIGINAL_SESSION_FORBIDDEN')}},dialog:{async showOpenDialog(){entered.resolve();return picker.promise},async showMessageBox(){return{response:0}}}}
 const module={exports:{}as{launchRootRelocation(bootstrap:string,initial:ReturnType<typeof rootRelocationPreflight>):Promise<void>}}
 new Function('module','exports','require','__dirname','process',await windowBundle)(module,module.exports,(id:string)=>id==='electron'?electron:require(id),join(f.base,'bundle/main'),{...process,platform})
 const launch=module.exports.launchRootRelocation(f.bootstrap,rootRelocationPreflight(f.bootstrap));void launch.catch(()=>{})
 const event=()=>({sender:windows[0].webContents,senderFrame:windows[0].webContents.mainFrame})
 const state=()=>handlers.get('desktop:relocation-state')!(event())
 const command=(command:string)=>handlers.get('desktop:relocation-command')!(event(),command)
 return{...f,ready,picker,entered,handlers,windows,trace,templates,popupOwners,app,launch,state,command,async started(){ready.resolve();await launch;for(let count=0;count<100&&state().phase==='checking';count++)await new Promise(resolve=>setTimeout(resolve,2));assert.equal(state().phase,'unavailable')},async close(){picker.resolve({canceled:true,filePaths:[]});ready.resolve();await launch.catch(()=>{});await new Promise(setImmediate);await f.close()}}
}

test('RL100-04 main-frame document navigation invalidates the old restricted bridge before a late picker settles',async()=>{
 const f=await windowFixture()
 try{
  await f.started();const before=await readFile(join(f.bootstrap,'data-root.json')),choice=f.command('choose');void choice.catch(()=>{})
  await f.entered.promise
  // Installed Electron uses details.isMainFrame. This is an actual callback
  // on the original module, with the Electron emitter boundary controlled.
  f.windows[0].webContents.emit('did-start-navigation',{isMainFrame:true,url:'xaanink://app/'})
  assert.throws(()=>f.state(),/UNTRUSTED/)
  await new Promise(setImmediate);assert.equal(f.trace.includes('quit'),false,'process exit waits actual picker work')
  f.picker.resolve({canceled:false,filePaths:[f.moved]});await choice.catch(()=>{})
  for(let count=0;count<100&&!f.trace.includes('quit');count++)await new Promise(resolve=>setTimeout(resolve,2))
  assert.equal(f.trace.filter(item=>item==='quit').length,1)
  assert.equal(f.trace.includes('relaunch'),false)
  assert.deepEqual(await readFile(join(f.bootstrap,'data-root.json')),before)
 }finally{await f.close()}
})

test('RL100-05 an already opened foreign window refuses the cold relocation entry before any restricted window or IPC handler',async()=>{
 const f=await windowFixture()
 try{
  f.windows.push({isDestroyed:()=>false,webContents:{session:{storagePath:'/foreign/profile'}}})
  f.ready.resolve();await assert.rejects(f.launch,/SOURCE_NOT_CLOSED/)
  assert.equal(f.windows.length,1)
  assert.equal(f.handlers.size,0)
  assert.equal(f.templates.length,0)
  assert.equal(f.trace.includes('relaunch'),false)
 }finally{await f.close()}
})

const item=(template:any[],group:string,label:string)=>{
 const found=template.find(entry=>entry.label===group)?.submenu.find((entry:any)=>entry.label===label)
 assert.ok(found,`${group}/${label} exists`);return found
}
test('RL100-06 fixed mac menu keeps system roles and drains exactly once; old-frame native actions cannot acquire another window',async()=>{
 const f=await windowFixture('darwin')
 try{
  await f.started();const template=f.templates[0]
  assert.deepEqual(template.map(entry=>entry.label),['玄印','文件','编辑','视图','窗口','帮助'])
  assert.equal(item(template,'文件','新建作品').enabled,false)
  assert.deepEqual(template.find(entry=>entry.label==='编辑').submenu.filter((entry:any)=>entry.role).map((entry:any)=>entry.role),['undo','redo','cut','copy','paste','selectAll'])
  item(template,'玄印','关于玄印写作').click();item(template,'窗口','最小化').click();assert.deepEqual(f.trace,['about','minimize'])
  const choice=f.command('choose');void choice.catch(()=>{});await f.entered.promise
  const quit=item(template,'玄印','退出玄印');assert.equal(quit.accelerator,'Cmd+Q');quit.click();item(template,'窗口','关闭窗口').click()
  await new Promise(setImmediate);assert.equal(f.trace.includes('quit'),false)
  f.picker.resolve({canceled:false,filePaths:[f.moved]});await choice.catch(()=>{})
  for(let count=0;count<100&&!f.trace.includes('quit');count++)await new Promise(resolve=>setTimeout(resolve,2))
  assert.equal(f.trace.filter(value=>value==='quit').length,1);assert.equal(f.trace.includes('relaunch'),false)
  // The close handlers are allowed to drain an expired owner. Other native
  // actions remain tied to the exact old document/owned window.
  f.windows[0].webContents.emit('did-start-navigation',{isMainFrame:true})
  item(template,'玄印','关于玄印写作').click();item(template,'窗口','最小化').click()
  assert.equal(f.trace.filter(value=>value==='about').length,1);assert.equal(f.trace.filter(value=>value==='minimize').length,1)
 }finally{await f.close()}
})

test('RL100-07 Windows-branch popup is fixed and owner-bound; renderer templates and expired main frames are denied',async()=>{
 const f=await windowFixture('win32')
 try{
  // This is a controlled platform branch on the real macOS filesystem,
  // never Windows/native-menu/keyboard acceptance.
  await f.started();assert.equal(f.state().platform,'win32')
  assert.deepEqual(f.templates[0].map(entry=>entry.label),['文件','编辑','视图','窗口','帮助'])
  assert.equal(item(f.templates[0],'文件','新建作品').enabled,false)
  await f.command('menu');assert.deepEqual(f.popupOwners,[f.windows[0]])
  const owned=f.windows[0],handler=f.handlers.get('desktop:relocation-command')!
  await assert.rejects(handler({sender:owned.webContents,senderFrame:owned.webContents.mainFrame},{type:'menu',path:f.moved,template:[{role:'quit'}]}))
  await assert.rejects(handler({sender:owned.webContents,senderFrame:{url:'xaanink://app/'}},'menu'))
  owned.webContents.emit('did-start-navigation',{isMainFrame:true})
  await assert.rejects(f.command('menu'))
  assert.equal(f.popupOwners.length,1)
 }finally{await f.close()}
})
