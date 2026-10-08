import {lstatSync,realpathSync} from 'node:fs'
import {rootIdentitySchema} from '../core/root-ownership'
import type {RootIdentity} from '../core/data-root'
import {canonical,digest} from '../core/application-backup-files'
import {assertRootAuthorityDirectory,assertRootAuthorityHost,observeRootAuthority,readRootAuthority} from '../core/root-authority'
import {APPLICATION_DRAFT_RETENTION_LIMITS,applicationDraftRetentionSchema} from '../shared/application-restore'
import {validateDraftSnapshot} from './draft-journal'
import {ApplicationRestoreRequests,type ApplicationRestoreStartup} from './application-restore-request'

export function inspectApplicationRestoreProtection(bootstrap:RootIdentity,assertLock:()=>void):{operationIds:string[];unknown:boolean}{
 try{
  const guard=()=>{assertRootAuthorityHost(assertLock,'LOCK_REQUIRED');assertRootAuthorityDirectory(bootstrap)}
  guard()
  if(!observeRootAuthority(bootstrap,'data-root.json',16384,true))return{operationIds:[],unknown:false}
  const authority=readRootAuthority(bootstrap,guard),root=authority.pointer.root
  let physical:ReturnType<typeof lstatSync>
  try{physical=lstatSync(root.path)}catch(cause){if(['ENOENT','ENOTDIR'].includes((cause as NodeJS.ErrnoException).code??'')){authority.assertCurrent();return{operationIds:[],unknown:false}}throw cause}
  const exact=lstatSync(root.path,{bigint:true})
  // A replacement directory is never inspected as the old source. The
  // independent relocation triage handles actual physical identity loss.
  if(!physical.isDirectory()||physical.isSymbolicLink()||String(exact.dev)!==root.device||String(exact.ino)!==root.inode||realpathSync(root.path)!==root.path){authority.assertCurrent();return{operationIds:[],unknown:false}}
  const file=observeRootAuthority(root,'application-restore-drafts.json',APPLICATION_DRAFT_RETENTION_LIMITS.bytes,true)
  if(!file){authority.assertCurrent();return{operationIds:[],unknown:false}}
  const retained=applicationDraftRetentionSchema.parse(JSON.parse(file.text)),{checksum,...body}=retained
  if(digest(canonical(body))!==checksum||retained.appId!==authority.pointer.rootId)throw Error('APPLICATION_DRAFT_BARRIER_INVALID')
  for(const row of retained.snapshots)validateDraftSnapshot(row.snapshot)
  authority.assertCurrent();assertRootAuthorityDirectory(root)
  const after=observeRootAuthority(root,'application-restore-drafts.json',APPLICATION_DRAFT_RETENTION_LIMITS.bytes)!
  if(canonical(after.proof)!==canonical(file.proof))throw Error('APPLICATION_DRAFT_BARRIER_CHANGED')
  return{operationIds:retained.barrier.phase==='complete'?[]:[retained.operationId],unknown:false}
 }catch{return{operationIds:[],unknown:true}}
}

/** Synchronous first-turn admission only. Never opens an engine/session,
 * adopts a directory, repairs metadata, or creates a missing root. */
export function applicationRestorePreflight(path:string,assertLock:()=>void):{bootstrap:RootIdentity|null;requests:ApplicationRestoreRequests|null;startup:ApplicationRestoreStartup}{
 try{
  assertRootAuthorityHost(assertLock,'LOCK_REQUIRED')
  const before=lstatSync(path,{bigint:true}),bootstrap=rootIdentitySchema.parse({path,device:String(before.dev),inode:String(before.ino)})
  assertRootAuthorityDirectory(bootstrap)
  const readonly=()=>{throw Error('READ_ONLY_PREFLIGHT')}
  const requests=new ApplicationRestoreRequests(bootstrap,{assertStableLock:assertLock,assertOwner:readonly,assertQuiesced:readonly,assertOldProcessExited:readonly,assertCold:readonly,assertExecutionSettled:readonly,inspectPendingEvidence:()=>inspectApplicationRestoreProtection(bootstrap,assertLock)})
  return{bootstrap,requests,startup:requests.startup()}
 }catch{return{bootstrap:null,requests:null,startup:{mode:'cold',code:'APPLICATION_RESTORE_INSPECTION_REQUIRED'}}}
}
