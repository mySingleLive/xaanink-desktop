import {lstatSync,realpathSync,opendirSync} from 'node:fs'
import {z} from 'zod'
import {DataRootManager} from '../core/data-root'
import {rootIdentitySchema,sameIdentity} from '../core/root-ownership'
import {assertRootAuthorityDirectory,assertRootAuthorityHost,observeRootAuthority} from '../core/root-authority'
import {applicationRestorePreflight} from './application-restore-preflight'
import {inspectApplicationRestoreLayouts} from './application-restore-layout'

// Read compatibility for an existing control file. This module never starts,
// resumes, acknowledges or removes an old backup recovery operation.
const legacyWorkBarrierSchema=z.object({
 schemaVersion:z.literal(1),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
 active:z.object({token:z.uuid(),operationId:z.uuid().optional(),workId:z.uuid(),candidateId:z.uuid(),createdAt:z.iso.datetime(),outcome:z.discriminatedUnion('status',[
  z.object({status:z.literal('pending')}).strict(),z.object({status:z.literal('activated')}).strict(),z.object({status:z.literal('failed'),message:z.string().min(1).max(4096)}).strict(),
 ])}).strict().nullable(),
}).strict()
function applicationControls(path:string){
 const directory=opendirSync(path),names:string[]=[];let count=0
 try{for(;;){const row=directory.readSync();if(!row)break;if(++count>512)throw Error('LEGACY_BACKUP_RECOVERY_UNCONFIRMED')
  if(/^(?:\.?application-recovery-|\.?application-restore-|\.?desktop-recovery-layout-)/.test(row.name))names.push(row.name)
 }}finally{directory.closeSync()}
 return names.sort()
}

/** First-turn, bounded, read-only check before any ordinary engine or session.
 * An absent/replaced root is left to normal root relocation. Existing legacy
 * controls in a physically owned root must be complete before opening data. */
export function assertNoLegacyBackupRecovery(path:string,assertLock:()=>void):void{
 try{
  assertRootAuthorityHost(assertLock,'LOCK_REQUIRED')
  const info=lstatSync(path,{bigint:true}),bootstrap=rootIdentitySchema.parse({path,device:String(info.dev),inode:String(info.ino)})
  const guard=()=>{assertRootAuthorityHost(assertLock,'LOCK_REQUIRED');assertRootAuthorityDirectory(bootstrap)}
  guard()
  const controls=applicationControls(path)
  // A pre-publication activation file has no committed authority witness.
  // The original receipt reader ignores dot files, so block it explicitly.
  if(controls.some(name=>name.startsWith('.application-restore-')))throw Error('LEGACY_BACKUP_RECOVERY_PENDING')
  const checkApplication=()=>{
   const recovery=applicationRestorePreflight(path,assertLock),layout=inspectApplicationRestoreLayouts(bootstrap)
   if(!recovery.bootstrap||recovery.startup.mode!=='normal'||layout.unknown||layout.operationIds.length)throw Error('LEGACY_BACKUP_RECOVERY_PENDING')
  }
  // With no legacy controls, ordinary migration/relocation keeps its existing
  // triage. Its nonterminal journal must not be misclassified as a restore.
  if(controls.length)checkApplication()
  const pointerFile=observeRootAuthority(bootstrap,'data-root.json',16384,true)
  if(!pointerFile){guard();return}
  const pointer=DataRootManager.parsePointer(JSON.parse(pointerFile.text)),root=pointer.root
  let physical:ReturnType<typeof lstatSync>
  try{physical=lstatSync(root.path,{bigint:true})}catch(cause){
   if(!['ENOENT','ENOTDIR'].includes((cause as NodeJS.ErrnoException).code??''))throw cause
   guard();return
  }
  if(!physical.isDirectory()||physical.isSymbolicLink()||!sameIdentity(root,{device:String(physical.dev),inode:String(physical.ino)})||realpathSync(root.path)!==root.path){guard();return}
  const file=observeRootAuthority(root,'restore-draft-barrier.json',16384,true)
  if(file&&legacyWorkBarrierSchema.parse(JSON.parse(file.text)).active)throw Error('LEGACY_BACKUP_RECOVERY_PENDING')
  if(!controls.length&&observeRootAuthority(root,'application-restore-drafts.json',16*1024*1024,true))checkApplication()
  guard();assertRootAuthorityDirectory(root)
  if(JSON.stringify(applicationControls(path))!==JSON.stringify(controls)||JSON.stringify(observeRootAuthority(bootstrap,'data-root.json',16384))!==JSON.stringify(pointerFile)||JSON.stringify(observeRootAuthority(root,'restore-draft-barrier.json',16384,true))!==JSON.stringify(file))throw Error('LEGACY_BACKUP_RECOVERY_CHANGED')
 }catch(cause){
  if(cause instanceof Error&&cause.message.startsWith('LEGACY_BACKUP_RECOVERY'))throw cause
  throw Error('LEGACY_BACKUP_RECOVERY_UNCONFIRMED',{cause})
 }
}
