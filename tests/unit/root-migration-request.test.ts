import {ROOT_MIGRATION_LIMITS} from '../../desktop/core/root-inventory-limits'
import assert from "node:assert/strict"
import {test} from "node:test"
import {randomUUID} from "node:crypto"
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm,rename,readdir,symlink,link,lstat} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {setImmediate} from "node:timers/promises"
import {DataRootManager,type RootPointer,type MigrationResult} from "../../desktop/core/data-root"
import {directoryIdentity} from "../../desktop/core/root-ownership"
import {RootMigrationRequests,RootMigrationRequestError,MAX_ROOT_MIGRATION_REQUEST_BYTES,type RootMigrationRequestOptions} from "../../desktop/main/root-migration-request"

const code=(expected:string)=>(error:unknown)=>error instanceof RootMigrationRequestError&&error.code===expected
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return{promise,resolve}}
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),"xuanxiang-request64-"))),bootstrap=join(base,"bootstrap"),source=join(base,"source"),target=join(base,"target")
 for(const path of [bootstrap,source,target])await mkdir(path)
 const pointer:RootPointer={schemaVersion:1,revision:1,rootId:randomUUID(),migrationId:null,root:await directoryIdentity(source)},owner=randomUUID(),path=join(bootstrap,"root-migration-request.json")
 const marker={schemaVersion:1,app:"Xuanxiangxiezuo-Desktop",id:pointer.rootId,phase:"ready",inboxReady:true}
 await writeFile(join(source,"xuanxiang-app.json"),JSON.stringify(marker));await writeFile(join(source,"drafts.json"),"unapproved original draft");await writeFile(join(bootstrap,"data-root.json"),JSON.stringify(pointer))
 const manager=new DataRootManager(bootstrap,source)
 let valid=true,locked=true,closed=false,sourceAvailable=true
 const options:RootMigrationRequestOptions={resolveSource:async()=>{if(!sourceAvailable)throw Error("sk-secret-provider-cause");return manager.resolve()},assertStableLock(){if(!locked)throw Error("no lock")},assertOwner(nonce){if(!valid||nonce!==owner)throw Error("old owner")},assertClosed(){if(!closed)throw Error("DB open")},writeOptions:{}}
 const requests=new RootMigrationRequests(bootstrap,options),proof=await directoryIdentity(target)
 return{base,bootstrap,source,target,path,pointer,owner,options,requests,proof,manager,setValid:(value:boolean)=>{valid=value},setLocked:(value:boolean)=>{locked=value},setClosed:(value:boolean)=>{closed=value},setSourceAvailable:(value:boolean)=>{sourceAvailable=value},reopen:()=>new RootMigrationRequests(bootstrap,options),
  async armed(){const prepared=await requests.prepare(owner,proof);closed=true;return requests.arm(owner,prepared.requestId)},
  async executing(){const armed=await this.armed();return requests.startArmed(armed.requestId)},
  async moved(migrationId=randomUUID()):Promise<MigrationResult>{const root:RootPointer={...pointer,revision:2,migrationId,root:proof};await writeFile(join(target,"xuanxiang-app.json"),JSON.stringify(marker));await writeFile(join(bootstrap,"data-root.json"),JSON.stringify(root));return{status:"complete",migrationId,root,pending:[]}},
  async cleanup(){await requests.flush().catch(()=>{});await rm(base,{recursive:true,force:true})}}
}

