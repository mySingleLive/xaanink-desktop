import {mainFunction} from "../helpers/main-function"
import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdtemp,readFile,writeFile,rm,readdir,realpath,mkdir,rename} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {setImmediate} from "node:timers/promises"
import {ConfigurationFiles,type ConfigurationFileOptions} from "../../desktop/main/configuration-files"
import {ModelRepository} from "../../desktop/main/model-repository"
import {VersionedStore,type StoreOptions} from "../../desktop/core/versioned-store"
import {exportConfiguration} from "../../desktop/core/configuration-transfer"
import {readFileSync} from "node:fs"
import {randomUUID} from "node:crypto"
import ts from "typescript"
import {transformSync} from "esbuild"
import {z} from "zod"

function gate<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return{promise,resolve}}
async function fixture(options:StoreOptions={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),"xuanxiang-review61-"))),statePath=join(root,"state.json"),source=join(root,"source.json"),destination=join(root,"export.json"),owner="17:trusted-session:settings-session"
 let current=owner,importPicker:()=>Promise<string|null>=async()=>source,exportPicker:()=>Promise<string|null>=async()=>destination
 let published=0
 const repository=new ModelRepository(statePath,{isEncryptionAvailable:()=>true,encryptString:key=>Buffer.from("cipher:"+key),decryptString:value=>value.toString().slice(7)},{replace(){published++},remove(){published++}},options)
 const initial=await repository.read();await repository.updateSettings(initial.revision,initial.settings)
 const incoming=await repository.read();incoming.settings.appearance.theme="ink";await writeFile(source,exportConfiguration(incoming))
 const config:ConfigurationFileOptions={repository,catalogs:{},assertOwner(value){if(value!==current)throw Error("owner invalid")},chooseImport:()=>importPicker(),chooseExport:()=>exportPicker()}
 const files=new ConfigurationFiles(config)
 return{root,statePath,source,destination,owner,repository,config,files,published:()=>published,setOwner:(value:string)=>{current=value},setImport:(fn:()=>Promise<string|null>)=>{importPicker=fn},setExport:(fn:()=>Promise<string|null>)=>{exportPicker=fn},async cleanup(){files.cancelWindow("17:");await files.flush();await rm(root,{recursive:true,force:true})}}
}

test("CF61-01: cancelling a waiting picker lets close flush complete without waiting for stale native consent",async()=>{
 const f=await fixture(),picker=gate<string|null>();let settled=false,pending:Promise<unknown>|undefined
 try{
  f.setImport(()=>picker.promise);pending=f.files.preview(f.owner);void pending.catch(()=>{})
  f.files.cancelWindow("17:");const flush=f.files.flush();void flush.then(()=>{settled=true})
  await setImmediate();await setImmediate()
  assert.equal(settled,true)
  picker.resolve(f.source);await assert.rejects(pending,/取消|失效/);pending=undefined;await flush
  assert.equal((await f.repository.read()).revision,1)
 }finally{picker.resolve(null);await pending?.catch(()=>{});await f.cleanup()}
})

test("CF61-02: export cannot overwrite its live repository state even through the native-selected destination",async()=>{
 const f=await fixture()
 try{
  const before=await readFile(f.statePath)
  f.setExport(async()=>f.statePath)
  await assert.rejects(f.files.export(f.owner))
  assert.deepEqual(await readFile(f.statePath),before)
  assert.equal((await f.repository.read()).revision,1)
 }finally{await f.cleanup()}
})

test("CF61-03: a valid-token apply that fails owner validation cannot revive after owner ABA",async()=>{
 const f=await fixture()
 try{
  const preview=(await f.files.preview(f.owner))!
  f.setOwner("different-owner")
  await assert.rejects(f.files.apply(f.owner,preview.token,{selectedPaths:["/appearance/theme"]}),/owner/)
  f.setOwner(f.owner)
  await assert.rejects(f.files.apply(f.owner,preview.token,{selectedPaths:["/appearance/theme"]}),/预览|失效/)
  assert.equal((await f.repository.read()).revision,1)
 }finally{await f.cleanup()}
})

