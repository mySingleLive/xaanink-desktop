import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Worker} from 'node:worker_threads'
import {mkdtemp,mkdir,rm,rename,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {build} from 'esbuild'
import {RpcPeer} from '../../desktop/service/rpc'
import {DirectoryAuthority} from '../../desktop/main/directory-authority'
import {WorkBackupManager} from '../../desktop/main/work-backup-manager'
import {BusinessGate} from '../../desktop/main/business-gate'
import type {WorkBackupBatch,WorkBackupResult} from '../../desktop/shared/work-backup'
import {defaultState} from '../../desktop/core/settings'
import {freezeTaskDefaults} from '../../desktop/shared/task-defaults'

test('BW77-01 main manager calls the actual built worker, keeps good copies in a partial batch and resumes after a real worker restart', {timeout:120000},async()=>{
 const compilation=await mkdtemp(join(process.cwd(),'tests/.review77-worker-')),base=await mkdtemp(join(tmpdir(),'xuanxiang-review77-worker-')),root=join(base,'app'),entry=join(compilation,'service.cjs')
 const clock={time:0,timer:undefined as {run:()=>void;at:number}|undefined,now(){return this.time},setTimer(run:()=>void,ms:number){return this.timer={run,at:this.time+ms}},clearTimer(){this.timer=undefined},tick(ms:number){this.time+=ms;if(this.timer&&this.timer.at<=this.time){const run=this.timer.run;this.timer=undefined;run()}}},gate=new BusinessGate(),errorNotice=Promise.withResolvers<string>()
 let worker:Worker|undefined,rpc:RpcPeer|undefined;const notices:unknown[]=[]
 const manager=new WorkBackupManager({root,clock,gate,run:retention=>rpc!.call<WorkBackupBatch>('work-backup',{type:'now',retention}),notify:notice=>{notices.push(notice);if(notice.type==='error')errorNotice.resolve(notice.message)}})
 async function boot(){worker=new Worker(entry,{workerData:{root,migrations:join(process.cwd(),'prisma/migrations')}});rpc=new RpcPeer(worker,async method=>{if(method==='model.defaults')return freezeTaskDefaults(defaultState.settings.agent,0);throw Error(`unexpected external request ${method}`)});const current=rpc;worker.on('error',()=>current.dispose());worker.on('exit',()=>current.dispose());await rpc.call('ready')}
 async function closeWorker(){if(rpc)await rpc.call('close');rpc?.dispose();await worker?.terminate();rpc=undefined;worker=undefined}
 async function create(title:string){const path=join(base,title);await mkdir(path);const authority=new DirectoryAuthority(),grant=await authority.issue(path,'create-work','review77');await rpc!.call('create-work',{selection:await authority.consume(grant.id,'create-work','review77'),input:{title,requestId:`review77-${title}`}});return{path,id:JSON.parse(await readFile(join(path,'xuanxiang-work.json'),'utf8')).id as string}}
 try{
  await build({bundle:true,platform:'node',target:'node24',format:'cjs',packages:'external',entryPoints:['desktop/service/index.ts'],outfile:entry,define:{'import.meta.url':'__desktopImportMetaUrl'},banner:{js:'var __desktopImportMetaUrl = require("node:url").pathToFileURL(__filename).href;'}})
  await boot();const unavailable=await create('不可读作品'),good=await create('可读作品');await rpc!.call('close');await rename(join(unavailable.path,'database'),join(unavailable.path,'held-database'))
  await manager.start({backupIntervalMinutes:1,backupRetention:1});clock.tick(60000);assert.match(await errorNotice.promise,/已完成 1.*不可读作品/);await manager.pause()
  const partial=await rpc!.call<WorkBackupResult>('work-backup',{type:'list',workId:good.id});assert.equal(partial.type,'list');if(partial.type!=='list')throw Error('type');assert.equal(partial.backups.length,1)
  await assert.rejects(readFile(join(root,'backup-plan.json')),/ENOENT/);assert.ok(await readFile(join(unavailable.path,'held-database','PG_VERSION')))
  await closeWorker();await rename(join(unavailable.path,'held-database'),join(unavailable.path,'database'));await boot()
  await manager.start({backupIntervalMinutes:1,backupRetention:1});const batch=await manager.runNow();assert.equal(batch.saved.length,2);assert.equal(batch.failed.length,0);assert.equal(JSON.parse(await readFile(join(root,'backup-plan.json'),'utf8')).value.lastSuccess,60000)
  const complete=await rpc!.call<WorkBackupResult>('work-backup',{type:'list',workId:good.id});assert.equal(complete.type,'list');if(complete.type!=='list')throw Error('type');assert.equal(complete.backups.length,1);assert.ok(notices.some((notice:any)=>notice.type==='complete'&&notice.count===2))
  await manager.pause();await gate.close();await closeWorker();gate.reopen();await boot();await manager.start({backupIntervalMinutes:5,backupRetention:1});assert.equal(clock.timer?.at,360000);await manager.pause();assert.equal(clock.timer,undefined)
 }finally{await manager.pause();await closeWorker().catch(()=>{});await rm(base,{recursive:true,force:true});await rm(compilation,{recursive:true,force:true})}
})
