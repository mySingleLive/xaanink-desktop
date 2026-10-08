import {z} from 'zod'
import {randomUUID} from 'node:crypto'
import type {WorkRestoreDraftBarrier,WorkRestoreBarrier} from './work-restore-draft-barrier'
type Outcome=Exclude<WorkRestoreBarrier['outcome'],{status:'pending'}>
interface Options{
 assertOwner():Promise<void>
 assertClosed():Promise<void>
 barrier:Pick<WorkRestoreDraftBarrier,'begin'|'settle'>
 activate(identity:{workId:string;candidateId:string;revision:number}):Promise<unknown>
 closeReopenedData():Promise<void>
}
/** Runs only after the existing close coordinator's actual flush and worker
 * close. It never resumes an old renderer after activation may have occurred. */
export class WorkRestoreCommit{
 private identity:{workId:string;candidateId:string;revision:number}
 private flight:Promise<Outcome>|null=null
 private retention:WorkRestoreBarrier|null=null
 private outcome:Outcome|null=null
 private settled=false
 private completed=false
 private attempted=false
 private operationId=randomUUID()
 constructor(identity:{workId:string;candidateId:string;revision:number},private options:Options){this.identity=z.object({workId:z.uuid(),candidateId:z.uuid(),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict().parse(identity)}
 get ready(){return this.completed}
 get requiresRestart(){return this.attempted}
 finish():Promise<Outcome>{
  if(this.flight)return this.flight
  if(this.completed)return Promise.resolve(this.outcome!)
  const work=Promise.resolve().then(async()=>{
   await this.options.assertOwner();if(!this.outcome)await this.options.assertClosed()
   if(!this.retention){this.attempted=true;this.retention=await this.options.barrier.begin({workId:this.identity.workId,candidateId:this.identity.candidateId,operationId:this.operationId},()=>this.options.assertOwner());if(this.retention.outcome.status!=='pending'){this.outcome=this.retention.outcome;this.settled=true}}
   await this.options.assertOwner()
   if(!this.outcome){try{await this.options.activate(this.identity);this.outcome={status:'activated'}}catch(error){this.outcome={status:'failed',message:(error instanceof Error?error.message:'恢复未完成，原文件已保留').slice(0,4096)||'恢复未完成'}}}
   if(!this.settled){await this.options.barrier.settle(this.retention.token,this.outcome,()=>this.options.assertOwner());this.settled=true}
   await this.options.closeReopenedData();await this.options.assertOwner();this.completed=true;return structuredClone(this.outcome)
  })
  this.flight=work
  void work.then(()=>{if(this.flight===work)this.flight=null},()=>{if(this.flight===work)this.flight=null})
  return work
 }
}