test("CF61-04: cancellation after schema/CAS and temp fsync is checked after the original beforeRename hook",async()=>{
 const entered=gate(),allow=gate();let gated=false
 const f=await fixture({async beforeRename(){if(gated){entered.resolve();await allow.promise}}})
 let pending:Promise<unknown>|undefined
 try{
  const preview=(await f.files.preview(f.owner))!,before=await readFile(f.statePath);gated=true
  pending=f.files.apply(f.owner,preview.token,{selectedPaths:["/appearance/theme"]});void pending.catch(()=>{})
  await entered.promise;f.files.cancel(f.owner);allow.resolve()
  await assert.rejects(pending,/取消|失效/);pending=undefined
  assert.deepEqual(await readFile(f.statePath),before)
  assert.equal((await f.repository.read()).revision,1)
  assert.equal((await readdir(f.root)).some(path=>path.endsWith(".tmp")),false)
  await assert.rejects(f.files.apply(f.owner,preview.token,{selectedPaths:[]}),/预览|失效/)
 }finally{allow.resolve();await pending?.catch(()=>{});await f.cleanup()}
})

test("CF61-05: renderer mutations cannot replace the retained plan and validation-only failure permits an explicit corrected retry",async()=>{
 const f=await fixture()
 try{
  const first=(await f.files.preview(f.owner))!
  Reflect.set(first.plan.changes.find(row=>row.path==="/appearance/theme")!,"incoming","system")
  assert.equal((await f.files.apply(f.owner,first.token,{selectedPaths:["/appearance/theme"]})).settings.appearance.theme,"ink")
  const next=await f.repository.read();next.settings.appearance.theme="paper";await f.repository.updateSettings(next.revision,next.settings)
  const preview=(await f.files.preview(f.owner))!,before=await readFile(f.statePath)
  await assert.rejects(f.files.apply(f.owner,preview.token,{selectedPaths:["/general/defaultParent"]}))
  assert.deepEqual(await readFile(f.statePath),before)
  assert.equal((await f.files.apply(f.owner,preview.token,{selectedPaths:["/appearance/theme"]})).settings.appearance.theme,"ink")
  await assert.rejects(f.files.apply(f.owner,preview.token,{selectedPaths:[]}),/预览|失效/)
  assert.equal((await f.files.preview(f.owner))?.plan.baseRevision,4)
 }finally{await f.cleanup()}
})

test("CF61-06: a cancelled export picker finishes its business operation and late file selection never writes",async()=>{
 const f=await fixture(),picker=gate<string|null>()
 let pending:Promise<unknown>|undefined
 try{
  f.setExport(()=>picker.promise);pending=f.files.export(f.owner);void pending.catch(()=>{})
  f.files.cancel(f.owner);await f.files.flush();await assert.rejects(pending,/取消|失效/);pending=undefined
  picker.resolve(f.destination);await setImmediate()
  await assert.rejects(readFile(f.destination),{code:"ENOENT"})
  assert.equal((await f.repository.read()).revision,1)
 }finally{picker.resolve(null);await pending?.catch(()=>{});await f.cleanup()}
})

test("CF61-07: export refuses a destination changed while the repository snapshot was pending",async()=>{
 const f=await fixture(),entered=gate(),allow=gate(),read=f.repository.read.bind(f.repository)
 let pending:Promise<unknown>|undefined
 try{
  await writeFile(f.destination,"initial user file")
  f.repository.read=async()=>{const result=await read();entered.resolve();await allow.promise;return result}
  pending=f.files.export(f.owner);void pending.catch(()=>{});await entered.promise
  await writeFile(f.destination,"concurrent user change");allow.resolve()
  await assert.rejects(pending,/目标已变化|原文件/);pending=undefined
  assert.equal(await readFile(f.destination,"utf8"),"concurrent user change")
  assert.equal((await readdir(f.root)).some(path=>path.endsWith(".tmp")),false)
 }finally{allow.resolve();await pending?.catch(()=>{});await f.cleanup()}
})

