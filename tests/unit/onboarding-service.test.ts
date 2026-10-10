import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { ModelRepository } from "../../desktop/main/model-repository"
import { AvatarAssetService } from "../../desktop/main/avatar-assets"
import { OnboardingService } from "../../desktop/main/onboarding-service"
import { defaultState } from "../../desktop/core/settings"
import type { OnboardingAction } from "../../desktop/shared/onboarding"
import type { StoreOptions } from "../../desktop/core/versioned-store"

const protection={isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from(value),decryptString:(bytes:Buffer)=>bytes.toString()}
async function fixture(options:StoreOptions={}){const root=await mkdtemp(join(tmpdir(),"xaanink-onboarding-service-")),path=join(root,"state.json"),repo=new ModelRepository(path,protection,{replace(){},remove(){}},options),avatars=new AvatarAssetService({root}),service=new OnboardingService({repository:repo,avatarAssets:avatars});const owner="fixture-window",sessionId=randomUUID();const action=(body:Record<string,unknown>,revision:number):OnboardingAction=>({...body,flow:"full",operationId:randomUUID(),revision,sessionId} as OnboardingAction);return{root,path,repo,avatars,service,owner,action,close:async()=>{avatars.close();await rm(root,{recursive:true,force:true})}}}
test("ONB-03 avatar normalization and user+progress publication happen on confirmation",async()=>{
 const f=await fixture();try{await f.service.commit(f.owner,f.action({type:"next-theme"},0),()=>{});const avatarSessionId=randomUUID();f.avatars.begin(f.owner,avatarSessionId);const path=join(f.root,"source.png");await writeFile(path,await sharp({create:{width:8,height:16,channels:4,background:"red"}}).png().toBuffer());const draft=await f.avatars.stageSelected(f.owner,avatarSessionId,path);const state=await f.service.commit(f.owner,f.action({type:"profile",avatarSessionId,avatarDraftId:draft.draftId,user:{...defaultState.settings.user,penName:"头像作者"}},1),()=>{});assert.equal(state.onboarding?.step,"text");assert.equal(state.settings.user.penName,"头像作者");assert.ok(await f.avatars.readAsset(state.settings.user.avatarAssetId!));assert.throws(()=>f.avatars.assertActive(f.owner,avatarSessionId))}finally{await f.close()}
})
test("ONB-08 matching profile receipt retries before consulting a retired avatar session",async()=>{
 let fail=false;const f=await fixture({beforeDirectorySync:async()=>{if(fail)throw Error("synthetic sync")}});try{await f.service.commit(f.owner,f.action({type:"next-theme"},0),()=>{});const avatarSessionId=randomUUID(),action=f.action({type:"profile",avatarSessionId,user:{...defaultState.settings.user,penName:"retry author"}},1);fail=true;await assert.rejects(f.service.commit(f.owner,action,()=>{}));f.avatars.cancel(f.owner,avatarSessionId);fail=false;const confirmed=await f.service.commit(f.owner,action,()=>{});assert.equal(confirmed.settings.user.penName,"retry author");assert.equal(confirmed.onboarding?.step,"text")}finally{await f.close()}
})
test("ONB-08 revoked owner after avatar persistence stops the state transaction",async()=>{
 const f=await fixture();try{
  await f.service.commit(f.owner,f.action({type:"next-theme"},0),()=>{})
  const avatarSessionId=randomUUID(),path=join(f.root,"owner-loss.png")
  f.avatars.begin(f.owner,avatarSessionId)
  await writeFile(path,await sharp({create:{width:8,height:16,channels:4,background:"blue"}}).png().toBuffer())
  const draft=await f.avatars.stageSelected(f.owner,avatarSessionId,path),before=await readFile(f.path,"utf8"),persist=f.avatars.persistDraft.bind(f.avatars)
  let owner=true,persistedAssetId:string|null=null
  f.avatars.persistDraft=async(...args)=>{const asset=await persist(...args);persistedAssetId=asset.assetId;owner=false;return asset}
  await assert.rejects(f.service.commit(f.owner,f.action({type:"profile",avatarSessionId,avatarDraftId:draft.draftId,user:{...defaultState.settings.user,penName:"late owner"}},1),()=>{if(!owner)throw Error("private owner detail")}),error=>error instanceof Error&&!error.message.includes("private"))
  assert.ok(persistedAssetId,"The real normalized PNG must have completed before owner loss")
  assert.ok(await f.avatars.readAsset(persistedAssetId))
  assert.equal(await readFile(f.path,"utf8"),before)
  assert.equal((await f.repo.read()).settings.user.avatarAssetId,null)
  f.avatars.assertActive(f.owner,avatarSessionId,draft.draftId)
 }finally{await f.close()}
})
test("ONB-08 forged avatar references, stale sessions and malformed actions preserve bytes",async()=>{
 const f=await fixture();try{await f.service.commit(f.owner,f.action({type:"next-theme"},0),()=>{});const before=await readFile(f.path,"utf8");await assert.rejects(f.service.commit(f.owner,f.action({type:"profile",avatarSessionId:randomUUID(),user:{...defaultState.settings.user,avatarAssetId:randomUUID()}},1),()=>{}));const retired=randomUUID();f.avatars.cancel(f.owner,retired);await assert.rejects(f.service.commit(f.owner,f.action({type:"profile",avatarSessionId:retired,user:defaultState.settings.user},1),()=>{}));await assert.rejects(f.service.commit(f.owner,{...f.action({type:"next-theme"},1),secret:"not accepted"},()=>{}));assert.equal(await readFile(f.path,"utf8"),before)}finally{await f.close()}
})
test("ONB-03 hiding an editor cancels picker B while preserving session and normalized draft A",async()=>{
 const f=await fixture();try{
  const avatarSessionId=randomUUID(),sourceA=join(f.root,"draft-a.png"),sourceB=join(f.root,"draft-b.png")
  f.avatars.begin(f.owner,avatarSessionId)
  await writeFile(sourceA,await sharp({create:{width:8,height:16,channels:4,background:"red"}}).png().toBuffer())
  await writeFile(sourceB,await sharp({create:{width:16,height:8,channels:4,background:"blue"}}).png().toBuffer())
  const draftA=await f.avatars.stageSelected(f.owner,avatarSessionId,sourceA)
  const selectionB=f.avatars.beginSelection(f.owner,avatarSessionId)
  f.avatars.cancelSelection(f.owner,avatarSessionId)
  await assert.rejects(f.avatars.stageSelected(f.owner,avatarSessionId,sourceB,selectionB))
  f.avatars.assertActive(f.owner,avatarSessionId,draftA.draftId)
  const persisted=await f.avatars.persistDraft(f.owner,avatarSessionId,draftA.draftId)
  const metadata=await sharp((await f.avatars.readAsset(persisted.assetId))!).metadata()
  assert.equal(metadata.width,8);assert.equal(metadata.height,16)
 }finally{await f.close()}
})

