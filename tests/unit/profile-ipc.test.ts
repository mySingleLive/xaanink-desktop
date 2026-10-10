import {mainFunction} from "../helpers/main-function"
import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import ts from "typescript"
import { transformSync } from "esbuild"
import { z } from "zod"
import sharp from "sharp"
import { AvatarAssetService, AvatarAssetError, type AvatarAssetOptions } from "../../desktop/main/avatar-assets"
import { defaultState, settingsSchema, type Settings } from "../../desktop/core/settings"
import { RevisionConflict } from "../../desktop/core/versioned-store"
import type { StateSnapshot } from "../../desktop/shared/ipc"

// Execute the current main-process handler bodies, not a copy of their logic.
// Electron IPC, native picker and repository are controlled dependencies; asset
// decoding/file persistence are real. No Electron process or native picker UI.
const mainSource=readFileSync(new URL("../../desktop/main/index.ts",import.meta.url),"utf8")
const syntax=ts.createSourceFile("main.ts",mainSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
function declaration(name:string){const node=syntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(node,`main function ${name}`);return node.getText(syntax)}
const handlersSource=transformSync(`${declaration("trusted")}\n${declaration("registerIpc")}`,{loader:"ts",format:"cjs"}).code
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return {promise,resolve}}
async function fixture(options:{read?:(state:StateSnapshot)=>Promise<StateSnapshot>;pick?:()=>Promise<{canceled:boolean;filePaths:string[]}>;failSave?:()=>boolean;assets?:Partial<AvatarAssetOptions>}={}){
  const root=await mkdtemp(join(tmpdir(),"xuanxiang-profile-ipc-")),assets=new AvatarAssetService({root,...options.assets}),handlers=new Map<string,(event:unknown,...args:unknown[])=>Promise<unknown>>()
  const frame={url:"xaanink://app/"},contents={id:37,mainFrame:frame,setZoomFactor(){}}
  const event={sender:contents,senderFrame:frame},published:unknown[]=[],updates:Settings[]=[],pickerCalls:unknown[]=[],state:StateSnapshot={revision:3,settings:structuredClone(defaultState.settings),models:[]}
  const repository={
    async read(){return options.read?await options.read(structuredClone(state)):structuredClone(state)},
    async updateSettings(revision:number,settings:Settings){updates.push(structuredClone(settings));if(revision!==state.revision||options.failSave?.())throw new RevisionConflict();state.revision++;state.settings=structuredClone(settings);return structuredClone(state)},
  }
  const nativeDialog={async showOpenDialog(...args:unknown[]){pickerCalls.push(args);return await options.pick?.()??{canceled:true,filePaths:[]}}}
  mainFunction("ipcMain","avatarAssets","repository","dialog","window","send","z","settingsSchema","RevisionConflict",`${handlersSource};registerIpc();`)(
    {handle:(name:string,handler:(event:unknown,...args:unknown[])=>Promise<unknown>)=>handlers.set(name,handler),on(){}},assets,repository,nativeDialog,{webContents:contents},(value:unknown)=>published.push(value),z,settingsSchema,RevisionConflict,
  )
  const invoke=(name:string,...args:unknown[])=>{const handler=handlers.get(name);assert.ok(handler,`Registered IPC ${name}`);return handler(event,...args)}
  return {root,assets,handlers,event,state,published,updates,pickerCalls,invoke,profile:(sessionId:string,avatarDraftId?:string)=>({type:"save-profile",revision:state.revision,sessionId,user:{...state.settings.user,penName:"新笔名",email:"author@example.test"},...(avatarDraftId?{avatarDraftId}:{})}),async close(){assets.close();await rm(root,{recursive:true,force:true})}}
}
const cancelled=(error:unknown)=>error instanceof AvatarAssetError&&error.code==="CANCELLED"

test("profile IPC: an earlier cancel prevents registration of a queued text-only save",async()=>{
  const f=await fixture()
  try{const id=randomUUID();await f.invoke("desktop:avatar-cancel",id);await assert.rejects(f.invoke("desktop:settings",f.profile(id)),cancelled);assert.equal(f.updates.length,0);assert.equal(f.state.settings.user.penName,defaultState.settings.user.penName)}finally{await f.close()}
})

