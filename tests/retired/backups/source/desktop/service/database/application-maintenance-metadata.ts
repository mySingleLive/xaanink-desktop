import type {RootIdentity} from '../../core/data-root'
import type {Snapshot} from '../../core/versioned-store'
import {backupPlanSchema,type BackupPlan} from '../../shared/backup-plan'
import {WorkRestoreDraftBarrier,type WorkRestoreBarrier} from '../../main/work-restore-draft-barrier'
import {lstat} from 'node:fs/promises'
import {lstatSync,type BigIntStats} from 'node:fs'
import {join} from 'node:path'
import {z} from 'zod'
import {assertDirectory,rootIdentitySchema} from '../../core/root-ownership'
import {readBoundedBytes,assertDirectoryImmediately} from '../../core/application-backup-files'
export interface ApplicationMaintenanceMetadata{backupPlan:Snapshot<BackupPlan>|null;restoreBarrier:WorkRestoreBarrier|null}
export class ApplicationMaintenanceMetadataError extends Error{
 constructor(readonly code:string){super(code);this.name='ApplicationMaintenanceMetadataError'}
}
const maximumBytes=16384
// VersionedStore allows annotations on the envelope; the persisted value is
// strict. Do not silently reject an envelope accepted by the original reader.
const planEnvelope=z.object({schemaVersion:z.literal(1),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),value:backupPlanSchema}).passthrough()
type Proof={device:string;inode:string;size:string;mtimeNs:string;ctimeNs:string}
type Observation={name:string;proof:Proof|null;bytes:Buffer|null}
const codes=new Set(['APPLICATION_MAINTENANCE_PLAN_INVALID','APPLICATION_MAINTENANCE_BARRIER_INVALID','APPLICATION_MAINTENANCE_GUARD_REJECTED','APPLICATION_MAINTENANCE_DIRECTORY_CHANGED','APPLICATION_MAINTENANCE_CHANGED'])
const fail=(code:string):never=>{throw new ApplicationMaintenanceMetadataError(code)}
const sanitized=(error:unknown,code:string):never=>{if(error instanceof ApplicationMaintenanceMetadataError&&codes.has(error.code))throw error;return fail(code)}
function proof(info:BigIntStats):Proof{
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1n||info.size>BigInt(maximumBytes))throw Error('invalid metadata')
 return{device:String(info.dev),inode:String(info.ino),size:String(info.size),mtimeNs:String(info.mtimeNs),ctimeNs:String(info.ctimeNs)}
}
/** Read-only validation for an already-owned isolated application directory.
 * Never starts a timer, acknowledges a barrier or replays an unknown restore. */
export async function validateApplicationMaintenanceMetadata(directory:RootIdentity,guard:()=>void|Promise<void>):Promise<ApplicationMaintenanceMetadata>{
 let root:RootIdentity
 try{root=Object.freeze(rootIdentitySchema.parse(structuredClone(directory)))}catch{return fail('APPLICATION_MAINTENANCE_DIRECTORY_CHANGED')}
 const check=async()=>{
  try{await guard()}catch{return fail('APPLICATION_MAINTENANCE_GUARD_REJECTED')}
  try{await assertDirectory(root)}catch{return fail('APPLICATION_MAINTENANCE_DIRECTORY_CHANGED')}
  try{await guard()}catch{return fail('APPLICATION_MAINTENANCE_GUARD_REJECTED')}
 }
 const read=async(name:string,code:string):Promise<Observation>=>{
  await check()
  let before:Proof
  try{before=proof(await lstat(join(root.path,name),{bigint:true}))}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){await check();return{name,proof:null,bytes:null}}return sanitized(error,code)}
  try{
   const bytes=await readBoundedBytes(root,name,maximumBytes,check)
   // Fail malformed UTF8 before the original JSON reader could replace bytes.
   new TextDecoder('utf-8',{fatal:true}).decode(bytes)
   await check()
   return{name,proof:before,bytes}
  }catch(error){return sanitized(error,code)}
 }
 const plan=await read('backup-plan.json','APPLICATION_MAINTENANCE_PLAN_INVALID')
 let backupPlan:Snapshot<BackupPlan>|null=null
 if(plan.bytes){try{const parsed=planEnvelope.parse(JSON.parse(plan.bytes.toString('utf8')));backupPlan={revision:parsed.revision,value:parsed.value}}catch{return fail('APPLICATION_MAINTENANCE_PLAN_INVALID')}}
 const barrier=await read('restore-draft-barrier.json','APPLICATION_MAINTENANCE_BARRIER_INVALID')
 let restoreBarrier:WorkRestoreBarrier|null
 await check()
 try{restoreBarrier=await new WorkRestoreDraftBarrier(root.path).inspect()}catch(error){return sanitized(error,'APPLICATION_MAINTENANCE_BARRIER_INVALID')}
 await check()
 // No await follows these final identity/revision/absence checks: the trusted
 // guard and the two reads cannot authorize a replaced file or missing root.
 try{assertDirectoryImmediately(root)}catch{return fail('APPLICATION_MAINTENANCE_DIRECTORY_CHANGED')}
 for(const observation of [plan,barrier]){
  let current:Proof
  try{current=proof(lstatSync(join(root.path,observation.name),{bigint:true}))}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&!observation.proof)continue;return fail('APPLICATION_MAINTENANCE_CHANGED')}
  if(!observation.proof||JSON.stringify(current)!==JSON.stringify(observation.proof))return fail('APPLICATION_MAINTENANCE_CHANGED')
 }
 return structuredClone({backupPlan,restoreBarrier})
}
