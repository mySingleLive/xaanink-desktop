import assert from "node:assert/strict"
import {test} from "node:test"
import {spawn} from "node:child_process"
import {once} from "node:events"
import {randomUUID} from "node:crypto"
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,readdir,symlink,rename} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {DataRootManager,RootMigrationCrash,type RootOptions} from "../../desktop/core/data-root"
import {directoryIdentity} from "../../desktop/core/root-ownership"
import {RootMigrationRequests,validateRootMigrationRequestSnapshot} from "../../desktop/main/root-migration-request"
import {RootMaintenanceRunner,type MaintenanceDataRoot} from "../../desktop/main/root-maintenance-runner"
import type {RootMaintenanceState} from "../../desktop/shared/root-maintenance"

function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return{promise,resolve}}
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),"xuanxiang-maintenance-runner-"))),source=join(base,"source"),target=join(base,"target"),bootstrap=join(base,"bootstrap"),work=join(base,"work")
 for(const path of [source,target,bootstrap,work])await mkdir(path)
 await mkdir(join(source,"inbox/database/pg_snapshots"),{recursive:true});await mkdir(join(source,"session/Local Storage/leveldb"),{recursive:true})
 const rootId=randomUUID(),owner=randomUUID(),pointer={schemaVersion:1 as const,revision:1,rootId,migrationId:null,root:await directoryIdentity(source)}
 await writeFile(join(source,"xuanxiang-app.json"),JSON.stringify({schemaVersion:1,app:"Xuanxiangxiezuo-Desktop",id:rootId,phase:"ready",inboxReady:true}));await writeFile(join(source,"catalog.json"),JSON.stringify({schemaVersion:1,revision:0,value:[{path:work}]}));await writeFile(join(source,"state.json"),"original encrypted state");await writeFile(join(source,"drafts.json"),"original draft");await writeFile(join(source,"inbox/database/PG_VERSION"),"17");await writeFile(join(source,"session/Preferences"),"original preferences");await writeFile(join(source,"session/unknown.txt"),"preserve unknown session file");await writeFile(join(work,"chapter.md"),"never move work");await writeFile(join(bootstrap,"data-root.json"),JSON.stringify(pointer))
 // A real exited process is the test's closure proof; this is not an Electron process/session acceptance claim.
 const previous=spawn(process.execPath,["-e","process.exit(0)"],{stdio:"ignore"});await once(previous,"exit")
 let guardCalls=0,continues=0,quits=0,migrates=0,releases:string[]=[],hooks:RootOptions["hook"],extraGuard:(()=>void|Promise<void>)|undefined
 const closed=async()=>{guardCalls++;assert.notEqual(previous.exitCode,null);await extraGuard?.()}
 const manager=new DataRootManager(bootstrap,source),requestOptions={resolveSource:()=>manager.resolve(),assertStableLock(){},assertOwner(nonce:string){assert.equal(nonce,owner)},assertClosed:closed,writeOptions:{}}
 const requests=new RootMigrationRequests(bootstrap,requestOptions),proof=await directoryIdentity(target)
 const createManager=(options:RootOptions&{migrationId:string}):MaintenanceDataRoot=>{
  const current:MaintenanceDataRoot=new DataRootManager(bootstrap,source,{...options,hook:async(phase,path)=>{await options.hook?.(phase,path);await hooks?.(phase,path)}})
  const original=current.migrate.bind(current);current.migrate=async(...input)=>{migrates++;return original(...input)}
  return current
 }
 const options={bootstrap,defaultRoot:source,requests,theme:"ink" as const,host:{assertMaintenanceClosed:closed,release(outcome:"old-root"|"new-root"){releases.push(outcome)}},createManager,onContinue:async()=>{continues++},onQuit:async()=>{quits++}}
 return{base,source,target,bootstrap,work,pointer,owner,requests,proof,options,requestOptions,manager,previous,
  get guardCalls(){return guardCalls},get continues(){return continues},get quits(){return quits},get migrates(){return migrates},get releases(){return releases},setHook(value:RootOptions["hook"]){hooks=value},setGuard(value:(()=>void|Promise<void>)|undefined){extraGuard=value},
  async armed(){const prepared=await requests.prepare(owner,proof);return requests.arm(owner,prepared.requestId)},
  async executing(){const armed=await this.armed();return requests.startArmed(armed.requestId)},
  async close(){await requests.flush().catch(()=>{});await rm(base,{recursive:true,force:true})}}
}

