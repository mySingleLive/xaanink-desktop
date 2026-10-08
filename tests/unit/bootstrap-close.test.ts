import {mainFunction} from "../helpers/main-function"
import assert from "node:assert/strict"
import {test} from "node:test"
import {readFileSync} from "node:fs"
import {randomUUID} from "node:crypto"
import ts from "typescript"
import {transformSync} from "esbuild"
import {z} from "zod"
import type {CloseReply} from "../../desktop/shared/close"
const syntax=ts.createSourceFile("main.ts",readFileSync("desktop/main/index.ts","utf8"),ts.ScriptTarget.Latest,true)
const functions=["trusted","registerIpc","flushDraftForClose"].map(name=>syntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)?.getText(syntax)??`function ${name}(){throw Error("unimplemented ${name}")}`).join("\n")
function rig(){
 const frame={url:"xaanink://app/"},contents={id:12,mainFrame:frame},event={sender:contents,senderFrame:frame},handlers=new Map<string,(...args:unknown[])=>Promise<unknown>>()
 const session={owner:12,id:randomUUID(),ready:false},calls:string[]=[],state={session:session as typeof session|null,closing:false,reply:{status:"unmodified"} as CloseReply},bootstrap=Promise.withResolvers<object>(),bootstrapReading=Promise.withResolvers<void>()
 const runtime=mainFunction("ipcMain","window","z","harnessState","draftJournal","closeChannel","repository","app","nativeTheme","restoreDraftBarrier",transformSync(functions.replace(/\bdraftSession\b/g,"harnessState.session").replace(/\bclosingFlow\b/g,"harnessState.closing"),{loader:"ts"}).code+"\nconst dataRoot='/controlled';registerIpc();return {flush:flushDraftForClose}")(
  {handle:(id:string,handler:(...args:unknown[])=>Promise<unknown>)=>handlers.set(id,handler),on(){}},{webContents:contents},z,state,
  {persist:async()=>{calls.push("persist");return{revision:1,digest:"f".repeat(64),clientRevision:2}},confirm:async()=>{calls.push("confirm")}},
  {request:async()=>state.reply},{read:()=>{bootstrapReading.resolve();return bootstrap.promise}},{getVersion:()=>"0.1.0"},{shouldUseDarkColors:false},{inspect:async()=>null})
 return{session,state,event,contents,calls,bootstrap,bootstrapReading:bootstrapReading.promise,flush:()=>runtime.flush({owner:session.owner,sessionId:session.id},false) as Promise<void>,call:(id:string,nonce=session.id)=>{const handler=handlers.get(id);assert.ok(handler,`registered ${id}`);return handler(event,nonce,{})}}
}
test("a renderer that has not acknowledged restoration cannot persist an empty replacement",async()=>{
 const r=rig();await assert.rejects(r.call("desktop:draft-persist"),/恢复|就绪/);assert.deepEqual(r.calls,[])
 await r.call("desktop:draft-ready");assert.equal(r.session.ready,true);await r.call("desktop:draft-persist");assert.deepEqual(r.calls,["persist"])
})
test("main rejects a late ready transition once the close barrier owns the session",async()=>{
 const r=rig();r.state.closing=true;await assert.rejects(r.call("desktop:draft-ready"),/关闭/);assert.equal(r.session.ready,false)
 r.state.closing=false;await assert.rejects(r.call("desktop:draft-ready",randomUUID()),/窗口/);assert.equal(r.session.ready,false)
})
test("only the current unready session can close without a new journal write",async()=>{
 const r=rig();await r.flush();assert.deepEqual(r.calls,[]);r.session.ready=true;await assert.rejects(r.flush(),/保存/);assert.deepEqual(r.calls,[])
})
test("saved replies still require the main durable receipt check",async()=>{
 const r=rig();r.session.ready=true;r.state.reply={status:"saved",receipt:{revision:1,clientRevision:2,digest:"f".repeat(64)}};await r.flush();assert.deepEqual(r.calls,["confirm"])
})
test("a stale owner cannot use an unmodified reply after the window lifetime changes",async()=>{
 const r=rig();r.state.session={...r.session,id:randomUUID()};await assert.rejects(r.flush(),/窗口|保存/);assert.deepEqual(r.calls,[])
})
test("bootstrap rechecks the trusted lifetime after its settings read",async()=>{
 const r=rig(),pending=r.call("desktop:bootstrap"),rejected=assert.rejects(pending,/窗口|不受信/);await r.bootstrapReading;r.state.session={...r.session,id:randomUUID()};r.bootstrap.resolve({});await rejected
})
