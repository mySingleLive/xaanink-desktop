import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,readdir,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import sharp from 'sharp'
import {Workspaces} from '../../desktop/service/workspaces'
import {ApplicationBackups} from '../../desktop/core/application-backups'
import {directoryIdentity,readMetadata} from '../../desktop/core/root-ownership'
import {assertDirectoryImmediately} from '../../desktop/core/application-backup-files'
import {loadMigrations} from '../../desktop/service/database/migrations'
import {prepareApplicationRestoreWithProof,reSealApplicationRestoreWithProof,cancelApplicationRestore} from '../../desktop/service/database/application-restore'
import {prepareApplicationDraftRetention} from '../../desktop/core/application-restore-drafts'
import {ApplicationRestoreActivation,ApplicationRestoreActivationError,inspectApplicationRestoreActivation} from '../../desktop/core/application-restore-activation'
import {ApplicationRestoreDraftBarrier} from '../../desktop/main/application-restore-draft-barrier'
import {applicationDraftRecoveryItems} from '../../desktop/shared/application-restore'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {DataRootManager} from '../../desktop/core/data-root'
import {startOwnedRoot} from '../../desktop/service/root-startup'
import type {RootIdentity} from '../../desktop/core/data-root'
import packageInfo from '../../package.json'
import {prisma} from '../../src/lib/db'

