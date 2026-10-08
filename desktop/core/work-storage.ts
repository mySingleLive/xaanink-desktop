import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {atomicWrite,type StoreOptions} from './versioned-store'
import {assertDirectory,readMetadata,rootIdentitySchema,sameIdentity} from './root-ownership'
import type {RootIdentity} from './data-root'
import {LEGACY_NAMES,type BrandNames} from '../shared/brand-names'

const activeSchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('original')}).strict(),z.object({kind:z.literal('candidate'),id:z.uuid(),directory:rootIdentitySchema}).strict()])
const stateSchema=z.object({schemaVersion:z.literal(1),workId:z.uuid(),revision:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),active:activeSchema,previous:z.object({active:activeSchema,backupId:z.uuid(),kind:z.literal('closed-source').optional()}).strict().nullable()}).strict()
export type WorkStorageState=z.infer<typeof stateSchema>
export type StorageOutcome='old'|'new'|'blocked'
export interface WorkStorageHost{
 verify(id:string):Promise<RootIdentity>
 /** Host retains the work writer lease, stops admission and captures the final pre-restore data. */
 quiesce():Promise<{preRestoreBackupId:string;preRestoreKind?:'closed-source';release(outcome:StorageOutcome):Promise<void>}>
}
interface Options{assertOwner():void|Promise<void>;required():Promise<boolean>;markRequired():Promise<void>;writeOptions?:StoreOptions;names?:Readonly<BrandNames>}
const checksum=(state:WorkStorageState)=>createHash('sha256').update(JSON.stringify(state)).digest('hex')
function equal(a:WorkStorageState,b:WorkStorageState){return checksum(a)===checksum(b)}
/** Single authoritative pointer for original work data or a verified restored generation.
 * The host's required marker is an independent witness: losing this file
 * after an activation must never silently open the older original database.
 */
export class WorkStorage{
 private queue:Promise<unknown>=Promise.resolve()
 private path:string
 private readonly names:Readonly<BrandNames>
 constructor(readonly root:RootIdentity,readonly workId:string,readonly options:Options){z.uuid().parse(workId);this.names=options.names??LEGACY_NAMES;this.path=join(root.path,this.names.storage)}
 private serialize<T>(run:()=>Promise<T>){const p=this.queue.then(run);this.queue=p.catch(()=>{});return p}
 private async guard(){await this.options.assertOwner();await assertDirectory(this.root)}
 private original():WorkStorageState{return{schemaVersion:1,workId:this.workId,revision:0,active:{kind:'original'},previous:null}}
 private async read():Promise<WorkStorageState|null>{
  await this.guard();let raw:unknown
  try{raw=await readMetadata(this.path,128*1024)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){await this.guard();return null}throw error}
  const envelope=z.object({state:stateSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(raw),state=envelope.state
  if(state.workId!==this.workId||checksum(state)!==envelope.sha256)throw Error('作品存储指针校验失败')
  for(const active of [state.active,state.previous?.active])if(active?.kind==='candidate'&&active.directory.path!==join(this.root.path,this.names.restores,active.id))throw Error('作品存储指针越界')
  await this.guard();return state
 }
 async resolve():Promise<WorkStorageState>{
  const state=await this.read()
  if(!state&&await this.options.required())throw Error('作品存储指针缺失，原数据已保留')
  if(state?.active.kind==='candidate')await assertDirectory(state.active.directory)
  return state??this.original()
 }
 initialize():Promise<WorkStorageState>{return this.serialize(async()=>{
  let state=await this.read()
  if(!state){
   if(await this.options.required())throw Error('作品存储指针缺失，不能重建')
   state=this.original();const captured=state
   await atomicWrite(this.path,JSON.stringify({state,sha256:checksum(state)}),{...this.options.writeOptions,beforeRename:async()=>{await this.options.writeOptions?.beforeRename?.();await this.guard();if(await this.read())throw Error('作品存储指针已变更');if(await this.options.required())throw Error('作品存储指针缺失，不能重建');if(!equal(captured,this.original()))throw Error('作品存储初始状态无效')}})
  }
  await this.guard();await this.options.markRequired();await this.guard();return structuredClone(state)
 })}
 activate(revision:number,id:string,host:WorkStorageHost):Promise<WorkStorageState>{return this.serialize(async()=>{
  z.uuid().parse(id);const before=await this.read()
  if(!before||before.revision!==revision||revision>=Number.MAX_SAFE_INTEGER)throw Error('作品存储已变更，请重新准备恢复')
  if(!await this.options.required())throw Error('作品存储保护标记尚未保存')
  const target=rootIdentitySchema.parse(await host.verify(id))
  if(target.path!==join(this.root.path,this.names.restores,id))throw Error('恢复候选不属于当前作品')
  await assertDirectory(target)
  const lease=await host.quiesce();let outcome:StorageOutcome='blocked',next:WorkStorageState|undefined
  const verifyTarget=async()=>{const current=await host.verify(id);if(current.path!==target.path||!sameIdentity(current,target))throw Error('恢复候选已变化');await assertDirectory(target)}
  try{
   z.uuid().parse(lease.preRestoreBackupId);await this.guard();await verifyTarget()
   const current=await this.read();if(!current||!equal(current,before))throw Error('作品存储已变更')
   next=stateSchema.parse({...before,revision:before.revision+1,active:{kind:'candidate',id,directory:target},previous:{active:before.active,backupId:lease.preRestoreBackupId,...(lease.preRestoreKind?{kind:lease.preRestoreKind}:{})}})
   await atomicWrite(this.path,JSON.stringify({state:next,sha256:checksum(next)}),{...this.options.writeOptions,beforeRename:async()=>{await this.options.writeOptions?.beforeRename?.();await this.guard();await verifyTarget();const latest=await this.read();if(!latest||!equal(latest,before))throw Error('作品存储已变更')}})
   const committed=await this.read();if(!committed||!equal(committed,next))throw Error('作品存储启用结果无法确认')
   await verifyTarget();outcome='new';return structuredClone(next)
  }catch(error){
   // Rename may have committed even if directory sync failed. Resume only the
   // authority actually proven on disk; an unreadable pointer keeps the gate closed.
   try{const actual=await this.read();if(actual&&next&&equal(actual,next)){await verifyTarget();outcome='new'}else if(actual&&equal(actual,before)){if(actual.active.kind==='candidate')await assertDirectory(actual.active.directory);outcome='old'}}catch{outcome='blocked'}
   throw error
  }finally{await lease.release(outcome)}
 })}
}
