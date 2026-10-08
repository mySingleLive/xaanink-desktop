import {join} from 'node:path'
import {realpath} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {atomicWrite,type StoreOptions} from '../core/versioned-store'
import {assertDirectory,directoryIdentity,readMetadata} from '../core/root-ownership'
const outcomeSchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('pending')}).strict(),z.object({status:z.literal('activated')}).strict(),z.object({status:z.literal('failed'),message:z.string().min(1).max(4096)}).strict(),
])
const activeSchema=z.object({token:z.uuid(),operationId:z.uuid().optional(),workId:z.uuid(),candidateId:z.uuid(),createdAt:z.iso.datetime(),outcome:outcomeSchema}).strict()
const stateSchema=z.object({schemaVersion:z.literal(1),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),active:activeSchema.nullable()}).strict()
export type WorkRestoreBarrier=z.infer<typeof activeSchema>
/** Durable flag to retain existing caches as inert recovery drafts after a
 * database restoration, even when the process exits between activation and ACK. */
export class WorkRestoreDraftBarrier{
 private rootIdentity:ReturnType<typeof directoryIdentity>
 private queue:Promise<unknown>=Promise.resolve()
 private path:string
 private instanceId=randomUUID()
 private issued=new Map<string,{operationId:string;confirmed:boolean}>()
 constructor(root:string,private options:StoreOptions={}){this.rootIdentity=realpath(root).then(directoryIdentity);void this.rootIdentity.catch(()=>{});this.path=join(root,'restore-draft-barrier.json')}
 private serial<T>(run:()=>Promise<T>){const work=this.queue.then(run);this.queue=work.catch(()=>{});return work}
 private async guard(){await assertDirectory(await this.rootIdentity)}
 private async read(){await this.guard();let raw:unknown;try{raw=await readMetadata(this.path,16384)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){await this.guard();return{schemaVersion:1 as const,revision:0,active:null}}throw error}const state=stateSchema.parse(raw);await this.guard();return state}
 private async commit(before:z.infer<typeof stateSchema>,active:WorkRestoreBarrier|null,assertOwner:()=>Promise<void>){
  if(before.revision>=Number.MAX_SAFE_INTEGER)throw Error('恢复草稿保护修订超过上限')
  const next=stateSchema.parse({...before,revision:before.revision+1,active}),current=async()=>{await assertOwner();await this.guard();if(JSON.stringify(await this.read())!==JSON.stringify(before))throw Error('恢复草稿保护状态已变化');await assertOwner()}
  await current();await atomicWrite(this.path,JSON.stringify(next),{...this.options,beforeRename:async()=>{await this.options.beforeRename?.();await current()}})
  await assertOwner();if(JSON.stringify(await this.read())!==JSON.stringify(next))throw Error('恢复草稿保护写入尚未确认')
 }
 inspect(){return this.serial(async()=>structuredClone((await this.read()).active))}
 begin(input:{workId:string;candidateId:string;operationId?:string},assertOwner:()=>Promise<void>){
  const identity=z.object({workId:z.uuid(),candidateId:z.uuid(),operationId:z.uuid().optional()}).strict().parse(input),operationId=identity.operationId??this.instanceId
  return this.serial(async()=>{await assertOwner();const before=await this.read();if(before.active){
   if(before.active.workId!==identity.workId||before.active.candidateId!==identity.candidateId)throw Error('请先完成上一次恢复草稿的保留确认')
   const grant=this.issued.get(before.active.token)
   if(before.active.outcome.status==='pending'){
    if(!grant||grant.operationId!==operationId||before.active.operationId!==operationId)throw Error('上次恢复结果尚未确认，请先保留恢复草稿；不能重新执行启用')
    if(!grant.confirmed){await this.commit(before,before.active,assertOwner);grant.confirmed=true}
   }else await this.commit(before,before.active,assertOwner)
   await assertOwner();return structuredClone(before.active)
  }
   const active:WorkRestoreBarrier={...identity,operationId,token:randomUUID(),createdAt:new Date().toISOString(),outcome:{status:'pending'}},grant={operationId,confirmed:false};this.issued.set(active.token,grant);await this.commit(before,active,assertOwner);grant.confirmed=true;return active
  })
 }
 settle(token:string,input:Exclude<z.infer<typeof outcomeSchema>,{status:'pending'}>,assertOwner:()=>Promise<void>){
  z.uuid().parse(token);const outcome=outcomeSchema.parse(input);if(outcome.status==='pending')return Promise.reject(Error('恢复结果无效'))
  return this.serial(async()=>{await assertOwner();const before=await this.read();if(before.active?.token!==token)throw Error('恢复草稿保护令牌已失效');await this.commit(before,{...before.active,outcome},assertOwner)})
 }
 acknowledge(token:string,verifyPersistedRecovery:()=>Promise<void>){
  z.uuid().parse(token)
  return this.serial(async()=>{const before=await this.read();if(before.active?.token!==token)throw Error('恢复草稿保护令牌已失效');await verifyPersistedRecovery();await this.commit(before,null,verifyPersistedRecovery)})
 }
}
