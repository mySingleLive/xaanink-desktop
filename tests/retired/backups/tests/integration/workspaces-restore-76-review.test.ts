import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,rm,readFile,writeFile,rename,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Workspaces} from '../../desktop/service/workspaces'
import {DirectoryAuthority} from '../../desktop/main/directory-authority'
import {prisma} from '../../src/lib/db'
import {PGlite} from '@electric-sql/pglite'
import fs from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {retainDatabaseTask} from '../../desktop/service/context'

async function fixture(){
 const base=await mkdtemp(join(tmpdir(),'xuanxiang-review76-')),root=join(base,'app'),path=join(base,'work'),migrations=join(process.cwd(),'prisma/migrations')
 let works=new Workspaces(root,migrations);await works.initialize();await mkdir(path)
 const authority=new DirectoryAuthority(),grant=await authority.issue(path,'create-work','review'),work=await works.create(await authority.consume(grant.id,'create-work','review'),{title:'审核恢复作品',requestId:'review76-work'})
 return{base,root,path,migrations,work,get works(){return works},set works(value:Workspaces){works=value},close:async()=>{await works.close();await rm(base,{recursive:true,force:true})}}
}

test('WR76-01 releasing a real writer lease preserves unknown files and remains retryable',async()=>{
 const f=await fixture()
 try{
  await f.works.run(f.work.id,()=>prisma.novel.count())
  const lock=join(f.path,'.xuanxiang-lock'),foreign=join(lock,'foreign-data');await mkdir(foreign);await writeFile(join(foreign,'keep.txt'),'external unrelated bytes')
  await assert.rejects(f.works.close(),/锁|目录|未知|unknown|lease/)
  assert.equal(await readFile(join(foreign,'keep.txt'),'utf8'),'external unrelated bytes')
  assert.ok((await readFile(join(lock,'owner.json'),'utf8')).includes('token'))
  await rm(foreign,{recursive:true});await f.works.close()
  f.works=new Workspaces(f.root,f.migrations);await f.works.initialize();assert.equal(await f.works.run(f.work.id,()=>prisma.novel.count()),1)
 }finally{await f.close()}
})

test('WR76-02 a cold missing current database can restore a verified candidate without recreating or destroying the old source evidence',async()=>{
 const f=await fixture()
 try{
  const backup=await f.works.backup(f.work.id,2);await f.works.close()
  await rename(join(f.path,'database'),join(f.path,'held-original-database'));const evidence=await readFile(join(f.path,'held-original-database','PG_VERSION'))
  f.works=new Workspaces(f.root,f.migrations);await f.works.initialize()
  const candidate=await f.works.prepareRestore(f.work.id,backup.id)
  const state=await f.works.activateRestore(f.work.id,candidate.id,candidate.revision)
  assert.equal(state.active.kind,'candidate')
  assert.equal(state.previous!.kind,'closed-source')
  const receipt=JSON.parse(await readFile(join(f.path,'.xuanxiang-preserved',state.previous!.backupId,'receipt.json'),'utf8'))
  assert.equal(receipt.kind,'closed-source');assert.ok(receipt.missing.includes('database'))
  assert.equal(receipt.inventory.files.some((file:{path:string})=>file.path.startsWith('database')),false)
  assert.equal(await f.works.run(f.work.id,()=>prisma.novel.count()),1)
  assert.deepEqual(await readFile(join(f.path,'held-original-database','PG_VERSION')),evidence)
  await assert.rejects(readFile(join(f.path,'database','PG_VERSION')),/ENOENT/)
 }finally{await f.close()}
})

test('WR76-07 a cold corrupt ordinary database file is preserved byte for byte without opening it and the verified backup becomes authoritative',async()=>{
 const f=await fixture()
 try{
  const backup=await f.works.backup(f.work.id,2);await f.works.close()
  await rename(join(f.path,'database'),join(f.path,'held-original-database'))
  const corrupt=Buffer.from('not a database\x00raw evidence'),asset=Buffer.from('original opaque bytes')
  await writeFile(join(f.path,'database'),corrupt);await writeFile(join(f.path,'assets','original.bin'),asset);await mkdir(join(f.path,'assets','empty-directory'));await writeFile(join(f.path,'outside-note.txt'),'unmanaged original note')
  const originalIdentity=await lstat(join(f.path,'database'),{bigint:true})
  f.works=new Workspaces(f.root,f.migrations);await f.works.initialize()
  const candidate=await f.works.prepareRestore(f.work.id,backup.id),state=await f.works.activateRestore(f.work.id,candidate.id,candidate.revision),preserved=join(f.path,'.xuanxiang-preserved',state.previous!.backupId)
  assert.equal(state.previous!.kind,'closed-source')
  assert.deepEqual(await readFile(join(preserved,'database')),corrupt);assert.deepEqual(await readFile(join(preserved,'assets','original.bin')),asset);assert.ok((await lstat(join(preserved,'assets','empty-directory'))).isDirectory())
  assert.deepEqual(await readFile(join(f.path,'database')),corrupt);assert.equal((await lstat(join(f.path,'database'),{bigint:true})).ino,originalIdentity.ino);assert.equal(await readFile(join(f.path,'outside-note.txt'),'utf8'),'unmanaged original note')
  assert.equal(await f.works.run(f.work.id,()=>prisma.novel.count()),1)
  await f.works.close();f.works=new Workspaces(f.root,f.migrations);await f.works.initialize();assert.equal(await f.works.run(f.work.id,()=>prisma.novel.count()),1)
 }finally{await f.close()}
})


