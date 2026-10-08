import {constants,lstatSync,realpathSync,openSync,fstatSync,readSync,closeSync,type BigIntStats} from 'node:fs'
import {join} from 'node:path'
import {MAX_ROOT_MIGRATION_REQUEST_BYTES,validateRootMigrationRequestSnapshot} from './root-migration-request'
const same=(a:BigIntStats,b:BigIntStats)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs
/** First-turn triage only: no source session may be opened on uncertain input. */
export function rootMaintenanceRequired(bootstrap:string):boolean{
 let fd:number|undefined
 try{
  const root=lstatSync(bootstrap,{bigint:true})
  if(!root.isDirectory()||root.isSymbolicLink()||realpathSync(bootstrap)!==bootstrap)return true
  const path=join(bootstrap,'root-migration-request.json')
  let before:BigIntStats
  try{before=lstatSync(path,{bigint:true})}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){const current=lstatSync(bootstrap,{bigint:true});return !current.isDirectory()||current.isSymbolicLink()||current.dev!==root.dev||current.ino!==root.ino||realpathSync(bootstrap)!==bootstrap}throw error}
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.size>BigInt(MAX_ROOT_MIGRATION_REQUEST_BYTES))return true
  fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const opened=fstatSync(fd,{bigint:true})
  if(!same(before,opened))return true
  const chunks:Buffer[]=[];let length=0
  for(;;){const block=Buffer.allocUnsafe(Math.min(64*1024,MAX_ROOT_MIGRATION_REQUEST_BYTES+1-length)),count=readSync(fd,block);if(!count)break;length+=count;if(length>MAX_ROOT_MIGRATION_REQUEST_BYTES)return true;chunks.push(block.subarray(0,count))}
  const after=fstatSync(fd,{bigint:true}),leaf=lstatSync(path,{bigint:true}),rootAfter=lstatSync(bootstrap,{bigint:true})
  if(!same(opened,after)||!same(after,leaf)||leaf.nlink!==1n||!leaf.isFile()||leaf.isSymbolicLink()||length!==Number(opened.size)||rootAfter.dev!==root.dev||rootAfter.ino!==root.ino||rootAfter.isSymbolicLink()||realpathSync(bootstrap)!==bootstrap)return true
  const snapshot=validateRootMigrationRequestSnapshot(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,length))))
  return snapshot.active!==null||snapshot.results.length>0
 }catch{return true}finally{if(fd!==undefined)closeSync(fd)}
}