test("profile IPC: owner cleanup during the first repository await prevents the save from committing",async()=>{
  const entered=deferred<void>(),read=deferred<StateSnapshot>(),f=await fixture({read:async()=>{entered.resolve();return await read.promise}})
  try{const pending=f.invoke("desktop:settings",f.profile(randomUUID()));const rejected=assert.rejects(pending,cancelled);await entered.promise;f.assets.cancelOwner(String(f.event.sender.id));read.resolve(structuredClone(f.state));await rejected;assert.equal(f.updates.length,0);assert.deepEqual(f.published,[])}finally{read.resolve(structuredClone(f.state));await f.close()}
})

test("profile IPC: cancelling an open picker rejects its late path before reading the selected file",async()=>{
  const picker=deferred<{canceled:boolean;filePaths:string[]}>();let readCount=0
  const f=await fixture({pick:()=>picker.promise,assets:{readSelectedFile:async()=>{readCount++;return Buffer.alloc(0)}}})
  try{const id=randomUUID(),pending=f.invoke("desktop:avatar-choose",id),rejected=assert.rejects(pending,cancelled);await f.invoke("desktop:avatar-cancel",id);picker.resolve({canceled:false,filePaths:[join(f.root,"late.png")]});await rejected;assert.equal(readCount,0);assert.equal(f.updates.length,0)}finally{picker.resolve({canceled:true,filePaths:[]});await f.close()}
})

test("profile IPC: wrong sender/frame, forged avatar identity and generic user updates never commit",async()=>{
  const f=await fixture()
  try{
    const handler=f.handlers.get("desktop:settings")!,id=randomUUID()
    await assert.rejects(handler({sender:{id:38},senderFrame:f.event.senderFrame},f.profile(id)),/不受信/)
    await assert.rejects(handler({sender:f.event.sender,senderFrame:{url:"xuanxiang:\/\/app\/"}},f.profile(id)),/不受信/)
    await assert.rejects(f.invoke("desktop:settings",{...f.profile(id),user:{...f.state.settings.user,avatarAssetId:randomUUID()}}),/用户资料已变更/)
    await assert.rejects(f.invoke("desktop:settings",{...f.profile(randomUUID()),selectedPath:join(f.root,"ungranted.png")}))
    await assert.rejects(f.invoke("desktop:settings",{type:"update",revision:f.state.revision,settings:{...f.state.settings,user:{...f.state.settings.user,penName:"绕过资料事务"}}}),/编辑用户/)
    assert.equal(f.updates.length,0);assert.deepEqual(f.published,[])
  }finally{await f.close()}
})

test("profile IPC: profile CAS failure keeps the normalized avatar draft retryable and publishes both fields only on confirmation",async()=>{
  let fail=true
  const f=await fixture({failSave:()=>fail}),id=randomUUID()
  try{
    f.assets.begin(String(f.event.sender.id),id)
    const path=join(f.root,"source.png");await writeFile(path,await sharp({create:{width:8,height:16,channels:4,background:"red"}}).png().toBuffer())
    const draft=await f.assets.stageSelected(String(f.event.sender.id),id,path),request=f.profile(id,draft.draftId)
    await assert.rejects(f.invoke("desktop:settings",request),RevisionConflict)
    assert.equal(f.state.settings.user.penName,defaultState.settings.user.penName);assert.equal(f.state.settings.user.avatarAssetId,null);assert.deepEqual(f.published,[])
    const files=await readdir(join(f.root,"assets","global"));assert.equal(files.length,1)
    fail=false;await f.invoke("desktop:settings",request)
    assert.equal(f.state.settings.user.penName,"新笔名");assert.equal(f.state.settings.user.email,"author@example.test");assert.equal(`${f.state.settings.user.avatarAssetId}.png`,files[0])
    assert.equal(f.updates.length,2);assert.equal(f.published.length,1);assert.throws(()=>f.assets.assertActive(String(f.event.sender.id),id),cancelled)
    assert.deepEqual(await readdir(join(f.root,"assets","global")),files)
  }finally{await f.close()}
})

