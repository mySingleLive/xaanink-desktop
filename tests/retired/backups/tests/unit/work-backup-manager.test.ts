import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {WorkBackupManager} from '../../desktop/main/work-backup-manager'
import {BusinessGate} from '../../desktop/main/business-gate'
class Clock{time=0;timer:{at:number;run:()=>void}|undefined;now=()=>this.time;setTimer=(run:()=>void,ms:number)=>this.timer={at:this.time+ms,run};clearTimer=()=>{this.timer=undefined};tick(ms:number){this.time+=ms;if(this.timer&&this.timer.at<=this.time){const run=this.timer.run;this.timer=undefined;run()}}}
const configuration={backupIntervalMinutes:1,backupRetention:2}
test('main backup manager persists only a complete batch and surfaces partial failures without suppressing later jobs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xx-backup-manager-')),clock=new Clock(),gate=new BusinessGate(),results:unknown[]=[];let partial=true,calls=0
 const manager=new WorkBackupManager({root,clock,gate,run:async retention=>{calls++;assert.equal(retention,2);return{type:'now',saved:[],failed:partial?[{workId:'work',title:'作品',message:'目录不可读'}]:[]}},notify:value=>results.push(value)})
 try{await manager.start(configuration);await assert.rejects(manager.runNow(),/目录不可读/);assert.equal(calls,1);await assert.rejects(readFile(join(root,'backup-plan.json')),/ENOENT/)
 partial=false;clock.time=4000;await manager.runNow();assert.equal(JSON.parse(await readFile(join(root,'backup-plan.json'),'utf8')).value.lastSuccess,4000);assert.deepEqual(results,[{type:"complete",count:0}])
 await gate.close();await assert.rejects(manager.runNow(),/BUSINESS_CLOSED/);assert.equal(calls,2);gate.reopen();clock.tick(60000);await new Promise(setImmediate);await manager.pause();assert.equal(calls,3)
 }finally{await manager.pause();await rm(root,{recursive:true,force:true})}
})
test('main pause drains accepted backup before worker close; settings changes retain single flight and resume after a window reopens',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xx-backup-manager-')),clock=new Clock(),gate=new BusinessGate(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let calls=0
 const manager=new WorkBackupManager({root,clock,gate,run:async()=>{calls++;entered.resolve();await release.promise;return{type:'now',saved:[],failed:[]}},notify:()=>{}})
 try{await manager.start(configuration);const first=manager.runNow();await entered.promise;const second=manager.runNow();assert.equal(first,second);manager.configure({...configuration,backupIntervalMinutes:5});let paused=false;const pause=manager.pause().then(()=>{paused=true});await new Promise(setImmediate);assert.equal(paused,false);release.resolve();await first;await pause;assert.equal(clock.timer,undefined);await manager.start(configuration);clock.tick(60000);await new Promise(setImmediate);await manager.pause();assert.equal(calls,2)}finally{release.resolve();await manager.pause();await rm(root,{recursive:true,force:true})}
})
