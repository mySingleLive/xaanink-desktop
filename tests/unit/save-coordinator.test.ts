import assert from "node:assert/strict"
import { test } from "node:test"
import { AutosaveController } from "../../src/lib/autosave-controller"
import { DesktopSaveCoordinator, type DesktopDraftSnapshot } from "../../src/lib/desktop/save-coordinator"

function deferred<T=void>() { let resolve!: (value:T|PromiseLike<T>)=>void; const promise=new Promise<T>(yes=>{resolve=yes});return{promise,resolve} }
async function tick(){for(let n=0;n<16;n++)await Promise.resolve()}
function rig(){const coordinator=new DesktopSaveCoordinator({checkpointDelayMs:null}),controllers:AutosaveController<unknown>[]=[];return{coordinator,add<T>(save:(value:T,attempt:import("../../src/lib/autosave-controller").SaveAttempt<T>)=>Promise<void>){const controller=new AutosaveController(save,60000);controllers.push(controller as AutosaveController<unknown>);const release=coordinator.register(controller);return{controller,release}},dispose(){for(const controller of controllers)controller.dispose()}}}
test("SAVE50-01: synthetic autosave completion cannot confirm shutdown before the durable journal acknowledges",async()=>{
 const r=rig(),gate=deferred(),written:DesktopDraftSnapshot[]=[];let completed=false
 r.coordinator.configurePersistence(async snapshot=>{written.push(snapshot);await gate.promise})
 const a=r.add<string>(async()=>{});a.controller.schedule("尚未提交的正文")
 const result=r.coordinator.flushAll().then(()=>{completed=true})
 try{await tick();assert.equal(completed,false,"memory-only staging is not a durable close acknowledgement");assert.equal(written.length,1);gate.resolve();await result;assert.equal(completed,true)}finally{gate.resolve();await result;r.dispose()}
})
test("SAVE50-02: missing durable writer blocks closing without silently discarding the pending draft",async()=>{
 const r=rig(),a=r.add<string>(async()=>{});a.controller.schedule("保留输入")
 try{await assert.rejects(r.coordinator.flushAll(),{code:"DURABLE_SAVE_UNAVAILABLE"});assert.equal(a.controller.dirty,true)}finally{r.dispose()}
})
test("SAVE50-03: flush waits for an in-flight revision and then the new pending revision before writing the snapshot",async()=>{
 const r=rig(),gate=deferred(),values:string[]=[],written:DesktopDraftSnapshot[]=[]
 const a=r.add<string>(async value=>{values.push(value);if(value==="甲")await gate.promise})
 r.coordinator.configurePersistence(async snapshot=>{written.push(snapshot)})
 a.controller.schedule("甲");const local=a.controller.flush();a.controller.schedule("乙")
 const close=r.coordinator.flushAll();await tick();assert.equal(written.length,0)
 gate.resolve();try{await Promise.all([local,close]);assert.deepEqual(values,["甲","乙"]);assert.equal(written.length,1);assert.equal((written[0].autosaves[0].draft as {latest:{value:string}}).latest.value,"乙")}finally{r.dispose()}
})
test("SAVE50-04: unmount retains a pending controller until a successful durable acknowledgement; disk failure can retry",async()=>{
 const r=rig(),values:string[]=[],written:DesktopDraftSnapshot[]=[];let fail=true
 r.coordinator.configurePersistence(async snapshot=>{written.push(snapshot);if(fail)throw Error("isolated disk failure")})
 const a=r.add<string>(async value=>{values.push(value)});a.controller.schedule("离开面板仍须保留");a.release()
 try{await assert.rejects(r.coordinator.flushAll(),{code:"DURABLE_SAVE_FAILED"});assert.deepEqual(values,["离开面板仍须保留"]);assert.equal(r.coordinator.exportSnapshot().autosaves.length,1)
  fail=false;await r.coordinator.flushAll();assert.equal(written.length,2);assert.equal(r.coordinator.exportSnapshot().autosaves.length,0);assert.deepEqual(values,["离开面板仍须保留"])
 }finally{r.dispose()}
})
test("SAVE50-05: an autosave failure blocks the journal and retries exactly the failed operation before later input",async()=>{
 const r=rig(),calls:Array<{value:string;operationId:string}>=[];let fail=true,writes=0
 const a=r.add<string>(async(value,attempt)=>{calls.push({value,operationId:attempt.operationId});if(fail)throw Error("unknown write result")})
 r.coordinator.configurePersistence(async()=>{writes++});a.controller.schedule("甲")
 try{await assert.rejects(r.coordinator.flushAll(),{code:"AUTOSAVE_FLUSH_FAILED"});a.controller.schedule("乙");assert.equal(writes,0);fail=false
  await r.coordinator.flushAll({retryFailures:true});assert.deepEqual(calls.map(call=>call.value),["甲","甲","乙"]);assert.equal(calls[0].operationId,calls[1].operationId);assert.notEqual(calls[1].operationId,calls[2].operationId);assert.equal(writes,1)
 }finally{r.dispose()}
})
test("SAVE50-06: a paused conflict is not resumed or confirmed; a complete local draft remains exportable",async()=>{
 const r=rig(),a=r.add<string>(async()=>{});let writes=0;r.coordinator.configurePersistence(async()=>{writes++});a.controller.schedule("有冲突的未批准正文");a.controller.pause()
 try{await assert.rejects(r.coordinator.flushAll({retryFailures:true}),{code:"AUTOSAVE_FLUSH_FAILED"});assert.equal(writes,0);assert.equal(a.controller.dirty,true);const draft=r.coordinator.exportSnapshot().autosaves[0].draft as {paused:boolean;pending:{value:string}};assert.equal(draft.paused,true);assert.equal(draft.pending.value,"有冲突的未批准正文") }finally{r.dispose()}
})
test("SAVE50-07: source mutation while the journal is pending requires a second acknowledgement of the latest snapshot",async()=>{
 const r=rig(),gate=deferred(),written:DesktopDraftSnapshot[]=[];let value="原暂存",changed=()=>{}
 r.coordinator.registerSource("staged",{read:()=>({text:value,phase:"editing"}),subscribe:fn=>{changed=fn;return()=>{}}})
 r.coordinator.configurePersistence(async snapshot=>{written.push(snapshot);if(written.length===1)await gate.promise})
 let done=false;const flush=r.coordinator.flushAll().then(()=>{done=true})
 try{await tick();assert.equal(written.length,1);value="新暂存";changed();gate.resolve();await flush;assert.equal(done,true);assert.equal(written.length,2);assert.equal((written[1].sources.staged as {text:string}).text,"新暂存");assert.ok(written[1].revision>written[0].revision)}finally{gate.resolve();await flush;r.dispose()}
})
test("SAVE50-08: a controller registered during a durable write must also flush before closing",async()=>{
 const r=rig(),gate=deferred(),written:DesktopDraftSnapshot[]=[];let saved=""
 r.coordinator.configurePersistence(async snapshot=>{written.push(snapshot);if(written.length===1)await gate.promise})
 const flush=r.coordinator.flushAll()
 try{await tick();const a=r.add<string>(async value=>{saved=value});a.controller.schedule("新挂载输入");gate.resolve();await flush;assert.equal(saved,"新挂载输入");assert.equal(written.length,2)}finally{gate.resolve();await flush;r.dispose()}
})
test("SAVE50-09: export snapshots do not alias live values, contain save callbacks or include arbitrary source errors",()=>{
 const r=rig(),value={text:"本地文本"},source={phase:"editing",body:{content:"暂存"}},a=r.add<typeof value>(async()=>{});a.controller.schedule(value)
 r.coordinator.registerSource("staged",{read:()=>source})
 try{const snapshot=r.coordinator.exportSnapshot();assert.equal(snapshot.autosaves.length,1);(snapshot.sources.staged as typeof source).body.content="污染";const draft=snapshot.autosaves[0].draft as {pending:{value:typeof value}};draft.pending.value.text="污染";assert.equal(source.body.content,"暂存");assert.equal(value.text,"本地文本");assert.equal(JSON.stringify(snapshot).includes("async"),false)}finally{r.dispose()}
})
test("SAVE50-10: a broken draft source blocks success but still provides available drafts for export and a subsequent retry",async()=>{
 const r=rig(),a=r.add<string>(async()=>{});a.controller.schedule("仍可导出");let fail=true,writes=0
 r.coordinator.registerSource("broken",{read:()=>{if(fail)throw Error("private path and arbitrary secret");return{restored:true}}})
 r.coordinator.configurePersistence(async()=>{writes++})
 try{await assert.rejects(r.coordinator.flushAll(),{code:"DRAFT_SOURCE_UNREADABLE"});const snapshot=r.coordinator.exportSnapshot();assert.equal(snapshot.autosaves.length,1);assert.deepEqual(snapshot.issues,[{source:"broken",code:"DRAFT_SOURCE_UNREADABLE"}]);assert.equal(JSON.stringify(snapshot).includes("private path"),false);assert.equal(writes,0);fail=false;await r.coordinator.flushAll();assert.equal(writes,1)}finally{r.dispose()}
})
test("SAVE50-11: cancelling one close wait does not dispose the shared pending save or another caller's durable acknowledgement",async()=>{
 const r=rig(),gate=deferred(),controller=new AbortController();let writes=0
 const a=r.add<string>(async()=>{await gate.promise});a.controller.schedule("取消关闭也保留")
 r.coordinator.configurePersistence(async()=>{writes++});const cancelled=r.coordinator.flushAll({signal:controller.signal}),second=r.coordinator.flushAll();let cancelledError:unknown;const observed=cancelled.catch(error=>{cancelledError=error});controller.abort()
 try{await tick();assert.equal((cancelledError as Error|undefined)?.name,"AbortError","cancellation must finish without waiting for the ignored write");assert.equal(a.controller.dirty,true);gate.resolve();await second;assert.equal(writes,1);assert.equal(a.controller.dirty,false)}finally{gate.resolve();await Promise.allSettled([observed,second]);r.dispose()}
})
test("SAVE50-12: clean never-edited controllers are released without a journal, and strict lifecycle reactivation retains the dirty identity",async()=>{
 const r=rig(),clean=r.add<string>(async()=>{});clean.release();assert.equal(r.coordinator.exportSnapshot().autosaves.length,0)
 const a=r.add<string>(async()=>{});a.controller.schedule("strict恢复");const id=r.coordinator.exportSnapshot().autosaves[0]?.id;a.release();const releaseAgain=r.coordinator.register(a.controller)
 r.coordinator.configurePersistence(async()=>{})
 try{assert.ok(id);assert.equal(r.coordinator.exportSnapshot().autosaves[0].id,id);await r.coordinator.flushAll();assert.equal(r.coordinator.exportSnapshot().autosaves.length,1);releaseAgain();assert.equal(r.coordinator.exportSnapshot().autosaves.length,0)}finally{r.dispose()}
})
test("SAVE50-13: a read-only source without subscriptions still receives a new monotonic snapshot revision when it changes",async()=>{
 const r=rig(),gate=deferred(),written:DesktopDraftSnapshot[]=[];let value="甲"
 r.coordinator.registerSource("manual",{read:()=>({value})});r.coordinator.configurePersistence(async snapshot=>{written.push(snapshot);if(written.length===1)await gate.promise})
 const flush=r.coordinator.flushAll()
 try{await tick();value="乙";gate.resolve();await flush;assert.equal(written.length,2);assert.equal((written[1].sources.manual as {value:string}).value,"乙");assert.ok(written[1].revision>written[0].revision,"main journal CAS cannot accept changed content under the old revision")}finally{gate.resolve();await flush;r.dispose()}
})
test("SAVE50-14: replacing the durable writer during a pending write requires its new acknowledgement; stale cleanup cannot remove it",async()=>{
 const r=rig(),gate=deferred();let old=0,current=0,done=false
 const releaseOld=r.coordinator.configurePersistence(async()=>{old++;await gate.promise}),flush=r.coordinator.flushAll().then(()=>{done=true})
 try{await tick();r.coordinator.configurePersistence(async()=>{current++});releaseOld();assert.equal(done,false);gate.resolve();await flush;assert.equal(old,1);assert.equal(current,1);assert.equal(done,true)}finally{gate.resolve();await flush;r.dispose()}
})
test("SAVE50-15: automatic renderer checkpoints wait for debounce and persist drafts without an explicit close request",async context=>{
 context.mock.timers.enable({apis:["setTimeout"]})
 let businessSaves=0;const coordinator=new DesktopSaveCoordinator({checkpointDelayMs:10}),controller=new AutosaveController<string>(async()=>{businessSaves++},60000),release=coordinator.register(controller);let writes=0
 const releaseWriter=coordinator.configurePersistence(async()=>{writes++})
 try{controller.schedule("崩溃前的定期草稿");context.mock.timers.tick(9);await tick();assert.equal(writes,0);context.mock.timers.tick(1);await tick();assert.equal(writes,1);assert.equal(coordinator.getState().status,"saved");assert.equal(controller.dirty,true);assert.equal(businessSaves,0,"a recovery checkpoint must not advance the business autosave") }finally{releaseWriter();release();controller.dispose();context.mock.timers.reset()}
})
test("SAVE50-16: explicitly disposed dirty controllers cannot produce a false successful close acknowledgement",async()=>{
 const r=rig(),a=r.add<string>(async()=>{});let writes=0;r.coordinator.configurePersistence(async()=>{writes++});a.controller.schedule("被错误停用的草稿");a.controller.dispose()
 try{await assert.rejects(r.coordinator.flushAll(),{code:"AUTOSAVE_FLUSH_FAILED"});assert.equal(writes,0);assert.equal((r.coordinator.exportSnapshot().autosaves[0].draft as {pending:{value:string}}).pending.value,"被错误停用的草稿")}finally{r.dispose()}
})
test("SAVE50-17: export freezes an in-flight operation and a newer pending operation independently",async()=>{
 const r=rig(),gate=deferred(),a=r.add<string>(async()=>{await gate.promise});a.controller.schedule("正在写入");const flight=a.controller.flush();a.controller.schedule("尚未写入")
 try{const draft=r.coordinator.exportSnapshot().autosaves[0].draft;assert.equal(draft.inFlight?.value,"正在写入");assert.equal(draft.pending?.value,"尚未写入");assert.equal(draft.latest?.value,"尚未写入");assert.notEqual(draft.inFlight?.operationId,draft.pending?.operationId);gate.resolve();await flight}catch(error){gate.resolve();await flight;throw error}finally{r.dispose()}
})
test("SAVE50-18: synchronous saved observers cannot append a new revision behind the close acknowledgement",async()=>{
 const r=rig(),values:string[]=[],a=r.add<string>(async value=>{values.push(value)});let writes=0,once=false
 r.coordinator.configurePersistence(async()=>{writes++});r.coordinator.subscribe(state=>{if(state.status==="saved"&&!once){once=true;a.controller.schedule("回执监听产生的新输入")}});a.controller.schedule("原输入")
 try{await r.coordinator.flushAll();assert.deepEqual(values,["原输入","回执监听产生的新输入"]);assert.equal(writes,2);assert.equal(a.controller.dirty,false)}finally{r.dispose()}
})
test("SAVE50-19: dropping acknowledged detached controllers cannot reuse a main journal revision with different data",async()=>{
 const r=rig(),a=r.add<string>(async()=>{}),written:DesktopDraftSnapshot[]=[]
 r.coordinator.configurePersistence(async snapshot=>{const previous=written.at(-1);if(previous&&snapshot.revision===previous.revision)assert.deepEqual(snapshot.autosaves,previous.autosaves,"same main revision must have the same fingerprint");written.push(snapshot)})
 a.controller.schedule("已落盘的离开面板草稿");a.release()
 try{await r.coordinator.flushAll();assert.equal(written[0].autosaves.length,1);assert.equal(r.coordinator.exportSnapshot().autosaves.length,0);await r.coordinator.checkpointDrafts();assert.equal(written.length,2);assert.equal(written[1].autosaves.length,0);assert.ok(written[1].revision>written[0].revision)}finally{r.dispose()}
})