test("profile IPC: a late older picker cannot replace the newer selection's valid draft",async()=>{
  const old=deferred<{canceled:boolean;filePaths:string[]}>(),newer=deferred<{canceled:boolean;filePaths:string[]}>(),firstEntered=deferred<void>();let calls=0
  const f=await fixture({pick:()=>{if(calls++===0){firstEntered.resolve();return old.promise}return newer.promise}}),id=randomUUID()
  try{
    const oldPath=join(f.root,"old.png"),newPath=join(f.root,"new.png")
    await writeFile(oldPath,await sharp({create:{width:8,height:16,channels:4,background:"red"}}).png().toBuffer())
    await writeFile(newPath,await sharp({create:{width:16,height:8,channels:4,background:"blue"}}).png().toBuffer())
    const first=f.invoke("desktop:avatar-choose",id)
    const olderOutcome=first.then(value=>({value}),error=>({error}))
    await firstEntered.promise
    const second=f.invoke("desktop:avatar-choose",id)
    newer.resolve({canceled:false,filePaths:[newPath]});const latest=await second as {draftId:string;width:number;height:number}
    assert.equal(latest.width,16);assert.equal(latest.height,8)
    old.resolve({canceled:false,filePaths:[oldPath]});await olderOutcome
    const saved=await f.assets.persistDraft(String(f.event.sender.id),id,latest.draftId)
    assert.ok(await f.assets.readAsset(saved.assetId),"The draft shown by the latest renderer selection must remain saveable")
  }finally{old.resolve({canceled:true,filePaths:[]});newer.resolve({canceled:true,filePaths:[]});await f.close()}
})
test("profile IPC: selection cleanup cancels queued picker B while preserving accepted draft A",async()=>{
 const picker=deferred<{canceled:boolean;filePaths:string[]}>(),f=await fixture({pick:()=>picker.promise}),id=randomUUID()
 try{
  f.assets.begin(String(f.event.sender.id),id)
  const sourceA=join(f.root,"draft-a.png"),sourceB=join(f.root,"draft-b.png")
  await writeFile(sourceA,await sharp({create:{width:8,height:16,channels:4,background:"red"}}).png().toBuffer())
  await writeFile(sourceB,await sharp({create:{width:16,height:8,channels:4,background:"blue"}}).png().toBuffer())
  const draftA=await f.assets.stageSelected(String(f.event.sender.id),id,sourceA)
  const pending=f.invoke("desktop:avatar-choose",id,draftA.draftId),rejected=assert.rejects(pending)
  await f.invoke("desktop:avatar-selection-cancel",{sessionId:id,draftId:draftA.draftId})
  picker.resolve({canceled:false,filePaths:[sourceB]});await rejected
  f.assets.assertActive(String(f.event.sender.id),id,draftA.draftId)
  await f.invoke("desktop:settings",f.profile(id,draftA.draftId))
  const bytes=(await f.assets.readAsset(f.state.settings.user.avatarAssetId!))!,metadata=await sharp(bytes).metadata()
  assert.equal(metadata.width,8);assert.equal(metadata.height,16)
 }finally{picker.resolve({canceled:true,filePaths:[]});await f.close()}
})

test("profile IPC: selection cleanup restores A after B is fully staged but still unaccepted by UI",async()=>{
 const picker=deferred<{canceled:boolean;filePaths:string[]}>(),f=await fixture({pick:()=>picker.promise}),id=randomUUID()
 try{
  const owner=String(f.event.sender.id),sourceA=join(f.root,"accepted-a.png"),sourceB=join(f.root,"unaccepted-b.png")
  f.assets.begin(owner,id)
  await writeFile(sourceA,await sharp({create:{width:8,height:16,channels:4,background:"red"}}).png().toBuffer())
  await writeFile(sourceB,await sharp({create:{width:16,height:8,channels:4,background:"blue"}}).png().toBuffer())
  const draftA=await f.assets.stageSelected(owner,id,sourceA)
  const pending=f.invoke("desktop:avatar-choose",id,draftA.draftId)
  picker.resolve({canceled:false,filePaths:[sourceB]})
  const preparedB=await pending as {draftId:string}
  f.assets.assertActive(owner,id,preparedB.draftId)
  // Completion of main handling precedes UI acceptance; suspension keeps A.
  await f.invoke("desktop:avatar-selection-cancel",{sessionId:id,draftId:draftA.draftId})
  await f.invoke("desktop:settings",f.profile(id,draftA.draftId))
  const bytes=(await f.assets.readAsset(f.state.settings.user.avatarAssetId!))!,metadata=await sharp(bytes).metadata()
  assert.equal(metadata.width,8);assert.equal(metadata.height,16)
 }finally{picker.resolve({canceled:true,filePaths:[]});await f.close()}
})
