import {workBackupActionSchema,type WorkBackupResult,type PreparedWorkRestore,type WorkBackupBatch} from '../shared/work-backup'
import type {BackupReceipt} from '../core/work-backups'
interface Works{
 list():Promise<Array<{id:string;title:string}>>
 backups(id:string):Promise<BackupReceipt[]>
 backup(id:string,retention:number):Promise<BackupReceipt>
 prepareRestore(id:string,backupId:string):Promise<PreparedWorkRestore>
 cancelRestore(id:string,candidateId:string):Promise<void>
 activateRestore(id:string,candidateId:string,revision:number):Promise<{revision:number}>
}
/** Main serializes orchestration. The worker accepts semantic IDs only; no file paths or engine bytes cross this API. */
export class WorkBackupControl{
 constructor(private works:Works){}
 async handle(input:unknown):Promise<WorkBackupResult>{
  const action=workBackupActionSchema.parse(input)
  if(action.type==='works')return{type:'works',works:(await this.works.list()).map(({id,title})=>({id,title}))}
  if(action.type==='list')return{type:'list',backups:await this.works.backups(action.workId)}
  if(action.type==='prepare')return{type:'prepare',candidate:await this.works.prepareRestore(action.workId,action.backupId)}
  if(action.type==='cancel'){await this.works.cancelRestore(action.workId,action.candidateId);return{type:'cancel'}}
  if(action.type==='activate'){const state=await this.works.activateRestore(action.workId,action.candidateId,action.revision);return{type:'activate',revision:state.revision}}
  const result:WorkBackupBatch={type:'now',saved:[],failed:[]}
  for(const row of await this.works.list()){
   try{result.saved.push(await this.works.backup(row.id,action.retention))}
   catch(error){result.failed.push({workId:row.id,title:row.title,message:error instanceof Error?error.message:'作品备份未完成'})}
  }
  return result
 }
}
