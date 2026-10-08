import {z} from 'zod'
import type {Prisma,PrismaClient} from '../../src/generated/prisma/client'
import {ContentError} from '../../src/lib/content-errors'
import {lockContentOperation,requestHash} from '../../src/lib/services/content-commit'
import {conversationDirectoryProofSchema} from '../shared/conversation-task'

const inputSchema=z.object({requestId:z.string().min(8).max(140),requestHash:z.string().regex(/^[a-f0-9]{64}$/),selection:conversationDirectoryProofSchema}).strict()
const reservationSchema=inputSchema.extend({version:z.literal(1),phase:z.enum(['pending','complete'])}).strict()
type Input=z.infer<typeof inputSchema>
type WithGlobal=<T>(run:(database:PrismaClient)=>Promise<T>)=>Promise<T>
const key=(requestId:string)=>'desktop:work-creation-reservation:'+requestHash(requestId)
const encoded=(value:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(value))
function assertSame(previous:Input,input:Input){
 if(previous.requestId!==input.requestId||previous.requestHash!==input.requestHash||previous.selection.path!==input.selection.path||previous.selection.device!==input.selection.device||previous.selection.inode!==input.selection.inode)
  throw new ContentError('REQUEST_CONFLICT','此建书请求已预留原作品目录；请核对原书名与定位，重新选择原目录后重试')
}

/** Private inbox metadata. A pending record binds a request to its authorized
 * physical directory; it is never a ready work or executable authorization. */
export class WorkCreationReservations{
 constructor(private readonly withGlobal:WithGlobal){}
 reserve(input:Input,assertCurrent:()=>void){return this.mutate(input,false,assertCurrent)}
 complete(input:Input,assertCurrent:()=>void){return this.mutate(input,true,assertCurrent)}
 private async mutate(value:Input,complete:boolean,assertCurrent:()=>void){
  assertCurrent();const input=inputSchema.parse(value)
  const result=await this.withGlobal(async database=>{
   assertCurrent()
   const result=await database.$transaction(async tx=>{
    assertCurrent()
    // Use the original creation lock name; a worker-local serialize queue alone
    // cannot durably bind an unknown outcome across process restarts.
    await lockContentOperation(tx,'local-author',`novel-create:${input.requestId}`);assertCurrent()
    const old=await tx.systemConfig.findUnique({where:{key:key(input.requestId)}});assertCurrent()
    if(old){
     const previous=reservationSchema.parse(old.value);assertSame(previous,input)
     if(!complete||previous.phase==='complete')return previous
     const next=reservationSchema.parse({...previous,phase:'complete'})
     await tx.systemConfig.update({where:{key:key(input.requestId)},data:{value:encoded(next)}});assertCurrent()
     return next
    }
    if(complete)throw new ContentError('REQUEST_CONFLICT','原建书目录预留记录缺失，请保留作品并核对原请求')
    const next=reservationSchema.parse({...input,version:1,phase:'pending'})
    await tx.systemConfig.create({data:{key:key(input.requestId),value:encoded(next)}});assertCurrent()
    return next
   });assertCurrent();return result
  });assertCurrent();return result
 }
 async directories(){return this.withGlobal(async database=>(await database.systemConfig.findMany({where:{key:{startsWith:'desktop:work-creation-reservation:'}}})).map(row=>reservationSchema.parse(row.value).selection.path))}
 async assertNoPendingCreation(requestId:string){return this.withGlobal(async database=>{
  const row=await database.systemConfig.findUnique({where:{key:key(requestId)}})
  if(row){const value=reservationSchema.parse(row.value);if(value.requestId!==requestId)throw new ContentError('REQUEST_CONFLICT','建书请求目录记录不匹配');throw new ContentError('WORK_CREATION_PENDING','原建书请求已有目录预留，请重新选择原目录以完成恢复',409)}
 })}
}
