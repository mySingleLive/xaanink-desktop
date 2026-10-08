import {z} from 'zod'
import {applicationBackupControlResultSchema,type ApplicationBackupControlResult} from '../shared/application-backup-control'
import type {DesktopBackupBatch,WorkBackupBatch} from '../shared/work-backup'
interface BackupHost {
 application(retention:number):Promise<ApplicationBackupControlResult>
 works(retention:number):Promise<WorkBackupBatch>
}
function failureMessage(error:unknown,fallback:string){return error instanceof Error&&error.message.trim()?error.message:fallback}
/** One admitted main-process job. Each worker scope is attempted once, in
 * sequence, so failures cannot suppress the other scope or close its lease. */
export async function runDesktopBackupBatch(retention:number,host:BackupHost):Promise<DesktopBackupBatch>{
 z.number().int().min(1).max(1000).parse(retention)
 let application:DesktopBackupBatch['application']
 try{
  const reply=applicationBackupControlResultSchema.parse(await host.application(retention))
  if(reply.type!=='now')throw Error('应用备份回执无效')
  application={status:'saved',backup:reply.backup}
 }catch(error){application={status:'failed',message:failureMessage(error,'应用数据备份未完成')}}
 try{
  const works=await host.works(retention)
  if(works.type!=='now'||!Array.isArray(works.saved)||!Array.isArray(works.failed))throw Error('作品备份回执无效')
  return{type:'now',saved:works.saved,failed:works.failed,application}
 }catch(error){return{type:'now',saved:[],failed:[],application,workError:failureMessage(error,'作品备份未完成')}}
}
