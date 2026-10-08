import {z} from 'zod'
import {WorkRestoreCommit} from './work-restore-commit'
import type {WorkRestoreDraftBarrier} from './work-restore-draft-barrier'
import type {PreparedWorkRestore} from '../shared/work-backup'
interface Options{
 assertOwner():Promise<void>
 assertClosed():Promise<void>
 prepare(identity:{workId:string;backupId:string}):Promise<PreparedWorkRestore>
 cancel(identity:{workId:string;candidateId:string}):Promise<void>
 confirm(candidate:PreparedWorkRestore):Promise<boolean>
 close():Promise<boolean>
 restart():void
 barrier:Pick<WorkRestoreDraftBarrier,'begin'|'settle'>
 activate(identity:{workId:string;candidateId:string;revision:number}):Promise<unknown>
 closeReopenedData():Promise<void>
}
/** Owns one native confirmation and delegates stop/flush/close to the existing
 * coordinator. After a barrier attempt only finishing and restarting are safe. */
export class WorkRestoreHandoff{
 private identity:{workId:string;backupId:string}
 private candidate:PreparedWorkRestore|null=null
 private operation:WorkRestoreCommit|null=null
 private flight:Promise<boolean>|null=null
 private cancellation:Promise<void>|null=null
 private accepted=false
 private committed=false
 constructor(identity:{workId:string;backupId:string},private options:Options){this.identity=z.object({workId:z.uuid(),backupId:z.uuid()}).strict().parse(identity)}
 get preparing(){return !!this.flight&&!this.accepted&&!this.requiresRestart}
 get pending(){return !this.committed&&(!!this.flight||!!this.candidate||this.requiresRestart)}
 get requiresRestart(){return this.operation?.requiresRestart??false}
 start():Promise<boolean>{
  if(this.flight)return this.flight
  if(this.operation||this.committed)return Promise.reject(Error('恢复交接不能重复启动'))
  const work=Promise.resolve().then(async()=>{
   try{
    await this.options.assertOwner()
    this.candidate=await this.options.prepare(this.identity)
    await this.options.assertOwner()
    if(!await this.options.confirm(this.candidate))return false
    await this.options.assertOwner()
    this.operation=new WorkRestoreCommit({workId:this.identity.workId,candidateId:this.candidate.id,revision:this.candidate.revision},this.options)
    this.accepted=true
    return await this.options.close()
   }finally{await this.cancelPrepared()}
  })
  this.flight=work
  void work.then(()=>{if(this.flight===work)this.flight=null},()=>{if(this.flight===work)this.flight=null})
  return work
 }
 cancelPrepared():Promise<void>{
  if(this.committed||this.requiresRestart||!this.candidate)return Promise.resolve()
  if(this.cancellation)return this.cancellation
  const candidate=this.candidate
  const work=Promise.resolve().then(async()=>{await this.options.cancel({workId:this.identity.workId,candidateId:candidate.id});if(this.candidate===candidate)this.candidate=null})
  this.cancellation=work
  void work.then(()=>{if(this.cancellation===work)this.cancellation=null},()=>{if(this.cancellation===work)this.cancellation=null})
  return work
 }
 async finishClosed(){if(!this.accepted||!this.operation)throw Error('恢复尚未确认');await this.operation.finish()}
 commit(){
  if(this.committed)return false
  if(!this.operation?.ready)throw Error('恢复交接尚未完成，不能重新启动')
  this.options.restart();this.committed=true;return true
 }
}
