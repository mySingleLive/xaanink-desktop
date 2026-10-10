import assert from "node:assert/strict"
import {test} from "node:test"
import {readFileSync} from "node:fs"
import {mkdtemp,readFile,rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {randomUUID} from "node:crypto"
import ts from "typescript"
import {transformSync} from "esbuild"
import {mainFunction} from "../helpers/main-function"
import {ModelRepository} from "../../desktop/main/model-repository"
import {AvatarAssetService} from "../../desktop/main/avatar-assets"
import {OnboardingService} from "../../desktop/main/onboarding-service"
import {onboardingActionSchema,OnboardingError,type OnboardingAction} from "../../desktop/shared/onboarding"
import type {StoreOptions} from "../../desktop/core/versioned-store"

const source=readFileSync("desktop/main/index.ts","utf8"),syntax=ts.createSourceFile("main.ts",source,ts.ScriptTarget.Latest,true)
const trusted=syntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="trusted")!
const register=syntax.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="registerIpc") as ts.FunctionDeclaration
const handler=register.body!.statements.find(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.arguments[0]?.getText(syntax)==='"desktop:onboarding"')!
const actual=transformSync(`${trusted.getText(syntax)}\n${handler.getText(syntax)}`,{loader:"ts"}).code
const protection={isEncryptionAvailable:()=>true,encryptString:(v:string)=>Buffer.from(v),decryptString:(b:Buffer)=>b.toString()}
async function fixture(options:StoreOptions={}){
 const root=await mkdtemp(join(tmpdir(),"xaanink-onboarding-ipc-")),path=join(root,"state.json"),repo=new ModelRepository(path,protection,{replace(){},remove(){}},options),avatars=new AvatarAssetService({root}),service=new OnboardingService({repository:repo,avatarAssets:avatars})
 const frame={url:"xaanink://app/"},contents={id:23,mainFrame:frame,setZoomFactor(){}},window={webContents:contents,isDestroyed:()=>false},session={owner:23,id:randomUUID(),ready:true},event={sender:contents,senderFrame:frame},sent:unknown[]=[],handlers=new Map<string,(event:unknown,input:unknown)=>Promise<unknown>>()
 const controls=mainFunction("window","draftSession","closingFlow","quitting","migrationHandoff","onboardingService","onboardingActionSchema","OnboardingError","ipcMain","send",`${actual};return {setSession(value){draftSession=value},setWindow(value){window=value},setClosing(value){closingFlow=value},setMigration(value){migrationHandoff=value},setQuitting(value){quitting=value},setLease(value){workLease=value},closeGate(){return businessGate.close()}}`)(window,session,null,false,null,service,onboardingActionSchema,OnboardingError,{handle:(name:string,run:(event:unknown,input:unknown)=>Promise<unknown>)=>handlers.set(name,run)},(e:unknown)=>sent.push(e)) as {setSession(value:unknown):void;setWindow(value:unknown):void;setClosing(value:unknown):void;setMigration(value:unknown):void;setQuitting(value:boolean):void;setLease(value:unknown):void;closeGate():Promise<void>}
 const action=(revision=0):OnboardingAction=>({type:"next-theme",flow:"full",operationId:randomUUID(),revision,sessionId:session.id})
 const invoke=(input:unknown=action(),sender:unknown=event)=>handlers.get("desktop:onboarding")!(sender,input)
 return {root,path,repo,session,event,sent,action,invoke,...controls,close:async()=>{avatars.close();await rm(root,{recursive:true,force:true})}}
}
test("ONB-08 actual main handler rejects wrong frame/window/session and not-ready session",async()=>{
 const f=await fixture();try{await assert.rejects(f.invoke(f.action(),{sender:{id:24},senderFrame:f.event.senderFrame}));await assert.rejects(f.invoke(f.action(),{sender:f.event.sender,senderFrame:{url:"xaanink://app/"}}));await assert.rejects(f.invoke({...f.action(),sessionId:randomUUID()}));f.session.ready=false;await assert.rejects(f.invoke());assert.equal((await f.repo.read()).revision,0);assert.deepEqual(f.sent,[])}finally{await f.close()}
})
test("ONB-08 actual main handler rejects closing/maintenance/quitting/lease/closed gate",async()=>{
 const f=await fixture();try{f.setClosing(Promise.resolve(false));await assert.rejects(f.invoke());f.setClosing(null);f.setMigration({pending:true});await assert.rejects(f.invoke());f.setMigration(null);f.setQuitting(true);await assert.rejects(f.invoke());f.setQuitting(false);f.setLease({pending:true});await assert.rejects(f.invoke());f.setLease(null);await f.closeGate();await assert.rejects(f.invoke());assert.equal((await f.repo.read()).revision,0);assert.deepEqual(f.sent,[])}finally{await f.close()}
})
test("ONB-08 changing the actual owner at beforeRename prevents durable mutation or event",async()=>{
 let f!:Awaited<ReturnType<typeof fixture>>;f=await fixture({beforeRename:async()=>f.setSession({...f.session,id:randomUUID()})});try{await assert.rejects(f.invoke());assert.equal((await f.repo.read()).revision,0);assert.deepEqual(f.sent,[])}finally{await f.close()}
})
test("ONB-08 successful actual IPC publishes a real atomic progress snapshot",async()=>{
 const f=await fixture();try{await f.invoke();const disk=JSON.parse(await readFile(f.path,"utf8"));assert.equal(disk.revision,1);assert.equal(disk.value.onboarding.step,"profile");assert.equal(f.sent.length,1);await assert.rejects(f.invoke({...f.action(1),rawKey:"synthetic forbidden field"}),error=>error instanceof OnboardingError&&!error.message.includes("synthetic"))}finally{await f.close()}
})