test('WR76-03 failed real engine close blocks activation and retains the writer lease until explicit close retry succeeds',async()=>{
 const f=await fixture(),realClose=PGlite.prototype.close;let failures=0
 try{
  const backup=await f.works.backup(f.work.id,2);await f.works.run(f.work.id,()=>prisma.novel.update({where:{id:f.work.novelId},data:{title:'最后原稿'}}))
  const candidate=await f.works.prepareRestore(f.work.id,backup.id),pointer=join(f.path,'xuanxiang-storage.json'),before=await readFile(pointer),ownerBefore=await readFile(join(f.path,'.xuanxiang-lock','owner.json'))
  PGlite.prototype.close=async function(){if(this.dataDir===join(f.work.path,'database')){failures++;throw Error('controlled engine close failure')}return realClose.call(this)}
  await assert.rejects(f.works.activateRestore(f.work.id,candidate.id,candidate.revision),/controlled engine close failure/)
  assert.ok(failures>0);assert.deepEqual(await readFile(pointer),before);assert.deepEqual(await readFile(join(f.path,'.xuanxiang-lock','owner.json')),ownerBefore)
  await assert.rejects(f.works.run(f.work.id,()=>prisma.novel.count()),/恢复|存储|关闭|确认/)
  await assert.rejects(f.works.close(),/controlled engine close failure/)
  PGlite.prototype.close=realClose;await f.works.close()
  f.works=new Workspaces(f.root,f.migrations);await f.works.initialize()
  assert.equal((await f.works.run(f.work.id,()=>prisma.novel.findUniqueOrThrow({where:{id:f.work.novelId}}))).title,'最后原稿')
 }finally{PGlite.prototype.close=realClose;await f.close()}
})

test('WR76-04 a retained background task blocks concurrent activation and the same verified candidate can be activated after its final write',async()=>{
 const f=await fixture();let release:(()=>void)|undefined
 try{
  const backup=await f.works.backup(f.work.id,2),candidate=await f.works.prepareRestore(f.work.id,backup.id),pointer=join(f.path,'xuanxiang-storage.json'),before=await readFile(pointer)
  await f.works.run(f.work.id,async()=>{release=retainDatabaseTask();await prisma.novel.update({where:{id:f.work.novelId},data:{title:'后台尚未结束'}})})
  const first=f.works.activateRestore(f.work.id,candidate.id,candidate.revision),second=f.works.activateRestore(f.work.id,candidate.id,candidate.revision)
  const outcomes=await Promise.allSettled([first,second]);assert.equal(outcomes[0].status,'rejected');assert.equal(outcomes[1].status,'rejected')
  assert.deepEqual(await readFile(pointer),before)
  await assert.rejects(f.works.close(),/仍有创作任务/)
  await f.works.run(f.work.id,()=>prisma.novel.update({where:{id:f.work.novelId},data:{title:'后台最后一次保存'}}));release!();release=undefined
  const state=await f.works.activateRestore(f.work.id,candidate.id,candidate.revision)
  assert.equal(state.revision,candidate.revision+1);assert.equal((await f.works.run(f.work.id,()=>prisma.novel.findUniqueOrThrow({where:{id:f.work.novelId}}))).title,'审核恢复作品')
  const previous=await f.works.readBackup(f.work.id,state.previous!.backupId),engine=await PGlite.create({loadDataDir:new Blob([Uint8Array.from(previous.snapshot.database)])})
  try{assert.equal((await engine.query<{title:string}>('SELECT title FROM "Novel" WHERE id=$1',[f.work.novelId])).rows[0].title,'后台最后一次保存')}finally{await engine.close()}
 }finally{release?.();await f.close()}
})

test('WR76-05 a writer-directory removal failure after owner unlink is explicitly retryable without stealing a replacement lease',async()=>{
 const f=await fixture(),realRmdir=fs.rmdir;let injected=false
 try{
  await f.works.run(f.work.id,()=>prisma.novel.count());const lock=join(f.work.path,'.xuanxiang-lock')
  fs.rmdir=(async(...args:Parameters<typeof realRmdir>)=>{if(!injected&&String(args[0])===lock){injected=true;throw Error('controlled writer directory removal failure')}return realRmdir(...args)}) as typeof realRmdir;syncBuiltinESMExports()
  await assert.rejects(f.works.close(),/controlled writer directory removal failure/);assert.equal(injected,true)
  fs.rmdir=realRmdir;syncBuiltinESMExports()
  await f.works.close()
  f.works=new Workspaces(f.root,f.migrations);await f.works.initialize();assert.equal(await f.works.run(f.work.id,()=>prisma.novel.count()),1)
 }finally{fs.rmdir=realRmdir;syncBuiltinESMExports();await f.close()}
})