// Independent original-schema/actual-engine case, executed only in the root's
// serialized PG resource window. No real model, credentials, network or UI.
test('AR102-I01 actual global data/resources survive source loss, cold activation and two inert application draft checkpoints',{timeout:600000},async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review102-pg-'))),source=join(base,'source'),storage=join(base,'packages'),parent=join(base,'native-parent'),boot=join(base,'boot'),retained=join(base,'source-retained'),conversationId=randomUUID(),messageId=randomUUID(),assetId=randomUUID(),modelId=randomUUID(),configKey='review102:'+randomUUID(),workspaces=new Workspaces(source,join(process.cwd(),'prisma/migrations'))
 let sourceClosed=false,target:Workspaces|undefined,passed=false
 const stage=(name:string)=>console.log('AR102 isolated stage:',name),collect=()=>{(globalThis as typeof globalThis&{gc?:()=>void}).gc?.()}
 try{
  await workspaces.initialize();let postgresMajor=0
  await workspaces.runWithGlobal('inbox',async()=>{
   const version=await prisma.$queryRaw<{server_version:string}[]>`SHOW server_version`;postgresMajor=Number(version[0].server_version.split('.')[0]);assert.ok(postgresMajor>0)
   await prisma.aIModel.create({data:{id:modelId,name:'历史模型引用',provider:'openai',modelId:'fixture-history-model',apiKeyEncrypted:'',enabled:false,inputCostPer1k:0,outputCostPer1k:0}})
   await prisma.systemConfig.create({data:{key:configKey,value:{text:'原全局配置',enabled:true}}})
   await prisma.conversation.create({data:{id:conversationId,userId:'local-author',title:'原全局历史会话',modelId}})
   await prisma.message.create({data:{id:messageId,conversationId,role:'ASSISTANT',content:'历史文本必须完整恢复',toolCalls:[{toolName:'fixture-inert-history',result:{approved:true}}]}})
  });await workspaces.close();sourceClosed=true;collect();stage('original schema source initialized, populated and physically closed')
  for(const path of[storage,parent,boot])await mkdir(path)
  await mkdir(join(source,'assets/global'),{recursive:true});const avatar=await sharp({create:{width:3,height:3,channels:4,background:{r:90,g:35,b:13,alpha:1}}}).png().toBuffer();await writeFile(join(source,'assets/global',assetId+'.png'),avatar)
  const root=await directoryIdentity(source),app=await readMetadata(join(source,'xuanxiang-app.json')) as {id:string},migrations=await loadMigrations(join(process.cwd(),'prisma/migrations')),journal=new DraftJournal(source),oldSnapshot={version:1 as const,revision:1,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft:'备份内未发送内容',queuedRequests:[{approved:true,prompt:'不得自动执行'}]}},issues:[]}
  journal.activate('backup');await journal.persist('backup',oldSnapshot)
  const producerHost=(identity:RootIdentity)=>({expectedAppId:app.id,assertOwner(selected:RootIdentity){assert.deepEqual(selected,identity);assertDirectoryImmediately(identity)},assertOwnerImmediately(selected:RootIdentity){assert.deepEqual(selected,identity);assertDirectoryImmediately(identity)}})
  let backups:ApplicationBackups
  backups=new ApplicationBackups(await directoryIdentity(storage),app.id,{pglite:packageInfo.dependencies['@electric-sql/pglite'],postgresMajor},{assertOwner(){},assertClosed(){assert.equal(sourceClosed,true)},async verifyCaptured(backup){const native=join(base,'verify-'+randomUUID());await mkdir(native);const identity=await directoryIdentity(native),host=producerHost(identity),candidate=await prepareApplicationRestoreWithProof(backups,backup.id,identity,migrations,host);await cancelApplicationRestore(identity,candidate.candidate.id,host,async()=>false);collect()}})
  const selected=await backups.create(root,10);collect();stage('actual backup verified through separate real candidate engine')
  journal.activate('latest');await journal.persist('latest',{...oldSnapshot,revision:2,sources:{chat:{draft:'源目录丢失前的最新输入',queuedRequests:[{approved:false,prompt:'仍需保留原文件'}]}}});const latestBytes=await readFile(join(source,'drafts.json')),pointer=await new DataRootManager(boot,source).adopt(root),bootstrap=await directoryIdentity(boot),nativeParent=await directoryIdentity(parent),host=producerHost(nativeParent)
  const prepared=await prepareApplicationRestoreWithProof(backups,selected.id,nativeParent,migrations,host);collect();const operationId=randomUUID(),drafts=await prepareApplicationDraftRetention({appId:app.id,operationId,candidateId:prepared.candidate.id,current:null,backup:prepared.candidate.directory},()=>{}),sealed=await reSealApplicationRestoreWithProof(prepared,drafts);collect();stage('private real-engine candidate resealed with explicit unavailable-source draft provenance')
  // A physically existing root with damaged DB files is not a lost source.
  // Reject before opening that damaged source; do not invent a healthy snapshot.
  const pgPath=join(source,'inbox/database/PG_VERSION'),pgVersion=await readFile(pgPath);await writeFile(pgPath,'damaged');let confirms=0
  const options={assertStableLock(){},assertCold(){assert.equal(sourceClosed,true)},assertOwner(){},async confirm(){confirms++;return true}},activation=new ApplicationRestoreActivation(bootstrap,options),proof={currentRootAvailable:false,beforeSnapshot:null}
  await assert.rejects(activation.prepare('owner',sealed,proof),cause=>cause instanceof ApplicationRestoreActivationError&&cause.code==='APPLICATION_RESTORE_SOURCE_PROOF_INVALID');assert.equal(confirms,0);assert.equal(await readFile(pgPath,'utf8'),'damaged');await writeFile(pgPath,pgVersion)
  await rename(source,retained);const preview=await activation.prepare('owner',sealed,proof);assert.equal(preview.currentRootAvailable,false);assert.equal(preview.beforeSnapshot,null);assert.deepEqual(preview.source,pointer);const result=await activation.activate('owner',preview.operationId);assert.equal(result.requiresColdStart,true);assert.equal(confirms,1);assert.deepEqual(await readFile(join(retained,'drafts.json')),latestBytes);assert.equal((await readdir(boot)).filter(name=>name.startsWith('application-restore-')).length,1);stage('lost source activated only after actual native-style confirmation; original cold bytes retained')
  await assert.rejects(import('node:fs/promises').then(fs=>fs.stat(source)),cause=>(cause as NodeJS.ErrnoException).code==='ENOENT');assert.deepEqual((await inspectApplicationRestoreActivation(bootstrap,options))!.pointer,result.pointer)
  const started=await startOwnedRoot({bootstrap:boot,root:join(base,'never-fallback')},async path=>{assert.equal(path,sealed.candidate.directory.path);target=new Workspaces(path,join(process.cwd(),'prisma/migrations'));await target.initialize();return target})
  await started.value.runWithGlobal('inbox',async()=>{
   assert.deepEqual(await prisma.systemConfig.findUnique({where:{key:configKey}}).then(row=>row!.value),{text:'原全局配置',enabled:true})
   assert.equal((await prisma.conversation.findUnique({where:{id:conversationId}}))!.title,'原全局历史会话');assert.equal((await prisma.message.findUnique({where:{id:messageId}}))!.content,'历史文本必须完整恢复')
   const models=await prisma.aIModel.findMany();assert.deepEqual(models.map(row=>[row.id,row.apiKeyEncrypted,row.enabled]),[[modelId,'',false]]);assert.equal(await prisma.novel.count(),0)
  });await target!.close();target=undefined;collect();stage('actual cold startup reopened original schema at committed target, exact history/config/inert model verified')
  assert.deepEqual(await readFile(join(sealed.candidate.directory.path,'assets/global',assetId+'.png')),avatar)
  const targetJournal=new DraftJournal(sealed.candidate.directory.path);targetJournal.activate('active');const barrier=new ApplicationRestoreDraftBarrier(sealed.candidate.directory.path,targetJournal,{assertOwner(){}}),retention=await barrier.inspect();assert.equal(retention!.currentRootAvailable,false);assert.deepEqual(retention!.snapshots.map(row=>[row.origin,row.snapshot]),[['backup',oldSnapshot]])
  const checkpoint=(revision:number)=>({version:1 as const,revision,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{recovery:{version:1,items:applicationDraftRecoveryItems(retention!)}},issues:[]}),first=await targetJournal.persist('active',checkpoint(10));await barrier.checkpoint(retention!.barrier.token,'active',first);const second=await targetJournal.persist('active',checkpoint(11));await barrier.acknowledge(retention!.barrier.token,'active',second);await barrier.flush();assert.equal((await barrier.inspect())!.barrier.phase,'complete');assert.deepEqual((await targetJournal.read())!.sources,{recovery:{version:1,items:applicationDraftRecoveryItems(retention!)}});assert.equal((await targetJournal.read())!.autosaves.length,0);assert.deepEqual(await readFile(join(retained,'drafts.json')),latestBytes);stage('two actual application journal checkpoints retained old approved requests strictly as inert recovery data')
  passed=true
 }finally{await target?.close();if(!sourceClosed)await workspaces.close();if(passed)await rm(base,{recursive:true,force:true});else console.log('AR102 failed isolated fixture retained:',base)}
})
