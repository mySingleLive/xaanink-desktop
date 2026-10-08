import type {ApplicationBackup} from '../shared/application-backup'
import type {ApplicationBackupSessionResult} from './application-backup-session'
import {applicationBackupActionSchema,applicationBackupControlResultSchema,type ApplicationBackupControlResult} from '../shared/application-backup-control'
interface Works{
 applicationBackups():Promise<ApplicationBackup[]>
 applicationBackups(retention:number):Promise<ApplicationBackupSessionResult>
}
export class ApplicationBackupControl{
 constructor(private works:Works){}
 async handle(input:unknown):Promise<ApplicationBackupControlResult>{
  const parsed=applicationBackupActionSchema.safeParse(input)
  if(!parsed.success)throw Error('APPLICATION_BACKUP_ACTION_INVALID')
  const summary=({id,appId,createdAt,bytes}:ApplicationBackup)=>({id,appId,createdAt,bytes})
  try{
   if(parsed.data.type==='list'){
    const backups=await this.works.applicationBackups()
    return applicationBackupControlResultSchema.parse({type:'list',backups:backups.filter(row=>row.phase==='verified').map(summary)})
   }
   const {receipt,retained,cleanupPending}=await this.works.applicationBackups(parsed.data.retention)
   if(receipt.phase!=='verified'||!Array.isArray(cleanupPending))throw Error('invalid result')
   return applicationBackupControlResultSchema.parse({type:'now',backup:{...summary(receipt),retained:[...retained],cleanupPending:cleanupPending.length}})
  }catch{throw Error('APPLICATION_BACKUP_FAILED')}
 }
}