test("CF61-08: export detects replacement of the selected parent directory and preserves both old and new user files",async()=>{
 const f=await fixture(),entered=gate(),allow=gate(),read=f.repository.read.bind(f.repository),parent=join(f.root,"chosen-parent"),destination=join(parent,"export.json")
 let pending:Promise<unknown>|undefined
 try{
  await mkdir(parent);await writeFile(destination,"original parent file");f.setExport(async()=>destination)
  f.repository.read=async()=>{const result=await read();entered.resolve();await allow.promise;return result}
  pending=f.files.export(f.owner);void pending.catch(()=>{});await entered.promise
  await rename(parent,parent+"-old");await mkdir(parent);await writeFile(destination,"replacement directory user file");allow.resolve()
  await assert.rejects(pending,/目录已变化|目标已变化|原文件/);pending=undefined
  assert.equal(await readFile(join(parent+"-old","export.json"),"utf8"),"original parent file")
  assert.equal(await readFile(destination,"utf8"),"replacement directory user file")
  assert.deepEqual(await readdir(parent),["export.json"])
 }finally{allow.resolve();await pending?.catch(()=>{});await f.cleanup()}
})

test("CF61-09: protected application/work directories are checked at the final rename boundary",async()=>{
 const f=await fixture(),read=f.repository.read.bind(f.repository),entered=gate(),allow=gate();let protectedRoots:string[]=[]
 f.config.protectedRoots=async()=>protectedRoots
 let pending:Promise<unknown>|undefined
 try{
  await writeFile(f.destination,"unrelated author file")
  f.repository.read=async()=>{const result=await read();entered.resolve();await allow.promise;return result}
  pending=f.files.export(f.owner);void pending.catch(()=>{});await entered.promise
  protectedRoots=[f.root];allow.resolve()
  await assert.rejects(pending,/应用数据|作品目录/);pending=undefined
  assert.equal(await readFile(f.destination,"utf8"),"unrelated author file")
  assert.equal((await readdir(f.root)).some(path=>path.endsWith(".tmp")),false)
 }finally{allow.resolve();await pending?.catch(()=>{});await f.cleanup()}
})

test("CF61-10: exact owner loss during a queued repository commit leaves the old durable bytes untouched",async()=>{
 const entered=gate(),allow=gate();let gated=false
 const f=await fixture({async beforeRename(){if(gated){entered.resolve();await allow.promise}}})
 let pending:Promise<unknown>|undefined
 try{
  const preview=(await f.files.preview(f.owner))!,before=await readFile(f.statePath);gated=true
  pending=f.files.apply(f.owner,preview.token,{selectedPaths:["/appearance/theme"]});void pending.catch(()=>{});await entered.promise
  f.setOwner("17:other-session:settings-session");allow.resolve()
  await assert.rejects(pending,/owner/);pending=undefined
  f.setOwner(f.owner);await assert.rejects(f.files.apply(f.owner,preview.token,{selectedPaths:["/appearance/theme"]}),/预览|失效/)
  assert.deepEqual(await readFile(f.statePath),before)
 }finally{allow.resolve();await pending?.catch(()=>{});await f.cleanup()}
})

