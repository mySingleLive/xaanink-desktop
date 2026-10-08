import {createHash,randomUUID} from "node:crypto"
import {constants} from "node:fs"
import {open,lstat,realpath,stat} from "node:fs/promises"
import {join} from "node:path"
import {z} from "zod"
import {draftSnapshotSchema,type DraftSnapshot,type DraftReceipt} from "../shared/drafts"
import {atomicWrite,CommitDurabilityError,type StoreOptions} from "../core/versioned-store"
const limit=16*1024*1024
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex")
const fingerprint=(snapshot:DraftSnapshot)=>digest({...snapshot,createdAt:""})
export function validateDraftSnapshot(input:unknown):DraftSnapshot {
 const stack=[{value:input,depth:0}];let nodes=0,characters=0
 while(stack.length){
  const {value,depth}=stack.pop()!
  if(++nodes>200000||depth>64)throw new Error("草稿数据过大或嵌套过深")
  if(typeof value==="string"){characters+=value.length;if(characters>limit)throw new Error("草稿数据过大");continue}
  if(value===null||typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value))continue
  if(!value||typeof value!=="object"||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error("草稿只能包含普通数据")
  for(const[key,descriptor]of Object.entries(Object.getOwnPropertyDescriptors(value))){
   if(Array.isArray(value)&&key==="length")continue
   if(!("value"in descriptor))throw new Error("草稿只能包含普通数据")
   if(!Array.isArray(value)&&descriptor.value===undefined)continue
   characters+=key.length;stack.push({value:descriptor.value,depth:depth+1})
  }
 }
 const encoded=JSON.stringify(input)
 if(Buffer.byteLength(encoded)>limit)throw new Error("草稿数据过大")
 const snapshot=draftSnapshotSchema.parse(JSON.parse(encoded))
 if(new Set(snapshot.autosaves.map(row=>row.id)).size!==snapshot.autosaves.length)throw new Error("草稿标识不能重复")
 return snapshot
}
const envelopeSchema=z.object({version:z.literal(1),revision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),sessionId:z.uuid(),digest:z.string().regex(/^[a-f0-9]{64}$/),snapshot:draftSnapshotSchema}).strict()
type Envelope=z.infer<typeof envelopeSchema>
/** One main-process writer, under the existing application-root lock. Saved
 * requests remain inert recovery data; this journal never submits domain edits. */
