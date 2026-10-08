import assert from 'node:assert/strict'
import {test,mock} from 'node:test'
import fs,{mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath,lstat} from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {ApplicationBackupSession} from '../../desktop/service/application-backup-session'
import {assertDirectory,directoryIdentity} from '../../desktop/core/root-ownership'
import {prepareApplicationRestoreWithProof,prepareApplicationRestore} from '../../desktop/service/database/application-restore'
import {canonical,digest,inspectTree,publicFiles} from '../../desktop/core/application-backup-files'
import {cleanupApplicationStaging} from '../../desktop/core/application-staging'
import type {ApplicationBackups} from '../../desktop/core/application-backups'
import type {ApplicationBackup} from '../../desktop/shared/application-backup'

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes});return{promise,resolve}}
async function proofFixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xx-session-review-proof-'))),container=join(base,'packages'),packagePath=join(container,randomUUID()),dataPath=join(packagePath,'data'),parentPath=join(base,'selected')
 await mkdir(join(dataPath,'inbox/database'),{recursive:true});await mkdir(parentPath)
 const appId=randomUUID(),backupId=randomUUID()
 await writeFile(join(dataPath,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}))
 await writeFile(join(dataPath,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));await writeFile(join(dataPath,'inbox/database/PG_VERSION'),'18')
 const directory=await directoryIdentity(container),packageDirectory=await directoryIdentity(packagePath),data=await directoryIdentity(dataPath),parent=await directoryIdentity(parentPath),tree=await inspectTree(data,()=>{})
 const body={format:'xuanxiang-application-backup' as const,schemaVersion:1 as const,id:backupId,appId,phase:'verified' as const,createdAt:new Date().toISOString(),engine:{pglite:'0.5.8',postgresMajor:18},files:publicFiles(tree.files),directories:tree.directories.map(item=>item.path.slice(data.path.length+1)),bytes:tree.files.reduce((total,file)=>total+file.size,0)}
 const receipt:ApplicationBackup={...body,checksum:digest(canonical(body))}
 // This stub supplies a trusted receipt and fixed validation query answers.
 // It isolates the new producer-proof/close API, not PostgreSQL validation.
 const backups={directory,appId,assertOwned:async()=>assertDirectory(directory),inspect:async()=>({receipt,directory:packageDirectory,data,tree,metadata:{fixture:true}})} as unknown as ApplicationBackups
 return{base,backups,backupId,parent,host:{expectedAppId:appId,assertOwner:assertDirectory}}
}
function validationEngine(close:()=>Promise<void>):PGlite{
 const query=async(sql:string)=>({rows:sql==='SHOW server_version'?[{server_version:'18.3'}]:sql==='SELECT id FROM "User"'?[{id:'local-author'}]:sql.includes('count(*)')?[{n:0}]:[]})
 return{query,transaction:async(run:(tx:{query:typeof query;exec:()=>Promise<void>})=>Promise<void>)=>run({query,exec:async()=>{}}),close} as unknown as PGlite
}

test('ABS93-01: an online catalog update before namespace creation cannot place backup storage inside a registered work',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'xx-session-review-namespace-')))
 try{
  await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}))
  await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
  const source=await directoryIdentity(root),work=join(root,'backups');let catalogRead=false,registered=false
  const originalOpen=fs.open
  t.mock.method(fs,'open',async(...args:Parameters<typeof fs.open>)=>{
   const handle=await originalOpen(...args)
   if(args[0]===join(root,'catalog.json')&&!catalogRead){
    const close=handle.close.bind(handle)
    t.mock.method(handle,'close',async()=>{await close();catalogRead=true})
   }
   return handle
  });syncBuiltinESMExports()
  // Only SHOW is needed for this real-filesystem namespace probe. No database
  // capture, candidate verification or PGlite close is claimed by this test.
  const engine={query:async()=>({rows:[{server_version:'18.3'}]})} as unknown as PGlite
  const session=new ApplicationBackupSession({source,engine,migrations:[],assertLive:async()=>{
   // Registration occurs at the first trusted host await after the actual
   // initial catalog handle has been closed. No call-count assumption is used.
   if(!catalogRead||registered)return
   await mkdir(work);await writeFile(join(work,'author-note'),'registered author bytes')
   const identity=await directoryIdentity(work)
   await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[{id:randomUUID(),path:work,identity:{device:identity.device,inode:identity.inode},novelId:randomUUID(),title:'并发登记的作者作品',requestId:'registered',requestHash:'registered',createdAt:new Date().toISOString()}]}))
   registered=true
  }})
  let failure:unknown
  try{await session.list()}catch(error){failure=error}
  assert.equal(registered,true,'the catalog update actually occurred in the post-read lease check')
  assert.equal(await readFile(join(work,'author-note'),'utf8'),'registered author bytes')
  assert.deepEqual(await readdir(work),['author-note'],'backup listing must not create its namespace inside the newly catalogued work')
  assert.match(String(failure),/APPLICATION_BACKUP_NAMESPACE_OVERLAPS_WORK/)
 }finally{t.mock.restoreAll();syncBuiltinESMExports();await rm(root,{recursive:true,force:true})}
})