test("ONB-03 hiding after B has staged restores UI-accepted A without retiring its session",async()=>{
 const f=await fixture();try{
  const avatarSessionId=randomUUID(),sourceA=join(f.root,"accepted-a.png"),sourceB=join(f.root,"unaccepted-b.png")
  f.avatars.begin(f.owner,avatarSessionId)
  await writeFile(sourceA,await sharp({create:{width:8,height:16,channels:4,background:"red"}}).png().toBuffer())
  await writeFile(sourceB,await sharp({create:{width:16,height:8,channels:4,background:"blue"}}).png().toBuffer())
  const draftA=await f.avatars.stageSelected(f.owner,avatarSessionId,sourceA)
  const selectionB=f.avatars.beginSelection(f.owner,avatarSessionId,draftA.draftId)
  const draftB=await f.avatars.stageSelected(f.owner,avatarSessionId,sourceB,selectionB)
  assert.notEqual(draftB.draftId,draftA.draftId)
  // Native preparation is complete, but the renderer has not accepted B.
  f.avatars.cancelSelection(f.owner,avatarSessionId,draftA.draftId)
  f.avatars.assertActive(f.owner,avatarSessionId,draftA.draftId)
  assert.throws(()=>f.avatars.assertActive(f.owner,avatarSessionId,draftB.draftId))
  const persisted=await f.avatars.persistDraft(f.owner,avatarSessionId,draftA.draftId)
  const metadata=await sharp((await f.avatars.readAsset(persisted.assetId))!).metadata()
  assert.equal(metadata.width,8);assert.equal(metadata.height,16)
 }finally{await f.close()}
})
