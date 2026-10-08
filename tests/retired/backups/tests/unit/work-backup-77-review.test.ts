import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import fs,{mkdtemp,rm,readFile,writeFile,realpath,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {syncBuiltinESMExports} from 'node:module'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {WorkBackupManager} from '../../desktop/main/work-backup-manager'
import {WorkBackupControl} from '../../desktop/service/work-backup-control'
import {BusinessGate} from '../../desktop/main/business-gate'
import {WorkBackups,type BackupSnapshot} from '../../desktop/core/work-backups'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {collectClosedRootFiles} from '../../desktop/main/owned-root-files'

class Clock{
 time=0;timer:{at:number;run:()=>void}|undefined
 now=()=>this.time
 setTimer=(run:()=>void,ms:number)=>this.timer={at:this.time+ms,run}
 clearTimer=()=>{this.timer=undefined}
 tick(ms:number){this.time+=ms;if(this.timer&&this.timer.at<=this.time){const run=this.timer.run;this.timer=undefined;run()}}
}
const settings={backupIntervalMinutes:1,backupRetention:2}
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve))
async function root(){return realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review77-')))}
function closeDataCode(){
 const file=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
 let callback:ts.Expression|undefined
 const visit=(node:ts.Node)=>{if(ts.isNewExpression(node)&&node.expression.getText(file)==='CloseCoordinator')for(const argument of node.arguments??[])if(ts.isObjectLiteralExpression(argument))for(const member of argument.properties)if(ts.isPropertyAssignment(member)&&member.name.getText(file)==='closeData')callback=member.initializer;ts.forEachChild(node,visit)}
 visit(file);assert.ok(callback);return transformSync(`return ${callback.getText(file)}`,{loader:'ts'}).code
}

test('BC77-01 the actual main closeData waits for the accepted entire batch and durable plan before worker close',async()=>{
 const directory=await root(),gate=new BusinessGate(),clock=new Clock(),entered=Promise.withResolvers<void>(),finish=Promise.withResolvers<void>(),events:string[]=[];let serviceClosed=false
 const manager=new WorkBackupManager({root:directory,clock,gate,run:async()=>{events.push('backup-enter');entered.resolve();await finish.promise;events.push('backup-finish');return{type:'now',saved:[],failed:[]}},notify:()=>events.push('durable-notice')})
 const dependencies={window:null,recoveryExports:{flush:async()=>{}},fileExports:{flush:async()=>{}},configurationFiles:{flush:async()=>events.push('configuration-flush')},modelConfiguration:{},avatarAssets:{},workBackups:manager,businessGate:gate,responseOwners:new Map(),repository:{read:async()=>events.push('repository-read')},service:{call:async(method:string)=>{assert.equal(method,'close');assert.ok(await readFile(join(directory,'backup-plan.json')));serviceClosed=true;events.push('worker-close')}},migrationHandoff:{armClosed:async()=>events.push('arm')},businessClosed:false}
 const actualClose=new Function(...Object.keys(dependencies),closeDataCode())(...Object.values(dependencies)) as ()=>Promise<void>
 try{
  await manager.start(settings);const saving=manager.runNow();await entered.promise
  const closing=actualClose();await turn();assert.equal(gate.closed,true);assert.equal(serviceClosed,false);await assert.rejects(gate.run(async()=>{}),/BUSINESS_CLOSED/);await assert.rejects(manager.runNow(),/暂停/)
  finish.resolve();await saving;await closing;assert.equal(serviceClosed,true);assert.ok(events.indexOf('backup-finish')<events.indexOf('durable-notice'));assert.ok(events.indexOf('durable-notice')<events.indexOf('worker-close'));assert.ok(events.indexOf('worker-close')<events.indexOf('arm'));assert.equal(clock.timer,undefined)
 }finally{finish.resolve();await manager.pause();await rm(directory,{recursive:true,force:true})}
})

test('BC77-02 automatic partial worker batches preserve each successful receipt, surface failure once, and retry with newly confirmed retention',async()=>{
 const directory=await root(),clock=new Clock(),gate=new BusinessGate(),a=randomUUID(),b=randomUUID(),observed:Array<[string,number]>=[],notices:unknown[]=[];let partial=true
 const receipt={id:randomUUID(),workId:b,title:'有效作品',createdAt:new Date().toISOString(),bytes:1,assetCount:0,sha256:'a'.repeat(64)}
 const control=new WorkBackupControl({list:async()=>[{id:a,title:'暂不可用'},{id:b,title:'有效作品'}],backup:async(id,retention)=>{observed.push([id,retention]);if(partial&&id===a)throw Error('受控目录不可读');return{...receipt,workId:id}},backups:async()=>[],prepareRestore:async()=>{throw Error('unexpected')},cancelRestore:async()=>{},activateRestore:async()=>{throw Error('unexpected')}})
 const manager=new WorkBackupManager({root:directory,clock,gate,run:async retention=>{const result=await control.handle({type:'now',retention});assert.equal(result.type,'now');if(result.type!=='now')throw Error('type');return result},notify:value=>notices.push(value)})
 try{
  await manager.start(settings);clock.tick(60000);await turn();await manager.pause()
  assert.deepEqual(observed,[[a,2],[b,2]]);assert.equal(notices.length,1);assert.match(JSON.stringify(notices[0]),/已完成 1.*受控目录不可读/);await assert.rejects(readFile(join(directory,'backup-plan.json')),/ENOENT/)
  partial=false;await manager.start({...settings,backupRetention:1});const result=await manager.runNow();assert.equal(result.saved.length,2);assert.deepEqual(observed.slice(2),[[a,1],[b,1]]);assert.equal(JSON.parse(await readFile(join(directory,'backup-plan.json'),'utf8')).value.lastSuccess,60000)
 }finally{await manager.pause();await rm(directory,{recursive:true,force:true})}
})

test('BC77-03 a real plan-write failure cannot announce completion or prevent explicit later success',async()=>{
 const directory=await root(),clock=new Clock(),gate=new BusinessGate(),notices:unknown[]=[],realRename=fs.rename;let calls=0,injected=false
 const manager=new WorkBackupManager({root:directory,clock,gate,run:async()=>{calls++;return{type:'now',saved:[],failed:[]}},notify:value=>notices.push(value)})
 try{
  await manager.start(settings)
  fs.rename=(async(...args:Parameters<typeof realRename>)=>{if(!injected&&String(args[1])===join(directory,'backup-plan.json')){injected=true;throw Error('controlled plan persistence failure')}return realRename(...args)}) as typeof realRename;syncBuiltinESMExports()
  await assert.rejects(manager.runNow(),/controlled plan persistence failure/);assert.equal(injected,true);assert.equal(notices.length,0);await assert.rejects(readFile(join(directory,'backup-plan.json')),/ENOENT/)
  fs.rename=realRename;syncBuiltinESMExports();clock.time=12345;await manager.runNow();assert.equal(calls,2);assert.deepEqual(notices,[{type:'complete',count:0}]);assert.equal(JSON.parse(await readFile(join(directory,'backup-plan.json'),'utf8')).value.lastSuccess,12345)
 }finally{fs.rename=realRename;syncBuiltinESMExports();await manager.pause();await rm(directory,{recursive:true,force:true})}
})

test('BC77-04 pause waits for an in-flight durable plan read and reopen uses the latest confirmed configuration',async()=>{
 const directory=await root(),clock=new Clock(),gate=new BusinessGate(),readEntered=Promise.withResolvers<void>(),readRelease=Promise.withResolvers<void>(),realRead=fs.readFile;let held=false,calls=0,paused=false
 await writeFile(join(directory,'backup-plan.json'),JSON.stringify({schemaVersion:1,revision:1,value:{lastSuccess:100}}));clock.time=1000
 const manager=new WorkBackupManager({root:directory,clock,gate,run:async retention=>{assert.equal(retention,1);calls++;return{type:'now',saved:[],failed:[]}},notify:()=>{}})
 try{
  fs.readFile=(async(...args:any[])=>{if(!held&&String(args[0])===join(directory,'backup-plan.json')){held=true;readEntered.resolve();await readRelease.promise}return Reflect.apply(realRead,fs,args)}) as typeof realRead;syncBuiltinESMExports()
  const starting=manager.start(settings);await readEntered.promise;const pause=manager.pause().then(()=>{paused=true});manager.configure({...settings,backupRetention:1});await turn();assert.equal(paused,false);assert.equal(clock.timer,undefined)
  readRelease.resolve();await starting;await pause;assert.equal(clock.timer,undefined);await assert.rejects(manager.runNow(),/暂停/)
  fs.readFile=realRead;syncBuiltinESMExports();await manager.start({...settings,backupRetention:1});clock.tick(59100);await turn();await manager.pause();assert.equal(calls,1)
 }finally{readRelease.resolve();fs.readFile=realRead;syncBuiltinESMExports();await manager.pause();await rm(directory,{recursive:true,force:true})}
})

test('BC77-05 protected backup IDs are captured before asynchronous work and never substitute for the normal retention count',async()=>{
 const directory=await root(),workId=randomUUID(),store=new WorkBackups(directory,workId,{pglite:'0.5.8',postgresMajor:18}),snapshot:BackupSnapshot={work:{schemaVersion:1,id:workId,phase:'ready',novelId:'review',title:'固定备份',requestId:'review',requestHash:'review',createdAt:new Date().toISOString()},engine:{pglite:'0.5.8',postgres:'18.3',migrations:[]},database:Buffer.from('controlled engine bytes'),assets:[]}
 try{
  const pinned=await store.create(snapshot,1),ids=[pinned.id],first=store.create(snapshot,1,ids);ids.length=0;await first
  const next=await store.create(snapshot,1,[pinned.id]);assert.equal((await store.list()).length,2);assert.equal((await store.read(pinned.id)).receipt.sha256,pinned.sha256);assert.ok((await store.list()).some(row=>row.id===next.id))
  const before=await readdir(join(directory,'backups'));await assert.rejects(store.create(snapshot,1,[randomUUID(),'../../anything']));assert.deepEqual(await readdir(join(directory,'backups')),before)
 }finally{await rm(directory,{recursive:true,force:true})}
})

test('BC77-06 a late older confirmed state cannot roll back the actual main backup timer or retention',async()=>{
 const directory=await root(),clock=new Clock(),gate=new BusinessGate(),retentions:number[]=[]
 const manager=new WorkBackupManager({root:directory,clock,gate,run:async retention=>{retentions.push(retention);return{type:'now',saved:[],failed:[]}},notify:()=>{}})
 const file=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true),refresh=file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='refreshMenus')
 let send:ts.VariableDeclaration|undefined
 for(const statement of file.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(declaration.name.getText(file)==='send')send=declaration
 assert.ok(refresh);assert.ok(send)
 const code=transformSync(`let menuRevision=-1;let menuShortcuts={};const ${send.getText(file)};${refresh.getText(file)};return send`,{loader:'ts'}).code
 const deliver=new Function('workBackups','window','app','Menu','menuTemplate',code)(manager,null,{isReady:()=>false},{},()=>[]) as (event:unknown)=>void
 try{
  await manager.start(settings)
  deliver({type:'state',state:{revision:5,settings:{general:{backupIntervalMinutes:5,backupRetention:1},shortcuts:{darwin:{},win32:{}}}}})
  assert.equal(clock.timer?.at,300000)
  deliver({type:'state',state:{revision:4,settings:{general:{backupIntervalMinutes:1,backupRetention:50},shortcuts:{darwin:{},win32:{}}}}})
  assert.equal(clock.timer?.at,300000,'a confirmed newer interval remains effective after a late old reply')
  clock.tick(300000);await turn();await manager.pause();assert.deepEqual(retentions,[1])
 }finally{await manager.pause();await rm(directory,{recursive:true,force:true})}
})

