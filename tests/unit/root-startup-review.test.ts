import assert from "node:assert/strict"
import {test} from "node:test"
import fs from "node:fs"
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,symlink,readdir} from "node:fs/promises"
import {join,resolve} from "node:path"
import {tmpdir} from "node:os"
import {randomUUID,createHash} from "node:crypto"
import {syncBuiltinESMExports} from "node:module"
import ts from "typescript"
import {transformSync} from "esbuild"
import {DataRootManager,type RootPointer} from "../../desktop/core/data-root"
import {directoryIdentity} from "../../desktop/core/root-ownership"
import {createRootStartupBuffer,RootStartupError,publishRootStartup,waitRootStartup} from "../../desktop/shared/root-startup"
import {startOwnedRoot} from "../../desktop/service/root-startup"
import {prepareSessionDirectory} from "../../desktop/main/session-directory"
import {assertNoLegacyBackupRecovery} from "../../desktop/main/legacy-recovery-preflight"

function syntax(){return ts.createSourceFile("main.ts",fs.readFileSync("desktop/main/index.ts","utf8"),ts.ScriptTarget.Latest,true)}
function prefix(){
 const source=syntax(),launch=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="launch") as ts.FunctionDeclaration
 assert.ok(launch?.body)
 const boundary=launch.body.statements.findIndex(node=>node.getText(source)==="await app.whenReady()")
 assert.ok(boundary>0)
 return launch.body.statements.slice(0,boundary).map(node=>node.getText(source)).join("\n")
}
function mainHarness(root:string,bootstrap:string,outcome:{status:"ready";root:string}|{status:"failed";code:string}){
 const trace:unknown[]=[],app={isPackaged:true,hasSingleInstanceLock:()=>true,getAppPath:()=>"/bundle",setPath(kind:string,path:string){trace.push({kind,path})}}
 const bindings={Worker:class{constructor(_path:unknown,options:unknown){trace.push({worker:options})}on(){}},RpcPeer:class{async call(method:string){trace.push(method);return true}},app,join,resolve,homedir:()=>"/default/author",mkdirSync:fs.mkdirSync,realpathSync:fs.realpathSync,lstatSync:fs.lstatSync,prepareSessionDirectory,assertNoLegacyBackupRecovery,applicationMetadata:{revoke(){}},conversationDirectories:{revokeAll(){},workerStopped(){}},responseOwners:new Map(),send(){},createRootStartupBuffer,waitRootStartup:()=>outcome,bootstrapPath:bootstrap,startupPaths:{bootstrap,defaultRoot:root,encryptionFamily:"legacy"},startupSelectionError:null,__dirname:"/bundle/main"}
 const source=syntax(),creation=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="createOrdinaryServiceWorker");assert.ok(creation)
 const code=transformSync(`let dataRoot,worker,service,modelService;let failedRootBeforeSession=false,ordinaryWorkerExited=false;${creation.getText(source)};async function launch(){${prefix()};return dataRoot};return launch`,{loader:"ts"}).code
 const start=new Function("bindings",`with(bindings){${code}}`)(bindings) as ()=>Promise<string>
 return{trace,start}
}
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),"xuanxiang-startup-review67-"))),root=join(base,"root"),bootstrap=join(base,"bootstrap"),outside=join(base,"outside")
 for(const path of [root,bootstrap,outside])await mkdir(path)
 const pointer:RootPointer={schemaVersion:1,revision:1,rootId:randomUUID(),migrationId:null,root:await directoryIdentity(root)}
 await writeFile(join(root,"xuanxiang-app.json"),JSON.stringify({schemaVersion:1,app:"Xuanxiangxiezuo-Desktop",id:pointer.rootId,phase:"ready",inboxReady:true}));await writeFile(join(bootstrap,"data-root.json"),JSON.stringify(pointer));await writeFile(join(outside,"user.txt"),"external user bytes")
 return{base,root,bootstrap,outside,pointer,manager:new DataRootManager(bootstrap,root),async cleanup(){await rm(base,{recursive:true,force:true})}}
}

