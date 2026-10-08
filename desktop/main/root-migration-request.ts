import type {RootResolution,RootPointer,MigrationResult} from "../core/data-root"
import {ROOT_MIGRATION_LIMITS} from "../core/root-inventory-limits"
import {CommitDurabilityError,type StoreOptions} from "../core/versioned-store"
import type {DirectoryProof} from "./directory-authority"
import {randomUUID,createHash} from "node:crypto"
import {constants,lstatSync,realpathSync,openSync,fstatSync,readSync,closeSync,type BigIntStats} from "node:fs"
import {lstat,open,rename,unlink} from "node:fs/promises"
import {isAbsolute,join} from "node:path"
import {z} from "zod"
import {directoryIdentity,assertDirectory,overlapping,syncDirectory,rootIdentitySchema,type FileIdentity} from "../core/root-ownership"

export const MAX_ROOT_MIGRATION_REQUEST_BYTES=256*1024
export type MigrationFailureCode="MIGRATION_FAILED"|"SOURCE_CHANGED"|"TARGET_CHANGED"|"RECOVERY_REQUIRED"|"MIGRATION_CANCELLED"
interface RequestBase {requestId:string;ownerNonce:string;source:RootPointer;target:DirectoryProof;createdAt:string}
export type RootMigrationRequest=(RequestBase&{phase:"prepared"})|(RequestBase&{phase:"armed";armedAt:string})|(RequestBase&{phase:"executing";armedAt:string;executionNonce:string;startedAt:string})
export type RootMigrationOutcome={status:MigrationResult["status"];migrationId:string;root:RootPointer;pendingCount:number}|{status:"failed";code:MigrationFailureCode;root:RootPointer}|{status:"cancelled"}
export interface RootMigrationCompletion extends RequestBase {receiptId:string;executionNonce:string|null;finishedAt:string;outcome:RootMigrationOutcome}
export interface RootMigrationRequestSnapshot {schemaVersion:1;revision:number;active:RootMigrationRequest|null;results:RootMigrationCompletion[]}
export interface RootMigrationRequestOptions {
 resolveSource():Promise<RootResolution>
 assertStableLock():void
 assertOwner(ownerNonce:string):void
 assertClosed(source:RootPointer):void|Promise<void>
 writeOptions?:StoreOptions
}
export class RootMigrationRequestError extends Error {constructor(readonly code:string){super(code);this.name="RootMigrationRequestError"}}