export class DraftJournal {
 private queue:Promise<unknown>=Promise.resolve()
 private owner:{id:string;sessionId:string;sequence:number}|null=null
 private rootIdentity:Promise<{path:string;dev:bigint;ino:bigint}>
 private uncertain:string|null=null
 constructor(readonly root:string,readonly options:StoreOptions={}){
  this.rootIdentity=(async()=>{const path=await realpath(root),info=await stat(path,{bigint:true});if(!info.isDirectory())throw new Error("草稿目录不可用");return{path,dev:info.dev,ino:info.ino}})()
  // Preserve the rejection for each actual operation, but do not let delayed
  // bootstrap consumers turn a missing root into an unhandled rejection.
  void this.rootIdentity.catch(()=>{})
 }
 activate(owner:string){
  const current={id:owner,sessionId:randomUUID(),sequence:-1};this.owner=current
  return()=>{if(this.owner===current)this.owner=null}
 }
 private enqueue<T>(run:()=>Promise<T>):Promise<T>{const result=this.queue.then(run);this.queue=result.catch(()=>{});return result}
 private async path(){
  const captured=await this.rootIdentity,path=await realpath(this.root),info=await stat(path,{bigint:true})
  if(path!==captured.path||info.dev!==captured.dev||info.ino!==captured.ino)throw new Error("草稿目录已变化，尚未保存")
  return join(path,"drafts.json")
 }
 private async fileSafe(path:string){
  try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>limit+65536)throw new Error("草稿文件不安全或过大")}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}
 }
 private async readDisk():Promise<Envelope|null>{
  const path=await this.path();await this.fileSafe(path)
  let handle:Awaited<ReturnType<typeof open>>
  try{handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0))}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw new Error("草稿文件无法读取",{cause:error})}
  try{
   const before=await handle.stat();if(!before.isFile()||before.nlink!==1||before.size>limit+65536)throw new Error("草稿文件不安全或过大")
   const bytes=await handle.readFile();if(bytes.length>limit+65536)throw new Error("草稿文件过大")
   const parsed:unknown=JSON.parse(bytes.toString("utf8"));const envelope=envelopeSchema.parse(parsed)
   const snapshot=validateDraftSnapshot(envelope.snapshot)
   if(digest(snapshot)!==envelope.digest)throw new Error("草稿校验不通过，原文件已保留")
   return{...envelope,snapshot}
  }catch(error){throw new Error("草稿格式或校验不通过，原文件已保留",{cause:error})}finally{await handle.close()}
 }
 async persist(owner:string,input:DraftSnapshot):Promise<DraftReceipt>{
  const snapshot=validateDraftSnapshot(input),captured=this.owner
  if(snapshot.issues.length)throw new Error("部分草稿无法读取，旧恢复记录已保留")
  const current=()=>{if(!captured||this.owner!==captured||captured.id!==owner)throw new Error("草稿所属窗口已变化")}
  current()
  return this.enqueue(async()=>{
   current();const before=await this.readDisk();current()
   if(snapshot.revision<captured!.sequence)throw new Error("草稿修订已过期")
   let next:Envelope
   if(before?.sessionId===captured!.sessionId&&before.snapshot.revision>=snapshot.revision){
    if(before.snapshot.revision!==snapshot.revision||fingerprint(before.snapshot)!==fingerprint(snapshot))throw new Error("草稿修订冲突，旧稿已保留")
    next=before
    if(this.uncertain===null){captured!.sequence=snapshot.revision;return{revision:before.revision,digest:before.digest,clientRevision:snapshot.revision}}
   }else{
    const revision=(before?.revision??0)+1
    if(!Number.isSafeInteger(revision))throw new Error("草稿修订超出范围")
    next={version:1,revision,sessionId:captured!.sessionId,digest:digest(snapshot),snapshot}
   }
   const path=await this.path();await this.fileSafe(path);const currentFile=await this.readDisk();if(JSON.stringify(currentFile)!==JSON.stringify(before))throw new Error("草稿文件已变化，旧稿已保留");current()
   try{
    await atomicWrite(path,JSON.stringify(next)+"\n",{...this.options,beforeRename:async()=>{await this.options.beforeRename?.();current();await this.path();await this.fileSafe(path);const currentFile=await this.readDisk();if(JSON.stringify(currentFile)!==JSON.stringify(before))throw new Error("草稿文件已变化，旧稿已保留");current()}})
   }catch(error){if(error instanceof CommitDurabilityError)this.uncertain=next.digest;throw error}
   this.uncertain=next.digest
   await this.path();const committed=await this.readDisk();current()
   if(JSON.stringify(committed)!==JSON.stringify(next))throw new Error("草稿文件已变化，落盘尚未确认")
   this.uncertain=null;captured!.sequence=snapshot.revision
   return{revision:next.revision,digest:next.digest,clientRevision:snapshot.revision}
  })
 }
 async read():Promise<DraftSnapshot|null>{return this.enqueue(async()=>structuredClone((await this.readDisk())?.snapshot??null))}
 async confirm(owner:string,receipt:DraftReceipt):Promise<void>{
  const captured=this.owner
  const current=()=>{if(!captured||this.owner!==captured||captured.id!==owner||this.uncertain)throw new Error("草稿落盘尚未确认")}
  current()
  return this.enqueue(async()=>{
   current();const disk=await this.readDisk();current()
   if(!disk||disk.sessionId!==captured!.sessionId||disk.revision!==receipt.revision||disk.digest!==receipt.digest||disk.snapshot.revision!==receipt.clientRevision||captured!.sequence!==receipt.clientRevision)throw new Error("草稿落盘尚未确认")
  })
 }
}
