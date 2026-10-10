import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ModelRepository, type ModelDraft } from "../../desktop/main/model-repository"
import { defaultState } from "../../desktop/core/settings"
import { onboardingActionSchema, onboardingProgressSchema, type OnboardingAction, type OnboardingPayload } from "../../desktop/shared/onboarding"
import type { StoreOptions } from "../../desktop/core/versioned-store"
import { ConfigurationFiles } from "../../desktop/main/configuration-files"
import { exportConfiguration } from "../../desktop/core/configuration-transfer"

const key="synthetic-onboarding-secret"
const draft:ModelDraft={name:"专项模型",provider:"custom",protocol:"openai",modelId:"fixture-text",endpoint:"https://onboarding.invalid/v1",kind:"TEXT",contextWindow:0,enabled:true,thinkingLevels:["high"],defaultThinking:"high",apiKey:key}
const protection={isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from([...value].reverse().join("")),decryptString:(bytes:Buffer)=>[...bytes.toString()].reverse().join("")}
type OptionalOperation<T> = T extends OnboardingPayload ? Omit<T,"operationId">&{operationId?:string}:never
type TestPayload=OptionalOperation<OnboardingPayload>
async function fixture(options:StoreOptions={},operationLimit=4096){
 const root=await mkdtemp(join(tmpdir(),"xaanink-onboarding-repo-")),path=join(root,"state.json"),published:string[]=[]
 let encryptionCalls=0
 const repo=new ModelRepository(path,{...protection,encryptString(value){encryptionCalls++;return protection.encryptString(value)}},{replace(model){published.push(model.id)},remove(){}},options,{operationLimit})
 const sessionId=randomUUID()
 const envelope=async(payload:TestPayload):Promise<OnboardingAction>=>({...payload,operationId:payload.operationId??randomUUID(),revision:(await repo.read()).revision,sessionId} as OnboardingAction)
 const apply=async(payload:TestPayload)=>repo.commitOnboarding(await envelope(payload),()=>{})
 const toText=async()=>{await apply({type:"next-theme",flow:"full"});await apply({type:"profile",flow:"full",user:defaultState.settings.user,avatarSessionId:randomUUID()})}
 const text=async()=>apply({type:"model",flow:"full",selection:{type:"draft",model:draft,creationId:randomUUID()}})
 return{root,path,repo,published,sessionId,envelope,apply,toText,text,encryptionCalls:()=>encryptionCalls,close:()=>rm(root,{recursive:true,force:true})}
}

