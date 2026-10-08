import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,readdir,cp} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import sharp from 'sharp'
import {Workspaces} from '../../desktop/service/workspaces'
import {ApplicationBackups} from '../../desktop/core/application-backups'
import {directoryIdentity,readMetadata} from '../../desktop/core/root-ownership'
import {loadMigrations} from '../../desktop/service/database/migrations'
import {prepareApplicationRestore,verifyApplicationRestore,cancelApplicationRestore} from '../../desktop/service/database/application-restore'
import {LocalTemplateLibrary} from '../../desktop/service/template-library'
import {prisma} from '../../src/lib/db'
import packageInfo from '../../package.json'
import {defaultState} from '../../desktop/core/settings'
import {DraftJournal} from '../../desktop/main/draft-journal'

test('APP17-I01: closed original global templates and unassociated chat roundtrip from a portable package despite missing current source',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-apprestore17-'))),source=join(base,'source'),storage=join(base,'backup'),selected=join(base,'selected'),works=new Workspaces(source,join(process.cwd(),'prisma/migrations'))
 let closed=false,engine:PGlite|undefined
 try{
  await works.initialize();const library=new LocalTemplateLibrary({prompts:[],wizardTemplates:[]});let postgresMajor=0
  await works.runWithGlobal('inbox',async()=>{
   await library.initialize();await library.createPrompt({key:'local-backup-proof',name:'用户自定义模板',content:'原作者提示词 {{idea}}',variables:['idea']})
   await library.saveWizard({template:{id:'local-wizard-proof',cat:'theme',title:'用户自定义向导',summary:'原向导完整保留',channels:[],genres:[],tags:[],prompt:'原作者向导提示词'},enabled:true})
   await prisma.aIModel.create({data:{id:'reference-proof',name:'历史的不可调用模型引用',provider:'openai',modelId:'gpt-5-fixture',apiKeyEncrypted:'',inputCostPer1k:0,outputCostPer1k:0,enabled:false,kind:'TEXT'}})
   await prisma.conversation.create({data:{id:'inbox-recovery-proof',userId:'local-author',title:'无作品的原会话',modelId:'reference-proof',thinkingEffort:null,messages:{create:{id:'inbox-message-proof',role:'USER',content:'尚未发往模型的完整对话历史'}}}})
   const version=await prisma.$queryRaw<{server_version:string}[]>`SHOW server_version`;postgresMajor=Number(version[0].server_version.split('.')[0])
  })
  await works.close();closed=true
  await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
  const avatarId=randomUUID(),state=structuredClone(defaultState);state.settings.user.avatarAssetId=avatarId
  state.models.push({id:randomUUID(),name:'密文原样保留',provider:'openai',protocol:'openai',modelId:'gpt-fixture',endpoint:'https://fixture.invalid/v1',kind:'TEXT',contextWindow:128000,enabled:false,authRevision:1,encryptedKey:'os-protected-fixture-no-real-key',keyMask:'••••••••',thinkingLevels:[],defaultThinking:'default'})
  await writeFile(join(source,'state.json'),JSON.stringify({schemaVersion:1,revision:7,value:state}))
  await mkdir(join(source,'assets/global'),{recursive:true});const avatar=await sharp({create:{width:4,height:4,channels:4,background:{r:80,g:60,b:40,alpha:1}}}).png().toBuffer();await writeFile(join(source,'assets/global',avatarId+'.png'),avatar)
  const journal=new DraftJournal(source);journal.activate('fixture-owner');await journal.persist('fixture-owner',{version:1,revision:4,createdAt:new Date().toISOString(),autosaves:[],sources:{chat:{queuedRequest:{id:'never-replay',tool:'submitChapter',payload:{content:'恢复不重放任务'}}}},issues:[]})
  await mkdir(storage);await mkdir(selected)
  const root=await directoryIdentity(source),marker=await readMetadata(join(source,'xuanxiang-app.json')) as {id:string}
  const migrations=await loadMigrations(join(process.cwd(),'prisma/migrations')),host={expectedAppId:marker.id,assertOwner:async()=>{}}
  async function actualVerifier(store:ApplicationBackups,id:string,signal?:AbortSignal){
   const validationParent=join(base,'verification-'+randomUUID());await mkdir(validationParent)
   const proof=await prepareApplicationRestore(store,id,await directoryIdentity(validationParent),migrations,host,signal)
   await cancelApplicationRestore(await directoryIdentity(validationParent),proof.id,host,async()=>false)
  }
  let backups:ApplicationBackups
  backups=new ApplicationBackups(await directoryIdentity(storage),marker.id,{pglite:packageInfo.dependencies['@electric-sql/pglite'],postgresMajor},{assertOwner:async()=>{},assertClosed:async()=>{assert.equal(closed,true)},verifyCaptured:async(backup,signal)=>actualVerifier(backups,backup.id,signal)})
  const receipt=await backups.create(root,2),imported=join(base,'portable');await mkdir(imported);await cp(join(storage,receipt.id),join(imported,receipt.id),{recursive:true})
  await rm(join(source,'inbox/database'),{recursive:true})
  const portable=new ApplicationBackups(await directoryIdentity(imported),marker.id,backups.engine,{assertOwner:async()=>{},assertClosed:async()=>{throw Error('broken current source must never be opened')},verifyCaptured:async()=>{throw Error('read/restore must not create against current source')}})
  const parent=await directoryIdentity(selected)
  const candidate=await prepareApplicationRestore(portable,receipt.id,parent,migrations,host)
  assert.equal(candidate.appId,marker.id);assert.equal(candidate.phase,'ready');assert.equal((await verifyApplicationRestore(parent,candidate.id,host)).id,candidate.id)
  assert.deepEqual(await readFile(join(candidate.directory.path,'state.json')),await readFile(join(source,'state.json')))
  assert.deepEqual(await readFile(join(candidate.directory.path,'drafts.json')),await readFile(join(source,'drafts.json')))
  assert.deepEqual(await readFile(join(candidate.directory.path,'assets/global',avatarId+'.png')),avatar)
  const inspection=join(base,'inspection');await cp(join(candidate.directory.path,'inbox/database'),inspection,{recursive:true})
  engine=await PGlite.create({dataDir:inspection,relaxedDurability:false})
  assert.deepEqual((await engine.query('SELECT name,content,variables FROM "PromptTemplate" WHERE key=$1',['local-backup-proof'])).rows,[{name:'用户自定义模板',content:'原作者提示词 {{idea}}',variables:['idea']}])
  assert.deepEqual((await engine.query('SELECT title,"novelId","modelId" FROM "Conversation" WHERE id=$1',['inbox-recovery-proof'])).rows,[{title:'无作品的原会话',novelId:null,modelId:'reference-proof'}])
  const libraryState=(await engine.query<{value:{wizardTemplates:Array<{template:{id:string;prompt:string};enabled:boolean;source:string}>}}>('SELECT value FROM "SystemConfig" WHERE key=$1',['desktop.template-library.v1'])).rows[0].value
  assert.deepEqual(libraryState.wizardTemplates.map(row=>({id:row.template.id,prompt:row.template.prompt,enabled:row.enabled,source:row.source})),[{id:'local-wizard-proof',prompt:'原作者向导提示词',enabled:true,source:'user'}])
  assert.deepEqual((await engine.query('SELECT "apiKeyEncrypted",enabled FROM "AIModel" WHERE id=$1',['reference-proof'])).rows,[{apiKeyEncrypted:'',enabled:false}])
  assert.equal((await engine.query<{content:string}>('SELECT content FROM "Message" WHERE id=$1',['inbox-message-proof'])).rows[0].content,'尚未发往模型的完整对话历史')
  assert.equal((await engine.query<{n:number}>('SELECT count(*)::int AS n FROM "Novel"')).rows[0].n,0)
  // This separate closed-source fixture has foreign authorship. Its bytes remain intact after rejection.
  await engine.query('INSERT INTO "User" (id,email,"passwordHash",name,"updatedAt") VALUES ($1,$2,$3,$4,now())',['foreign-author','foreign-author@fixture.invalid','not-a-credential','foreign fixture'])
  await engine.close();engine=undefined
  const bytes=await readFile(join(candidate.directory.path,'inbox/database/PG_VERSION'))
  await assert.rejects(cancelApplicationRestore(parent,candidate.id,host,async()=>true),/ACTIVE|启用/)
  await cancelApplicationRestore(parent,candidate.id,host,async()=>false);await assert.rejects(verifyApplicationRestore(parent,candidate.id,host),/CANCELLED|取消/)
  assert.deepEqual(await readFile(join(candidate.directory.path,'inbox/database/PG_VERSION')),bytes)
  assert.equal((await portable.read(receipt.id)).checksum,receipt.checksum)
  assert.deepEqual(await readdir(source),['assets','catalog.json','drafts.json','inbox','state.json','xuanxiang-app.json'].sort())
  for(const branch of ['nonempty','owner','abort','app','migration']){
   const target=join(base,'failed-'+branch);await mkdir(target);const proof=await directoryIdentity(target),abort=new AbortController()
   if(branch==='nonempty')await writeFile(join(target,'author-file'),'keep');if(branch==='abort')abort.abort()
   const changedHost={expectedAppId:branch==='app'?randomUUID():marker.id,assertOwner:async()=>{if(branch==='owner')throw Error('OWNER_LOST')}}
   const expectedMigrations=branch==='migration'?[{id:'invalid',sql:'SELECT 1',checksum:'0'.repeat(64)}]:migrations
   await assert.rejects(prepareApplicationRestore(portable,receipt.id,proof,expectedMigrations,changedHost,abort.signal))
   const contents=await readdir(target)
   if(branch==='migration'){assert.equal(contents.length,1);assert.equal(await readFile(join(target,contents[0],'inbox/database/PG_VERSION'),'utf8'),String(postgresMajor)+'\n')}
   else assert.deepEqual(contents,branch==='nonempty'?['author-file']:[])
   assert.equal((await portable.read(receipt.id)).checksum,receipt.checksum)
  }
  const foreignRoot=join(base,'foreign-root'),foreignStore=join(base,'foreign-backup'),foreignTarget=join(base,'foreign-target')
  await cp(join(imported,receipt.id,'data'),foreignRoot,{recursive:true});await rm(join(foreignRoot,'inbox/database'),{recursive:true});await cp(inspection,join(foreignRoot,'inbox/database'),{recursive:true});await mkdir(foreignStore);await mkdir(foreignTarget)
  await cp(join(imported,receipt.id),join(foreignStore,receipt.id),{recursive:true})
  let foreignBackups:ApplicationBackups
  foreignBackups=new ApplicationBackups(await directoryIdentity(foreignStore),marker.id,backups.engine,{assertOwner:async()=>{},assertClosed:async()=>{},verifyCaptured:async(backup,signal)=>actualVerifier(foreignBackups,backup.id,signal)})
  const beforeForeign=await readFile(join(foreignRoot,'inbox/database/global/pg_control'))
  await assert.rejects(foreignBackups.create(await directoryIdentity(foreignRoot),1),/AUTHOR_MISMATCH/)
  const foreignId=(await readdir(foreignStore)).find(id=>id!==receipt.id)!;const foreignReceipt=await foreignBackups.read(foreignId)
  assert.equal(foreignReceipt.phase,'captured');assert.equal((await foreignBackups.read(receipt.id)).phase,'verified')
  await assert.rejects(prepareApplicationRestore(foreignBackups,foreignReceipt.id,await directoryIdentity(foreignTarget),migrations,host),/AUTHOR_MISMATCH/)
  assert.deepEqual(await readFile(join(foreignRoot,'inbox/database/global/pg_control')),beforeForeign);assert.equal((await foreignBackups.read(foreignReceipt.id)).checksum,foreignReceipt.checksum)
  const brokenRoot=join(base,'broken-control');await cp(join(imported,receipt.id,'data'),brokenRoot,{recursive:true})
  const badControl=Buffer.alloc(64);await writeFile(join(brokenRoot,'inbox/database/global/pg_control'),badControl)
  const beforeIds=await readdir(foreignStore)
  await assert.rejects(foreignBackups.create(await directoryIdentity(brokenRoot),1))
  const brokenId=(await readdir(foreignStore)).find(id=>!beforeIds.includes(id))!
  assert.equal((await foreignBackups.read(brokenId)).phase,'captured');assert.deepEqual(await readFile(join(foreignStore,brokenId,'data/inbox/database/global/pg_control')),badControl)
  assert.deepEqual(await readFile(join(brokenRoot,'inbox/database/global/pg_control')),badControl);assert.deepEqual((await foreignBackups.list()).map(row=>row.id),[receipt.id])
 }finally{await engine?.close();await works.close();await rm(base,{recursive:true,force:true})}
})
