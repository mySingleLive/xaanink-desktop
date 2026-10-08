import {mainFunction} from "../helpers/main-function"
import assert from "node:assert/strict"
import {test} from "node:test"
import {readFileSync} from "node:fs"
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {randomUUID} from "node:crypto"
import ts from "typescript"
import {transformSync} from "esbuild"
import {z} from "zod"
import {DraftJournal} from "../../desktop/main/draft-journal"
import {RendererCloseChannel} from "../../desktop/main/renderer-close-channel"
import {DesktopDraftSession} from "../../src/lib/desktop/draft-session"
import {DesktopSaveCoordinator} from "../../src/lib/desktop/save-coordinator"
import type {DesktopBridge} from "../../desktop/shared/ipc"
import type {DraftSnapshot} from "../../desktop/shared/drafts"
import type {CloseOwner} from "../../desktop/main/close-coordinator"

const syntax=ts.createSourceFile("main.ts",readFileSync("desktop/main/index.ts","utf8"),ts.ScriptTarget.Latest,true)
const body=["trusted","registerIpc","flushDraftForClose"].map(name=>{
 const node=syntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node);return node.getText(syntax)
}).join("\n").replace(/\bdraftSession\b/g,"harnessState.session").replace(/\bclosingFlow\b/g,"harnessState.closing")

test("B55-07: failed unready boot closes via actual main handshake without changing a valid or corrupt original journal",async()=>{
 const root=await mkdtemp(join(tmpdir(),"xuanxiang-unready-close-"))
 try{
  for(const scenario of ["source-failure","corrupt-file"]){
   const journal=new DraftJournal(root),nonce=randomUUID(),owner=55,release=journal.activate(String(owner))
   const snapshot:DraftSnapshot={version:1,revision:1,createdAt:new Date().toISOString(),autosaves:[],sources:{chat:{draft:"original inert manuscript"}},issues:[]}
   if(scenario==="source-failure")await journal.persist(String(owner),snapshot)
   else await writeFile(join(root,"drafts.json"),"CORRUPT AUTHOR RECOVERY\0\n")
   const before=await readFile(join(root,"drafts.json")),frame={url:"xaanink://app/"},contents={id:owner,mainFrame:frame},event={sender:contents,senderFrame:frame}
   const state={session:{owner,id:nonce,ready:false},closing:false},handlers=new Map<string,(...args:unknown[])=>Promise<unknown>>()
   let renderer!:DesktopDraftSession
   const channel=new RendererCloseChannel(event=>{void renderer.handle(event)})
   const runtime=mainFunction("ipcMain","window","z","harnessState","draftJournal","closeChannel",transformSync(body,{loader:"ts"}).code+"\nregisterIpc();return {flush:flushDraftForClose}")(
    {handle:(id:string,handler:(...args:unknown[])=>Promise<unknown>)=>handlers.set(id,handler),on(){}},{webContents:contents},z,state,journal,channel) as {flush:(owner:CloseOwner,retry:boolean)=>Promise<void>}
   const invoke=(id:string,...args:unknown[])=>{const handler=handlers.get(id);assert.ok(handler);return handler(event,...args)}
   const bridge={readDraft:(session:string)=>invoke("desktop:draft-read",session),markDraftReady:(session:string)=>invoke("desktop:draft-ready",session),persistDraft:(session:string,value:DraftSnapshot)=>invoke("desktop:draft-persist",session,value),replyClose:(session:string,id:string,reply:unknown)=>invoke("desktop:close-reply",session,id,reply)} as unknown as DesktopBridge
   renderer=new DesktopDraftSession(bridge,new DesktopSaveCoordinator({checkpointDelayMs:null}),{restore:()=>{},installSources:()=>{throw Error("source registration rejected")},flushSettings:async()=>{},closing:()=>{}})
   try{
    await assert.rejects(renderer.initialize(nonce),/source registration|草稿格式/)
    assert.equal(state.session.ready,false)
    state.closing=true;await runtime.flush({owner,sessionId:nonce},false)
    assert.deepEqual(await readFile(join(root,"drafts.json")),before,"unmodified close must preserve the exact original bytes")
   }finally{renderer.dispose();channel.cancel();release()}
  }
 }finally{await rm(root,{recursive:true,force:true})}
})
