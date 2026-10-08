import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {ApplicationBackupSession} from '../../desktop/service/application-backup-session'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {defaultState} from '../../desktop/core/settings'

test('online application backup validates a real isolated inbox before publication, reclaims only sealed staging and leaves source writable', {timeout:600000},async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xx-application-session-'))),root=join(base,'root');await mkdir(root);await mkdir(join(root,'inbox'))
 const appId=randomUUID(),engine=await PGlite.create({dataDir:join(root,'inbox/database'),relaxedDurability:false})
 try{
  await engine.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY); INSERT INTO "User" VALUES (\'local-author\'); CREATE TABLE "Novel" (id TEXT PRIMARY KEY); CREATE TABLE "AIModel" ("apiKeyEncrypted" TEXT NOT NULL,enabled BOOLEAN NOT NULL); CREATE TABLE notes (text TEXT); INSERT INTO notes VALUES (\'original inbox\')')
  await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}));await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));const stateBytes=JSON.stringify({schemaVersion:1,revision:1,value:defaultState});await writeFile(join(root,'state.json'),stateBytes)
  await writeFile(join(root,'author-note.txt'),'unknown source neighbor');const source=await directoryIdentity(root);let held=true,checks=0
  const session=new ApplicationBackupSession({source,engine,migrations:[],assertLive:async()=>{checks++;assert.equal(held,true);assert.equal(engine.closed,false)}})
  const backup=await session.create(2);assert.equal(backup.receipt.phase,'verified');assert.equal(backup.receipt.appId,appId);assert.deepEqual(backup.cleanupPending,[]);assert.ok(checks>0)
  assert.equal(await readFile(join(root,'backups/application/packages',backup.receipt.id,'data/state.json'),'utf8'),stateBytes)
  assert.deepEqual(await readdir(join(root,'backups/application/staging')),[]);assert.deepEqual(await readdir(join(root,'backups/application/validation')),[])
  const listed=await session.list();assert.deepEqual(listed.map(row=>row.id),[backup.receipt.id]);assert.equal(await readFile(join(root,'author-note.txt'),'utf8'),'unknown source neighbor')
  await engine.query("INSERT INTO notes VALUES ('after backup')");assert.equal((await engine.query<{n:number}>('SELECT count(*)::int AS n FROM notes')).rows[0].n,2)
  held=false;await assert.rejects(session.create(2));assert.equal((await readdir(join(root,'backups/application/packages'))).length,1)
 }finally{await engine.close();await rm(base,{recursive:true,force:true})}
})
test('revoked or cancelled session cannot create backup storage or open a candidate',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'xx-application-revoked-')))
 try{
  const source=await directoryIdentity(root),engine={} as PGlite,session=new ApplicationBackupSession({source,engine,migrations:[],assertLive:async()=>{throw Error('REVOKED')}})
  await assert.rejects(session.create(1));await assert.rejects(session.list());assert.deepEqual(await readdir(root),[])
  const cancel=new AbortController();cancel.abort();const second=new ApplicationBackupSession({source,engine,migrations:[],assertLive:async()=>{throw Error('should not run')}});await assert.rejects(second.create(1,cancel.signal));assert.deepEqual(await readdir(root),[])
 }finally{await rm(root,{recursive:true,force:true})}
})
test('backup storage never creates folders inside a catalogued work or across a work already in its namespace',async()=>{
 for(const relative of ['backups','backups/application/packages/author-work']){
  const root=await realpath(await mkdtemp(join(tmpdir(),'xx-application-namespace-'))),work=join(root,relative);await mkdir(work,{recursive:true})
  try{
   await writeFile(join(work,'author-note'),'original work');const identity=await directoryIdentity(work),appId=randomUUID()
   await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}));await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[{id:randomUUID(),path:work,identity:{device:identity.device,inode:identity.inode},novelId:randomUUID(),title:'作者作品',requestId:'original',requestHash:'original',createdAt:new Date().toISOString()}]}))
   const engine={query:async()=>({rows:[{server_version:'18.3'}]})} as unknown as PGlite,session=new ApplicationBackupSession({source:await directoryIdentity(root),engine,migrations:[],assertLive:async()=>{}})
   const before=await readdir(work);await assert.rejects(session.create(1),/NAMESPACE/);assert.deepEqual(await readdir(work),before);assert.equal(await readFile(join(work,'author-note'),'utf8'),'original work')
  }finally{await rm(root,{recursive:true,force:true})}
 }
})
