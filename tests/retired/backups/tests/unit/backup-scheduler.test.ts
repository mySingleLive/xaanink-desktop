import assert from 'node:assert/strict'
import {test} from 'node:test'
import {BackupScheduler} from '../../desktop/main/backup-scheduler'
function clock(){let now=0,id=0;const tasks=new Map<number,{at:number;run:()=>void}>();return{now:()=>now,setTimer:(run:()=>void,ms:number)=>{const key=++id;tasks.set(key,{at:now+ms,run});return key},clearTimer:(key:unknown)=>{tasks.delete(key as number)},advance:async(ms:number)=>{now+=ms;for(const [key,task]of [...tasks])if(task.at<=now){tasks.delete(key);task.run()}for(let n=0;n<20;n++)await Promise.resolve()},tasks}}
test('interval boundary, persisted baseline, immediate backup and changed settings share one schedule',async()=>{
 const c=clock(),calls:number[]=[],saved:number[]=[],scheduler=new BackupScheduler({clock:c,loadLastSuccess:async()=>null,saveLastSuccess:async time=>{saved.push(time)},backup:async retention=>{calls.push(retention);return{completed:1}},onError:()=>{}})
 scheduler.configure({intervalMinutes:1,retention:2});await scheduler.start();await c.advance(59999);assert.deepEqual(calls,[]);await c.advance(1);assert.deepEqual(calls,[2]);assert.deepEqual(saved,[60000]);await c.advance(59999);assert.equal(calls.length,1)
 scheduler.configure({intervalMinutes:2,retention:3});await c.advance(1);assert.equal(calls.length,1);await scheduler.runNow();assert.deepEqual(calls,[2,3]);await c.advance(119999);assert.equal(calls.length,2);await c.advance(1);assert.equal(calls.length,3);await scheduler.pause();assert.equal(c.tasks.size,0)
 const resumed=new BackupScheduler({clock:c,loadLastSuccess:async()=>saved.at(-1)!,saveLastSuccess:async()=>{},backup:async()=>({completed:1}),onError:()=>{}});resumed.configure({intervalMinutes:2,retention:3});await resumed.start();assert.equal([...c.tasks.values()][0].at,c.now()+120000);await resumed.pause()
})
test('timer/manual overlap is single flight; pause waits for durable completion and blocks new work',async()=>{
 const c=clock(),started=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let calls=0,saved=false,paused=false
 const scheduler=new BackupScheduler({clock:c,loadLastSuccess:async()=>null,saveLastSuccess:async()=>{saved=true},backup:async()=>{calls++;started.resolve();await release.promise;return{completed:1}},onError:()=>{}})
 scheduler.configure({intervalMinutes:1,retention:2});await scheduler.start();const first=scheduler.runNow(),second=scheduler.runNow();assert.equal(first,second);await started.promise;await c.advance(60000);assert.equal(calls,1)
 const pause=scheduler.pause().then(()=>{paused=true});await Promise.resolve();assert.equal(paused,false);await assert.rejects(scheduler.runNow(),/暂停/);release.resolve();await first;await pause;assert.equal(saved,true);assert.equal(c.tasks.size,0)
})
test('failed job or timestamp write does not acknowledge success or create a hot retry loop',async()=>{
 for(const mode of ['job','persist']as const){const c=clock(),errors:string[]=[];let calls=0;const scheduler=new BackupScheduler({clock:c,loadLastSuccess:async()=>null,saveLastSuccess:async()=>{throw Error('persist')},backup:async()=>{calls++;if(mode==='job')throw Error('job');return{completed:1}},onError:error=>errors.push(String(error))})
 scheduler.configure({intervalMinutes:1,retention:2});await scheduler.start();await c.advance(60000);assert.equal(calls,1);assert.equal(errors.length,1);await c.advance(59999);assert.equal(calls,1);await c.advance(1);assert.equal(calls,2);assert.equal(errors.length,2);await scheduler.pause()}
})