test("RMT12-01 armed runs one real copy with exact request nonce; inventory preserves unknown files and empty engine directories",async()=>{
 const f=await fixture();try{const armed=await f.armed(),runner=new RootMaintenanceRunner(f.options),state=await runner.start();assert.equal(state.phase,"cleanup-pending");assert.deepEqual(state.pendingItems,["session/unknown.txt"]);assert.equal(state.pendingCount,1);assert.equal(state.canContinue,true);assert.equal(state.theme,"ink");assert.equal(f.migrates,1);const result=await f.requests.readResult();assert.equal(result?.requestId,armed.requestId);assert.equal(result?.executionNonce,(result?.outcome as {migrationId:string}).migrationId);assert.equal(await readFile(join(f.target,"drafts.json"),"utf8"),"original draft");assert.ok((await readdir(join(f.target,"inbox/database"))).includes("pg_snapshots"));assert.equal(await readFile(join(f.source,"session/unknown.txt"),"utf8"),"preserve unknown session file");assert.equal(await readFile(join(f.work,"chapter.md"),"utf8"),"never move work");assert.deepEqual(f.releases,["new-root"]);assert.ok(f.guardCalls>20)}finally{await f.close()}
})
test("RMT12-02 prepared is inert until explicit cancel; durable result before cancelled state",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof),runner=new RootMaintenanceRunner(f.options);const initial=await runner.start();assert.equal(initial.phase,"preparing");assert.equal(initial.canCancel,true);assert.equal(initial.canContinue,false);assert.equal(f.migrates,0);assert.deepEqual(await readdir(f.target),[]);await runner.cancel();assert.equal(runner.state().phase,"cancelled");assert.equal((await f.requests.readResult())?.requestId,prepared.requestId);assert.equal((await f.requests.inspect()).active,null)}finally{await f.close()}
})
test("RMT12-03 actual process-closure guard rejection preserves armed request and all data",async()=>{
 const f=await fixture();try{const armed=await f.armed();f.setGuard(()=>{throw Error("previous Electron still running sk-private")});const runner=new RootMaintenanceRunner(f.options),state=await runner.start();assert.equal(state.phase,"recovery-required");assert.equal(state.canContinue,false);assert.equal(f.migrates,0);assert.equal((await f.requests.inspect()).active?.requestId,armed.requestId);assert.equal(await readFile(join(f.source,"drafts.json"),"utf8"),"original draft");assert.equal(JSON.stringify(state).includes("sk-private"),false)}finally{await f.close()}
})
test("RMT12-04 simultaneous start shares real work and progress is monotonic bounded read-only, observers cannot break persistence",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let running:Promise<RootMaintenanceState>|undefined
 try{await f.armed();f.setHook(async phase=>{if(phase==="copying"){entered.resolve();await allow.promise}});const runner=new RootMaintenanceRunner(f.options),states:RootMaintenanceState[]=[];runner.subscribe(()=>{throw Error("bad observer")});runner.subscribe(state=>{states.push({...state});state.copiedFiles=999999});running=runner.start();const repeated=runner.start();assert.equal(running,repeated);await entered.promise;assert.equal(runner.state().copiedFiles,0);allow.resolve();await running;assert.equal(f.migrates,1);assert.ok(states.length>4);assert.ok(states.every((state,index)=>index===0||state.revision>states[index-1].revision));assert.ok(states.every(state=>state.totalFiles===null||state.copiedFiles<=state.totalFiles));assert.equal(runner.state().copiedFiles,runner.state().totalFiles)}finally{allow.resolve();await running?.catch(()=>{});await f.close()}
})
test("RMT12-05 cancellation before pointer waits for actual rollback and journal-correlated finish",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let running:Promise<RootMaintenanceState>|undefined
 try{await f.armed();f.setHook(async phase=>{if(phase==="file-copied"){entered.resolve();await allow.promise}});const runner=new RootMaintenanceRunner(f.options);running=runner.start();await entered.promise;let stopped=false;const cancelling=runner.cancel().then(()=>{stopped=true});await new Promise(done=>setTimeout(done,10));assert.equal(stopped,false);assert.equal(runner.state().canContinue,false);allow.resolve();await Promise.all([running,cancelling]);assert.equal(runner.state().phase,"cancelled");assert.equal((await f.requests.readResult())?.outcome.status,"rolled-back");assert.deepEqual((await f.manager.resolve() as {pointer:unknown}).pointer,f.pointer);assert.equal(await readFile(join(f.source,"drafts.json"),"utf8"),"original draft");assert.deepEqual(await readdir(f.target),[])}finally{allow.resolve();await running?.catch(()=>{});await f.close()}
})
test("RMT12-06 after commit cancellation is rejected and never falsely declares old root authoritative",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let running:Promise<RootMaintenanceState>|undefined
 try{await f.armed();f.setHook(async phase=>{if(phase==="pointer-written"){entered.resolve();await allow.promise}});const runner=new RootMaintenanceRunner(f.options);running=runner.start();await entered.promise;assert.equal(runner.state().canCancel,false);await assert.rejects(runner.cancel(),/CANNOT_CANCEL/);allow.resolve();assert.equal((await running).phase,"cleanup-pending");assert.equal((await f.manager.resolve() as {pointer:{root:{path:string}}}).pointer.root.path,f.target)}finally{allow.resolve();await running?.catch(()=>{});await f.close()}
})
test("RMT12-07 executing without matching journal never restarts migration or clears unknown request",async()=>{
 const f=await fixture();try{const execution=await f.executing(),runner=new RootMaintenanceRunner(f.options),state=await runner.start();assert.equal(state.phase,"recovery-required");assert.equal(state.canContinue,false);assert.equal(f.migrates,0);const active=(await f.requests.inspect()).active;assert.equal(active?.phase,"executing");assert.ok(active?.phase==="executing");assert.equal(active.executionNonce,execution.executionNonce);assert.deepEqual(await readdir(f.target),[])}finally{await f.close()}
})
test("RMT12-08 committed crash recovery matches execution nonce, never new migrate, and stores actual completion",async()=>{
 const f=await fixture();try{const execution=await f.executing(),core=new DataRootManager(f.bootstrap,f.source,{migrationId:execution.executionNonce,hook:phase=>{if(phase==="pointer-written")throw new RootMigrationCrash()}} as RootOptions);const inventory=(await import("../../desktop/main/owned-root-files")).collectClosedRootFiles;const owned=await inventory(f.pointer.root,f.options.host.assertMaintenanceClosed);await assert.rejects(core.migrate(f.proof,{quiesce:async()=>({source:f.pointer.root,ownedFiles:owned.files,ownedDirectories:owned.directories,assertClosed:f.options.host.assertMaintenanceClosed,release(){}})}),RootMigrationCrash);const runner=new RootMaintenanceRunner(f.options),state=await runner.start();assert.equal(state.phase,"complete");assert.equal(f.migrates,0);assert.equal((await f.requests.readResult())?.executionNonce,execution.executionNonce);assert.equal(await readFile(join(f.target,"drafts.json"),"utf8"),"original draft")}finally{await f.close()}
})
test("RMT12-09 stale journal for identical source and target cannot be reused by a new executing request",async()=>{
 const f=await fixture();try{const oldId=randomUUID(),inventory=await(await import("../../desktop/main/owned-root-files")).collectClosedRootFiles(f.pointer.root,f.options.host.assertMaintenanceClosed),abort=new AbortController();const core=new DataRootManager(f.bootstrap,f.source,{migrationId:oldId,hook:phase=>{if(phase==="file-copied")abort.abort()}} as RootOptions);await assert.rejects(core.migrate(f.proof,{quiesce:async()=>({source:f.pointer.root,ownedFiles:inventory.files,ownedDirectories:inventory.directories,assertClosed:f.options.host.assertMaintenanceClosed,release(){}})},abort.signal));const execution=await f.executing();assert.notEqual(execution.executionNonce,oldId);const runner=new RootMaintenanceRunner(f.options);assert.equal((await runner.start()).phase,"recovery-required");assert.equal(f.migrates,0);assert.equal((await f.requests.inspect()).active?.requestId,execution.requestId)}finally{await f.close()}
})
test("RMT12-10 terminal journal after finish-before-ACK crash restores exact result and no new copy",async()=>{
 const f=await fixture();try{await f.armed();const first=new RootMaintenanceRunner(f.options);await first.start();const stored=await f.requests.readResult();const next=new RootMaintenanceRunner(f.options);assert.equal((await next.start()).phase,"cleanup-pending");assert.equal(f.migrates,1);assert.deepEqual(await f.requests.readResult(),stored);await next.continue();assert.equal(f.continues,1);assert.equal(await f.requests.readResult(),null)}finally{await f.close()}
})
test("RMT12-11 FIFO result display leaves newer active armed request untouched until cold relaunch",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof),old=await f.requests.cancel(prepared.requestId,f.owner),armed=await f.armed(),runner=new RootMaintenanceRunner(f.options);assert.equal((await runner.start()).phase,"cancelled");assert.equal(f.migrates,0);await runner.continue();assert.equal(await f.requests.readResult(),null);assert.equal((await f.requests.inspect()).active?.requestId,armed.requestId);assert.equal(f.continues,1);assert.equal(old.outcome.status,"cancelled")}finally{await f.close()}
})
test("RMT12-12 quit during active copy waits rollback and keeps unacknowledged result",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let running:Promise<RootMaintenanceState>|undefined
 try{await f.armed();f.setHook(async phase=>{if(phase==="file-copied"){entered.resolve();await allow.promise}});const runner=new RootMaintenanceRunner(f.options);running=runner.start();await entered.promise;const quitting=runner.quit();await new Promise(done=>setTimeout(done,10));assert.equal(f.quits,0);allow.resolve();await Promise.all([running,quitting]);assert.equal(f.quits,1);assert.equal((await f.requests.readResult())?.outcome.status,"rolled-back")}finally{allow.resolve();await running?.catch(()=>{});await f.close()}
})
test("RMT12-13 malformed ledger yields recovery-required without touching original files or exposing raw cause",async()=>{
 const f=await fixture();try{await writeFile(join(f.bootstrap,"root-migration-request.json"),"not JSON sk-private-key");const runner=new RootMaintenanceRunner(f.options),state=await runner.start();assert.equal(state.phase,"recovery-required");assert.equal(state.canContinue,false);assert.equal(f.migrates,0);assert.equal(JSON.stringify(state).includes("sk-private"),false);assert.equal(await readFile(join(f.source,"drafts.json"),"utf8"),"original draft")}finally{await f.close()}
})
test("RMT12-14 unsafe owned symlink is rejected before file promotion and preserves request result safely",async()=>{
 const f=await fixture();try{await f.armed();await rm(join(f.source,"session/Preferences"));await symlink(join(f.work,"chapter.md"),join(f.source,"session/Preferences"));const runner=new RootMaintenanceRunner(f.options),state=await runner.start();assert.equal(state.phase,"failed");assert.equal(state.canContinue,true);assert.equal(await readFile(join(f.work,"chapter.md"),"utf8"),"never move work");assert.deepEqual(await readdir(f.target),[]);assert.equal((await f.requests.readResult())?.outcome.status,"failed")}finally{await f.close()}
})
test("RMT12-15 source changes in closure guard cannot clear executing with guessed failure or publish continue",async()=>{
 const f=await fixture();try{await f.executing();await rm(join(f.bootstrap,"data-root.json"));const runner=new RootMaintenanceRunner(f.options),state=await runner.start();assert.equal(state.phase,"recovery-required");assert.equal(state.canContinue,false);assert.equal((await f.requests.inspect()).active?.phase,"executing");await assert.rejects(runner.continue(),/CANNOT_CONTINUE/);assert.equal(f.continues,0)}finally{await f.close()}
})
test("RMT12-16 pure64 decoder is strict and cannot alter caller snapshot or accept injected phase fields",()=>{
 const empty={schemaVersion:1,revision:0,active:null,results:[]};assert.deepEqual(validateRootMigrationRequestSnapshot(empty),empty);assert.throws(()=>validateRootMigrationRequestSnapshot({...empty,apiKey:"secret"}));assert.deepEqual(empty,{schemaVersion:1,revision:0,active:null,results:[]})
})
test("RMT12-17 prepared cancellation IO failure still permits safe quit without clearing its durable request",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof),runner=new RootMaintenanceRunner(f.options);await runner.start();Object.assign(f.requestOptions.writeOptions,{beforeRename:async()=>{throw Error("cancel IO failed sk-private")}});await runner.quit();assert.equal(f.quits,1);assert.equal((await f.requests.inspect()).active?.requestId,prepared.requestId);assert.equal(await readFile(join(f.source,"drafts.json"),"utf8"),"original draft");assert.equal(f.migrates,0)}finally{await f.close()}
})
test("RMT12-18 observer resubscribe cannot loop or receive the same revision twice",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof);await f.requests.cancel(prepared.requestId,f.owner);const runner=new RootMaintenanceRunner(f.options),seen:number[]=[];let unsubscribe=()=>{};const observe=(state:RootMaintenanceState)=>{seen.push(state.revision);if(seen.length<6){unsubscribe();unsubscribe=runner.subscribe(observe)}};unsubscribe=runner.subscribe(observe);await runner.start();assert.equal(new Set(seen).size,seen.length);assert.equal(runner.state().phase,"cancelled")}finally{await f.close()}
})
test("RMT12-19 finish durability failure never advertises success; exact stored receipt retry does not migrate again",async()=>{
 const f=await fixture();try{await f.armed();f.setHook(phase=>{if(phase==="complete")Object.assign(f.requestOptions.writeOptions,{beforeDirectorySync:async()=>{throw Error("private fsync fail")}})});const runner=new RootMaintenanceRunner(f.options);assert.equal((await runner.start()).phase,"recovery-required");assert.equal(runner.state().canContinue,false);assert.equal(f.migrates,1);Object.assign(f.requestOptions.writeOptions,{beforeDirectorySync:undefined});f.setHook(undefined);assert.equal((await runner.start()).phase,"cleanup-pending");assert.equal(f.migrates,1);assert.equal((await f.requests.inspect()).active,null);assert.equal(await readFile(join(f.target,"drafts.json"),"utf8"),"original draft")}finally{await f.close()}
})
test("RMT12-20 core terminal result cannot enable continue before ledger finish fsync settles",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let running:Promise<RootMaintenanceState>|undefined
 try{await f.armed();f.setHook(phase=>{if(phase==="complete")Object.assign(f.requestOptions.writeOptions,{beforeDirectorySync:async()=>{entered.resolve();await allow.promise}})});const runner=new RootMaintenanceRunner(f.options);running=runner.start();await entered.promise;assert.equal(runner.state().canContinue,false);await assert.rejects(runner.continue(),/CANNOT_CONTINUE/);assert.equal(f.continues,0);allow.resolve();assert.equal((await running).phase,"cleanup-pending");assert.equal(runner.state().canContinue,true)}finally{allow.resolve();await running?.catch(()=>{});await f.close()}
})
test("RMT12-21 core complete before ledger rename failure resumes from terminal journal without a second migrate",async()=>{
 const f=await fixture();try{await f.armed();f.setHook(phase=>{if(phase==="complete")Object.assign(f.requestOptions.writeOptions,{beforeRename:async()=>{throw Error("ledger finish unavailable")}})});const first=new RootMaintenanceRunner(f.options);assert.equal((await first.start()).phase,"recovery-required");assert.equal((await f.requests.inspect()).active?.phase,"executing");assert.equal(f.migrates,1);Object.assign(f.requestOptions.writeOptions,{beforeRename:undefined});f.setHook(undefined);const restart=new RootMaintenanceRunner(f.options);assert.equal((await restart.start()).phase,"cleanup-pending");assert.equal((await f.requests.inspect()).active,null);assert.equal(f.migrates,1);assert.equal(await readFile(join(f.target,"drafts.json"),"utf8"),"original draft")}finally{await f.close()}
})
test("RMT12-22 cancelled rollback with replaced staging bytes is rollback-pending and never hidden by generic failed/cancelled result",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let running:Promise<RootMaintenanceState>|undefined,foreign=""
 try{await f.armed();f.setHook(async(phase,path)=>{if(phase==="file-copied"&&!foreign){const stage=(await readdir(f.target)).find(name=>name.startsWith(".xuanxiang-migration-"));assert.ok(stage&&path);foreign=join(f.target,stage,path);await rename(foreign,foreign+"-old");await writeFile(foreign,"foreign replacement remains");entered.resolve();await allow.promise}});const runner=new RootMaintenanceRunner(f.options);running=runner.start();await entered.promise;const cancel=runner.cancel();allow.resolve();await Promise.all([running,cancel]);assert.equal(runner.state().phase,"rollback-pending");assert.equal(runner.state().canContinue,true);assert.ok(runner.state().pendingCount>0);assert.equal((await f.requests.readResult())?.outcome.status,"rollback-pending");assert.equal(await readFile(foreign,"utf8"),"foreign replacement remains");assert.equal(await readFile(join(f.source,"drafts.json"),"utf8"),"original draft")}finally{allow.resolve();await running?.catch(()=>{});await f.close()}
})
test("RMT12-23 FIFO ACK consumes only displayed receipt and repeated continue shares one cold-relaunch callback",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let advancing:Promise<void>|undefined
 try{const a=await f.requests.prepare(f.owner,f.proof),first=await f.requests.cancel(a.requestId,f.owner),b=await f.requests.prepare(f.owner,f.proof),second=await f.requests.cancel(b.requestId,f.owner);f.options.onContinue=async()=>{entered.resolve();await allow.promise};const runner=new RootMaintenanceRunner(f.options);await runner.start();advancing=runner.continue();const repeated=runner.continue();assert.equal(advancing,repeated);await entered.promise;assert.equal((await f.requests.readResult())?.requestId,second.requestId);assert.equal((await f.requests.inspect()).results.some(row=>row.receiptId===first.receiptId),false);allow.resolve();await advancing;assert.equal((await f.requests.readResult())?.receiptId,second.receiptId)}finally{allow.resolve();await advancing?.catch(()=>{});await f.close()}
})
test("RMT12-24 guard lost after copied file stops authority change and preserves association until guard restored",async()=>{
 const f=await fixture();let lost=false
 try{await f.armed();f.setHook(phase=>{if(phase==="file-copied"){lost=true;f.setGuard(()=>{if(lost)throw Error("stable instance lock lost")})}});const runner=new RootMaintenanceRunner(f.options);assert.equal((await runner.start()).phase,"recovery-required");assert.equal(runner.state().canContinue,false);assert.equal((await f.requests.inspect()).active?.phase,"executing");assert.deepEqual((await f.manager.resolve() as {pointer:unknown}).pointer,f.pointer);lost=false;f.setHook(undefined);assert.equal((await runner.start()).phase,"failed");assert.equal(f.migrates,1);assert.equal((await f.requests.readResult())?.outcome.status,"rolled-back")}finally{await f.close()}
})
test("RMT12-25 committed cleanup-pending exposes true phase and safe new-root continuation, preserving changed old copy",async()=>{
 const f=await fixture();try{await f.armed();f.setHook(async phase=>{if(phase==="cleanup")await writeFile(join(f.source,"drafts.json"),"external changed old draft")});const runner=new RootMaintenanceRunner(f.options);const state=await runner.start();assert.equal(state.phase,"cleanup-pending");assert.equal(state.canContinue,true);assert.ok(state.pendingCount>0);assert.equal(await readFile(join(f.source,"drafts.json"),"utf8"),"external changed old draft");assert.equal(await readFile(join(f.target,"drafts.json"),"utf8"),"original draft");assert.equal((await f.requests.readResult())?.outcome.status,"cleanup-pending");await runner.continue();assert.equal(f.continues,1)}finally{await f.close()}
})
test("RMT12-26 journal disappearance after actual creation cannot be reclassified as a no-journal preflight failure",async()=>{
 const f=await fixture();try{await f.armed();f.setHook(async phase=>{if(phase==="journal"){await rm(join(f.bootstrap,"root-migration.json"));throw Error("external journal disappeared")}});const runner=new RootMaintenanceRunner(f.options);assert.equal((await runner.start()).phase,"recovery-required");assert.equal(runner.state().canContinue,false);assert.equal((await f.requests.inspect()).active?.phase,"executing");assert.equal(await f.requests.readResult(),null);assert.deepEqual((await f.manager.resolve() as {pointer:unknown}).pointer,f.pointer);assert.equal(await readFile(join(f.source,"drafts.json"),"utf8"),"original draft")}finally{await f.close()}
})
test("RMT12-27 ACK directory-sync ambiguity does not relaunch until same-ledger durability is reconciled",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof);await f.requests.cancel(prepared.requestId,f.owner);const runner=new RootMaintenanceRunner(f.options);await runner.start();Object.assign(f.requestOptions.writeOptions,{beforeDirectorySync:async()=>{throw Error("ACK sync fail")}});await assert.rejects(runner.continue(),/CONTINUE_UNCONFIRMED/);assert.equal(f.continues,0);Object.assign(f.requestOptions.writeOptions,{beforeDirectorySync:undefined});await runner.continue();assert.equal(f.continues,1);assert.equal((await f.requests.inspect()).results.length,0);assert.equal(await readFile(join(f.source,"drafts.json"),"utf8"),"original draft")}finally{await f.close()}
})
test("RMT12-28 lost handoff guard never leaks raw cause or leaves safe-continue enabled",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof);await f.requests.cancel(prepared.requestId,f.owner);const runner=new RootMaintenanceRunner(f.options);await runner.start();f.setGuard(()=>{throw Error("sk-private-handoff-cause")});await assert.rejects(runner.continue(),error=>error instanceof Error&&error.message==="CONTINUE_UNCONFIRMED"&&!String(error).includes("sk-private"));assert.equal(runner.state().phase,"recovery-required");assert.equal(runner.state().canContinue,false);assert.equal(f.continues,0);assert.equal((await f.requests.inspect()).results.length,1)}finally{await f.close()}
})
test("RMT12-29 failed quit callback returns only fixed code and leaves receipt unacknowledged for restart",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof);await f.requests.cancel(prepared.requestId,f.owner);f.options.onQuit=async()=>{throw Error("sk-private-relaunch-error")};const runner=new RootMaintenanceRunner(f.options);await runner.start();await assert.rejects(runner.quit(),error=>error instanceof Error&&error.message==="QUIT_UNCONFIRMED"&&!String(error).includes("sk-private"));assert.equal((await f.requests.inspect()).results.length,1);f.options.onQuit=async()=>{};await runner.quit();assert.equal((await f.requests.inspect()).results.length,1)}finally{await f.close()}
})
test("RMT12-30 synchronous first-publication start reentry shares the real gated migration promise",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let running:Promise<RootMaintenanceState>|undefined,nested:Promise<RootMaintenanceState>|undefined
 try{
  await f.armed();f.setHook(async phase=>{if(phase==="copying"){entered.resolve();await allow.promise}})
  const runner=new RootMaintenanceRunner(f.options);runner.subscribe(state=>{if(state.revision===1)nested=runner.start()})
  running=runner.start();await entered.promise;assert.ok(nested);assert.equal(nested,running)
  let innerSettled=false;void nested.then(()=>{innerSettled=true});await Promise.resolve();assert.equal(innerSettled,false)
  allow.resolve();const [outerState,innerState]=await Promise.all([running,nested]);assert.equal(outerState.phase,"cleanup-pending");assert.equal(innerState.phase,"cleanup-pending");assert.equal(f.migrates,1)
 }finally{allow.resolve();await running?.catch(()=>{});await f.close()}
})
test("RMT12-31 cancel reentry at the first prepared notification shares one durable cancellation and waits for directory sync",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let running:Promise<RootMaintenanceState>|undefined,cancelling:Promise<void>|undefined,repeated:Promise<void>|undefined
 try{
  const prepared=await f.requests.prepare(f.owner,f.proof),runner=new RootMaintenanceRunner(f.options);let accepting=false
  Object.assign(f.requestOptions.writeOptions,{beforeDirectorySync:async()=>{entered.resolve();await allow.promise}})
  runner.subscribe(state=>{
   if(state.phase!=="preparing")return
   if(state.canCancel&&!accepting){accepting=true;cancelling=runner.cancel();void cancelling.catch(()=>{})}
   else if(accepting&&!state.canCancel&&!repeated){repeated=runner.cancel();void repeated.catch(()=>{})}
  })
  running=runner.start();await running;assert.ok(cancelling);assert.ok(repeated);assert.equal(repeated,cancelling)
  await entered.promise;let resolved=false;void cancelling.then(()=>{resolved=true},()=>{});await Promise.resolve();assert.equal(resolved,false);assert.equal(runner.state().canContinue,false)
  allow.resolve();await Promise.all([cancelling,repeated]);assert.equal(runner.state().phase,"cancelled");assert.equal(runner.state().canContinue,true);assert.equal((await f.requests.inspect()).active,null);assert.equal((await f.requests.readResult())?.requestId,prepared.requestId);assert.equal(f.migrates,0)
 }finally{allow.resolve();await running?.catch(()=>{});await cancelling?.catch(()=>{});await repeated?.catch(()=>{});await f.close()}
})
test("RMT12-32 synchronous quit during accepted prepared cancellation waits its actual durable IO and leaves the result unacknowledged",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let running:Promise<RootMaintenanceState>|undefined,cancelling:Promise<void>|undefined,quitting:Promise<void>|undefined
 try{
  const prepared=await f.requests.prepare(f.owner,f.proof),runner=new RootMaintenanceRunner(f.options);let accepting=false
  Object.assign(f.requestOptions.writeOptions,{beforeDirectorySync:async()=>{entered.resolve();await allow.promise}})
  runner.subscribe(state=>{
   if(state.phase!=="preparing")return
   if(state.canCancel&&!accepting){accepting=true;cancelling=runner.cancel();void cancelling.catch(()=>{})}
   else if(accepting&&!state.canCancel&&!quitting){quitting=runner.quit();void quitting.catch(()=>{})}
  })
  running=runner.start();await running;await entered.promise;assert.ok(cancelling);assert.ok(quitting)
  await new Promise(done=>setImmediate(done));assert.equal(f.quits,0,"quit must not bypass a cancellation accepted before its ledger write was queued")
  allow.resolve();await Promise.all([cancelling,quitting]);assert.equal(f.quits,1);assert.equal((await f.requests.inspect()).active,null);assert.equal((await f.requests.readResult())?.requestId,prepared.requestId);assert.equal(f.migrates,0)
 }finally{allow.resolve();await running?.catch(()=>{});await cancelling?.catch(()=>{});await quitting?.catch(()=>{});await f.close()}
})
test("RMT12-33 quit entered during its own cancellation publication shares the already registered handoff and invokes exit once",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let outer:Promise<void>|undefined,nested:Promise<void>|undefined
 try{
  const prepared=await f.requests.prepare(f.owner,f.proof),runner=new RootMaintenanceRunner(f.options);await runner.start()
  Object.assign(f.requestOptions.writeOptions,{beforeDirectorySync:async()=>{entered.resolve();await allow.promise}})
  runner.subscribe(state=>{if(state.phase==="preparing"&&!state.canCancel&&!nested){nested=runner.quit();void nested.catch(()=>{})}})
  outer=runner.quit();await entered.promise;assert.ok(nested);assert.equal(nested,outer);assert.equal(f.quits,0)
  allow.resolve();await Promise.all([outer,nested]);assert.equal(f.quits,1);assert.equal((await f.requests.inspect()).active,null);assert.equal((await f.requests.readResult())?.requestId,prepared.requestId);assert.equal(f.migrates,0)
 }finally{allow.resolve();await outer?.catch(()=>{});await nested?.catch(()=>{});await f.close()}
})

test('RMT29 preserved inventory is passed through the closed lease before migration writes or cleanup',async()=>{
 const f=await fixture();let preserved:readonly string[]|undefined
 try{await f.armed();const runner=new RootMaintenanceRunner({...f.options,createManager:options=>{const manager=f.options.createManager(options),migrate=manager.migrate.bind(manager);manager.migrate=(target,host,signal)=>migrate(target,{quiesce:async source=>{const lease=await host.quiesce(source);preserved=lease.preserved;return lease}},signal);return manager}})
 await runner.start();assert.ok(preserved?.includes('session/unknown.txt'));assert.equal(await readFile(join(f.source,'session/unknown.txt'),'utf8'),'preserve unknown session file')
 }finally{await f.close()}
})