test("RS67-01 actual main startup must reject a session symlink before authorizing Chromium writes outside the owned root",async()=>{
 const f=await fixture();try{await symlink(f.outside,join(f.root,"session"));assert.equal((await f.manager.resolve()).state,"existing");const r=mainHarness(f.root,f.bootstrap,{status:"ready",root:f.root});await assert.rejects(r.start());assert.equal(r.trace.some(item=>typeof item==="object"&&item!==null&&"kind"in item&&item.kind==="sessionData"),false);assert.equal(await readFile(join(f.outside,"user.txt"),"utf8"),"external user bytes");assert.deepEqual(await readdir(f.outside),["user.txt"])}finally{await f.cleanup()}
})
test("RS67-02 actual main accepts a regular existing session directory without rewriting user files or the authoritative pointer",async()=>{
 const f=await fixture();try{const session=join(f.root,"session");await mkdir(session);await writeFile(join(session,"Preferences"),"original Chromium preferences");const before=await readFile(join(f.bootstrap,"data-root.json"));const r=mainHarness(f.root,f.bootstrap,{status:"ready",root:f.root});assert.equal(await r.start(),f.root);assert.ok(r.trace.some(item=>typeof item==="object"&&item!==null&&"kind"in item&&item.kind==="sessionData"&&"path"in item&&item.path===session));assert.equal(await readFile(join(session,"Preferences"),"utf8"),"original Chromium preferences");assert.deepEqual(await readFile(join(f.bootstrap,"data-root.json")),before)}finally{await f.cleanup()}
})
test("RS67-03 failed startup envelope never creates a fallback session and a regular-file session leaf fails closed",async()=>{
 const f=await fixture();try{const failure=mainHarness(f.root,f.bootstrap,{status:"failed",code:"ROOT_UNAVAILABLE"});await assert.rejects(failure.start(),/ROOT_UNAVAILABLE/);assert.equal(fs.existsSync(join(f.root,"session")),false);await writeFile(join(f.root,"session"),"user-owned file");const r=mainHarness(f.root,f.bootstrap,{status:"ready",root:f.root});await assert.rejects(r.start());assert.equal(await readFile(join(f.root,"session"),"utf8"),"user-owned file")}finally{await f.cleanup()}
})
test("RS67-04 actual main canonicalizes the stable userData directory before acquiring the lock and never launches after lock denial",async()=>{
 const f=await fixture()
 try{
  const actual=join(f.base,"actual-appdata"),alias=join(f.base,"alias-appdata");await mkdir(actual);await symlink(actual,alias)
  const source=syntax(),names=new Set(["bootstrapDirectory","bootstrapPath"])
  const declarations=source.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>names.has(declaration.name.getText(source))))
  const setUserData=source.statements.find(node=>ts.isIfStatement(node)&&node.expression.getText(source)==="startupPaths")
  const branch=source.statements.at(-1);assert.ok(setUserData&&branch&&ts.isIfStatement(branch));assert.ok(branch.getText(source).includes("app.requestSingleInstanceLock()"))
  const events:unknown[]=[],expected=join(actual,"stable-test-bootstrap"),startupPaths={bootstrap:join(alias,"stable-test-bootstrap"),defaultRoot:f.root,encryptionFamily:"legacy"}
  const app={setPath(kind:string,path:string){events.push({kind,path})},requestSingleInstanceLock(){assert.deepEqual([...events],[{kind:"userData",path:expected}],"canonical userData must precede the actual lock attempt");events.push("lock");return false},quit(){events.push("quit")}}
  const dependencies={app,startupPaths,mkdirSync:fs.mkdirSync,realpathSync:fs.realpathSync,launch:()=>{events.push("launch");return Promise.resolve()}}
  new Function(...Object.keys(dependencies),transformSync([...declarations,setUserData,branch].map(node=>node.getText(source)).join("\n"),{loader:"ts"}).code)(...Object.values(dependencies))
  assert.deepEqual(events,[{kind:"userData",path:expected},"lock","quit"])
 }finally{await f.cleanup()}
})
test("RS67-05 missing authoritative pointer while historic journal exists blocks initialization without a new root",async()=>{
 const f=await fixture();let opens=0
 try{await rm(join(f.bootstrap,"data-root.json"));await writeFile(join(f.bootstrap,"root-migration.json"),JSON.stringify({journal:{phase:"rolled-back"},sha256:"bad"}));await assert.rejects(startOwnedRoot({root:join(f.base,"fallback"),bootstrap:f.bootstrap},async()=>{opens++;return"engine"}),error=>error instanceof RootStartupError&&error.code==="JOURNAL_INVALID");assert.equal(opens,0);assert.equal(fs.existsSync(join(f.base,"fallback")),false)}finally{await f.cleanup()}
})
test("RS67-06 published payload and safe error code remain exact through independent root barrier reads",()=>{
 const buffer=createRootStartupBuffer(),root="/作品根/作者";publishRootStartup(buffer,{version:1,status:"ready",root});const bytes=new Uint8Array(buffer).slice();assert.deepEqual(waitRootStartup(buffer,0),{version:1,status:"ready",root});assert.deepEqual(new Uint8Array(buffer),bytes);const invalid=createRootStartupBuffer();assert.throws(()=>publishRootStartup(invalid,{version:1,status:"failed",code:"sk-private-cause"} as any),error=>error instanceof RootStartupError&&error.code==="ROOT_STARTUP_ENVELOPE_INVALID")
})
test("RS67-07 actual synchronous session helper never recreates a vanished root or accepts a noncanonical root alias",async()=>{
 const f=await fixture();try{const absent=join(f.base,"vanished");assert.throws(()=>prepareSessionDirectory(absent),/SESSION_DIRECTORY_UNSAFE/);assert.equal(fs.existsSync(absent),false);const alias=join(f.base,"alias");await symlink(f.root,alias);assert.throws(()=>prepareSessionDirectory(alias),/SESSION_DIRECTORY_UNSAFE/);assert.equal(fs.existsSync(join(f.root,"session")),false);assert.equal(prepareSessionDirectory(f.root),join(f.root,"session"));assert.equal(fs.lstatSync(join(f.root,"session")).isDirectory(),true)}finally{await f.cleanup()}
})
test("RS67-08 actual synchronous session helper detects a root inode replacement during directory creation",async t=>{
 const f=await fixture();let changed=false
 try{const original=fs.mkdirSync;t.mock.method(fs,"mkdirSync",(path:fs.PathLike,options?:fs.MakeDirectoryOptions)=>{if(path===join(f.root,"session")&&!changed){changed=true;fs.renameSync(f.root,f.root+"-old");original(f.root);fs.writeFileSync(join(f.root,"foreign.txt"),"new directory owner")}return original(path,options)});syncBuiltinESMExports();assert.throws(()=>prepareSessionDirectory(f.root),/SESSION_DIRECTORY_UNSAFE/);assert.equal(changed,true);assert.equal(await readFile(join(f.root,"foreign.txt"),"utf8"),"new directory owner");assert.equal(fs.existsSync(join(f.root+"-old","xuanxiang-app.json")),true)}finally{t.mock.restoreAll();syncBuiltinESMExports();await f.cleanup()}
})
test("RS67-09 actual worker ready catch waits for failed seed engines to close before publishing a safe failure and never adopts",async()=>{
 const f=await fixture();let release!:()=>void;const closed=new Promise<void>(done=>{release=done});let closeStarted=false,settled=false
 try{await rm(join(f.bootstrap,"data-root.json"));const source=ts.createSourceFile("worker.ts",fs.readFileSync("desktop/service/index.ts","utf8"),ts.ScriptTarget.Latest,true),statement=source.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>declaration.name.getText(source)==="ready"));assert.ok(statement&&ts.isVariableStatement(statement));const expression=statement.declarationList.declarations.find(declaration=>declaration.name.getText(source)==="ready")?.initializer;assert.ok(expression);const startup=createRootStartupBuffer();const work=new Function("workerData","readRootStartup","ROOT_STARTUP_BYTES","RootStartupError","startOwnedRoot","Workspaces","prisma","PROMPT_TEMPLATES","LocalDispatcher",transformSync(`let works,dispatcher;const ready=${expression.getText(source)};return ready`,{loader:"ts"}).code)({root:f.root,bootstrap:f.bootstrap,migrations:"fixture",startup},()=>null,65536,RootStartupError,startOwnedRoot,class{async initialize(){}async run(_workspace:string,callback:()=>Promise<void>){await callback()}async close(){closeStarted=true;await closed}},{promptTemplate:{async upsert(){throw Error("sk-secret-seed-cause")}}},[{key:"test"}],class{}) as Promise<string>;void work.catch(()=>{});void work.then(()=>{settled=true},()=>{settled=true});for(let i=0;i<100&&!closeStarted;i++)await new Promise(done=>setTimeout(done,1));assert.equal(closeStarted,true);assert.equal(settled,false);assert.equal(fs.existsSync(join(f.bootstrap,"data-root.json")),false);release();await assert.rejects(work,error=>error instanceof RootStartupError&&error.message==="ROOT_INITIALIZATION_FAILED"&&!String(error).includes("sk-secret"));assert.equal(fs.existsSync(join(f.bootstrap,"data-root.json")),false)}finally{release?.();await f.cleanup()}
})
test("RS67-10 a valid historic rolled-back journal without its pointer requires manual recovery rather than initializing another root",async()=>{
 const f=await fixture();let opens=0
 try{await mkdir(join(f.root,"inbox"));await rm(join(f.bootstrap,"data-root.json"));const migrationId=randomUUID(),journal={schemaVersion:1,migrationId,phase:"rolled-back",source:f.pointer,target:await directoryIdentity(f.outside),stage:`.xuanxiang-migration-${migrationId}`,sourceInboxIdentity:await directoryIdentity(join(f.root,"inbox")),files:[],directories:[],createdAt:new Date().toISOString(),pending:[]};const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)])):value;await writeFile(join(f.bootstrap,"root-migration.json"),JSON.stringify({journal,sha256:createHash("sha256").update(JSON.stringify(canonical(journal))).digest("hex")}));const missing=join(f.base,"unrelated-default");await assert.rejects(startOwnedRoot({root:missing,bootstrap:f.bootstrap},async()=>{opens++;return"engine"}),error=>error instanceof RootStartupError&&error.code==="MIGRATION_RECOVERY_REQUIRED");assert.equal(opens,0);assert.equal(fs.existsSync(missing),false);assert.equal(await readFile(join(f.outside,"user.txt"),"utf8"),"external user bytes");assert.equal(fs.existsSync(join(f.bootstrap,"data-root.json")),false)}finally{await f.cleanup()}
})
