import {applicationNames,assertBrandControls} from '../core/brand-names'
import {lstatSync,realpathSync} from 'node:fs'
import {join} from 'node:path'
import {DataRootManager,type RootPointer,type RootIdentity} from '../core/data-root'
import {directoryIdentity} from '../core/root-ownership'
import {assertRootAuthorityDirectory,assertRootAuthorityFile,assertRootAuthorityHost,assertCurrentApplicationMarker,readRootAuthority} from '../core/root-authority'
import {observeWorkLeaseAudit,WorkLeaseRecovery,type WorkLeaseRecoveryOptions,type WorkLeaseRecoveryPreview,type WorkLeaseRecoveryResult} from '../core/work-lease-recovery'

function directoryImmediately(path:string):RootIdentity {
 const stat=lstatSync(path,{bigint:true})
 if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(path)!==path)throw Error('INBOX_DIRECTORY_UNSAFE')
 return{path,device:String(stat.dev),inode:String(stat.ino)}
}
/** First synchronous turn. No worker, source cache, adoption or data write. */
export function inboxLeaseRecoveryRequired(value:RootPointer|null):boolean {
 if(!value)return false
 const pointer=DataRootManager.parsePointer(value)
 const names=applicationNames(pointer.root),marker=assertCurrentApplicationMarker(pointer)
 const inbox=directoryImmediately(join(pointer.root.path,'inbox'))
 assertBrandControls(inbox,names);const audit=observeWorkLeaseAudit(inbox,names)
 let lockPresent=false
 try{lstatSync(join(inbox.path,names.lock));lockPresent=true}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 assertRootAuthorityDirectory(pointer.root);assertRootAuthorityDirectory(inbox)
 assertRootAuthorityFile(pointer.root,names.appMarker,marker);audit.assertCurrent()
 return lockPresent||audit.phase==='observed'
}
export interface InboxLeaseRecoveryOptions {assertColdHost():void;hook?:WorkLeaseRecoveryOptions['hook']}
export interface InboxLeaseRecoverySession {
 preview:WorkLeaseRecoveryPreview
 recover(confirmed:boolean):Promise<WorkLeaseRecoveryResult>
 assertRecovered():void
 cancel():void
}
/** Fixed inbox capability from current app authority; never accepts a work path. */
export async function prepareInboxLeaseRecovery(bootstrap:string,options:InboxLeaseRecoveryOptions):Promise<InboxLeaseRecoverySession>{
 const originalColdHost=options.assertColdHost
 const cold=()=>assertRootAuthorityHost(originalColdHost,'HOST_NOT_OWNED')
 cold()
 const boot=await directoryIdentity(bootstrap);cold()
 const authority=readRootAuthority(boot,cold)
 if(authority.records.some(record=>record.kind==='application')||authority.unreadMigrationResultIds.length||authority.retainedMigration&&!['complete','rolled-back'].includes(authority.retainedMigration.phase))throw Error('INBOX_AUTHORITY_REQUIRES_MAINTENANCE')
 const root=Object.freeze({...authority.pointer.root}),names=applicationNames(root),marker=assertCurrentApplicationMarker(authority.pointer)
 const inbox=await directoryIdentity(join(root.path,'inbox')),database=await directoryIdentity(join(inbox.path,'database'))
 const bound=()=>{
  cold();assertRootAuthorityDirectory(boot);authority.assertCurrent()
  assertRootAuthorityDirectory(root);assertRootAuthorityFile(root,names.appMarker,marker)
  if(applicationNames(root).family!==names.family)throw Error('INBOX_CHANGED')
  assertRootAuthorityDirectory(inbox);assertRootAuthorityDirectory(database)
 }
 bound()
 let confirmation=false,preview:WorkLeaseRecoveryPreview|undefined,cancelled=false
 const recovery=new WorkLeaseRecovery({
  namesForWork:()=>names,
  assertHost:bound,
  assertWorkClosed(work){bound();if(work.path!==inbox.path||work.device!==inbox.device||work.inode!==inbox.inode)throw Error('INBOX_CHANGED')},
  assertConfirmed(requestId,work){bound();if(cancelled||!confirmation||preview?.requestId!==requestId||work.path!==inbox.path)throw Error('CONFIRMATION_REQUIRED')},
  hook:phase=>options.hook?.(phase),
 })
 preview=await recovery.prepare(inbox);bound()
 const prepared=preview
 const assertRecovered=()=>{
  bound()
  try{lstatSync(join(inbox.path,names.lock));throw Error('INBOX_NEW_LEASE_PRESENT')}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  assertBrandControls(inbox,names);const audit=observeWorkLeaseAudit(inbox,names)
  if(audit.phase!=='recovered')throw Error('INBOX_AUDIT_NOT_COMPLETE')
  bound();audit.assertCurrent()
  // Seal after the last authority/audit read: that read may overlap a new writer.
  try{lstatSync(join(inbox.path,names.lock));throw Error('INBOX_NEW_LEASE_PRESENT')}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
 }
 return{
  preview:prepared,
  assertRecovered,
  cancel(){cancelled=true;confirmation=false;recovery.cancel(prepared.requestId)},
  async recover(confirmed){
   confirmation=confirmed===true&&!cancelled
   const result=await recovery.recover(prepared.requestId)
   // A cached recovered request never proves a newly arrived writer is absent.
   bound()
   if(result.status==='recovered')assertRecovered()
   return result
  },
 }
}