const identitySchema=rootIdentitySchema.refine(value=>isAbsolute(value.path)&&!/[\x00-\x1f]/.test(value.path))
const pointerSchema=z.object({schemaVersion:z.literal(1),revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),rootId:z.uuid(),migrationId:z.uuid().nullable(),root:identitySchema}).strict()
const baseShape={requestId:z.uuid(),ownerNonce:z.uuid(),source:pointerSchema,target:identitySchema,createdAt:z.iso.datetime()}
const requestSchema=z.discriminatedUnion("phase",[
 z.object({...baseShape,phase:z.literal("prepared")}).strict(),
 z.object({...baseShape,phase:z.literal("armed"),armedAt:z.iso.datetime()}).strict(),
 z.object({...baseShape,phase:z.literal("executing"),armedAt:z.iso.datetime(),executionNonce:z.uuid(),startedAt:z.iso.datetime()}).strict(),
])
const failureCodeSchema=z.enum(["MIGRATION_FAILED","SOURCE_CHANGED","TARGET_CHANGED","RECOVERY_REQUIRED","MIGRATION_CANCELLED"])
const migrationOutcomeSchema=z.object({status:z.enum(["complete","cleanup-pending","rolled-back","rollback-pending"]),migrationId:z.uuid(),root:pointerSchema,pendingCount:z.number().int().nonnegative().max(ROOT_MIGRATION_LIMITS.pending)}).strict()
const outcomeSchema=z.discriminatedUnion("status",[
 migrationOutcomeSchema,
 z.object({status:z.literal("failed"),code:failureCodeSchema,root:pointerSchema}).strict(),
 z.object({status:z.literal("cancelled")}).strict(),
])
const completionSchema=z.object({...baseShape,receiptId:z.uuid(),executionNonce:z.uuid().nullable(),finishedAt:z.iso.datetime(),outcome:outcomeSchema}).strict()
const snapshotSchema=z.object({schemaVersion:z.literal(1),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),active:requestSchema.nullable(),results:z.array(completionSchema).max(16)}).strict()
type Observed={state:RootMigrationRequestSnapshot;identity:FileIdentity;signature:string}
const empty=():RootMigrationRequestSnapshot=>({schemaVersion:1,revision:0,active:null,results:[]})
const fingerprint=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex")
const same=(a:unknown,b:unknown)=>fingerprint(a)===fingerprint(b)
const missing=(error:unknown)=>(error as NodeJS.ErrnoException)?.code==="ENOENT"
function failure(code:string):never{throw new RootMigrationRequestError(code)}
function parsed<T>(schema:z.ZodType<T>,value:unknown,code="INVALID_REQUEST"):T{try{return schema.parse(value)}catch{failure(code)}}
function validSnapshot(value:unknown):RootMigrationRequestSnapshot{
 const state=parsed(snapshotSchema,value,"RECORD_INVALID")
 const ids=state.results.map(result=>result.requestId),receipts=state.results.map(result=>result.receiptId)
 if(new Set(ids).size!==ids.length||new Set(receipts).size!==receipts.length||state.active&&ids.includes(state.active.requestId)||state.revision===0&&(state.active!==null||state.results.length!==0))failure("RECORD_INVALID")
 for(const result of state.results){
  const outcome=result.outcome
  if(outcome.status==="cancelled"){if(result.executionNonce!==null)failure("RECORD_INVALID")}
  else if(outcome.status!=="failed"){
   const forward=outcome.status==="complete"||outcome.status==="cleanup-pending"
   const expected=forward?{...result.source,revision:result.source.revision+1,migrationId:outcome.migrationId,root:result.target}:result.source
   if(result.executionNonce===null||!same(outcome.root,expected)||(outcome.status==="complete"||outcome.status==="rolled-back")&&outcome.pendingCount!==0)failure("RECORD_INVALID")
  }
 }
 return state
}
/** Pure read-only decoder reused by main's synchronous maintenance preflight. */
export function validateRootMigrationRequestSnapshot(value:unknown):RootMigrationRequestSnapshot{return validSnapshot(value)}

