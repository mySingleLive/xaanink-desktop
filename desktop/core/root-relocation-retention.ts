import type {RootPointer,RootRelocationRetention} from './data-root'
import {directoryIdentity} from './root-ownership'
import {inspectRootRelocation} from './root-relocation'
import {canonical} from './application-backup-files'
import {opendirSync} from 'node:fs'
import {RootRelocationError,ROOT_RELOCATION_LIMITS} from './root-relocation'
/** Ordinary roots need no relocation authority. Old receipts still undergo the
 * fresh chain check; a nonmatching current pointer yields null, never a skip. */
export async function inspectRetainedRootRelocation(bootstrap:string,host:{assertStableLock():void;assertCold():void}){
 let present=false,application=false,entries=0
 try{const directory=opendirSync(bootstrap);try{for(;;){const entry=directory.readSync();if(!entry)break;if(++entries>ROOT_RELOCATION_LIMITS.bootstrapEntries)throw Error('limit');if(entry.name.startsWith('root-relocation-'))present=true;if(entry.name.startsWith('application-restore-'))application=true}}finally{directory.closeSync()}}
 catch{throw new RootRelocationError('CONTROL_UNSAFE')}
 if(application){const{inspectApplicationRestoreActivation}=await import('./application-restore-activation');const restored=await inspectApplicationRestoreActivation(await directoryIdentity(bootstrap),host);if(restored)return restored}
 if(!present)return null
 return inspectRootRelocation(await directoryIdentity(bootstrap),host)
}
/** No cached migration ID: every invocation reads the full receipt chain and
 * original journal/ledger. Its last synchronous seal is called by recover. */
export function createRootRelocationRetention(bootstrap:string,host:{assertStableLock():void;assertCold():void}):(pointer:RootPointer,journalChecksum:string)=>Promise<RootRelocationRetention|null>{
 return async(pointer,journalChecksum)=>{
  const disposition=await inspectRetainedRootRelocation(bootstrap,host)
  if(!disposition||canonical(disposition.pointer)!==canonical(pointer)||disposition.journalChecksum!==journalChecksum||!['cleanup-pending','rollback-pending'].includes(disposition.retainedMigration?.phase??''))return null
  disposition.assertCurrent()
  return{pointer:disposition.pointer,journalChecksum,assertCurrent:disposition.assertCurrent}
 }
}
