import {z} from 'zod'
interface Clock {now():number;setTimer(run:()=>void,ms:number):unknown;clearTimer(timer:unknown):void}
const systemClock:Clock={now:Date.now,setTimer:(run,ms)=>{const timer=setTimeout(run,ms);timer.unref();return timer},clearTimer:timer=>clearTimeout(timer as NodeJS.Timeout)}
interface Options<T>{clock?:Clock;loadLastSuccess():Promise<number|null>;saveLastSuccess(time:number):Promise<void>;backup(retention:number):Promise<T>;onError(error:unknown):void}
const configuration=z.object({intervalMinutes:z.number().int().min(1).max(1440),retention:z.number().int().min(1).max(1000)}).strict()
/** Main owns the timer; the worker owns consistent exports. Only durable completion advances success. */
export class BackupScheduler<T>{
 private clock:Clock
 private configured:{intervalMinutes:number;retention:number}|undefined
 private timer:unknown
 private active=false
 private generation=0
 private baseline=0
 private flight:Promise<T>|null=null
 private starting:Promise<void>|null=null
 constructor(private options:Options<T>){this.clock=options.clock??systemClock}
 configure(value:{intervalMinutes:number;retention:number}){const next=configuration.parse(value);this.configured=next;if(this.active&&!this.starting&&!this.flight)this.arm()}
 private clear(){if(this.timer!==undefined){this.clock.clearTimer(this.timer);this.timer=undefined}}
 private arm(){
  this.clear();if(!this.active||!this.configured||this.flight)return
  const delay=Math.max(0,this.baseline+this.configured.intervalMinutes*60000-this.clock.now())
  this.timer=this.clock.setTimer(()=>{this.timer=undefined;void this.runNow().catch(error=>{try{this.options.onError(error)}catch{/* an observer cannot interrupt the next scheduled attempt */}})},delay)
 }
 start():Promise<void>{
  if(this.starting)return this.starting
  if(this.active)return Promise.resolve()
  if(!this.configured)return Promise.reject(Error('尚未配置自动备份'))
  const generation=++this.generation;this.active=true
  const work=Promise.resolve().then(async()=>{
   const saved=await this.options.loadLastSuccess();if(saved!==null&&(!Number.isSafeInteger(saved)||saved<0))throw Error('备份计划时间无效')
   if(!this.active||generation!==this.generation)return
   this.baseline=saved===null?this.clock.now():Math.min(saved,this.clock.now())
  }).catch(error=>{if(generation===this.generation)this.active=false;throw error}).finally(()=>{if(this.starting===work)this.starting=null;if(this.active&&generation===this.generation)this.arm()})
  this.starting=work;return work
 }
 runNow():Promise<T>{
  if(!this.active||!this.configured||this.starting)return Promise.reject(Error('备份计划已暂停或尚未准备好'))
  if(this.flight)return this.flight
  this.clear();const retention=this.configured.retention
  const work=Promise.resolve().then(async()=>{const result=await this.options.backup(retention);await this.options.saveLastSuccess(this.clock.now());return result}).finally(()=>{
   this.baseline=this.clock.now();if(this.flight===work)this.flight=null;if(this.active)this.arm()
  })
  this.flight=work;return work
 }
 async pause():Promise<void>{this.active=false;++this.generation;this.clear();await Promise.allSettled([this.starting,this.flight])}
}