test("CF61-11: the actual main configuration IPC rejects a post-commit reply after its frame/session changed",async()=>{
 const entered=gate(),allow=gate();let gated=false
 const f=await fixture({async beforeDirectorySync(){if(gated){entered.resolve();await allow.promise}}})
 let pending:Promise<unknown>|undefined
 try{
  const source=ts.createSourceFile("main.ts",readFileSync("desktop/main/index.ts","utf8"),ts.ScriptTarget.Latest,true)
  const body=["trusted","registerIpc"].map(name=>{const node=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node);return node.getText(source)}).join("\n")
  const frame={url:"xaanink://app/"},contents={id:17,mainFrame:frame,setZoomFactor(value:number){emits.push(value)}},event={sender:contents,senderFrame:frame},session={owner:17,id:randomUUID(),ready:true},settingsSession=randomUUID()
  const owner=`17:${session.id}:${settingsSession}`;f.setOwner(owner)
  const handlers=new Map<string,(...args:unknown[])=>Promise<unknown>>(),emits:unknown[]=[]
  mainFunction("ipcMain","window","z","draftSession","closingFlow","configurationFiles","send",transformSync(body,{loader:"ts"}).code+"\nregisterIpc()")({handle:(id:string,handler:(...args:unknown[])=>Promise<unknown>)=>handlers.set(id,handler),on(){}},{webContents:contents},z,session,null,f.files,(value:unknown)=>emits.push(value))
  const handler=handlers.get("desktop:configuration")!;assert.ok(handler)
  const preview=await handler(event,{type:"preview",sessionId:settingsSession}) as {token:string};gated=true
  pending=handler(event,{type:"apply",sessionId:settingsSession,token:preview.token,choices:{selectedPaths:["/appearance/theme"]}});void pending.catch(()=>{});await entered.promise
  contents.mainFrame={url:"xaanink://app/"};session.id=randomUUID();f.setOwner(`17:${session.id}:${settingsSession}`);allow.resolve()
  await assert.rejects(pending,/不受信|窗口|owner|取消|失效/);pending=undefined
  assert.deepEqual(emits,[])
  assert.equal((await f.repository.read()).settings.appearance.theme,"ink","a commit already renamed remains authoritative")
 }finally{allow.resolve();await pending?.catch(()=>{});await f.cleanup()}
})

test("CF61-12: VersionedStore runs the synchronous commit guard after its existing hook and a rejected guard does not poison the queue",async()=>{
 const f=await fixture(),path=join(f.root,"queued-store.json"),events:string[]=[],failure=new Error("isolated commit veto")
 try{
  const schema=z.object({answer:z.number().int()}).strict(),store=new VersionedStore(path,{answer:0},value=>schema.parse(value),{async beforeRename(){events.push("hook")}})
  const first=store.update(0,{answer:1},()=>{events.push("guard");throw failure}),second=store.update(0,{answer:2})
  await assert.rejects(first,error=>error===failure)
  assert.deepEqual(await second,{revision:1,value:{answer:2}})
  assert.deepEqual(events,["hook","guard","hook"])
  assert.deepEqual(await store.read(),{revision:1,value:{answer:2}})
  let invalidGuard=0;await assert.rejects(store.update(1,{answer:"invalid"} as any,()=>{invalidGuard++}))
  assert.equal(invalidGuard,0)
 }finally{await f.cleanup()}
})

test("CF61-13: cancelling configuration operations does not detach a real file write awaiting durability",async()=>{
 const entered=gate(),allow=gate();let gated=false,settled=false
 const f=await fixture({async beforeDirectorySync(){if(gated){entered.resolve();await allow.promise}}})
 let pending:Promise<unknown>|undefined
 try{
  const preview=(await f.files.preview(f.owner))!;gated=true
  pending=f.files.apply(f.owner,preview.token,{selectedPaths:["/appearance/theme"]});void pending.catch(()=>{});await entered.promise
  f.files.cancelWindow("17:");const flush=f.files.flush();void flush.then(()=>{settled=true})
  await setImmediate();assert.equal(settled,false)
  allow.resolve();await pending;pending=undefined;await flush;assert.equal(settled,true)
  assert.equal((await f.repository.read()).settings.appearance.theme,"ink")
 }finally{allow.resolve();await pending?.catch(()=>{});await f.cleanup()}
})

