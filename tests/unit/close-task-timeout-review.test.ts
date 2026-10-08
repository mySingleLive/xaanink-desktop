import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {mkdtemp,rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {randomUUID} from "node:crypto"
import {test} from "node:test"
import ts from "typescript"
import {CloseCoordinator} from "../../desktop/main/close-coordinator"
import {ModelRepository,type ModelDraft} from "../../desktop/main/model-repository"
import {ModelGateway} from "../../desktop/core/model-authorization"
import {ModelService} from "../../desktop/main/model-service"

// Execute the actual worker RPC callback body without rebuilding or starting
// Electron. Only its IO dependencies are controlled; the close/stop logic is
// extracted from the current source. This is a cancellation contract test,
// not a native-worker acceptance test.
const file=ts.createSourceFile("desktop/service/index.ts",readFileSync("desktop/service/index.ts","utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
let dispatchSource=""
function walk(node:ts.Node){
 if(ts.isNewExpression(node)&&node.expression.getText(file)==="RpcPeer"&&node.arguments?.length===2)dispatchSource=node.arguments[1].getText(file)
 ts.forEachChild(node,walk)
}
walk(file);assert.ok(dispatchSource)
const compiled=ts.transpileModule(`const dispatch=${dispatchSource};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText

test("C53-05: stopping must bound pending response cancellation before its task-finally deadline",async t=>{
 t.mock.timers.enable({apis:["setTimeout","Date"]})
 const gate=Promise.withResolvers<void>(),pendingStarts=new Set<Promise<void>>(),responses=new Map([["pending-response",{}]]),starting=new Map(),ready=Promise.resolve()
 let closed=false,settled=false,error:unknown
 const create=new Function("ready","localAttemptCount","abortAllLocalAttempts","responses","starting","cancel","pendingStarts","delay","works",`${compiled}\nreturn dispatch`)
 const dispatch=create(ready,()=>0,()=>{},responses,starting,async()=>gate.promise,pendingStarts,(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),{close:async()=>{closed=true}}) as (method:string,value?:unknown)=>Promise<unknown>
 const request=dispatch("stop-tasks").then(()=>{settled=true},reason=>{settled=true;error=reason})
 try {
  await new Promise(setImmediate)
  // Advance well past both the worker's documented eight-second stop wait and
  // the renderer's twenty-second close wait. The latter starts only later.
  t.mock.timers.tick(60000);await new Promise(setImmediate)
  assert.equal(closed,false)
  assert.equal(settled,true,"pending cancel before the deadline must fail closed with a bounded error, leaving the window available")
  assert.ok(error instanceof Error)
 }finally{gate.resolve();await request;t.mock.timers.reset()}
})

test("C53-05b: pending handler-finally is bounded and its late stop cannot cancel a subsequent task",async t=>{
 t.mock.timers.enable({apis:["setTimeout","Date"]})
 const gate=Promise.withResolvers<void>(),pendingStarts=new Set([gate.promise]),responses=new Map(),starting=new Map(),ready=Promise.resolve()
 let aborts=0,loops=0,active=1
 const create=new Function("ready","localAttemptCount","abortAllLocalAttempts","responses","starting","cancel","pendingStarts","delay","works",`${compiled}\nreturn dispatch`)
 const dispatch=create(ready,()=>active,()=>{aborts++},responses,starting,async()=>{},pendingStarts,(ms:number)=>{loops++;return new Promise(resolve=>setTimeout(resolve,ms))},{close:async()=>{throw Error("must retain database")}}) as (method:string)=>Promise<unknown>
 const old=dispatch("stop-tasks"),rejected=assert.rejects(old,/保存停止状态/)
 try{
  await new Promise(setImmediate);t.mock.timers.tick(8000);await rejected
  active=2;gate.resolve();await new Promise(setImmediate)
  assert.equal(aborts,1);assert.equal(loops,0,"expired stop must not retain a polling loop for new tasks")
 }finally{active=0;gate.resolve();await old.catch(()=>{});t.mock.timers.reset()}
})

test("C53-06: main stop timeout retains pending model ownership and a late completion does not re-pause the reopened service",async t=>{
 const mainFile=ts.createSourceFile("desktop/main/index.ts",readFileSync("desktop/main/index.ts","utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
 let stopSource=""
 function walkMain(node:ts.Node){
  if(ts.isNewExpression(node)&&node.expression.getText(mainFile)==="CloseCoordinator"&&node.arguments?.length===1&&ts.isObjectLiteralExpression(node.arguments[0])){
   const property=node.arguments[0].properties.find(item=>ts.isPropertyAssignment(item)&&item.name.getText(mainFile)==="stopTasks")
   if(property&&ts.isPropertyAssignment(property))stopSource=property.initializer.getText(mainFile)
  }
  ts.forEachChild(node,walkMain)
 }
 walkMain(mainFile);assert.ok(stopSource)
 const mainCompiled=ts.transpileModule(`const stop=${stopSource};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText
 const root=await mkdtemp(join(tmpdir(),"xuanxiang-close-review-")),gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>()
 let repository!:ModelRepository,fetches=0,resumed=0,closedData=0,flushes=0,commits=0
 const gateway=new ModelGateway({keyFor:(id,rev)=>repository.keyFor(id,rev),fetch:async()=>{if(++fetches===1){entered.resolve();await gate.promise}return new Response("isolated text")}})
 repository=new ModelRepository(join(root,"state.json"),{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},gateway)
 const modelService=new ModelService(repository,gateway)
 const draft:ModelDraft={name:"isolated model",provider:"custom",protocol:"openai",kind:"TEXT",modelId:"isolated-text",endpoint:"https://fixture.invalid/v1",contextWindow:0,enabled:true,thinkingLevels:[],defaultThinking:"default",apiKey:"isolated-secret"}
 const state=await repository.saveModel(0,draft),model=state.models[0]
 const input={id:randomUUID(),modelId:model.id,authRevision:model.authRevision,kind:model.kind,url:model.endpoint+"/chat/completions",method:"POST",headers:{},body:JSON.stringify({model:model.modelId})}
 const pending=modelService.start(input),cancelled=assert.rejects(pending,/AUTHORIZATION_REVOKED/);await entered.promise
 const stop=new Function("window","modelConfiguration","modelService","service",`${mainCompiled}\nreturn stop`)({webContents:{id:9}},{cancelOwner(){}},modelService,{call:async()=>true}) as ()=>Promise<void>
 const coordinator=new CloseCoordinator({current:()=>({owner:9,sessionId:"same-owner"}),busy:async()=>true,confirmStop:async()=>true,stopTasks:stop,flush:async()=>{flushes++},closeData:async()=>{closedData++},failed:async()=>"cancel",exportDraft:async()=>{},commit:()=>{commits++},release:()=>{resumed++;modelService.resume()}})
 t.mock.timers.enable({apis:["setTimeout","Date"]})
 try{
  const closing=coordinator.request("window");await new Promise(setImmediate);t.mock.timers.tick(10000);assert.equal(await closing,false)
  assert.equal(modelService.activeCount,1,"an unsettled old transfer remains tracked after timeout")
  assert.deepEqual([flushes,closedData,commits,resumed],[0,0,0,1])
  await modelService.start({...input,id:randomUUID()});assert.equal(modelService.activeCount,2)
  gate.resolve();await cancelled;await new Promise(setImmediate)
  assert.equal(modelService.activeCount,1)
  await modelService.start({...input,id:randomUUID()});assert.equal(modelService.activeCount,2,"late old close completion must not re-pause the resumed service")
 }finally{gate.resolve();await cancelled;await modelService.close();t.mock.timers.reset();await rm(root,{recursive:true,force:true})}
})
