import {DataRootManager,RootMigrationCrash,type RootOptions,type RootPointer,type RootIdentity,type MigrationResult,type MigrationHost} from "../core/data-root"
import type {RootMigrationRequests,RootMigrationCompletion,RootMigrationRequest} from "./root-migration-request"
import {validMaintenancePendingItem,type RootMaintenanceState} from "../shared/root-maintenance"
import {collectClosedRootFiles} from "./owned-root-files"
import {inspectRetainedRootRelocation} from "../core/root-relocation-retention"
import {createHash} from "node:crypto"

export interface RecordedRootMigration {migrationId:string;phase:string;source:RootPointer;target:RootIdentity;result:MigrationResult|null}
export interface MaintenanceDataRoot extends Pick<DataRootManager,"resolve"|"recover"|"migrate"> {recordedMigration(migrationId:string):Promise<RecordedRootMigration|null>}
export interface RootMaintenanceHost {
 /** Main proves previous Electron exited, stable instance lock held and no source DB/session opened. */
 assertMaintenanceClosed():void|Promise<void>
 release?(outcome:"old-root"|"new-root"):void|Promise<void>
}
export interface RootMaintenanceRunnerOptions {
 bootstrap:string
 defaultRoot:string
 requests:RootMigrationRequests
 theme:"paper"|"ink"
 host:RootMaintenanceHost
 createManager?(options:RootOptions&{migrationId:string}):MaintenanceDataRoot
 /** Must cold-relaunch; never open an existing source session in this process. */
 onContinue():Promise<void>
 onQuit():Promise<void>
}
export class RootMaintenanceRunnerError extends Error {constructor(readonly code:string){super(code);this.name="RootMaintenanceRunnerError"}}
type Execution=Extract<RootMigrationRequest,{phase:"executing"}>
function canonical(value:unknown):unknown{return Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)])):value}
function same(a:unknown,b:unknown){return JSON.stringify(canonical(a))===JSON.stringify(canonical(b))}
function failure(code:string):never{throw new RootMaintenanceRunnerError(code)}
export class RootMaintenanceRunner {
 private current:RootMaintenanceState
 private listeners=new Set<(state:RootMaintenanceState)=>void>()
 private running:Promise<RootMaintenanceState>|null=null
 private cancelling:Promise<void>|null=null
 private handoff:Promise<void>|null=null
 private exited=false
 private started=false
 private abort=new AbortController()
 private completion:RootMigrationCompletion|null=null
 private acknowledged=false
 private copied=new Set<string>()
 private observedJournals=new Set<string>()
 constructor(readonly options:RootMaintenanceRunnerOptions){this.current={version:1,revision:0,phase:"preparing",theme:options.theme,sourcePath:null,targetPath:null,copiedFiles:0,totalFiles:null,canCancel:false,canContinue:false,pendingCount:0,pendingItems:[]}}
 state():RootMaintenanceState{return structuredClone(this.current)}
 subscribe(listener:(state:RootMaintenanceState)=>void):()=>void{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
 private publish(patch:Partial<Omit<RootMaintenanceState,"version"|"revision"|"theme">>){
  this.current={...this.current,...patch,revision:this.current.revision+1}
  for(const listener of [...this.listeners]){try{listener(this.state())}catch{/* UI observers cannot interrupt IO or receipt bookkeeping. */}}
 }
 private async guard(){await this.options.host.assertMaintenanceClosed()}
 private manager(id:string):MaintenanceDataRoot{
  const options:RootOptions&{migrationId:string}={migrationId:id,hook:async(phase,path)=>{if(phase==="journal")this.observedJournals.add(id);await this.guard();this.progress(phase,path)}}
  const manager=this.options.createManager?.(options)??new DataRootManager(this.options.bootstrap,this.options.defaultRoot,options)
  if(typeof manager.recordedMigration!=="function")failure("MAINTENANCE_API_UNAVAILABLE")
  return manager
 }
 private progress(phase:string,path?:string){
  if(phase==="validating"||phase==="quiescing")this.publish({phase:"validating"})
  else if(phase==="copying")this.publish({phase:"copying"})
  else if(phase==="file-copied"&&path&&this.current.totalFiles!==null&&!this.copied.has(path)){
   if(this.copied.size>=this.current.totalFiles)failure("INVALID_PROGRESS")
   this.copied.add(path);this.publish({phase:"copying",copiedFiles:this.copied.size})
  }else if(phase==="verifying"||phase==="verified")this.publish({phase:"verifying"})
  else if(phase==="pointer")this.publish({phase:"committing",canCancel:false})
  else if(phase==="pointer-written"||phase==="committed"||phase==="complete")this.publish({phase:"cleanup",canCancel:false})
 }
 private host(execution:Execution,recovering:boolean):MigrationHost{
  return{quiesce:async source=>{
   await this.guard();if(!same(source,execution.source))failure("REQUEST_JOURNAL_MISMATCH")
   const inventory=recovering?null:await collectClosedRootFiles(source.root,async()=>{await this.guard();if(this.abort.signal.aborted)failure("MIGRATION_CANCELLED")})
   await this.guard()
   if(inventory){this.copied.clear();this.publish({totalFiles:inventory.files.length,copiedFiles:0})}
   return{source:execution.source.root,ownedFiles:inventory?.files??[],ownedDirectories:inventory?.directories??[],preserved:inventory?.preserved??[],assertClosed:()=>this.guard(),release:async outcome=>{await this.guard();await this.options.host.release?.(outcome);await this.guard()}}
  }}
 }
 private correlated(record:RecordedRootMigration|null,execution:Execution):RecordedRootMigration{
  if(!record||record.migrationId!==execution.executionNonce||!same(record.source,execution.source)||!same(record.target,execution.target))failure("REQUEST_JOURNAL_MISMATCH")
  return record
 }
 private async completionSeal(completion:RootMigrationCompletion,pointer:RootPointer,acknowledged=false):Promise<{assertCurrent():void;currentRootPath:string|null}>{
  const cold=()=>{const value:unknown=this.options.host.assertMaintenanceClosed();if(value!==undefined){void Promise.resolve(value).catch(()=>{});failure("SOURCE_NOT_CLOSED")}}
  const proof=await inspectRetainedRootRelocation(this.options.bootstrap,{assertStableLock:cold,assertCold:cold})
  if(!proof){
   // Removed audit files cannot make a relocated same-physical pointer ordinary.
   // Normal later migrations to a different physical root keep FIFO semantics.
   const expected="root"in completion.outcome?completion.outcome.root:completion.source
   if(expected.root.device===pointer.root.device&&expected.root.inode===pointer.root.inode&&!same(expected,pointer))failure("RELOCATION_PROOF_REQUIRED")
   if(pointer.migrationId){const record=await new DataRootManager(this.options.bootstrap,this.options.defaultRoot).recordedMigration(pointer.migrationId),authority=record?.result?.root;if(authority&&authority.root.device===pointer.root.device&&authority.root.inode===pointer.root.inode&&!same(authority,pointer))failure("RELOCATION_PROOF_REQUIRED")}
   return{assertCurrent(){},currentRootPath:null}
  }
  const hash=createHash("sha256").update(JSON.stringify(canonical(completion))).digest("hex")
  const matches=proof.completionWitnesses.filter(item=>item.requestId===completion.requestId||item.receiptId===completion.receiptId)
  if(!same(proof.pointer,pointer)||(!acknowledged&&(matches.length!==1||matches[0].requestId!==completion.requestId||matches[0].receiptId!==completion.receiptId||matches[0].sha256!==hash))||acknowledged&&matches.length)failure("RELOCATION_RESULT_CHANGED")
  return{assertCurrent:proof.assertCurrent,currentRootPath:proof.pointer.root.path}
 }
 private async showCompletion(completion:RootMigrationCompletion,cancelled=false){
  await this.guard();await this.options.requests.flush()
  const resolution=await new DataRootManager(this.options.bootstrap,this.options.defaultRoot).resolve()
  if(resolution.state!=="existing")failure("AUTHORITY_UNAVAILABLE")
  const seal=await this.completionSeal(completion,resolution.pointer)
  await this.guard();this.completion=structuredClone(completion);this.acknowledged=false
  const outcome=completion.outcome,pending="pendingCount"in outcome?outcome.pendingCount:0
  const phase=outcome.status==="cancelled"||outcome.status==="failed"&&outcome.code==="MIGRATION_CANCELLED"?"cancelled":outcome.status==="complete"?"complete":outcome.status==="cleanup-pending"||outcome.status==="rollback-pending"?outcome.status:outcome.status==="rolled-back"&&cancelled?"cancelled":"failed"
  let pendingItems:string[]|null=pending?null:[]
  if(pending&&completion.executionNonce){
   try{
    const record=await this.manager(completion.executionNonce).recordedMigration(completion.executionNonce),result=record?.result
    if(record&&result&&record.migrationId===completion.executionNonce&&same(record.source,completion.source)&&same(record.target,completion.target)&&"migrationId"in outcome&&result.migrationId===outcome.migrationId&&result.status===outcome.status&&same(result.root,outcome.root)&&result.pending.length===pending&&result.pending.every(validMaintenancePendingItem))pendingItems=[...result.pending]
   }catch{/* Detail availability cannot change the already validated authority. */}
  }
  await this.guard()
  seal.assertCurrent()
  this.publish({phase,sourcePath:completion.source.root.path,targetPath:completion.target.path,pendingCount:pending,pendingItems,currentRootPath:seal.currentRootPath,canCancel:false,canContinue:true})
 }
 private async finish(execution:Execution,manager:MaintenanceDataRoot,result:MigrationResult,cancelled=false){
  await this.guard();const record=this.correlated(await manager.recordedMigration(execution.executionNonce),execution)
  if(!record.result||!same(record.result,result)||result.migrationId!==execution.executionNonce)failure("REQUEST_JOURNAL_MISMATCH")
  const completion=await this.options.requests.finish(execution.requestId,execution.executionNonce,result)
  await this.showCompletion(completion,cancelled)
 }
 private async recover(execution:Execution,manager:MaintenanceDataRoot,cancelled=false){
  await this.guard();this.correlated(await manager.recordedMigration(execution.executionNonce),execution)
  this.publish({phase:"validating",canCancel:false})
  await manager.recover(this.host(execution,true))
  await this.guard();const record=this.correlated(await manager.recordedMigration(execution.executionNonce),execution)
  if(!record.result)failure("RECOVERY_INCOMPLETE")
  await this.finish(execution,manager,record.result,cancelled)
 }
 private async execute(){
  await this.guard();const snapshot=await this.options.requests.inspect();await this.guard()
  if(snapshot.results.length){await this.showCompletion(snapshot.results[0]);return this.state()}
  const request=snapshot.active
  if(!request){this.publish({phase:"recovery-required",canCancel:false,canContinue:false});return this.state()}
  this.publish({sourcePath:request.source.root.path,targetPath:request.target.path,copiedFiles:0,totalFiles:null,pendingCount:0,pendingItems:[]})
  if(request.phase==="prepared"){this.publish({phase:"preparing",canCancel:true,canContinue:false});return this.state()}
  if(request.phase==="executing"){
   await this.recover(request,this.manager(request.executionNonce));return this.state()
  }
  this.publish({phase:"validating",canCancel:true,canContinue:false})
  await this.guard()
  const execution=await this.options.requests.startArmed(request.requestId),manager=this.manager(execution.executionNonce)
  try{
   await this.guard()
   if(this.abort.signal.aborted)failure("MIGRATION_CANCELLED")
   const result=await manager.migrate(execution.target,this.host(execution,false),this.abort.signal)
   await this.finish(execution,manager,result)
  }catch(error){
   // A simulated process-loss boundary must remain durable executing for the next start.
   if(error instanceof RootMigrationCrash)throw error
   await this.guard()
   const record=await manager.recordedMigration(execution.executionNonce)
   if(record)await this.recover(execution,manager,this.abort.signal.aborted)
   else{
    if(this.observedJournals.has(execution.executionNonce))failure("RECORDED_JOURNAL_MISSING")
    // Only this fresh in-process attempt knows migrate returned before any matching journal.
    const completion=await this.options.requests.fail(execution.requestId,this.abort.signal.aborted?"MIGRATION_CANCELLED":"MIGRATION_FAILED",execution.executionNonce)
    await this.showCompletion(completion)
   }
  }
  return this.state()
 }
 start():Promise<RootMaintenanceState>{
  if(this.running)return this.running
  if(this.exited) return Promise.reject(new RootMaintenanceRunnerError("PROCESS_EXITING"))
  if(this.started&&this.current.phase!=="recovery-required")return Promise.resolve(this.state())
  this.started=true;this.abort=new AbortController()
  // Install the shared flight before observers can synchronously reenter start().
  const work=Promise.resolve().then(()=>this.execute()).catch(()=>{this.publish({phase:"recovery-required",canCancel:false,canContinue:false});return this.state()}).finally(()=>{if(this.running===work)this.running=null})
  this.running=work;this.publish({canContinue:false,canCancel:false});return work
 }
 cancel():Promise<void>{
  if(this.cancelling)return this.cancelling
  if(!this.current.canCancel||this.exited)return Promise.reject(new RootMaintenanceRunnerError("CANNOT_CANCEL"))
  const work=Promise.resolve().then(async()=>{
   if(this.running)await this.running
   await this.guard();const snapshot=await this.options.requests.inspect(),request=snapshot.active
   // A completed running migration already persisted its cancellation/terminal
   // receipt. A prepared flight only published its state and still needs cancel.
   if(!request&&this.completion)return
   if(!request||request.phase!=="prepared")failure("CANNOT_CANCEL")
   const completion=await this.options.requests.cancel(request.requestId,request.ownerNonce);await this.showCompletion(completion)
  }).catch(()=>{this.publish({phase:"recovery-required",canContinue:false,canCancel:false});throw new RootMaintenanceRunnerError("CANCELLATION_UNCONFIRMED")}).finally(()=>{if(this.cancelling===work)this.cancelling=null})
  this.cancelling=work;this.publish({canCancel:false});this.abort.abort();return work
 }
 private exit(action:()=>Promise<void>):Promise<void>{
  if(this.handoff)return this.handoff
  if(this.exited)return Promise.resolve()
  const work=Promise.resolve().then(action).then(()=>{this.exited=true}).finally(()=>{if(this.handoff===work)this.handoff=null})
  this.handoff=work;return work
 }
 continue():Promise<void>{
  if(!this.current.canContinue||!this.completion||this.running)return Promise.reject(new RootMaintenanceRunnerError("CANNOT_CONTINUE"))
  return this.exit(async()=>{
   try{
    await this.guard();const resolved=await new DataRootManager(this.options.bootstrap,this.options.defaultRoot).resolve()
    if(resolved.state!=="existing")failure("AUTHORITY_UNAVAILABLE")
    const seal=await this.completionSeal(this.completion!,resolved.pointer,this.acknowledged)
    await this.guard();seal.assertCurrent();this.publish({canContinue:false})
    if(!this.acknowledged){await this.options.requests.acknowledgeResult(this.completion!.requestId,this.completion!.receiptId);await this.options.requests.flush();this.acknowledged=true}
    // ACK changes the ledger legally. Never reuse its pre-ACK proof closure.
    const after=await this.completionSeal(this.completion!,resolved.pointer,true)
    await this.guard();after.assertCurrent();await this.options.onContinue()
   }catch{
    let safe=false
    try{await this.guard();const current=await new DataRootManager(this.options.bootstrap,this.options.defaultRoot).resolve();if(current.state==="existing"){const seal=await this.completionSeal(this.completion!,current.pointer,this.acknowledged);await this.guard();seal.assertCurrent();safe=true}}catch{safe=false}
    this.publish(safe?{canContinue:true}:{phase:"recovery-required",canContinue:false,canCancel:false})
    failure("CONTINUE_UNCONFIRMED")
   }
  })
 }
 quit():Promise<void>{
  return this.exit(async()=>{
   try{
    // Failed/uncertain cancellation keeps the ledger for the next preflight;
    // exiting after its real IO settles is safe and must remain available.
    if(this.current.canCancel)await this.cancel().catch(()=>undefined)
    if(this.cancelling)await this.cancelling.catch(()=>undefined)
    if(this.running)await this.running
    await this.options.requests.flush();await this.options.onQuit()
   }catch{failure("QUIT_UNCONFIRMED")}
  })
 }
}
