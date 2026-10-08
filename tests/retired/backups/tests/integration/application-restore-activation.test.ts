import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,readdir,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {Workspaces} from '../../desktop/service/workspaces'
import {ApplicationBackups} from '../../desktop/core/application-backups'
import {directoryIdentity,readMetadata} from '../../desktop/core/root-ownership'
import {loadMigrations} from '../../desktop/service/database/migrations'
import {prepareApplicationRestoreWithProof,reSealApplicationRestoreWithProof,cancelApplicationRestore,validatePreparedApplicationRestoreForActivation} from '../../desktop/service/database/application-restore'
import {prepareApplicationDraftRetention} from '../../desktop/core/application-restore-drafts'
import {ApplicationRestoreActivation,ApplicationRestoreActivationError,inspectApplicationRestoreActivation} from '../../desktop/core/application-restore-activation'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {DataRootManager} from '../../desktop/core/data-root'
import packageInfo from '../../package.json'
import {prisma} from '../../src/lib/db'
test('AA35-I01 real closed PGlite candidate retains latest+backup inert drafts, exact native confirm, cancellation, uncertainty and cold inspection',{timeout:600000},async t=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-appactivate35-'))),source=join(base,'source'),storage=join(base,'backup'),parent=join(base,'native-selected'),boot=join(base,'bootstrap'),works=new Workspaces(source,join(process.cwd(),'prisma/migrations'))
 let engine:PGlite|undefined,closed=false,postgresMajor=0
 const collect=()=>{(globalThis as typeof globalThis&{gc?:()=>void}).gc?.()},stage=(name:string)=>console.log('AA35 isolated stage:',name)
 try{
  await works.initialize();await works.runWithGlobal('inbox',async()=>{const version=await prisma.$queryRaw<{server_version:string}[]>`SHOW server_version`;postgresMajor=Number(version[0].server_version.split('.')[0]);assert.ok(postgresMajor>0)});await works.close();closed=true;collect();stage('initialized and closed');for(const path of[storage,parent,boot])await mkdir(path)
  const sourceRoot=await directoryIdentity(source),app=(await readMetadata(join(source,'xuanxiang-app.json'))) as {id:string},migrations=await loadMigrations(join(process.cwd(),'prisma/migrations')),owner=randomUUID(),host={expectedAppId:app.id,assertOwner(){},assertOwnerImmediately(){}}
  const journal=new DraftJournal(source),draftOwner=randomUUID();journal.activate(draftOwner)
  const snap=(text:string)=>({version:1 as const,revision:1,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft:text,queuedRequests:[{prompt:text,sent:false,approved:true}]}},issues:[]})
  await journal.persist(draftOwner,snap('old backup author input'))
  let backups:ApplicationBackups
  backups=new ApplicationBackups(await directoryIdentity(storage),app.id,{pglite:packageInfo.dependencies['@electric-sql/pglite'],postgresMajor},{assertOwner(){},assertClosed(){},async verifyCaptured(backup){const check=join(base,'verify-'+randomUUID());await mkdir(check);const prepared=await prepareApplicationRestoreWithProof(backups,backup.id,await directoryIdentity(check),migrations,host);await cancelApplicationRestore(await directoryIdentity(check),prepared.candidate.id,host,async()=>false);collect()}})
  const backup=await backups.create(sourceRoot,1000);stage('selected backup verified');collect()
  // A fresh process owner represents a later close checkpoint, not a replay of
  // the original journal sequence. Both snapshots remain exact data copies.
  journal.activate('latest-close-owner');await journal.persist('latest-close-owner',snap('latest unsaved author input'))
  const currentBytes=await readFile(join(source,'drafts.json')),before=await backups.create(sourceRoot,1000),pointer=await new DataRootManager(boot,source).adopt(sourceRoot),bootstrap=await directoryIdentity(boot);stage('before snapshot verified');collect()
  const prepared=await prepareApplicationRestoreWithProof(backups,backup.id,await directoryIdentity(parent),migrations,host);stage('candidate prepared');collect();const initial=prepared.candidate.checksum,operationId=randomUUID(),drafts=await prepareApplicationDraftRetention({appId:app.id,operationId,candidateId:prepared.candidate.id,current:sourceRoot,backup:prepared.candidate.directory},()=>{}),sealed=await reSealApplicationRestoreWithProof(prepared,drafts);stage('candidate resealed');collect()
  assert.notEqual(sealed.candidate.checksum,initial);assert.equal(sealed.candidate.activation!.initialChecksum,initial);assert.equal(sealed.candidate.activation!.operationId,operationId);validatePreparedApplicationRestoreForActivation(sealed).assertCurrent()
  const retention=JSON.parse(await readFile(join(sealed.candidate.directory.path,'application-restore-drafts.json'),'utf8'));assert.deepEqual(retention.snapshots.map((row:any)=>[row.origin,row.snapshot.sources.chat.draft]),[['current','latest unsaved author input'],['backup','old backup author input']]);assert.equal(retention.barrier.type,'application');assert.equal(retention.barrier.reason,'APPLICATION_RESTORED');assert.equal(retention.barrier.phase,'protected');assert.deepEqual((await new DraftJournal(sealed.candidate.directory.path).read())!.sources,{});assert.deepEqual(await readFile(join(source,'drafts.json')),currentBytes)
  let answer:unknown=true,mode='none',confirms=0
  const options={assertStableLock(){},assertCold(){},assertOwner(nonce:string){assert.equal(nonce,owner)},async confirm(){confirms++;return answer as boolean},async beforePointerRename(){if(mode==='source-changed')await writeFile(join(source,'drafts.json'),'foreign input');if(mode==='pointer-changed')await writeFile(join(boot,'data-root.json'),JSON.stringify({...pointer,revision:10})+'\n')},async beforeDirectorySync(stage:'receipt'|'pointer'|'inspection'){if(stage==='pointer'&&mode==='uncertain')throw Error('isolated EIO')}}
  const sourceProof={currentRootAvailable:true,beforeSnapshot:{backups,backupId:before.id}}
  const denied=new ApplicationRestoreActivation(bootstrap,options),deniedPreview=await denied.prepare(owner,sealed,sourceProof);stage('source proof and preview sealed')
  for(const nonboolean of[false,'false',1,{response:0}]){answer=nonboolean;await assert.rejects(denied.activate(owner,deniedPreview.operationId),error=>error instanceof ApplicationRestoreActivationError&&error.code==='CONFIRMATION_REQUIRED');assert.deepEqual(await readdir(boot),['data-root.json'])}
  answer=true
  await denied.cancel(owner,deniedPreview.operationId);await assert.rejects(denied.activate(owner,deniedPreview.operationId),error=>error instanceof ApplicationRestoreActivationError&&error.code==='ATTEMPT_EXPIRED');await assert.rejects(new ApplicationRestoreActivation(bootstrap,options).prepare(owner,sealed,sourceProof),error=>error instanceof ApplicationRestoreActivationError&&error.code==='APPLICATION_RESTORE_PROOF_INVALID');assert.deepEqual(await readdir(boot),['data-root.json']);stage('strict confirmations and cancelled capability rejected')
  // Cancellation retires the issuing token across all core instances. Build
  // one fresh real candidate instead of re-learning/reusing the cancelled proof.
  const secondParent=join(base,'native-selected-second');await mkdir(secondParent);const second=await prepareApplicationRestoreWithProof(backups,backup.id,await directoryIdentity(secondParent),migrations,host);collect();const secondOperation=randomUUID(),secondDrafts=await prepareApplicationDraftRetention({appId:app.id,operationId:secondOperation,candidateId:second.candidate.id,current:sourceRoot,backup:second.candidate.directory},()=>{}),fresh=await reSealApplicationRestoreWithProof(second,secondDrafts);collect();stage('fresh candidate resealed')
  mode='uncertain';const activation=new ApplicationRestoreActivation(bootstrap,options),preview=await activation.prepare(owner,fresh,sourceProof);await assert.rejects(activation.activate(owner,preview.operationId),error=>error instanceof ApplicationRestoreActivationError&&error.code==='DURABILITY_UNCONFIRMED');await assert.rejects(activation.prepare(owner,fresh,sourceProof),error=>error instanceof ApplicationRestoreActivationError&&error.code==='DURABILITY_UNCONFIRMED')
  const installed=JSON.parse(await readFile(join(boot,'data-root.json'),'utf8'));assert.equal(installed.revision,pointer.revision+1);assert.deepEqual(installed.root,fresh.candidate.directory);assert.equal((await readdir(boot)).filter(name=>name.startsWith('application-restore-')).length,1);assert.deepEqual(await readFile(join(source,'drafts.json')),currentBytes)
  const disposition=await inspectApplicationRestoreActivation(bootstrap,options);assert.equal(disposition!.receiptId,secondOperation);assert.equal(disposition!.currentRootAvailable,true);assert.equal(disposition!.retainedRootPath,source);assert.equal(disposition!.beforeSnapshot!.id,before.id);disposition!.assertCurrent();stage('uncertainty retained and cold pointer inspected')
  engine=await PGlite.create({dataDir:join(fresh.candidate.directory.path,'inbox/database'),relaxedDurability:false});const authors=await engine.query<{id:string}>('SELECT id FROM "User"'),novels=await engine.query<{n:number}>('SELECT count(*)::int AS n FROM "Novel"');assert.deepEqual(authors.rows,[{id:'local-author'}]);assert.equal(novels.rows[0].n,0);await engine.close();engine=undefined
  // Startup inspection permits legitimate later database writes while still
  // requiring exact immutable bootstrap/history and current application marker.
  assert.equal((await inspectApplicationRestoreActivation(bootstrap,options))!.receiptId,secondOperation);assert.equal(confirms,5)
 }finally{if(engine)await engine.close();if(!closed)await works.close();await rm(base,{recursive:true,force:true})}
})
