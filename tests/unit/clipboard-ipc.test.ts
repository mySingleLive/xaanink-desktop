import {mainFunction} from "../helpers/main-function"
import assert from "node:assert/strict"
import {test} from "node:test"
import {readFileSync} from "node:fs"
import ts from "typescript"
import {transformSync} from "esbuild"
import {z} from "zod"
const source=readFileSync(new URL("../../desktop/main/index.ts",import.meta.url),"utf8")
const syntax=ts.createSourceFile("main.ts",source,ts.ScriptTarget.Latest,true)
const body=["trusted","registerIpc"].map(name=>{const node=syntax.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.ok(node);return node.getText(syntax)}).join("\n")
function fixture(){
 const handlers=new Map<string,(...args:unknown[])=>Promise<unknown>>(),writes:string[]=[]
 const frame={url:"xaanink://app/"},contents={mainFrame:frame},event={sender:contents,senderFrame:frame}
 let focused=true,text="选中的正文",resolveRead:((value:string)=>void)|undefined
 const clipboard={readText:()=>new Promise<string>(resolve=>{resolveRead=resolve}),writeText:async(value:string)=>{writes.push(value)}}
 mainFunction("ipcMain","window","clipboard","z",`${transformSync(body,{loader:"ts"}).code}\nregisterIpc()`)(
  {handle:(id:string,fn:(...args:unknown[])=>Promise<unknown>)=>handlers.set(id,fn),on(){}},{webContents:contents,isFocused:()=>focused},clipboard,z)
 return {handlers,event,writes,setFocus:(value:boolean)=>{focused=value},release:()=>resolveRead?.(text),setText:(value:string)=>{text=value},
  invoke:(id:string,...args:unknown[])=>{const handler=handlers.get(id);assert.ok(handler,`registered ${id}`);return handler(event,...args)}}
}
test("clipboard write only accepts bounded text from focused trusted main renderer",async()=>{
 const f=fixture()
 await f.invoke("desktop:clipboard-write","选中的正文");assert.deepEqual(f.writes,["选中的正文"])
 for(const value of [null,{text:"伪造"},"x".repeat(1024*1024+1)])await assert.rejects(f.invoke("desktop:clipboard-write",value))
 f.setFocus(false);await assert.rejects(f.invoke("desktop:clipboard-write","后台内容"),/聚焦/)
 f.setFocus(true);await assert.rejects(f.handlers.get("desktop:clipboard-write")!({sender:{},senderFrame:f.event.senderFrame},"跨窗口"),/不受信/)
 await assert.rejects(f.handlers.get("desktop:clipboard-write")!({sender:f.event.sender,senderFrame:{url:"xaanink://app/"}},"子框架"),/不受信/)
 assert.deepEqual(f.writes,["选中的正文"])
})
test("clipboard read rechecks focus and frame after the async native read",async()=>{
 const f=fixture();let result=f.invoke("desktop:clipboard-read");f.release();assert.equal(await result,"选中的正文")
 result=f.invoke("desktop:clipboard-read");f.setFocus(false);f.release();await assert.rejects(result,/聚焦/)
 f.setFocus(true);f.setText("x".repeat(1024*1024+1));result=f.invoke("desktop:clipboard-read");f.release();await assert.rejects(result,/过长/)
})