/** Main-process use only, under the fixed-bootstrap application lock. */
export class RootMigrationRequests {
 private queue:Promise<unknown>=Promise.resolve()
 private boot:Promise<DirectoryProof>
 private expected:Observed|null|undefined
 private uncertain:RootMigrationRequestSnapshot|null=null
 private uncertainObservation:Observed|null=null
 private committedIdentity:FileIdentity|null=null
 constructor(readonly bootstrap:string,readonly options:RootMigrationRequestOptions){
  this.boot=directoryIdentity(bootstrap);void this.boot.catch(()=>{})
 }
 private lock(){try{this.options.assertStableLock()}catch{failure("LOCK_REQUIRED")}}
 private owner(nonce:string){try{this.options.assertOwner(nonce)}catch{failure("OWNER_EXPIRED")}}
 private enqueue<T>(run:()=>Promise<T>):Promise<T>{
  const result=this.queue.then(async()=>{this.lock();return run()});this.queue=result.catch(()=>{});return result
 }
 private async path(){
  this.lock();try{await assertDirectory(await this.boot)}catch{failure("BOOTSTRAP_CHANGED")};this.lock()
  return join(this.bootstrap,"root-migration-request.json")
 }
 private async readRaw():Promise<Observed|null>{
  const path=await this.path()
  let before:BigIntStats
  try{before=await lstat(path,{bigint:true})}catch(error){if(missing(error))return null;failure("RECORD_UNSAFE")}
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(MAX_ROOT_MIGRATION_REQUEST_BYTES))failure("RECORD_UNSAFE")
  let handle:Awaited<ReturnType<typeof open>>
  try{handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0))}catch{failure("RECORD_UNSAFE")}
  try{
   const opened=await handle.stat({bigint:true})
   if(!opened.isFile()||opened.nlink!==1n||opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||opened.mtimeNs!==before.mtimeNs||opened.ctimeNs!==before.ctimeNs)failure("RECORD_CHANGED")
   const chunks:Buffer[]=[];let length=0
   for(;;){this.lock();const block=Buffer.allocUnsafe(Math.min(64*1024,MAX_ROOT_MIGRATION_REQUEST_BYTES+1-length)),{bytesRead}=await handle.read(block);if(!bytesRead)break;length+=bytesRead;if(length>MAX_ROOT_MIGRATION_REQUEST_BYTES)failure("RECORD_UNSAFE");chunks.push(block.subarray(0,bytesRead))}
   const after=await handle.stat({bigint:true}),leaf=await lstat(path,{bigint:true})
   if(!leaf.isFile()||leaf.nlink!==1n||leaf.dev!==opened.dev||leaf.ino!==opened.ino||after.size!==opened.size||leaf.size!==opened.size||length!==Number(opened.size)||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs||leaf.mtimeNs!==opened.mtimeNs||leaf.ctimeNs!==opened.ctimeNs)failure("RECORD_CHANGED")
   await this.path()
   let value:unknown
   try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks,length)))}catch{failure("RECORD_INVALID")}
   return{state:validSnapshot(value),identity:{device:String(leaf.dev),inode:String(leaf.ino)},signature:fingerprint([String(leaf.size),String(leaf.mtimeNs),String(leaf.ctimeNs),value])}
  }catch(error){if(error instanceof RootMigrationRequestError)throw error;failure("RECORD_UNSAFE")}finally{await handle.close()}
 }
 private identical(a:Observed|null,b:Observed|null){return a===null?b===null:b!==null&&same(a.identity,b.identity)&&a.signature===b.signature}
 private finalRecordGuard(path:string,before:Observed|null,boot:DirectoryProof){
  // The final CAS is bounded and synchronous: no further asynchronous record
  // reads can separate the business guard from rename, and mutations during
  // that guard cannot replace a newer request unnoticed.
  try{
   const directory=lstatSync(boot.path,{bigint:true})
   if(!directory.isDirectory()||directory.isSymbolicLink()||String(directory.dev)!==boot.device||String(directory.ino)!==boot.inode||realpathSync(boot.path)!==boot.path)failure("BOOTSTRAP_CHANGED")
  }catch(error){if(error instanceof RootMigrationRequestError)throw error;failure("BOOTSTRAP_CHANGED")}
  let leaf:BigIntStats
  try{leaf=lstatSync(path,{bigint:true})}catch(error){if(missing(error)&&before===null)return;failure("RECORD_CHANGED")}
  if(!before||!leaf.isFile()||leaf.isSymbolicLink()||leaf.nlink!==1n||leaf.size>BigInt(MAX_ROOT_MIGRATION_REQUEST_BYTES)||String(leaf.dev)!==before.identity.device||String(leaf.ino)!==before.identity.inode)failure("RECORD_CHANGED")
  let fd:number|undefined
  try{
   fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const opened=fstatSync(fd,{bigint:true})
   if(opened.dev!==leaf.dev||opened.ino!==leaf.ino||opened.size!==leaf.size||opened.mtimeNs!==leaf.mtimeNs||opened.ctimeNs!==leaf.ctimeNs)failure("RECORD_CHANGED")
   const chunks:Buffer[]=[];let length=0
   for(;;){const bytes=Buffer.allocUnsafe(Math.min(64*1024,MAX_ROOT_MIGRATION_REQUEST_BYTES+1-length)),count=readSync(fd,bytes);if(count===0)break;length+=count;if(length>MAX_ROOT_MIGRATION_REQUEST_BYTES)failure("RECORD_CHANGED");chunks.push(bytes.subarray(0,count))}
   const after=fstatSync(fd,{bigint:true}),current=lstatSync(path,{bigint:true})
   if(current.dev!==opened.dev||current.ino!==opened.ino||current.nlink!==1n||!current.isFile()||current.size!==opened.size||after.size!==opened.size||length!==Number(opened.size)||current.mtimeNs!==opened.mtimeNs||current.ctimeNs!==opened.ctimeNs||after.mtimeNs!==opened.mtimeNs||after.ctimeNs!==opened.ctimeNs)failure("RECORD_CHANGED")
   const value:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks,length)))
   if(fingerprint([String(current.size),String(current.mtimeNs),String(current.ctimeNs),value])!==before.signature)failure("RECORD_CHANGED")
  }catch(error){if(error instanceof RootMigrationRequestError)throw error;failure("RECORD_CHANGED")}finally{if(fd!==undefined)closeSync(fd)}
 }
 private async read():Promise<Observed|null>{
  const observed=await this.readRaw()
  if(this.uncertain){
   if(!observed||!same(observed.state,this.uncertain))failure("RECORD_CHANGED")
   if(this.committedIdentity&&!same(this.committedIdentity,observed.identity))failure("RECORD_CHANGED")
   if(!this.uncertainObservation)failure("DURABILITY_UNCONFIRMED")
   if(!this.identical(this.uncertainObservation,observed))failure("RECORD_CHANGED")
   try{
    await this.options.writeOptions?.beforeDirectorySync?.();await this.path();await syncDirectory(this.bootstrap)
    const after=await this.readRaw();if(!this.identical(observed,after))failure("RECORD_CHANGED")
    this.expected=after;this.uncertain=null;this.uncertainObservation=null;this.committedIdentity=null;return after
   }catch(error){if(error instanceof RootMigrationRequestError)throw error;failure("DURABILITY_UNCONFIRMED")}
  }
  if(this.expected!==undefined&&!this.identical(this.expected,observed))failure("RECORD_CHANGED")
  this.expected=observed;return observed
 }
 private async atomicRequestWrite(path:string,content:string,state:RootMigrationRequestSnapshot,beforeRename:(temporaryPath:string,temporary:Observed)=>Promise<void>){
  // General atomicWrite deliberately hides its temporary fd. This request
  // ledger needs that exact inode to distinguish its own post-rename commit
  // from an external file with identical bytes during durability ambiguity.
  const temporary=join(this.bootstrap,`.root-migration-request-${randomUUID()}.tmp`)
  let ownsTemporary=false,committed=false,identity:FileIdentity|undefined
  try{
   const handle=await open(temporary,"wx",0o600);ownsTemporary=true
   let written:BigIntStats
   try{
    const created=await handle.stat({bigint:true});identity={device:String(created.dev),inode:String(created.ino)}
    await handle.writeFile(content,"utf8");await handle.sync();written=await handle.stat({bigint:true})
   }finally{await handle.close()}
   if(!written.isFile()||written.nlink!==1n||String(written.dev)!==identity!.device||String(written.ino)!==identity!.inode)failure("RECORD_CHANGED")
   const proof:Observed={state,identity:identity!,signature:fingerprint([String(written.size),String(written.mtimeNs),String(written.ctimeNs),JSON.parse(content)])}
   await beforeRename(temporary,proof)
   // beforeRename performed its synchronous final guard on this same path.
   await rename(temporary,path);committed=true
   this.uncertain=state;this.committedIdentity=identity!;this.uncertainObservation=null
   try{
    const leaf=await lstat(path,{bigint:true})
    if(!leaf.isFile()||leaf.isSymbolicLink()||leaf.nlink!==1n||String(leaf.dev)!==identity!.device||String(leaf.ino)!==identity!.inode||leaf.size!==written.size||leaf.mtimeNs!==written.mtimeNs)failure("RECORD_CHANGED")
    const observed=await this.readRaw()
    if(!observed||!same(observed.identity,identity)||!same(observed.state,state))failure("RECORD_CHANGED")
    this.uncertainObservation=observed
    await this.options.writeOptions?.beforeDirectorySync?.();await this.path();await syncDirectory(this.bootstrap)
    if(!this.identical(observed,await this.readRaw()))failure("RECORD_CHANGED")
   }catch(error){throw new CommitDurabilityError(error)}
  }finally{
   if(ownsTemporary&&!committed&&identity){
    try{const current=await lstat(temporary,{bigint:true});if(current.isFile()&&!current.isSymbolicLink()&&current.nlink===1n&&String(current.dev)===identity.device&&String(current.ino)===identity.inode)await unlink(temporary)}catch(error){if(!missing(error))throw error}
   }
  }
 }
 private async write(before:Observed|null,next:RootMigrationRequestSnapshot,guard?:()=>Promise<void>,syncGuard?:()=>void){
  const validated=validSnapshot(next),content=JSON.stringify(validated)+"\n"
  if(Buffer.byteLength(content)>MAX_ROOT_MIGRATION_REQUEST_BYTES)failure("RECORD_TOO_LARGE")
  const path=await this.path(),boot=await this.boot
  try{
   await this.atomicRequestWrite(path,content,validated,async(temporaryPath,temporary)=>{
    await this.options.writeOptions?.beforeRename?.();await this.path()
    const current=await this.readRaw();if(!this.identical(before,current))failure("RECORD_CHANGED")
    await guard?.();this.finalRecordGuard(path,before,boot)
    this.finalRecordGuard(temporaryPath,temporary,boot)
    this.lock();syncGuard?.()
   })
  }catch(error){
   if(error instanceof CommitDurabilityError){
    failure("DURABILITY_UNCONFIRMED")
   }
   if(error instanceof RootMigrationRequestError)throw error
   failure("WRITE_FAILED")
  }
  try{const after=await this.readRaw();if(!after||!same(after.state,validated)||!this.identical(this.uncertainObservation,after))failure("RECORD_CHANGED");this.expected=after;this.uncertain=null;this.uncertainObservation=null;this.committedIdentity=null}catch{failure("DURABILITY_UNCONFIRMED")}
 }
 private state(observed:Observed|null){return observed?.state??empty()}
 private next(before:Observed|null,active:RootMigrationRequest|null,results:RootMigrationCompletion[]){
  const revision=this.state(before).revision+1;if(!Number.isSafeInteger(revision))failure("REVISION_EXHAUSTED")
  return{schemaVersion:1 as const,revision,active,results}
 }
 private async source():Promise<RootPointer>{
  try{const resolution=await this.options.resolveSource();if(resolution.state!=="existing")failure("SOURCE_UNAVAILABLE");const pointer=parsed(pointerSchema,resolution.pointer,"SOURCE_UNAVAILABLE");await assertDirectory(pointer.root);return pointer}catch{failure("SOURCE_UNAVAILABLE")}
 }
 private async validate(request:RequestBase,closed=false){
  const source=await this.source();if(!same(source,request.source))failure("SOURCE_CHANGED")
  if(closed){try{await this.options.assertClosed(structuredClone(source))}catch{failure("SOURCE_NOT_CLOSED")};if(!same(await this.source(),request.source))failure("SOURCE_CHANGED")}
  try{await assertDirectory(request.target)}catch{failure("TARGET_CHANGED")}
  if(await overlapping(request.source.root,request.target)||await overlapping(await this.boot,request.target))failure("TARGET_OVERLAP")
  this.lock()
 }
 private request(state:RootMigrationRequestSnapshot,id:string){if(!state.active||state.active.requestId!==id)failure("REQUEST_MISMATCH");return state.active}
 private completion(request:RequestBase,outcome:RootMigrationOutcome,executionNonce:string|null):RootMigrationCompletion{
  return{requestId:request.requestId,ownerNonce:request.ownerNonce,source:request.source,target:request.target,createdAt:request.createdAt,receiptId:randomUUID(),executionNonce,finishedAt:new Date().toISOString(),outcome}
 }
 async prepare(ownerNonce:string,target:DirectoryProof):Promise<Extract<RootMigrationRequest,{phase:"prepared"}>>{
  const nonce=parsed(z.uuid(),ownerNonce),proof=parsed(identitySchema,target)
  return this.enqueue(async()=>{
   this.owner(nonce);const before=await this.read(),state=this.state(before)
   if(state.active)failure("REQUEST_PENDING");if(state.results.length===16)failure("RESULTS_PENDING")
   const source=await this.source();try{await assertDirectory(proof)}catch{failure("TARGET_CHANGED")}
   if(await overlapping(source.root,proof)||await overlapping(await this.boot,proof))failure("TARGET_OVERLAP")
   const request:Extract<RootMigrationRequest,{phase:"prepared"}>={requestId:randomUUID(),ownerNonce:nonce,source,target:proof,createdAt:new Date().toISOString(),phase:"prepared"}
   await this.write(before,this.next(before,request,state.results),()=>this.validate(request),()=>this.owner(nonce));return structuredClone(request)
  })
 }
 async arm(ownerNonce:string,requestId:string):Promise<Extract<RootMigrationRequest,{phase:"armed"}>>{
  const nonce=parsed(z.uuid(),ownerNonce),id=parsed(z.uuid(),requestId)
  return this.enqueue(async()=>{
   this.owner(nonce);const before=await this.read(),state=this.state(before),request=this.request(state,id)
   if(request.ownerNonce!==nonce)failure("REQUEST_MISMATCH");if(request.phase==="executing")failure("EXECUTION_STARTED")
   await this.validate(request,true);this.owner(nonce)
   if(request.phase==="armed")return structuredClone(request)
   const armed:Extract<RootMigrationRequest,{phase:"armed"}>={...request,phase:"armed",armedAt:new Date().toISOString()}
   await this.write(before,this.next(before,armed,state.results),()=>this.validate(armed,true),()=>this.owner(nonce));return structuredClone(armed)
  })
 }
 async loadArmed():Promise<Extract<RootMigrationRequest,{phase:"armed"}>|null>{
  return this.enqueue(async()=>{const request=this.state(await this.read()).active;if(request?.phase!=="armed")return null;await this.validate(request);return structuredClone(request)})
 }
 async startArmed(requestId:string):Promise<Extract<RootMigrationRequest,{phase:"executing"}>>{
  const id=parsed(z.uuid(),requestId)
  return this.enqueue(async()=>{
   const before=await this.read(),state=this.state(before),request=this.request(state,id);if(request.phase!=="armed")failure("NOT_ARMED")
   await this.validate(request,true)
   const execution:Extract<RootMigrationRequest,{phase:"executing"}>={...request,phase:"executing",executionNonce:randomUUID(),startedAt:new Date().toISOString()}
   await this.write(before,this.next(before,execution,state.results),()=>this.validate(execution,true));return structuredClone(execution)
  })
 }
 async finish(requestId:string,executionNonce:string,result:MigrationResult):Promise<RootMigrationCompletion>{
  const id=parsed(z.uuid(),requestId),nonce=parsed(z.uuid(),executionNonce)
  const input=parsed(z.object({status:z.enum(["complete","cleanup-pending","rolled-back","rollback-pending"]),migrationId:z.uuid(),root:pointerSchema,pending:z.array(z.string().max(4096)).max(ROOT_MIGRATION_LIMITS.pending)}).strict(),result)
  const outcome:RootMigrationOutcome={status:input.status,migrationId:input.migrationId,root:input.root,pendingCount:input.pending.length}
  return this.enqueue(async()=>{
   const before=await this.read(),state=this.state(before),previous=state.results.find(item=>item.requestId===id)
   if(previous){if(previous.executionNonce!==nonce||!same(previous.outcome,outcome))failure("RESULT_MISMATCH");return structuredClone(previous)}
   const request=this.request(state,id);if(request.phase!=="executing"||request.executionNonce!==nonce)failure("REQUEST_MISMATCH")
   const forward=input.status==="complete"||input.status==="cleanup-pending"
   const expected=forward?{...request.source,revision:request.source.revision+1,migrationId:input.migrationId,root:request.target}:request.source
   if(!same(input.root,expected))failure("RESULT_MISMATCH")
   const authoritative=async()=>{if(!same(await this.source(),input.root))failure("RESULT_MISMATCH")}
   await authoritative();const completion=this.completion(request,outcome,nonce)
   await this.write(before,this.next(before,null,[...state.results,completion]),authoritative);return structuredClone(completion)
  })
 }
 async fail(requestId:string,code:MigrationFailureCode,executionNonce?:string):Promise<RootMigrationCompletion>{
  const id=parsed(z.uuid(),requestId),safeCode=parsed(failureCodeSchema,code),nonce=executionNonce===undefined?null:parsed(z.uuid(),executionNonce)
  return this.enqueue(async()=>{
   const before=await this.read(),state=this.state(before),previous=state.results.find(item=>item.requestId===id)
   if(previous){if(previous.executionNonce!==nonce||previous.outcome.status!=="failed"||previous.outcome.code!==safeCode)failure("RESULT_MISMATCH");return structuredClone(previous)}
   const request=this.request(state,id);if(request.phase==="prepared")failure("NOT_ARMED")
   if(request.phase==="executing"?request.executionNonce!==nonce:nonce!==null)failure("REQUEST_MISMATCH")
   const root=await this.source()
   if(same(root.root,request.target)&&root.rootId===request.source.rootId)failure("RECOVERY_REQUIRED")
   if(!same(root,request.source)&&safeCode!=="SOURCE_CHANGED")failure("SOURCE_CHANGED")
   const authoritative=async()=>{if(!same(await this.source(),root))failure("SOURCE_CHANGED")}
   const completion=this.completion(request,{status:"failed",code:safeCode,root},nonce)
   await this.write(before,this.next(before,null,[...state.results,completion]),authoritative);return structuredClone(completion)
  })
 }
 async cancel(requestId:string,ownerNonce:string):Promise<RootMigrationCompletion>{
  const id=parsed(z.uuid(),requestId),nonce=parsed(z.uuid(),ownerNonce)
  return this.enqueue(async()=>{
   const before=await this.read(),state=this.state(before),previous=state.results.find(item=>item.requestId===id)
   if(previous){if(previous.ownerNonce!==nonce||previous.outcome.status!=="cancelled")failure("REQUEST_MISMATCH");return structuredClone(previous)}
   const request=this.request(state,id);if(request.ownerNonce!==nonce)failure("REQUEST_MISMATCH");if(request.phase==="executing")failure("EXECUTION_STARTED")
   const completion=this.completion(request,{status:"cancelled"},null)
   await this.write(before,this.next(before,null,[...state.results,completion]));return structuredClone(completion)
  })
 }
 async inspect():Promise<RootMigrationRequestSnapshot>{return this.enqueue(async()=>structuredClone(this.state(await this.read())))}
 async readResult():Promise<RootMigrationCompletion|null>{return this.enqueue(async()=>structuredClone(this.state(await this.read()).results[0]??null))}
 async acknowledgeResult(requestId:string,receiptId:string):Promise<boolean>{
  const id=parsed(z.uuid(),requestId),receipt=parsed(z.uuid(),receiptId)
  return this.enqueue(async()=>{
   const before=await this.read(),state=this.state(before),index=state.results.findIndex(item=>item.requestId===id&&item.receiptId===receipt);if(index<0)return false
   await this.write(before,this.next(before,state.active,state.results.filter((_,i)=>i!==index)));return true
  })
 }
 async flush():Promise<void>{for(;;){const captured=this.queue;await captured;if(captured===this.queue)return}}
}
