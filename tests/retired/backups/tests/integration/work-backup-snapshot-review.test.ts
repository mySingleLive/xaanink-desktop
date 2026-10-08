import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,rm,mkdir,rename,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {WorkspaceAssets} from '../../desktop/service/workspace-assets'
import {captureWorkBackup} from '../../desktop/service/database/backup-snapshot'
import {validateEngineArchive} from '../../desktop/service/database/backup-archive'
import type {WorkManifest} from '../../desktop/shared/workspace'
import {Workspaces} from '../../desktop/service/workspaces'
import {DirectoryAuthority} from '../../desktop/main/directory-authority'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
const work=():WorkManifest=>({schemaVersion:1,id:randomUUID(),phase:'ready',novelId:'review-novel',title:'审核作品',requestId:'review',requestHash:'hash',createdAt:new Date().toISOString()})
const turn=()=>new Promise(resolve=>setTimeout(resolve,20))

test('WS74-01 a rollback in an active real transaction cannot leak uncommitted state into the engine backup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-snapshot-review74-')),engine=await PGlite.create({dataDir:join(root,'database'),relaxedDurability:false}),release=Promise.withResolvers<void>();let restored:PGlite|undefined
 try{
  await engine.exec('CREATE TABLE "_desktop_migrations" (id TEXT, checksum TEXT); CREATE TABLE review_draft (text TEXT); INSERT INTO review_draft VALUES (\'durable-before\')')
  const assets=new WorkspaceAssets(root),image=await assets.save(png),entered=Promise.withResolvers<void>(),rollback=Error('controlled transaction rollback')
  const transaction=engine.transaction(async tx=>{await tx.query("UPDATE review_draft SET text='uncommitted' ");entered.resolve();await release.promise;throw rollback})
  const transactionResult=transaction.catch(error=>{assert.equal(error,rollback)})
  await entered.promise;let completed=false
  const pending=captureWorkBackup(engine,assets,work()).then(value=>{completed=true;return value});await turn();assert.equal(completed,false)
  release.resolve();await transactionResult;const snapshot=await pending
  const archive=await validateEngineArchive(snapshot.database,18)
  restored=await PGlite.create({loadDataDir:new Blob([new Uint8Array(archive)],{type:'application/x-tar'})})
  assert.equal((await restored.query<{text:string}>('SELECT text FROM review_draft')).rows[0].text,'durable-before')
  assert.deepEqual(snapshot.assets.map(a=>a.filename),[image.filename]);assert.deepEqual(snapshot.assets[0].bytes,png)
 }finally{release.resolve();await restored?.close();await engine.close();await rm(root,{recursive:true,force:true})}
})

test('WS74-02 the actual exporter retains both asset and transaction leases through asynchronous export',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-export-review74-')),engine=await PGlite.create({dataDir:join(root,'database'),relaxedDurability:false}),release=Promise.withResolvers<void>();let restored:PGlite|undefined
 try{
  await engine.exec('CREATE TABLE "_desktop_migrations" (id TEXT, checksum TEXT); CREATE TABLE review_draft (text TEXT); INSERT INTO review_draft VALUES (\'snapshot-before\')')
  const assets=new WorkspaceAssets(root),image=await assets.save(png),entered=Promise.withResolvers<void>(),exportData=engine.dumpDataDir.bind(engine)
  engine.dumpDataDir=async compression=>{entered.resolve();await release.promise;return exportData(compression)}
  const pending=captureWorkBackup(engine,assets,work());await entered.promise
  let transactionEntered=false,removeCompleted=false
  const transaction=engine.transaction(async tx=>{transactionEntered=true;await tx.query("UPDATE review_draft SET text='after-export'")})
  const remove=assets.removeCreated(image.filename).then(()=>{removeCompleted=true})
  await turn();assert.equal(transactionEntered,false);assert.equal(removeCompleted,false)
  release.resolve();const snapshot=await pending;await Promise.all([transaction,remove])
  restored=await PGlite.create({loadDataDir:new Blob([new Uint8Array(await validateEngineArchive(snapshot.database,18))],{type:'application/x-tar'})})
  assert.equal((await restored.query<{text:string}>('SELECT text FROM review_draft')).rows[0].text,'snapshot-before')
  assert.equal((await engine.query<{text:string}>('SELECT text FROM review_draft')).rows[0].text,'after-export')
  assert.deepEqual(snapshot.assets.map(a=>a.filename),[image.filename]);assert.deepEqual(snapshot.assets[0].bytes,png)
  await assert.rejects(assets.read(image.filename),/ENOENT/)
 }finally{release.resolve();await restored?.close();await engine.close();await rm(root,{recursive:true,force:true})}
})


test('WS74-03 cold backup reads do not open or replace a damaged current engine, while new capture and wrong manifest remain rejected',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-cold-backup-review74-')),app=join(root,'app'),migrations=join(process.cwd(),'prisma/migrations'),workPath=join(root,'work')
 let works=new Workspaces(app,migrations)
 try{
  await works.initialize();await mkdir(workPath)
  const authority=new DirectoryAuthority(),grant=await authority.issue(workPath,'create-work','review')
  const record=await works.create(await authority.consume(grant.id,'create-work','review'),{title:'实际作品',requestId:'review-backup-cold'})
  const receipt=await works.backup(record.id,2);await works.close()
  await rename(join(workPath,'database'),join(workPath,'held-original-database'));await writeFile(join(workPath,'database'),'external damaged engine evidence',{flag:'wx'})
  works=new Workspaces(app,migrations);await works.initialize()
  assert.deepEqual((await works.backups(record.id)).map(row=>row.id),[receipt.id])
  const backup=await works.readBackup(record.id,receipt.id);assert.equal(backup.snapshot.work.novelId,record.novelId)
  assert.equal(await readFile(join(workPath,'database'),'utf8'),'external damaged engine evidence')
  await assert.rejects(works.backup(record.id,2),/数据库|路径/)
  assert.deepEqual((await works.backups(record.id)).map(row=>row.id),[receipt.id])
  const manifestPath=join(workPath,'xuanxiang-work.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'))
  await writeFile(manifestPath,JSON.stringify({...manifest,novelId:'foreign-work'}));await assert.rejects(works.readBackup(record.id,receipt.id),/身份|匹配/)
  await assert.rejects(works.readBackup('outside',receipt.id),/作品/)
  assert.equal(await readFile(join(workPath,'database'),'utf8'),'external damaged engine evidence')
 }finally{await works.close();await rm(root,{recursive:true,force:true})}
})