test("CF61-14: actual main IPC rejects untrusted frame/extra native paths and cannot apply another settings-session token",async()=>{
 const f=await fixture();let picks=0
 try{
  const source=ts.createSourceFile("main.ts",readFileSync("desktop/main/index.ts","utf8"),ts.ScriptTarget.Latest,true),body=["trusted","registerIpc"].map(name=>{const node=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node);return node.getText(source)}).join("\n")
  const frame={url:"xaanink://app/"},contents={id:17,mainFrame:frame,setZoomFactor(){}},session={owner:17,id:randomUUID(),ready:true},settingsSession=randomUUID(),owner=`17:${session.id}:${settingsSession}`
  f.setOwner(owner);f.setImport(async()=>{picks++;return f.source})
  const handlers=new Map<string,(...args:unknown[])=>Promise<unknown>>()
  mainFunction("ipcMain","window","z","draftSession","closingFlow","configurationFiles","send",transformSync(body,{loader:"ts"}).code+"\nregisterIpc()")({handle:(id:string,handler:(...args:unknown[])=>Promise<unknown>)=>handlers.set(id,handler),on(){}},{webContents:contents},z,session,null,f.files,()=>{})
  const handler=handlers.get("desktop:configuration")!,event={sender:contents,senderFrame:frame}
  await assert.rejects(handler({...event,senderFrame:{url:"xaanink://app/"}},{type:"preview",sessionId:settingsSession}),/不受信/)
  await assert.rejects(handler(event,{type:"preview",sessionId:settingsSession,path:f.source}))
  await assert.rejects(handler(event,{type:"preview",sessionId:"not-uuid"}))
  assert.equal(picks,0)
  const preview=await handler(event,{type:"preview",sessionId:settingsSession}) as {token:string}
  await assert.rejects(handler(event,{type:"apply",sessionId:randomUUID(),token:preview.token,choices:{selectedPaths:["/appearance/theme"]}}),/预览|失效/)
  assert.equal((await f.repository.read()).revision,1)
 }finally{await f.cleanup()}
})

test("CF61-15: actual main closeData cancels a stale picker before flushing and only then closes the database",async()=>{
 const f=await fixture(),picker=gate<string|null>();let pending:Promise<unknown>|undefined
 try{
  const source=ts.createSourceFile("main.ts",readFileSync("desktop/main/index.ts","utf8"),ts.ScriptTarget.Latest,true)
  let expression:ts.Node|undefined
  function visit(node:ts.Node){if(ts.isPropertyAssignment(node)&&node.name.getText(source)==="closeData")expression=node.initializer;ts.forEachChild(node,visit)}visit(source);assert.ok(expression)
  const events:string[]=[],read=f.repository.read.bind(f.repository)
  f.repository.read=async()=>{events.push("read");return read()}
  f.setImport(()=>picker.promise);pending=f.files.preview(f.owner);void pending.catch(()=>{})
  const close=mainFunction("window","configurationFiles","repository","service","modelConfiguration","avatarAssets","responseOwners","migrationHandoff",transformSync(`const close=${expression.getText(source)}`,{loader:"ts"}).code+"\nreturn close")({webContents:{id:17}},f.files,f.repository,{async call(name:string){events.push(name)}},{cancelOwner(){}},{cancelOwner(){}},new Map(),null) as ()=>Promise<void>
  await close();assert.deepEqual(events,["read","close"])
  await assert.rejects(pending,/取消|失效/);pending=undefined
  picker.resolve(f.source);await setImmediate();assert.equal((await f.repository.read()).revision,1)
 }finally{picker.resolve(null);await pending?.catch(()=>{});await f.cleanup()}
})