test("MR64-01: prepare persists a random inert request from authoritative source without moving draft bytes",async()=>{
 const f=await fixture();try{const request=await f.requests.prepare(f.owner,f.proof);assert.match(request.requestId,/^[\da-f-]{36}$/);assert.equal(request.phase,"prepared");assert.deepEqual(request.source,f.pointer);assert.deepEqual(request.target,f.proof);assert.equal((await f.requests.inspect()).revision,1);assert.equal(await readFile(join(f.source,"drafts.json"),"utf8"),"unapproved original draft");assert.deepEqual(await readdir(f.target),[]);assert.ok((await lstat(f.path)).isFile())}finally{await f.cleanup()}
})
test("MR64-02: prepared survives reopening but cannot be loaded or started as an armed startup task",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof),reopened=f.reopen();assert.equal(await reopened.loadArmed(),null);await assert.rejects(reopened.startArmed(prepared.requestId),code("NOT_ARMED"));assert.equal((await reopened.inspect()).active?.phase,"prepared")}finally{await f.cleanup()}
})
test("MR64-03: arm requires actual closed assertion and only a durable armed task is returned on restart",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof);await assert.rejects(f.requests.arm(f.owner,prepared.requestId),code("SOURCE_NOT_CLOSED"));assert.equal((await f.requests.inspect()).active?.phase,"prepared");f.setClosed(true);await f.requests.arm(f.owner,prepared.requestId);f.setValid(false);assert.equal((await f.reopen().loadArmed())?.requestId,prepared.requestId)}finally{await f.cleanup()}
})
test("MR64-04: source root revision drift prevents arm and preserves the prepared record",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof);f.setClosed(true);await writeFile(join(f.bootstrap,"data-root.json"),JSON.stringify({...f.pointer,revision:2}));await assert.rejects(f.requests.arm(f.owner,prepared.requestId),code("SOURCE_CHANGED"));assert.equal((await f.requests.inspect()).active?.phase,"prepared")}finally{await f.cleanup()}
})
test("MR64-05: target directory identity replacement prevents arm without modifying either directory",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof);f.setClosed(true);await rename(f.target,f.target+"-old");await mkdir(f.target);await writeFile(join(f.target,"user.txt"),"replacement");await assert.rejects(f.requests.arm(f.owner,prepared.requestId),code("TARGET_CHANGED"));assert.equal(await readFile(join(f.target,"user.txt"),"utf8"),"replacement");assert.equal((await f.requests.inspect()).active?.phase,"prepared")}finally{await f.cleanup()}
})
test("MR64-06: owner expiration while the original rename hook is waiting cannot arm",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let pending:Promise<unknown>|undefined
 try{const prepared=await f.requests.prepare(f.owner,f.proof);f.setClosed(true);f.options.writeOptions!.beforeRename=async()=>{entered.resolve();await allow.promise};pending=f.requests.arm(f.owner,prepared.requestId);void pending.catch(()=>{});await entered.promise;f.setValid(false);allow.resolve();await assert.rejects(pending,code("OWNER_EXPIRED"));pending=undefined;assert.equal((await f.requests.inspect()).active?.phase,"prepared")}finally{allow.resolve();await pending?.catch(()=>{});await f.cleanup()}
})
test("MR64-07: expired owner may safely cancel its exact unexecuted id but cannot cancel another nonce",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof);f.setValid(false);await assert.rejects(f.requests.cancel(prepared.requestId,randomUUID()),code("REQUEST_MISMATCH"));const cancelled=await f.requests.cancel(prepared.requestId,f.owner);assert.equal(cancelled.outcome.status,"cancelled");assert.equal((await f.requests.inspect()).active,null);assert.deepEqual(await f.requests.cancel(prepared.requestId,f.owner),cancelled);assert.equal(await f.reopen().loadArmed(),null)}finally{await f.cleanup()}
})
test("MR64-08: concurrent arm and cancel serialize to a recorded cancellation, never an untracked armed task",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof);f.setClosed(true);const [armed,cancelled]=await Promise.all([f.requests.arm(f.owner,prepared.requestId),f.requests.cancel(prepared.requestId,f.owner)]);assert.equal(armed.phase,"armed");assert.equal(cancelled.outcome.status,"cancelled");assert.equal(await f.reopen().loadArmed(),null);assert.equal((await f.requests.inspect()).results.length,1)}finally{await f.cleanup()}
})
test("MR64-09: execution is durably claimed once and executing is never auto-loaded again on restart",async()=>{
 const f=await fixture();try{const armed=await f.armed(),execution=await f.requests.startArmed(armed.requestId);assert.equal(execution.phase,"executing");assert.match(execution.executionNonce,/^[\da-f-]{36}$/);assert.equal(await f.reopen().loadArmed(),null);assert.equal((await f.reopen().inspect()).active?.phase,"executing");await assert.rejects(f.requests.startArmed(armed.requestId),code("NOT_ARMED"));await assert.rejects(f.requests.cancel(armed.requestId,f.owner),code("EXECUTION_STARTED"))}finally{await f.cleanup()}
})
test("MR64-10: wrong execution nonce and mismatched migration result preserve the running request",async()=>{
 const f=await fixture();try{const execution=await f.executing(),result=await f.moved();await assert.rejects(f.requests.finish(execution.requestId,randomUUID(),result),code("REQUEST_MISMATCH"));await assert.rejects(f.requests.finish(execution.requestId,execution.executionNonce,{...result,root:{...result.root,rootId:randomUUID()}}),code("RESULT_MISMATCH"));assert.equal((await f.requests.inspect()).active?.phase,"executing")}finally{await f.cleanup()}
})
test("MR64-11: completion and new request coexist; stale result ACK cannot erase the new active request",async()=>{
 const f=await fixture();try{const execution=await f.executing(),result=await f.moved(),completion=await f.requests.finish(execution.requestId,execution.executionNonce,result);assert.equal(completion.outcome.status,"complete");assert.equal((await f.requests.inspect()).active,null);assert.deepEqual(await f.requests.finish(execution.requestId,execution.executionNonce,result),completion);const third=join(f.base,"third");await mkdir(third);const next=await f.requests.prepare(f.owner,await directoryIdentity(third));assert.deepEqual(await f.requests.readResult(),completion);assert.equal(await f.requests.acknowledgeResult(completion.requestId,randomUUID()),false);assert.equal(await f.requests.acknowledgeResult(completion.requestId,completion.receiptId),true);assert.equal(await f.requests.acknowledgeResult(completion.requestId,completion.receiptId),false);assert.equal((await f.requests.inspect()).active?.requestId,next.requestId);assert.equal(await f.requests.readResult(),null)}finally{await f.cleanup()}
})
test("MR64-12: failure stores only a fixed safe code and authority, never caller error text or cause",async()=>{
 const f=await fixture();try{const armed=await f.armed();await assert.rejects(f.requests.fail(armed.requestId,"sk-secret-provider-cause" as any),code("INVALID_REQUEST"));const failed=await f.requests.fail(armed.requestId,"MIGRATION_FAILED");assert.equal(failed.outcome.status,"failed");assert.equal((await f.requests.inspect()).active,null);assert.equal((await readFile(f.path,"utf8")).includes("sk-secret"),false);assert.deepEqual((failed.outcome as {root:RootPointer}).root,f.pointer)}finally{await f.cleanup()}
})
test("MR64-13: unknown authoritative source cannot clear the pending request or serialize its cause",async()=>{
 const f=await fixture();try{const armed=await f.armed(),before=await readFile(f.path);f.setSourceAvailable(false);await assert.rejects(f.requests.fail(armed.requestId,"RECOVERY_REQUIRED"),code("SOURCE_UNAVAILABLE"));assert.deepEqual(await readFile(f.path),before);assert.equal((await f.requests.inspect()).active?.phase,"armed");await assert.rejects(f.requests.loadArmed(),error=>code("SOURCE_UNAVAILABLE")(error)&&!String(error).includes("sk-secret"))}finally{await f.cleanup()}
})
test("MR64-14: a committed migration pointer requires recovery completion, not a generic failure that loses association",async()=>{
 const f=await fixture();try{const execution=await f.executing(),result=await f.moved();await assert.rejects(f.requests.fail(execution.requestId,"MIGRATION_FAILED",execution.executionNonce),code("RECOVERY_REQUIRED"));assert.equal((await f.requests.inspect()).active?.phase,"executing");assert.equal((await f.requests.finish(execution.requestId,execution.executionNonce,result)).outcome.status,"complete")}finally{await f.cleanup()}
})
test("MR64-15: unsafe symlink/hardlink, oversized and invalid schema records are rejected without overwriting external bytes",async()=>{
 for(const mode of ["symlink","hardlink","oversize","schema","utf8"]){const f=await fixture();try{const outside=join(f.base,"external");await writeFile(outside,"precious bytes");if(mode==="symlink")await symlink(outside,f.path);else if(mode==="hardlink")await link(outside,f.path);else await writeFile(f.path,mode==="oversize"?Buffer.alloc(MAX_ROOT_MIGRATION_REQUEST_BYTES+1):mode==="utf8"?Buffer.from([0xff,0xfe]):JSON.stringify({schemaVersion:1,revision:0,active:null,results:[],extra:"key"}));const before=await readFile(f.path);await assert.rejects(f.requests.inspect());await assert.rejects(f.requests.prepare(f.owner,f.proof));assert.deepEqual(await readFile(f.path),before);assert.equal(await readFile(outside,"utf8"),"precious bytes")}finally{await f.cleanup()}}
})
test("MR64-16: external replacement by an otherwise valid JSON record is detected by inode/revision guard",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof),replacement=f.path+".replacement";await writeFile(replacement,await readFile(f.path));await rename(replacement,f.path);f.setClosed(true);const before=await readFile(f.path);await assert.rejects(f.requests.arm(f.owner,prepared.requestId),code("RECORD_CHANGED"));assert.deepEqual(await readFile(f.path),before)}finally{await f.cleanup()}
})
test("MR64-17: bootstrap directory replacement never writes through the same pathname into its replacement",async()=>{
 const f=await fixture();try{await f.requests.inspect();await rename(f.bootstrap,f.bootstrap+"-old");await mkdir(f.bootstrap);await assert.rejects(f.requests.prepare(f.owner,f.proof),code("BOOTSTRAP_CHANGED"));assert.deepEqual(await readdir(f.bootstrap),[])}finally{await f.cleanup()}
})
test("MR64-18: rename-before-commit failure retains prepared and allows explicit retry",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof),before=await readFile(f.path);f.setClosed(true);f.options.writeOptions!.beforeRename=async()=>{throw Error("sk-sensitive-io")};await assert.rejects(f.requests.arm(f.owner,prepared.requestId),error=>code("WRITE_FAILED")(error)&&!String(error).includes("sensitive"));assert.deepEqual(await readFile(f.path),before);delete f.options.writeOptions!.beforeRename;assert.equal((await f.requests.arm(f.owner,prepared.requestId)).phase,"armed")}finally{await f.cleanup()}
})
test("MR64-19: prepare directory-sync failure retains the actually committed prepared request and can reconcile durably",async()=>{
 const f=await fixture();try{f.options.writeOptions!.beforeDirectorySync=async()=>{throw Error("sk-sync-secret")};await assert.rejects(f.requests.prepare(f.owner,f.proof),code("DURABILITY_UNCONFIRMED"));assert.equal(JSON.parse(await readFile(f.path,"utf8")).active.phase,"prepared");await assert.rejects(f.requests.inspect(),code("DURABILITY_UNCONFIRMED"));delete f.options.writeOptions!.beforeDirectorySync;const state=await f.requests.inspect();assert.equal(state.active?.phase,"prepared");assert.equal(state.revision,1);assert.equal(await f.reopen().loadArmed(),null)}finally{await f.cleanup()}
})
test("MR64-20: arm directory-sync ambiguity cannot be guessed to be an uncommitted prepared request",async()=>{
 const f=await fixture();try{const prepared=await f.requests.prepare(f.owner,f.proof);f.setClosed(true);f.options.writeOptions!.beforeDirectorySync=async()=>{throw Error("sync")};await assert.rejects(f.requests.arm(f.owner,prepared.requestId),code("DURABILITY_UNCONFIRMED"));assert.equal(JSON.parse(await readFile(f.path,"utf8")).active.phase,"armed");delete f.options.writeOptions!.beforeDirectorySync;assert.equal((await f.requests.loadArmed())?.requestId,prepared.requestId)}finally{await f.cleanup()}
})
test("MR64-21: finishing sync ambiguity preserves its request-linked result for reopening and acknowledgement",async()=>{
 const f=await fixture();try{const execution=await f.executing(),result=await f.moved();f.options.writeOptions!.beforeDirectorySync=async()=>{throw Error("sync")};await assert.rejects(f.requests.finish(execution.requestId,execution.executionNonce,result),code("DURABILITY_UNCONFIRMED"));const disk=JSON.parse(await readFile(f.path,"utf8"));assert.equal(disk.active,null);assert.equal(disk.results[0].requestId,execution.requestId);delete f.options.writeOptions!.beforeDirectorySync;assert.equal((await f.requests.readResult())?.requestId,execution.requestId);assert.deepEqual(await f.requests.finish(execution.requestId,execution.executionNonce,result),await f.requests.readResult())}finally{await f.cleanup()}
})
test("MR64-22: parallel prepare cannot replace the first active request and returned objects do not mutate durable authority",async()=>{
 const f=await fixture();try{const first=f.requests.prepare(f.owner,f.proof),second=f.requests.prepare(f.owner,f.proof);const request=await first;await assert.rejects(second,code("REQUEST_PENDING"));request.source.revision=99;request.target.inode="0";assert.equal((await f.requests.inspect()).active?.source.revision,1);assert.notEqual((await f.requests.inspect()).active?.target.inode,"0")}finally{await f.cleanup()}
})
test("MR64-23: a full unacknowledged result queue prevents new requests instead of dropping old outcomes",async()=>{
 const f=await fixture();try{for(let i=0;i<16;i++){const prepared=await f.requests.prepare(f.owner,f.proof);await f.requests.cancel(prepared.requestId,f.owner)}const state=await f.requests.inspect();assert.equal(state.results.length,16);await assert.rejects(f.requests.prepare(f.owner,f.proof),code("RESULTS_PENDING"));assert.equal((await f.requests.inspect()).results.length,16);const result=(await f.requests.readResult())!;await f.requests.acknowledgeResult(result.requestId,result.receiptId);assert.equal((await f.requests.prepare(f.owner,f.proof)).phase,"prepared")}finally{await f.cleanup()}
})
test("MR64-24: missing source initialization intent cannot authorize a new migration request",async()=>{
 const f=await fixture();try{f.options.resolveSource=async()=>({state:"needs-initialize",path:f.source});await assert.rejects(f.requests.prepare(f.owner,f.proof),code("SOURCE_UNAVAILABLE"));await assert.rejects(readFile(f.path),{code:"ENOENT"})}finally{await f.cleanup()}
})
test("MR64-25: stable lock failure and untrusted target shape never create a durable request",async()=>{
 const f=await fixture();try{f.setLocked(false);await assert.rejects(f.requests.prepare(f.owner,f.proof),code("LOCK_REQUIRED"));f.setLocked(true);await assert.rejects(f.requests.prepare(f.owner,{...f.proof,apiKey:"sk-secret"} as any),code("INVALID_REQUEST"));await assert.rejects(f.requests.prepare("expired-not-uuid",f.proof),code("INVALID_REQUEST"));await assert.rejects(readFile(f.path),{code:"ENOENT"})}finally{await f.cleanup()}
})
test("MR64-26: root/target/bootstrap overlaps and source directory replacement are rejected before prepare",async()=>{
 const f=await fixture();try{await assert.rejects(f.requests.prepare(f.owner,f.pointer.root),code("TARGET_OVERLAP"));await assert.rejects(f.requests.prepare(f.owner,await directoryIdentity(f.bootstrap)),code("TARGET_OVERLAP"));await rename(f.source,f.source+"-old");await mkdir(f.source);await assert.rejects(f.requests.prepare(f.owner,f.proof),code("SOURCE_UNAVAILABLE"));assert.equal(await readFile(join(f.source+"-old","drafts.json"),"utf8"),"unapproved original draft")}finally{await f.cleanup()}
})
test("MR64-27: deleting an observed request cannot turn it into a fresh default and lose prior intent",async()=>{
 const f=await fixture();try{await f.requests.prepare(f.owner,f.proof);await rm(f.path);await assert.rejects(f.requests.inspect(),code("RECORD_CHANGED"));await assert.rejects(f.requests.prepare(f.owner,f.proof),code("RECORD_CHANGED"));await assert.rejects(readFile(f.path),{code:"ENOENT"})}finally{await f.cleanup()}
})
test("MR64-28: start rechecks target and closed state, preserving armed for explicit failure or recovery",async()=>{
 const f=await fixture();try{const armed=await f.armed();f.setClosed(false);await assert.rejects(f.requests.startArmed(armed.requestId),code("SOURCE_NOT_CLOSED"));f.setClosed(true);await rename(f.target,f.target+"-old");await mkdir(f.target);await assert.rejects(f.requests.startArmed(armed.requestId),code("TARGET_CHANGED"));assert.equal((await f.requests.inspect()).active?.phase,"armed");assert.equal((await f.requests.fail(armed.requestId,"TARGET_CHANGED")).outcome.status,"failed")}finally{await f.cleanup()}
})
test("MR64-29: rollback result must match both authoritative original pointer and execution ticket",async()=>{
 const f=await fixture();try{const execution=await f.executing(),result:MigrationResult={status:"rollback-pending",migrationId:randomUUID(),root:f.pointer,pending:["private-user-content"]};const completed=await f.requests.finish(execution.requestId,execution.executionNonce,result);assert.equal(completed.outcome.status,"rollback-pending");assert.equal((completed.outcome as {pendingCount:number}).pendingCount,1);assert.equal((await readFile(f.path,"utf8")).includes("private-user-content"),false)}finally{await f.cleanup()}
})
test("MR64-30: flush retains a real armed write waiting for directory sync",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let pending:Promise<unknown>|undefined,settled=false
 try{const prepared=await f.requests.prepare(f.owner,f.proof);f.setClosed(true);f.options.writeOptions!.beforeDirectorySync=async()=>{entered.resolve();await allow.promise};pending=f.requests.arm(f.owner,prepared.requestId);void pending.catch(()=>{});await entered.promise;const flush=f.requests.flush();void flush.then(()=>{settled=true});await setImmediate();assert.equal(settled,false);allow.resolve();await pending;pending=undefined;await flush;assert.equal(settled,true)}finally{allow.resolve();await pending?.catch(()=>{});await f.cleanup()}
})
test("MR64-31: an uncertain commit cannot reconcile through an externally replaced inode with identical JSON",async()=>{
 const f=await fixture();try{f.options.writeOptions!.beforeDirectorySync=async()=>{throw Error("sync")};await assert.rejects(f.requests.prepare(f.owner,f.proof),code("DURABILITY_UNCONFIRMED"));const replacement=f.path+".replacement";await writeFile(replacement,await readFile(f.path));await rename(replacement,f.path);delete f.options.writeOptions!.beforeDirectorySync;await assert.rejects(f.requests.inspect(),code("RECORD_CHANGED"));assert.equal(JSON.parse(await readFile(f.path,"utf8")).active.phase,"prepared")}finally{await f.cleanup()}
})
test("MR64-32: the last asynchronous closed assertion cannot let source revision drift escape the final arm guard",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let calls=0,pending:Promise<unknown>|undefined
 try{const prepared=await f.requests.prepare(f.owner,f.proof);f.setClosed(true);f.options.assertClosed=async()=>{if(++calls===2){entered.resolve();await allow.promise}};pending=f.requests.arm(f.owner,prepared.requestId);void pending.catch(()=>{});await entered.promise;await writeFile(join(f.bootstrap,"data-root.json"),JSON.stringify({...f.pointer,revision:2}));allow.resolve();await assert.rejects(pending,code("SOURCE_CHANGED"));pending=undefined;assert.equal((await f.requests.inspect()).active?.phase,"prepared")}finally{allow.resolve();await pending?.catch(()=>{});await f.cleanup()}
})
test("MR64-33: current bounded application-history recovery entries are counted without persisting their text; overflow is rejected",async()=>{
 const f=await fixture();try{const execution=await f.executing(),migrationId=randomUUID(),pending=Array<string>(ROOT_MIGRATION_LIMITS.pending).fill("private-inventory-name");await assert.rejects(f.requests.finish(execution.requestId,execution.executionNonce,{status:"rollback-pending",migrationId,root:f.pointer,pending:[...pending,"overflow"]}),code("INVALID_REQUEST"));const completed=await f.requests.finish(execution.requestId,execution.executionNonce,{status:"rollback-pending",migrationId,root:f.pointer,pending});assert.equal((completed.outcome as {pendingCount:number}).pendingCount,ROOT_MIGRATION_LIMITS.pending);assert.equal((await readFile(f.path,"utf8")).includes("private-inventory-name"),false)}finally{await f.cleanup()}
})
test("MR64-34: cancel queued after an actual arm rename consumes the committed request even after owner expiration",async()=>{
 const f=await fixture(),entered=gate(),allow=gate();let pending:Promise<unknown>|undefined,cancel:Promise<unknown>|undefined
 try{const prepared=await f.requests.prepare(f.owner,f.proof);f.setClosed(true);f.options.writeOptions!.beforeDirectorySync=async()=>{entered.resolve();await allow.promise};pending=f.requests.arm(f.owner,prepared.requestId);void pending.catch(()=>{});await entered.promise;f.setValid(false);cancel=f.requests.cancel(prepared.requestId,f.owner);void cancel.catch(()=>{});allow.resolve();assert.equal((await pending as {phase:string}).phase,"armed");pending=undefined;assert.equal((await cancel as {outcome:{status:string}}).outcome.status,"cancelled");cancel=undefined;assert.equal(await f.reopen().loadArmed(),null);assert.equal((await f.requests.inspect()).results.length,1)}finally{allow.resolve();await pending?.catch(()=>{});await cancel?.catch(()=>{});await f.cleanup()}
})
test("MR64-35: a real DataRoot migration result can be completed by its caller without module-owned copying or loss of the draft",async()=>{
 const f=await fixture();try{await mkdir(join(f.source,"inbox","database"),{recursive:true});await writeFile(join(f.source,"catalog.json"),JSON.stringify({schemaVersion:1,revision:1,value:[]}));const execution=await f.executing();let released=false;const result=await f.manager.migrate(execution.target,{async quiesce(){return{source:f.pointer.root,ownedFiles:["xuanxiang-app.json","catalog.json","drafts.json"],ownedDirectories:["inbox/database"],assertClosed(){assert.equal(f.options.assertClosed(f.pointer),undefined)},release(){released=true}}}});assert.equal(released,true);assert.equal(result.status,"complete");const completion=await f.requests.finish(execution.requestId,execution.executionNonce,result);assert.equal(completion.outcome.status,"complete");assert.equal(await readFile(join(f.target,"drafts.json"),"utf8"),"unapproved original draft");assert.equal((await f.reopen().readResult())?.requestId,execution.requestId);assert.equal((await f.requests.inspect()).active,null)}finally{await f.cleanup()}
})
test("MR64-36: the synchronous final CAS preserves a newer ledger changed during the last asynchronous business guard",async()=>{
 const f=await fixture();let calls=0
 try{const prepared=await f.requests.prepare(f.owner,f.proof);f.setClosed(true);let replaced:Buffer|undefined;f.options.assertClosed=async()=>{if(++calls===2){const changed=JSON.parse(await readFile(f.path,"utf8"));changed.revision++;replaced=Buffer.from(JSON.stringify(changed));await writeFile(f.path,replaced)}};await assert.rejects(f.requests.arm(f.owner,prepared.requestId),code("RECORD_CHANGED"));assert.ok(replaced);assert.deepEqual(await readFile(f.path),replaced);assert.equal(JSON.parse((await readFile(f.path)).toString()).active.phase,"prepared");assert.equal((await readdir(f.bootstrap)).some(path=>path.endsWith(".tmp")),false)}finally{await f.cleanup()}
})
