import assert from "node:assert/strict"
import {test} from "node:test"
import {createRecoveryVerifier} from "../../src/lib/desktop/recovery-targets"
import type {RecoveryTarget} from "../../src/lib/desktop/draft-recovery"
function rig(data:Record<string,unknown>){const calls:string[]=[],controller=new AbortController();const verify=createRecoveryVerifier(async(url,init)=>{const path=String(url);calls.push(path);assert.equal(init?.method,"GET");return Object.hasOwn(data,path)?Response.json(data[path]):new Response(null,{status:404})},controller.signal);return{verify,calls,controller}}
const base="/api/novels/work-a",novel={novel:{id:"work-a"}}
test("recovery verifies the work first and reads real collection routes for entities without a GET detail endpoint",async()=>{
 const r=rig({[base]:novel,[base+"/characters"]:{characters:[{id:"c1",novelId:"work-a"}]},[base+"/worlds"]:{worlds:[{id:"w1",novelId:"work-a"}]}})
 assert.equal(await r.verify({novelId:"work-a",kind:"CHARACTER",id:"c1"}),true);assert.equal(await r.verify({novelId:"work-a",kind:"WORLD",id:"w1"}),true);assert.equal(await r.verify({novelId:"work-a",kind:"CHARACTER",id:"missing"}),false)
 assert.deepEqual(r.calls,[base,base+"/characters",base+"/worlds"])
})
test("unknown work, crossed ownership, missing records and unexpected payloads do not restore drafts",async()=>{
 const r=rig({[base]:novel,[base+"/scenes/s1"]:{scene:{id:"s1",novelId:"work-b"}},[base+"/chapters/ch1"]:{chapter:null},[base+"/settings/st1"]:{error:"not a setting"}})
 for(const target of [{novelId:"missing",kind:"NOVEL"},{novelId:"work-a",kind:"SCENE",id:"s1"},{novelId:"work-a",kind:"CHAPTER_CONTENT",id:"ch1"},{novelId:"work-a",kind:"SETTING",id:"st1"}] as RecoveryTarget[])assert.equal(await r.verify(target),false)
})
test("candidate and global subagent recovery proves both record and work ownership",async()=>{
 const r=rig({[base]:novel,[base+"/chapters/ch1/candidates/k1"]:{candidate:{id:"k1",novelId:"work-a",chapterId:"ch1"}},"/api/subagent-runs/r1":{run:{id:"r1",novelId:"work-a"}},"/api/subagent-runs/r2":{run:{id:"r2",novelId:"work-b"}}})
 assert.equal(await r.verify({novelId:"work-a",kind:"CHAPTER_CANDIDATE",id:"k1",chapterId:"ch1"}),true);assert.equal(await r.verify({novelId:"work-a",kind:"SUBAGENT",id:"r1"}),true);assert.equal(await r.verify({novelId:"work-a",kind:"SUBAGENT",id:"r2"}),false)
})
test("unsafe ids and unknown target kinds never become arbitrary fetch paths",async()=>{
 const r=rig({});for(const id of ["../private","%2fsecret","https://invalid","x/y",""])assert.equal(await r.verify({novelId:id,kind:"NOVEL"}),false)
 assert.equal(await r.verify({novelId:"work-a",kind:"ARBITRARY" as RecoveryTarget["kind"],id:"x"}),false);assert.deepEqual(r.calls,[])
})
test("cancelled recovery cannot accept a late local response",async()=>{
 const gate=Promise.withResolvers<Response>(),controller=new AbortController(),verify=createRecoveryVerifier(async()=>gate.promise,controller.signal),pending=verify({novelId:"work-a",kind:"NOVEL"});controller.abort();gate.resolve(Response.json(novel));await assert.rejects(pending,{name:"AbortError"})
})
test("comment candidate drafts without a chapter id use the original owner-checked text target read",async()=>{
 const path=base+"/comments?targetType=CANDIDATE_CONTENT&targetId=k1",r=rig({[base]:novel,[path]:{threads:[]}})
 assert.equal(await r.verify({novelId:"work-a",kind:"CHAPTER_CANDIDATE",id:"k1"}),true)
 assert.equal(await r.verify({novelId:"work-a",kind:"CHAPTER_CANDIDATE",id:"foreign"}),false)
 assert.deepEqual(r.calls,[base,path,base+"/comments?targetType=CANDIDATE_CONTENT&targetId=foreign"])
})
