import {mainFunction} from "../helpers/main-function"
import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {mkdtemp,readFile,readdir,rm,writeFile,symlink} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {randomUUID} from "node:crypto"
import {test} from "node:test"
import ts from "typescript"
import {transformSync} from "esbuild"
import {z} from "zod"
import {lstat} from "node:fs/promises"
import {validateDraftSnapshot} from "../../desktop/main/draft-journal"
import {FileExports,type FileExportOptions} from "../../desktop/main/file-export"
import {fileExportFailureMessages} from "../../desktop/shared/file-export"
import {RendererCloseChannel} from "../../desktop/main/renderer-close-channel"
import type {DraftSnapshot} from "../../desktop/shared/drafts"
import type {PrepareClose} from "../../desktop/shared/close"

// Actual narrow main handlers and export implementation, with native dialog
// choice controlled. Files use isolated temp roots; this does not launch GUI.
const syntax=ts.createSourceFile("main.ts",readFileSync("desktop/main/index.ts","utf8"),ts.ScriptTarget.Latest,true)
const body=["trusted","exportDraftSnapshot","registerIpc"].map(name=>{
 const node=syntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node);return node.getText(syntax)
}).join("\n")
const snapshot=():DraftSnapshot=>({version:1,revision:3,createdAt:new Date().toISOString(),autosaves:[],sources:{chat:{draft:"unapproved source"}},issues:[]})
function rig(chosen:{canceled:boolean;filePath?:string},hooks:Partial<Pick<FileExportOptions,"beforeRename"|"beforeDirectorySync">>={}){
 const handlers=new Map<string,(...args:unknown[])=>Promise<unknown>>(),frame={url:"xaanink://app/"},contents={id:53,mainFrame:frame},event={sender:contents,senderFrame:frame}
 const draftSession={owner:53,id:randomUUID()},events:PrepareClose[]=[],channel=new RendererCloseChannel(value=>events.push(value));let dialogs=0
 const dialog={showSaveDialog:async()=>{dialogs++;return chosen}}
 const recoveryExports=new FileExports({...hooks,assertOwner:owner=>{if(owner!==`53:${draftSession.id}`)throw Error("草稿所属窗口已变化")},chooseSave:async()=>{const result=await dialog.showSaveDialog();return result.canceled?null:result.filePath??null},guardTarget:async()=>{}})
 mainFunction("ipcMain","window","z","draftSession","closeChannel","validateDraftSnapshot","dialog","lstat","recoveryExports","randomUUID","fileExportFailureMessages",transformSync(body,{loader:"ts"}).code+"\nregisterIpc()")(
  {handle:(id:string,handler:(...args:unknown[])=>Promise<unknown>)=>handlers.set(id,handler),on(){}},{webContents:contents,isDestroyed:()=>false},z,draftSession,channel,validateDraftSnapshot,dialog,lstat,recoveryExports,randomUUID,fileExportFailureMessages)
 return{event,contents,draftSession,events,channel,dialogs:()=>dialogs,call:(id:string,...args:unknown[])=>{const handler=handlers.get(id);assert.ok(handler);return handler(event,...args)}}
}

test("C53-07: main close-reply requires the trusted current nonce as well as the pending action token",async()=>{
 const r=rig({canceled:true}),owner={owner:r.contents.id,sessionId:r.draftSession.id},pending=r.channel.request(owner,"flush")
 try{
  await assert.rejects(r.call("desktop:close-reply",randomUUID(),r.events[0].id,{status:"failed"}),/窗口/)
  assert.equal(await r.call("desktop:close-reply",owner.sessionId,r.events[0].id,{status:"export",snapshot:snapshot()}),false)
  assert.equal(await r.call("desktop:close-reply",owner.sessionId,randomUUID(),{status:"failed"}),false)
  assert.equal(await r.call("desktop:close-reply",owner.sessionId,r.events[0].id,{status:"failed"}),true)
  assert.deepEqual(await pending,{status:"failed"})
 }finally{r.channel.cancel();await pending.catch(()=>{})}
})

test("C53-08: native export cancellation and stale session do not write any recovery file",async()=>{
 let writes=0;const r=rig({canceled:true},{beforeRename:async()=>{writes++}})
 assert.equal(await r.call("desktop:draft-export",r.draftSession.id,snapshot()),false)
 await assert.rejects(r.call("desktop:draft-export",randomUUID(),snapshot()),/窗口/)
 assert.equal(r.dialogs(),1);assert.equal(writes,0)
})

test("C53-09: export owner replacement before rename preserves the prior file and cleans its owned temporary",async()=>{
 const root=await mkdtemp(join(tmpdir(),"xuanxiang-export-review-")),path=join(root,"recovery.json"),old="previous author recovery\n"
 await writeFile(path,old)
 const r=rig({canceled:false,filePath:path},{beforeRename:async()=>{r.draftSession.id=randomUUID()}})
 try{
  await assert.rejects(r.call("desktop:draft-export",r.draftSession.id,snapshot()),/窗口/)
  assert.equal(await readFile(path,"utf8"),old);assert.deepEqual(await readdir(root),["recovery.json"])
 }finally{await rm(root,{recursive:true,force:true})}
})

test("C53-10: a symlink export target is rejected before changing its author file",async()=>{
 const root=await mkdtemp(join(tmpdir(),"xuanxiang-export-link-")),author=join(root,"author.json"),link=join(root,"recovery.json")
 await writeFile(author,"author bytes");await symlink(author,link)
 const r=rig({canceled:false,filePath:link})
 try{
  await assert.rejects(r.call("desktop:draft-export",r.draftSession.id,snapshot()),/普通文件/)
  assert.equal(await readFile(author,"utf8"),"author bytes");assert.equal((await lstat(link)).isSymbolicLink(),true)
 }finally{await rm(root,{recursive:true,force:true})}
})

test("C53-11: failed export directory sync never acknowledges export success",async()=>{
 const root=await mkdtemp(join(tmpdir(),"xuanxiang-export-sync-")),path=join(root,"recovery.json")
 const r=rig({canceled:false,filePath:path},{beforeDirectorySync:async()=>{throw Error("isolated directory sync failure")}})
 try{
  await assert.rejects(r.call("desktop:draft-export",r.draftSession.id,snapshot()),/同步|sync|durability|确认保存/)
  const written=JSON.parse(await readFile(path,"utf8"));assert.equal(written.snapshot.sources.chat.draft,"unapproved source")
  assert.deepEqual(await readdir(root),["recovery.json"],"already-renamed inert recovery is retained rather than deleted on an uncertain sync")
 }finally{await rm(root,{recursive:true,force:true})}
})
