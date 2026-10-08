import {join} from 'node:path'
import {backupPlanSchema} from '../shared/backup-plan'
import {BackupScheduler} from './backup-scheduler'
import {VersionedStore} from '../core/versioned-store'
import type {BusinessGate} from './business-gate'
import {applicationBackupCompletion,type WorkBackupBatch} from '../shared/work-backup'
interface Clock{now():number;setTimer(run:()=>void,ms:number):unknown;clearTimer(timer:unknown):void}
interface Configuration{backupIntervalMinutes:number;backupRetention:number}
export type WorkBackupNotice={type:'complete';count:number}|{type:'error';message:string}
interface Options{root:string;clock?:Clock;gate:BusinessGate;run(retention:number):Promise<WorkBackupBatch>;notify(value:WorkBackupNotice):void}
/** Main timer lifetime follows the actual database lifetime, including macOS reopen. */
export class WorkBackupManager{
 private scheduler:BackupScheduler<WorkBackupBatch>
 private notify(value:WorkBackupNotice){try{this.options.notify(value)}catch{/* notification cannot invalidate a durable receipt */}}
 constructor(private options:Options){
  const store=new VersionedStore(join(options.root,'backup-plan.json'),{lastSuccess:null as number|null},value=>backupPlanSchema.parse(value));let completed:WorkBackupBatch|undefined
  this.scheduler=new BackupScheduler({clock:options.clock,loadLastSuccess:async()=>(await store.read()).value.lastSuccess,saveLastSuccess:async time=>{
   const before=await store.read();await store.update(before.revision,{lastSuccess:time});this.notify({type:'complete',count:completed?.saved.length??0})
  },backup:retention=>options.gate.run(async()=>{
   const result=await options.run(retention)
   const failures=[...(result.application?.status==='failed'?[`应用数据：${result.application.message||'备份未完成'}`]:[]),...(result.workError!==undefined?[result.workError||'作品备份未完成']:[]),...result.failed.map(item=>`${item.title}：${item.message}`)]
   if(failures.length)throw Error([applicationBackupCompletion(result.application),`已完成 ${result.saved.length} 部作品备份`,...failures].filter(Boolean).join('；'))
   completed=result;return result
  }),onError:error=>this.notify({type:'error',message:error instanceof Error?error.message:'自动备份未完成'})})
 }
 configure(settings:Configuration){this.scheduler.configure({intervalMinutes:settings.backupIntervalMinutes,retention:settings.backupRetention})}
 start(settings:Configuration){this.configure(settings);return this.scheduler.start()}
 runNow(){return this.scheduler.runNow()}
 pause(){return this.scheduler.pause()}
}