test('ABS93-02: complete producer proof is not published before close and includes the receipt inode for cleanup',async()=>{
 const fixture=await proofFixture(),entered=deferred<void>(),finish=deferred<void>();let settled=false
 const create=mock.method(PGlite,'create',async()=>validationEngine(async()=>{entered.resolve();await finish.promise}))
 try{
  const pending=prepareApplicationRestoreWithProof(fixture.backups,fixture.backupId,fixture.parent,[],fixture.host).then(proof=>{settled=true;return proof})
  await entered.promise;assert.equal(settled,false)
  const [candidateId]=await readdir(fixture.parent.path);assert.ok(candidateId)
  await assert.rejects(lstat(join(fixture.parent.path,candidateId,'.xuanxiang-application-candidate.json')),{code:'ENOENT'})
  finish.resolve();const proof=await pending,metadata=proof.tree.files.find(file=>file.path==='.xuanxiang-application-candidate.json');assert.ok(metadata)
  const info=await lstat(join(proof.candidate.directory.path,metadata.path),{bigint:true})
  assert.equal(metadata.identity.inode,String(info.ino));assert.equal(metadata.sha256,digest(await readFile(join(proof.candidate.directory.path,metadata.path),'utf8')))
  assert.deepEqual(proof.tree,await inspectTree(proof.candidate.directory,()=>{}))
  assert.equal(proof.candidate.files.some(file=>file.path===metadata.path),false,'receipt checksum does not recursively include itself')
  const removed=await cleanupApplicationStaging(fixture.parent,proof.candidate.directory,proof.tree,()=>{})
  assert.equal(removed.status,'removed');assert.equal(removed.removedFiles,proof.tree.files.length);assert.deepEqual(await readdir(fixture.parent.path),[])
 }finally{finish.resolve();create.mock.restore();await rm(fixture.base,{recursive:true,force:true})}
})

test('ABS93-03: original producer seal does not adopt an unknown file arriving after proof return',async()=>{
 const fixture=await proofFixture(),create=mock.method(PGlite,'create',async()=>validationEngine(async()=>{}))
 try{
  const proof=await prepareApplicationRestoreWithProof(fixture.backups,fixture.backupId,fixture.parent,[],fixture.host),directory=proof.candidate.directory.path
  await writeFile(join(directory,'author-note'),'unknown late bytes')
  const before=await inspectTree(proof.candidate.directory,()=>{})
  await assert.rejects(cleanupApplicationStaging(fixture.parent,proof.candidate.directory,proof.tree,()=>{}))
  assert.deepEqual(await inspectTree(proof.candidate.directory,()=>{}),before)
  assert.equal(await readFile(join(directory,'author-note'),'utf8'),'unknown late bytes')
 }finally{create.mock.restore();await rm(fixture.base,{recursive:true,force:true})}
})

test('ABS93-04: the original restore wrapper returns its ready receipt after the new proof boundary',async()=>{
 const fixture=await proofFixture();let closed=false
 const create=mock.method(PGlite,'create',async()=>validationEngine(async()=>{closed=true}))
 try{
  const candidate=await prepareApplicationRestore(fixture.backups,fixture.backupId,fixture.parent,[],fixture.host)
  assert.equal(closed,true);assert.equal(candidate.phase,'ready');assert.equal(candidate.backupId,fixture.backupId)
  assert.equal(Object.hasOwn(candidate,'tree'),false)
  const {checksum,...body}=candidate;assert.equal(checksum,digest(canonical(body)))
  assert.deepEqual(JSON.parse(await readFile(join(candidate.directory.path,'.xuanxiang-application-candidate.json'),'utf8')),candidate)
 }finally{create.mock.restore();await rm(fixture.base,{recursive:true,force:true})}
})
