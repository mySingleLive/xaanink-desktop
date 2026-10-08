import assert from "node:assert/strict"
import {test} from "node:test"
import {readFileSync} from "node:fs"
import ts from "typescript"
import {transformSync} from "esbuild"
import {join,resolve} from "node:path"
const syntax=ts.createSourceFile("main.ts",readFileSync("desktop/main/index.ts","utf8"),ts.ScriptTarget.Latest,true)
const launch=syntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="launch") as ts.FunctionDeclaration
assert(launch?.body)
const workerCreation=syntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="createOrdinaryServiceWorker") as ts.FunctionDeclaration
assert(workerCreation?.body)
const workerSource=workerCreation.getText(syntax)
const statements=launch.body.statements
const boundary=statements.findIndex(node=>node.getText(syntax)==="await app.whenReady()")
assert(boundary>0)
const prefix=statements.slice(0,boundary).map(node=>node.getText(syntax)).join("\n")
function runStartup(outcome:{status:string;root?:string;code?:string}){
 const trace:unknown[]=[];let workerData:Record<string,unknown>|undefined
 const shared=new SharedArrayBuffer(65536)
 const start=new Function("Worker","RpcPeer","app","join","resolve","homedir","mkdirSync","Atomics","createRootStartupBuffer","waitRootStartup","prepareSessionDirectory","assertNoLegacyBackupRecovery","startupPaths","startupSelectionError",transformSync(`let dataRoot,worker,service,applicationRequests,applicationProtectedOperationId,modelService;let failedRootBeforeSession=false,serviceProtected=false,ordinaryWorkerExited=false;const applicationHandoff=null;const applicationBlocked=()=>false;const applicationRestorePreflight=()=>({bootstrap:{path:'/canonical/bootstrap',dev:1,ino:1},startup:{mode:'normal'}});class ApplicationRestoreRequests{constructor(){} };const applicationMetadata={write:run=>run(),acquire:()=>{throw Error('normal startup has no capture authority')},release:()=>{throw Error('normal startup has no capture authority')},revoke:()=>{}};const conversationDirectories={revokeAll:()=>{},workerStopped:()=>{}};const responseOwners=new Map();const send=()=>{};const bootstrapPath='/canonical/bootstrap';const __dirname='/bundle/main';${workerSource};async function launch(){${prefix};return dataRoot};return launch`,{loader:"ts"}).code)(
  class{constructor(_path:unknown,options:{workerData:Record<string,unknown>}){workerData=options.workerData;trace.push("worker")};on(){}},
  class{async call(method:string){trace.push(method);return true}},
  {hasSingleInstanceLock:()=>true,isPackaged:true,getAppPath:()=>"/bundle",setPath:(kind:string,path:string)=>trace.push({kind,path})},join,resolve,()=>"/home/author",(path:string)=>trace.push({mkdir:path}),
  {wait:()=>"not-equal",load:()=>1},()=>shared,(_buffer:unknown)=>{trace.push("barrier");return outcome},
  (root:string)=>{const path=join(root,"session");trace.push({mkdir:path});return path},
  (bootstrap:string,guard:()=>void)=>{assert.equal(bootstrap,"/canonical/bootstrap");guard()},
  {bootstrap:"/canonical/bootstrap",defaultRoot:"/selected/default-root",encryptionFamily:"current"},null,
 ) as ()=>Promise<string>
 return{start,trace,get workerData(){return workerData}}
}
test("main startup chooses worker's resolved canonical root before any sessionData initialization",async()=>{
 const r=runStartup({status:"ready",root:"/chosen/canonical-root"})
 assert.equal(await r.start(),"/chosen/canonical-root")
 assert.equal(r.workerData?.bootstrap,"/canonical/bootstrap")
 assert.equal(r.workerData?.root,"/selected/default-root","worker must receive the selected default before its canonical root barrier")
 assert.deepEqual(r.trace,["worker","barrier",{mkdir:"/chosen/canonical-root/session"},{kind:"sessionData",path:"/chosen/canonical-root/session"},"ready"])
})
test("failed root resolution does not initialize a fallback session or open the application",async()=>{
 const r=runStartup({status:"failed",code:"ROOT_UNAVAILABLE"})
 await assert.rejects(r.start(),/ROOT_UNAVAILABLE/)
 assert.deepEqual(r.trace,["worker","barrier"])
})
test("the source root barrier remains before the first await in launch",()=>{
 const barrier=prefix.indexOf("waitRootStartup(")
 assert(barrier>=0);assert(barrier<prefix.indexOf('await service.call("ready")'))
 assert(prefix.indexOf("createOrdinaryServiceWorker()")<barrier)
 const preceding=prefix.slice(0,barrier)
 // Async RPC closures do not run during the synchronous launch prefix.
 const outer=ts.createSourceFile("prefix.ts",`async function launch(){${preceding}void 0}`,ts.ScriptTarget.Latest,true)
 const fn=outer.statements[0] as ts.FunctionDeclaration
 const visit=(node:ts.Node):void=>{if(ts.isFunctionLike(node))return;assert(!ts.isAwaitExpression(node));ts.forEachChild(node,visit)}
 for(const statement of fn.body!.statements)visit(statement)
 // The actual extracted worker constructor is part of that synchronous turn.
 // Inspect its body too; its asynchronous RPC callback still is not invoked.
 for(const statement of workerCreation.body!.statements)visit(statement)
})