test("CF61-16: actual native-picker option closures reject a late old-window selection without reading or applying it",async()=>{
 const f=await fixture(),picker=gate<{canceled:boolean;filePaths:string[]}>();let pending:Promise<unknown>|undefined,files:ConfigurationFiles|undefined
 try{
  const source=ts.createSourceFile("main.ts",readFileSync("desktop/main/index.ts","utf8"),ts.ScriptTarget.Latest,true)
  let expression:ts.Node|undefined
  function visit(node:ts.Node){if(ts.isNewExpression(node)&&node.expression.getText(source)==="ConfigurationFiles")expression=node.arguments?.[0];ts.forEachChild(node,visit)}visit(source);assert.ok(expression)
  const session={owner:17,id:randomUUID()},window={isDestroyed:()=>false,webContents:{id:17}},calls:string[]=[],settingsSession=randomUUID(),owner=`17:${session.id}:${settingsSession}`
  const options=mainFunction("repository","trustedCommandCatalogs","dataRoot","bootstrapPath","service","window","draftSession","closingFlow","dialog",transformSync(`const options=${expression.getText(source)}`,{loader:"ts"}).code+"\nreturn options")(
   f.repository,{},f.root,join(f.root,"bootstrap"),{async call(name:string){calls.push(name);return[join(f.root,"work")]}},window,session,null,{async showOpenDialog(target:unknown){assert.equal(target,window);calls.push("open");return picker.promise},async showSaveDialog(){return{canceled:true}}}) as ConfigurationFileOptions
  files=new ConfigurationFiles(options);pending=files.preview(owner);void pending.catch(()=>{})
  session.id=randomUUID();picker.resolve({canceled:false,filePaths:[f.source]})
  await assert.rejects(pending,/窗口|失效|取消/);pending=undefined
  assert.deepEqual(calls,["open"])
  assert.equal((await f.repository.read()).revision,1)
  const roots=await options.protectedRoots!();assert.deepEqual(roots,[f.root,join(f.root,"bootstrap"),join(f.root,"work")])
 }finally{picker.resolve({canceled:true,filePaths:[]});await pending?.catch(()=>{});files?.cancelWindow("17:");await files?.flush();await f.cleanup()}
})

test("CF61-17: actual releaseOwner cancels configuration operations for that window before its session is released",async()=>{
 const f=await fixture(),picker=gate<string|null>();let pending:Promise<unknown>|undefined
 try{
  const source=ts.createSourceFile("main.ts",readFileSync("desktop/main/index.ts","utf8"),ts.ScriptTarget.Latest,true)
  let declaration:ts.VariableDeclaration|undefined
  function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==="releaseOwner")declaration=node;ts.forEachChild(node,visit)}visit(source);assert.ok(declaration?.initializer)
  f.setImport(()=>picker.promise);pending=f.files.preview(f.owner);void pending.catch(()=>{})
  const order:string[]=[],session={owner:17,release(){order.push("session-release")}},noop={cancel(){},cancelOwner(){},revokeOwner(){}}
  const release=mainFunction("ownerId","closeChannel","configurationFiles","draftSession","authority","modelConfiguration","avatarAssets","responseOwners",transformSync(`const release=${declaration.initializer.getText(source)}`,{loader:"ts"}).code+"\nreturn release")(17,noop,f.files,session,noop,noop,noop,new Map()) as ()=>void
  release();await f.files.flush();await assert.rejects(pending,/取消|失效/);pending=undefined
  assert.deepEqual(order,["session-release"])
  picker.resolve(f.source);await setImmediate();assert.equal((await f.repository.read()).revision,1)
 }finally{picker.resolve(null);await pending?.catch(()=>{});await f.cleanup()}
})

test("CF61-18: preload forwards configuration through its single narrow channel without exposing native file APIs",async()=>{
 const source=ts.createSourceFile("preload.ts",readFileSync("desktop/preload/index.ts","utf8"),ts.ScriptTarget.Latest,true)
 const statement=source.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>declaration.name.getText(source)==="bridge"));assert.ok(statement&&ts.isVariableStatement(statement))
 const expression=statement.declarationList.declarations.find(declaration=>declaration.name.getText(source)==="bridge")?.initializer;assert.ok(expression)
 const calls:unknown[][]=[],bridge=mainFunction("ipcRenderer",transformSync(`const bridge=${expression.getText(source)}`,{loader:"ts"}).code+"\nreturn bridge")({invoke(...args:unknown[]){calls.push(args);return Promise.resolve(null)}})
 const action={type:"preview",sessionId:randomUUID()};await bridge.configuration(action)
 assert.deepEqual(calls,[["desktop:configuration",action]])
 for(const name of ["fs","shell","ipcRenderer","readFile","showOpenDialog","showSaveDialog"])assert.equal(name in bridge,false)
})
