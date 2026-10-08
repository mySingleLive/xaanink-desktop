import assert from 'node:assert/strict'
import {test} from 'node:test'
import {BackupScheduler} from '../../desktop/main/backup-scheduler'
function clock(){let now=0,sequence=0;const timers=new Map<number,{at:number;run:()=>void}>();return{now:()=>now,setTimer:(run:()=>void,ms:number)=>{const key=++sequence;timers.set(key,{at:now+ms,run});return key},clearTimer:(key:unknown)=>{timers.delete(key as number)},advance:async(ms:number)=>{now+=ms;for(const [key,task]of [...timers])if(task.at<=now){timers.delete(key);task.run()}for(let n=0;n<30;n++)await Promise.resolve()},timers}}

test('BS75-01 synchronous reentrant manual requests share one flight and pause waits for the timestamp ACK',async()=>{
 const c=clock(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let calls=0,nested:Promise<string>|undefined,saved=0,paused=false
 let scheduler:BackupScheduler<string>
 scheduler=new BackupScheduler({clock:c,loadLastSuccess:async()=>null,backup:async()=>{calls++;nested=scheduler.runNow();return 'verified-backup'},saveLastSuccess:async()=>{entered.resolve();await release.promise;saved++},onError:()=>{throw Error('unexpected scheduled observer')}})
 scheduler.configure({intervalMinutes:1,retention:2});await scheduler.start();const first=scheduler.runNow();await entered.promise
 assert.equal(nested,first);assert.equal(calls,1)
 const pause=scheduler.pause().then(()=>{paused=true});scheduler.configure({intervalMinutes:2,retention:4});await c.advance(600000)
 assert.equal(calls,1);assert.equal(saved,0);assert.equal(paused,false);assert.equal(c.timers.size,0);await assert.rejects(scheduler.runNow(),/暂停/)
 release.resolve();assert.equal(await first,'verified-backup');await pause;assert.equal(saved,1);assert.equal(c.timers.size,0)
})

test('BS75-02 failure observers can synchronously pause the schedule without leaving a retry timer or claiming success',async()=>{
 const c=clock();let calls=0,writes=0,errors=0,pause:Promise<void>|undefined
 const scheduler=new BackupScheduler({clock:c,loadLastSuccess:async()=>null,backup:async()=>{calls++;return 'verified'},saveLastSuccess:async()=>{writes++;throw Error('controlled persist failure')},onError:()=>{errors++;pause=scheduler.pause()}})
 scheduler.configure({intervalMinutes:1,retention:2});await scheduler.start();await c.advance(60000);await pause
 assert.equal(calls,1);assert.equal(writes,1);assert.equal(errors,1);assert.equal(c.timers.size,0)
 await c.advance(600000);assert.equal(calls,1);await assert.rejects(scheduler.runNow(),/暂停/)
})