test('BC77-07 the actual closed-root inventory and migrator preserve the durable plan and resume its deadline at the new root',async()=>{
 const base=await root(),source=join(base,'old'),target=join(base,'new'),boot=join(base,'boot'),clock=new Clock(),gate=new BusinessGate();let manager:WorkBackupManager|undefined
 try{
  for(const path of [source,target,boot])await fs.mkdir(path);await fs.mkdir(join(source,'inbox','database'),{recursive:true})
  await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}));await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));await writeFile(join(source,'inbox','database','PG_VERSION'),'18')
  const plan=JSON.stringify({schemaVersion:1,revision:3,value:{lastSuccess:120000}});await writeFile(join(source,'backup-plan.json'),plan);await writeFile(join(source,'backup-other.json'),'unmanaged neighboring bytes')
  const roots=new DataRootManager(boot,source),original=await roots.adopt(await directoryIdentity(source)),owned=await collectClosedRootFiles(original.root,()=>{})
  assert.ok(owned.files.includes('backup-plan.json'));assert.ok(owned.preserved.includes('backup-other.json'))
  const moved=await roots.migrate(await directoryIdentity(target),{quiesce:async()=>({source:original.root,ownedFiles:owned.files,ownedDirectories:owned.directories,assertClosed(){},release(){}})})
  assert.equal(moved.status,'complete');assert.equal(await readFile(join(target,'backup-plan.json'),'utf8'),plan);assert.equal(await readFile(join(source,'backup-other.json'),'utf8'),'unmanaged neighboring bytes')
  clock.time=240000;manager=new WorkBackupManager({root:target,clock,gate,run:async()=>{throw Error('not due yet')},notify:()=>{}});await manager.start({backupIntervalMinutes:5,backupRetention:1});assert.equal(clock.timer?.at,420000)
 }finally{await manager?.pause();await rm(base,{recursive:true,force:true})}
})