test("ONB-01/11 legacy state lacks a marker and remains model-free",async()=>{
 const f=await fixture();try{const legacy=structuredClone(defaultState);delete legacy.onboarding;await writeFile(f.path,JSON.stringify({schemaVersion:1,revision:2,value:legacy}));const state=await f.repo.read();assert.equal(state.onboarding,null);assert.deepEqual(state.models,[]);assert.equal(state.settings.agent.textModelId,null)}finally{await f.close()}
})
test("ONB-02 theme selection persists immediately without advancing; continue advances once",async()=>{
 const f=await fixture();try{let state=await f.apply({type:"theme",flow:"full",theme:"system"});assert.equal(state.settings.appearance.theme,"system");assert.equal(state.onboarding?.step,"theme");state=await f.apply({type:"next-theme",flow:"full"});assert.equal(state.onboarding?.step,"profile");assert.equal(state.revision,2)}finally{await f.close()}
})
test("ONB-03 profile and progress are one CAS, empty email is allowed",async()=>{
 const f=await fixture();try{await f.apply({type:"next-theme",flow:"full"});const state=await f.apply({type:"profile",flow:"full",user:{...defaultState.settings.user,penName:"专项作者"},avatarSessionId:randomUUID()});assert.equal(state.revision,2);assert.equal(state.settings.user.penName,"专项作者");assert.equal(state.onboarding?.step,"text");const disk=JSON.parse(await readFile(f.path,"utf8"));assert.equal(disk.value.settings.user.penName,"专项作者");assert.equal(disk.value.onboarding.step,"text")}finally{await f.close()}
})
test("ONB-04 new TEXT atomically saves both default roles and progress with no public Key",async()=>{
 const f=await fixture();try{await f.toText();const state=await f.text(),model=state.models[0];assert.equal(state.revision,3);assert.equal(state.settings.agent.textModelId,model.id);assert.equal(state.settings.agent.reviewModelId,model.id);assert.equal(state.onboarding?.textModelId,model.id);assert.equal(state.onboarding?.step,"image-choice");assert.equal(state.settings.agent.mode,"standard");assert.equal(JSON.stringify(state).includes(key),false);assert.equal((await readFile(f.path,"utf8")).includes(key),false);assert.equal("encryptedKey" in model,false)}finally{await f.close()}
})
test("ONB-04 returning edits the same ID; existing selection never copies models",async()=>{
 const f=await fixture();try{await f.toText();let state=await f.text();const id=state.models[0].id;await f.apply({type:"back",flow:"full"});state=await f.apply({type:"model",flow:"full",selection:{type:"draft",model:{...draft,id,apiKey:"",name:"已修改"}}});assert.equal(state.models.length,1);assert.equal(state.models[0].id,id);assert.equal(state.models[0].authRevision,1);await f.apply({type:"back",flow:"full"});state=await f.apply({type:"model",flow:"full",selection:{type:"existing",id}});assert.equal(state.models.length,1)}finally{await f.close()}
})
test("ONB-04 preserves mode and compatible thinking; incompatible choice resets thinking",async()=>{
 const f=await fixture();try{
  await f.toText();let state=await f.text()
  state.settings.agent.mode="plan";state.settings.agent.thinking="high"
  await f.repo.updateSettings(state.revision,state.settings)
  await f.apply({type:"back",flow:"full"})
  state=await f.apply({type:"model",flow:"full",selection:{type:"draft",model:{...draft,modelId:"compatible-model",thinkingLevels:["low","high"],defaultThinking:"low"},creationId:randomUUID()}})
  assert.equal(state.settings.agent.mode,"plan");assert.equal(state.settings.agent.thinking,"high")
  await f.apply({type:"back",flow:"full"})
  state=await f.apply({type:"model",flow:"full",selection:{type:"draft",model:{...draft,modelId:"other-model",thinkingLevels:["low"],defaultThinking:"low"},creationId:randomUUID()}})
  assert.equal(state.settings.agent.mode,"plan");assert.equal(state.settings.agent.thinking,"default")
 }finally{await f.close()}
})
test("ONB-05 image confirmation atomically completes and sets image default",async()=>{
 const f=await fixture();try{await f.toText();await f.text();await f.apply({type:"image-choice",flow:"full",choice:"configure"});const state=await f.apply({type:"model",flow:"full",selection:{type:"draft",model:{...draft,kind:"IMAGE",modelId:"fixture-image"},creationId:randomUUID()}});assert.equal(state.onboarding?.completed,true);assert.equal(state.onboarding?.step,"welcome");assert.equal(state.settings.agent.imageModelId,state.onboarding?.imageModelId);assert.equal(state.models.length,2)}finally{await f.close()}
})
test("ONB-05 skip from inquiry or form preserves an existing image default",async()=>{
 for(const form of [false,true]){const f=await fixture();try{let state=await f.repo.saveModel(0,{...draft,kind:"IMAGE"});const id=state.models[0].id;state.settings.agent.imageModelId=id;await f.repo.updateSettings(state.revision,state.settings);await f.toText();await f.text();if(form)await f.apply({type:"image-choice",flow:"full",choice:"configure"});state=await f.apply({type:"image-choice",flow:"full",choice:"skip"});assert.equal(state.onboarding?.completed,true);assert.equal(state.settings.agent.imageModelId,id);assert.equal(state.models.length,2)}finally{await f.close()}}
})
test("ONB-06 short flow cannot bypass unfinished full flow and start preserves completion",async()=>{
 const f=await fixture();try{await assert.rejects(f.apply({type:"start-models",flow:"models"}));await f.toText();await f.text();await f.apply({type:"image-choice",flow:"full",choice:"skip"});const state=await f.apply({type:"start-models",flow:"models"});assert.equal(state.onboarding?.completed,true);assert.equal(state.onboarding?.step,"text");await assert.rejects(f.apply({type:"back",flow:"models"}));await assert.rejects(f.apply({type:"theme",flow:"models",theme:"paper"}))}finally{await f.close()}
})
test("ONB-08 write-before-rename failure keeps bytes/revision/defaults/progress and retry uses one ID",async()=>{
 let fail=false;const f=await fixture({beforeRename:async()=>{if(fail)throw Error("synthetic write failure")}});try{await f.toText();const before=await readFile(f.path,"utf8"),action=await f.envelope({type:"model",flow:"full",selection:{type:"draft",model:draft,creationId:randomUUID()}});fail=true;await assert.rejects(f.repo.commitOnboarding(action,()=>{}));assert.equal(await readFile(f.path,"utf8"),before);fail=false;const saved=await f.repo.commitOnboarding(action,()=>{});assert.equal(saved.models.length,1);assert.equal(saved.models[0].id,action.type==="model"&&action.selection.type==="draft"?action.selection.creationId:"")}finally{await f.close()}
})
test("ONB-08 post-rename retry confirms latest state without creating/encrypting twice",async()=>{
 let fail=false;const f=await fixture({beforeDirectorySync:async()=>{if(fail)throw Error("synthetic durability failure")}});try{
  await f.toText();const action=await f.envelope({type:"model",flow:"full",selection:{type:"draft",model:draft,creationId:randomUUID()}})
  fail=true;await assert.rejects(f.repo.commitOnboarding(action,()=>{}))
  let actual=await f.repo.read();assert.equal(actual.models.length,1);assert.equal(actual.onboarding?.step,"image-choice");assert.equal(f.encryptionCalls(),1)
  await assert.rejects(f.repo.commitOnboarding(action,()=>{}));assert.equal((await f.repo.read()).models[0].authRevision,1);assert.equal(f.encryptionCalls(),1)
  fail=false;actual=await f.repo.read();actual.settings.appearance.uiFontSize=18
  await f.repo.updateSettings(actual.revision,actual.settings)
  const confirmed=await f.repo.commitOnboarding(action,()=>{})
  assert.equal(confirmed.models.length,1);assert.equal(confirmed.models[0].authRevision,1);assert.equal(confirmed.settings.appearance.uiFontSize,18);assert.equal(f.encryptionCalls(),1)
 }finally{await f.close()}
})
test("ONB-08 altered payload/old overwritten receipt/unknown restart receipt never replay",async()=>{
 const f=await fixture();try{await f.toText();const action=await f.envelope({type:"model",flow:"full",selection:{type:"draft",model:draft,creationId:randomUUID()}});await f.repo.commitOnboarding(action,()=>{});await assert.rejects(f.repo.commitOnboarding({...action,selection:{type:"draft",model:{...draft,name:"changed"},creationId:randomUUID()}} as OnboardingAction,()=>{}));const reopened=new ModelRepository(f.path,protection,{replace(){},remove(){}});await assert.rejects(reopened.commitOnboarding(action,()=>{}));await f.apply({type:"back",flow:"full"});await assert.rejects(f.repo.commitOnboarding(action,()=>{}));assert.equal((await f.repo.read()).models.length,1)}finally{await f.close()}
})
test("ONB-08 identity capacity rejects new IDs without forgetting retry identity",async()=>{
 const f=await fixture({},2);try{const first=await f.envelope({type:"theme",flow:"full",theme:"ink"});await f.repo.commitOnboarding(first,()=>{});const second=await f.envelope({type:"theme",flow:"full",theme:"paper"});await f.repo.commitOnboarding(second,()=>{});await assert.rejects(f.apply({type:"theme",flow:"full",theme:"system"}));await assert.rejects(f.repo.commitOnboarding({...first,theme:"system"} as OnboardingAction,()=>{}));await f.repo.commitOnboarding(second,()=>{})}finally{await f.close()}
})
test("ONB-08 current-step kind/enabled/creation collision and edit identity are enforced",async()=>{
 const f=await fixture();try{await f.toText();let state=await f.repo.saveModel((await f.repo.read()).revision,{...draft,modelId:"preexisting"});const id=state.models[0].id;for(const selection of [{type:"draft",model:{...draft,enabled:false},creationId:randomUUID()},{type:"draft",model:{...draft,kind:"IMAGE"},creationId:randomUUID()},{type:"draft",model:draft,creationId:id},{type:"draft",model:{...draft,id},creationId:randomUUID()},{type:"existing",id:randomUUID()}]){await assert.rejects(f.apply({type:"model",flow:"full",selection:selection as never}))}state=await f.repo.read();assert.equal(state.models.length,1);assert.equal(state.onboarding?.step,"text")}finally{await f.close()}
})
test("ONB-08 owner revoked at final commit cannot publish or mutate bytes",async()=>{
 let owner=true;const f=await fixture({beforeRename:async()=>{owner=false}});try{const action=await f.envelope({type:"next-theme",flow:"full"});await assert.rejects(f.repo.commitOnboarding(action,()=>{if(!owner)throw Error("private owner path")}),error=>error instanceof Error&&!error.message.includes("private"));assert.equal((await f.repo.read()).revision,0);assert.deepEqual(f.published,[])}finally{await f.close()}
})
test("ONB-09 ordinary model save/remove/update preserve local onboarding",async()=>{
 const f=await fixture();try{let state=await f.apply({type:"theme",flow:"full",theme:"ink"});const marker=state.onboarding;state=await f.repo.saveModel(state.revision,draft);assert.deepEqual(state.onboarding,marker);state=await f.repo.removeModel(state.revision,state.models[0].id);assert.deepEqual(state.onboarding,marker);state=await f.repo.updateSettings(state.revision,state.settings);assert.deepEqual(state.onboarding,marker)}finally{await f.close()}
})
test("ONB-08 strict actions refuse secret progress fields, malformed sessions and identities",()=>{
 const action={type:"next-theme",flow:"full",revision:0,sessionId:randomUUID(),operationId:randomUUID()};assert.equal(onboardingActionSchema.safeParse(action).success,true);for(const change of [{apiKey:key},{revision:Number.MAX_SAFE_INTEGER+1},{sessionId:"forged"},{operationId:"forged"}])assert.equal(onboardingActionSchema.safeParse({...action,...change}).success,false)
})
test("ONB-09 configuration files project portable fields and preserve local progress",async()=>{
 const f=await fixture();try{const state=await f.apply({type:"theme",flow:"full",theme:"ink"}),marker=state.onboarding,incoming=structuredClone(state),source=join(f.root,"incoming.json"),destination=join(f.root,"export.json");incoming.settings.appearance.uiFontSize=19;await writeFile(source,exportConfiguration(incoming));const files=new ConfigurationFiles({repository:f.repo,catalogs:{},assertOwner(){},chooseImport:async()=>source,chooseExport:async()=>destination});const preview=await files.preview("fixture-window");assert.ok(preview);const result=await files.apply("fixture-window",preview.token,{selectedPaths:["/appearance/uiFontSize"]});assert.equal(result.settings.appearance.uiFontSize,19);assert.deepEqual(result.onboarding,marker);assert.equal(await files.export("fixture-window"),true);const exported=await readFile(destination,"utf8");assert.equal(exported.includes("onboarding"),false);assert.equal(exported.includes(marker!.receipt!.id),false);files.cancel("fixture-window");await files.flush()}finally{await f.close()}
})
test("ONB-08 encryption failure never writes a model/default/progress or leaks the secret",async()=>{
 const f=await fixture();try{await f.toText();const before=await readFile(f.path,"utf8"),repo=new ModelRepository(f.path,{...protection,encryptString(){throw Error(`synthetic failure ${key}`)}},{replace(){},remove(){}});const action=await f.envelope({type:"model",flow:"full",selection:{type:"draft",model:draft,creationId:randomUUID()}});await assert.rejects(repo.commitOnboarding(action,()=>{}),error=>error instanceof Error&&!error.message.includes(key)&&error.cause===undefined);assert.equal(await readFile(f.path,"utf8"),before)}finally{await f.close()}
})
test("ONB-08 concurrent identical confirms share one operation and one revision",async()=>{
 const f=await fixture();try{await f.toText();const action=await f.envelope({type:"model",flow:"full",selection:{type:"draft",model:draft,creationId:randomUUID()}});const [first,second]=await Promise.all([f.repo.commitOnboarding(action,()=>{}),f.repo.commitOnboarding(action,()=>{})]);assert.equal(first.revision,3);assert.equal(second.revision,3);assert.equal((await f.repo.read()).models.length,1)}finally{await f.close()}
})
test("ONB-08 production identity bound admits 4096 and rejects further identities without eviction",async()=>{
 const f=await fixture();try{const first=await f.envelope({type:"back",flow:"full"});await assert.rejects(f.repo.commitOnboarding(first,()=>{}));for(let count=1;count<4096;count++)await assert.rejects(f.apply({type:"back",flow:"full"}));await assert.rejects(f.apply({type:"next-theme",flow:"full"}),/上限/);await assert.rejects(f.repo.commitOnboarding({...first,revision:1},()=>{}),/内容已变化/);assert.equal((await f.repo.read()).revision,0)}finally{await f.close()}
})
test("ONB-08 persisted completed progress rejects unreachable theme/profile states",()=>{
 const base={version:1,completed:true,textModelId:null,imageModelId:null,receipt:null}
 for(const step of ["theme","profile"])assert.equal(onboardingProgressSchema.safeParse({...base,step}).success,false)
 for(const step of ["text","image-choice","image","welcome"])assert.equal(onboardingProgressSchema.safeParse({...base,step}).success,true)
})
test("ONB-04 disabled/wrong-kind existing models and changed-scope blank keys reject precisely without adding",async()=>{
 const f=await fixture();try{await f.toText();let state=await f.repo.saveModel((await f.repo.read()).revision,{...draft,enabled:false,modelId:"disabled"});const disabled=state.models[0].id;state=await f.repo.saveModel(state.revision,{...draft,kind:"IMAGE",modelId:"image"});const image=state.models.find(model=>model.kind==="IMAGE")!.id;await assert.rejects(f.apply({type:"model",flow:"full",selection:{type:"existing",id:disabled}}));await assert.rejects(f.apply({type:"model",flow:"full",selection:{type:"existing",id:image}}));state=await f.text();const id=state.models.find(model=>model.modelId===draft.modelId)!.id;await f.apply({type:"back",flow:"full"});const before=await readFile(f.path,"utf8");await assert.rejects(f.apply({type:"model",flow:"full",selection:{type:"draft",model:{...draft,id,endpoint:"https://changed.invalid/v1",apiKey:""}}}));assert.equal(await readFile(f.path,"utf8"),before)}finally{await f.close()}
})
