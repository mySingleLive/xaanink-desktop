import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Worker} from 'node:worker_threads'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath,cp} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {build} from 'esbuild'
import {PGlite} from '@electric-sql/pglite'
import {Workspaces} from '../../desktop/service/workspaces'
import {LocalTemplateLibrary} from '../../desktop/service/template-library'
import {ApplicationBackups} from '../../desktop/core/application-backups'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {RpcPeer} from '../../desktop/service/rpc'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
import {prisma} from '../../src/lib/db'
import {defaultState} from '../../desktop/core/settings'
import {freezeTaskDefaults} from '../../desktop/shared/task-defaults'
import type {LocalResponse} from '../../desktop/shared/ipc'
import type {ApplicationBackupControlResult} from '../../desktop/shared/application-backup-control'

test('AI27-01 actual built worker holds original inbox lease through verified backup/cleanup/close and roundtrips global templates and unassociated chat',{timeout:600000},async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xx-app-worker27-'))),root=join(base,'app'),compilation=await mkdtemp(join(process.cwd(),'.tmp-app-worker27-')),entry=join(compilation,'worker.cjs'),works=new Workspaces(root,join(process.cwd(),'prisma/migrations'))
 let worker:Worker|undefined,rpc:RpcPeer|undefined,inspection:PGlite|undefined
 async function request(path:string,method='GET',body?:unknown){
  const id=randomUUID(),response=await rpc!.call<LocalResponse>('start',{version:1,id,path,method,headers:body?{'content-type':'application/json'}:{},body:body?new Uint8Array(Buffer.from(JSON.stringify(body))):undefined}),chunks:Uint8Array[]=[]
  for(;;){const frame=await rpc!.call<{done:boolean;bytes?:Uint8Array}>('read',id);if(frame.done)break;chunks.push(frame.bytes!)}
  return{status:response.status,data:JSON.parse(Buffer.concat(chunks).toString('utf8'))}
 }
 try{
  await works.initialize();const library=new LocalTemplateLibrary({prompts:[],wizardTemplates:[]})
  await works.runWithGlobal('inbox',async()=>{
   await library.initialize();await library.createPrompt({key:'application-worker27-proof',name:'原全局用户模板',content:'保持原文 {{idea}}',variables:['idea']})
   await library.saveWizard({template:{id:'worker27-wizard',cat:'theme',title:'原自定义向导',summary:'未关联作品的全局库',channels:[],genres:[],tags:[],prompt:'全局向导原字节'},enabled:true})
   await prisma.aIModel.create({data:{id:'worker27-reference',name:'原历史引用',provider:'openai',modelId:'fixture',apiKeyEncrypted:'',inputCostPer1k:0,outputCostPer1k:0,enabled:false,kind:'TEXT'}})
   await prisma.conversation.create({data:{id:'worker27-chat',userId:'local-author',novelId:null,title:'无作品会话',modelId:'worker27-reference',messages:{create:{id:'worker27-message',role:'USER',content:'从未提交给模型的原消息'}}}})
  })
  await works.close()
  const offline=join(base,'offline-work');await mkdir(offline);await writeFile(join(offline,'author-file'),'独立作品原字节不能进入应用包');const offlineIdentity=await directoryIdentity(offline)
  await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[{id:randomUUID(),path:offline,identity:{device:offlineIdentity.device,inode:offlineIdentity.inode},novelId:'offline-fixture',title:'合法独立作品索引',requestId:'worker27-offline',requestHash:'fixture',createdAt:new Date().toISOString()}]}))
  const state=structuredClone(defaultState);state.settings.appearance.theme='ink';const stateBytes=JSON.stringify({schemaVersion:1,revision:7,value:state});await writeFile(join(root,'state.json'),stateBytes);await writeFile(join(root,'author-note'),'未知应用邻居保留')
  await build({bundle:true,platform:'node',target:'node24',format:'cjs',packages:'external',entryPoints:['desktop/service/index.ts'],outfile:entry,define:{'import.meta.url':'__desktopImportMetaUrl'},banner:{js:'var __desktopImportMetaUrl=require("node:url").pathToFileURL(__filename).href;'}})
  worker=new Worker(entry,{workerData:{root,migrations:join(process.cwd(),'prisma/migrations')}})
  const metadataGate=new ApplicationMetadataGate();rpc=new RpcPeer(worker,async (method,value)=>{if(method==='application.capture.acquire')return metadataGate.acquire();if(method==='application.capture.release'){metadataGate.release(String(value));return true}if(method==='model.defaults')return freezeTaskDefaults(defaultState.settings.agent,0);throw Error('Unexpected external request '+method)});const current=rpc;worker.on('error',()=>current.dispose());worker.on('exit',()=>current.dispose())
  await rpc.call('ready');await assert.rejects(rpc.call('application-backup',{type:'now',retention:1,path:base}),/APPLICATION_BACKUP_ACTION_INVALID/)
  const events:string[]=[],backupFlight=rpc.call<ApplicationBackupControlResult>('application-backup',{type:'now',retention:2}).then(result=>{events.push('backup');return result})
  // Observe actual capture entry before requesting close, rather than proving
  // a waiter using a fixed timer or a fabricated closed flag.
  for(let n=0;;n++){let entries:string[]=[];try{entries=await readdir(join(root,'backups/application/staging'))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}if(entries.length||events.includes('backup'))break;if(n>3000)throw Error('actual capture never started');await delay(10)}
  const closeFlight=rpc.call('close').then(()=>{events.push('closed')});const result=await backupFlight;await closeFlight;assert.deepEqual(events,['backup','closed'])
  assert.equal(result.type,'now');if(result.type!=='now')throw Error('type');assert.deepEqual(result.backup.retained,[]);assert.equal(result.backup.cleanupPending,0);assert.equal(JSON.stringify(result).includes(root),false)
  assert.deepEqual(await readdir(join(root,'backups/application/staging')),[]);assert.deepEqual(await readdir(join(root,'backups/application/validation')),[])
  const metadata=JSON.parse(await readFile(join(root,'backups/application/packages',result.backup.id,'xuanxiang-app-backup.json'),'utf8'))
  assert.equal(metadata.phase,'verified');assert.equal(metadata.appId,result.backup.appId);assert.ok(metadata.files.every((file:{path:string})=>!file.path.includes('author-file')&&!file.path.includes('author-note')))
  const store=new ApplicationBackups(await directoryIdentity(join(root,'backups/application/packages')),result.backup.appId,metadata.engine,{assertOwner:async()=>{},assertClosed:async()=>{throw Error('read must not close source')},verifyCaptured:async()=>{throw Error('read must not create')}}),proof=await store.inspect(result.backup.id)
  assert.equal(await readFile(join(proof.data.path,'state.json'),'utf8'),stateBytes)
  const copied=join(base,'inspection');await cp(join(proof.data.path,'inbox/database'),copied,{recursive:true});inspection=await PGlite.create({dataDir:copied,relaxedDurability:false})
  assert.deepEqual((await inspection.query('SELECT name,content,variables FROM "PromptTemplate" WHERE key=$1',['application-worker27-proof'])).rows,[{name:'原全局用户模板',content:'保持原文 {{idea}}',variables:['idea']}])
  assert.deepEqual((await inspection.query('SELECT title,"novelId","modelId" FROM "Conversation" WHERE id=$1',['worker27-chat'])).rows,[{title:'无作品会话',novelId:null,modelId:'worker27-reference'}])
  assert.deepEqual((await inspection.query('SELECT content FROM "Message" WHERE id=$1',['worker27-message'])).rows,[{content:'从未提交给模型的原消息'}]);assert.deepEqual((await inspection.query('SELECT "apiKeyEncrypted",enabled FROM "AIModel" WHERE id=$1',['worker27-reference'])).rows,[{apiKeyEncrypted:'',enabled:false}])
  assert.equal((await inspection.query<{n:number}>('SELECT count(*)::int AS n FROM "Novel"')).rows[0].n,0)
  const global=(await inspection.query<{value:{wizardTemplates:Array<{template:{id:string;prompt:string}}>}}>('SELECT value FROM "SystemConfig" WHERE key=$1',['desktop.template-library.v1'])).rows[0].value;assert.ok(global.wizardTemplates.some(row=>row.template.id==='worker27-wizard'&&row.template.prompt==='全局向导原字节'));await inspection.close();inspection=undefined
  const listed=await rpc.call<ApplicationBackupControlResult>('application-backup',{type:'list'});assert.deepEqual(listed,{type:'list',backups:[{id:result.backup.id,appId:result.backup.appId,createdAt:result.backup.createdAt,bytes:result.backup.bytes}]})
  await assert.rejects(rpc.call('closed-work-lease-target',randomUUID()),/尚未关闭/)
  const saved=await request('/api/admin/prompts','POST',{key:'worker27-after',name:'备份后仍可写',content:'通过原handler写入'});assert.equal(saved.status,201);assert.ok((await request('/api/admin/prompts')).data.prompts.some((row:{key:string})=>row.key==='worker27-after'))
  assert.equal(await readFile(join(offline,'author-file'),'utf8'),'独立作品原字节不能进入应用包');assert.equal(await readFile(join(root,'author-note'),'utf8'),'未知应用邻居保留');await rpc.call('close')
 }finally{await inspection?.close();await rpc?.call('close').catch(()=>{});rpc?.dispose();await worker?.terminate();await works.close();await rm(base,{recursive:true,force:true});await rm(compilation,{recursive:true,force:true})}
})