test('WR76-06 stale prepared revisions cannot replace a newer generation and cancellation cannot delete the active candidate',async()=>{
 const f=await fixture()
 try{
  const backup=await f.works.backup(f.work.id,2),a=await f.works.prepareRestore(f.work.id,backup.id),b=await f.works.prepareRestore(f.work.id,backup.id)
  assert.equal(a.revision,b.revision)
  const state=await f.works.activateRestore(f.work.id,a.id,a.revision)
  await f.works.run(f.work.id,()=>prisma.novel.update({where:{id:f.work.novelId},data:{title:'新一代继续写作'}}))
  const before=await readFile(join(f.path,'xuanxiang-storage.json')),rows=await f.works.backups(f.work.id)
  await assert.rejects(f.works.activateRestore(f.work.id,b.id,b.revision),/存储已变更/)
  assert.deepEqual(await readFile(join(f.path,'xuanxiang-storage.json')),before);assert.equal((await f.works.backups(f.work.id)).length,rows.length)
  await assert.rejects(f.works.cancelRestore(f.work.id,a.id),/启用/)
  assert.equal((await f.works.run(f.work.id,()=>prisma.novel.findUniqueOrThrow({where:{id:f.work.novelId}}))).title,'新一代继续写作')
  await f.works.cancelRestore(f.work.id,b.id);assert.equal(state.active.kind,'candidate')
  assert.deepEqual(await readFile(join(f.path,'xuanxiang-storage.json')),before)
 }finally{await f.close()}
})

test('WR76-08 an unlock failure after pointer commit blocks reuse until explicit retry and then reopens the committed generation',async()=>{
 const f=await fixture(),realRmdir=fs.rmdir;let injected=false
 try{
  const backup=await f.works.backup(f.work.id,2),candidate=await f.works.prepareRestore(f.work.id,backup.id)
  await f.works.run(f.work.id,()=>prisma.novel.update({where:{id:f.work.novelId},data:{title:'恢复前的最后保存'}}))
  const lock=join(f.work.path,'.xuanxiang-lock')
  fs.rmdir=(async(...args:Parameters<typeof realRmdir>)=>{if(!injected&&String(args[0])===lock){injected=true;throw Error('controlled post-commit unlock failure')}return realRmdir(...args)}) as typeof realRmdir;syncBuiltinESMExports()
  await assert.rejects(f.works.activateRestore(f.work.id,candidate.id,candidate.revision),/controlled post-commit unlock failure/);assert.equal(injected,true)
  const pointer=JSON.parse(await readFile(join(f.path,'xuanxiang-storage.json'),'utf8'));assert.equal(pointer.state.active.id,candidate.id)
  await assert.rejects(f.works.run(f.work.id,()=>prisma.novel.count()),/存储确认|关闭/)
  fs.rmdir=realRmdir;syncBuiltinESMExports();await f.works.close()
  f.works=new Workspaces(f.root,f.migrations);await f.works.initialize()
  assert.equal((await f.works.run(f.work.id,()=>prisma.novel.findUniqueOrThrow({where:{id:f.work.novelId}}))).title,'审核恢复作品')
 }finally{fs.rmdir=realRmdir;syncBuiltinESMExports();await f.close()}
})

test('WR76-09 a real closed-source copy failure preserves the original authority and a later explicit retry can use the same candidate',async()=>{
 const f=await fixture(),realOpen=fs.open;let injected=false
 try{
  const backup=await f.works.backup(f.work.id,2);await f.works.close();f.works=new Workspaces(f.root,f.migrations);await f.works.initialize()
  const candidate=await f.works.prepareRestore(f.work.id,backup.id),pointer=join(f.path,'xuanxiang-storage.json'),before=await readFile(pointer),original=await readFile(join(f.path,'database','PG_VERSION'))
  fs.open=(async(...args:Parameters<typeof realOpen>)=>{const path=String(args[0]);if(!injected&&path.startsWith(join(f.work.path,'.xuanxiang-preserved')+'/')&&path.endsWith('/database/PG_VERSION')){injected=true;throw Error('controlled preservation write failure')}return realOpen(...args)}) as typeof realOpen;syncBuiltinESMExports()
  await assert.rejects(f.works.activateRestore(f.work.id,candidate.id,candidate.revision),/controlled preservation write failure/);assert.equal(injected,true)
  assert.deepEqual(await readFile(pointer),before);assert.deepEqual(await readFile(join(f.path,'database','PG_VERSION')),original)
  fs.open=realOpen;syncBuiltinESMExports()
  const state=await f.works.activateRestore(f.work.id,candidate.id,candidate.revision);assert.equal(state.previous!.kind,'closed-source')
  assert.equal(await f.works.run(f.work.id,()=>prisma.novel.count()),1)
 }finally{fs.open=realOpen;syncBuiltinESMExports();await f.close()}
})
