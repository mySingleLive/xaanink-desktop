import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,rm,readFile,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Workspaces} from '../../desktop/service/workspaces'
import {DirectoryAuthority} from '../../desktop/main/directory-authority'
import {prisma} from '../../src/lib/db'
import {PGlite} from '@electric-sql/pglite'
test('catalog-scoped backup captures the actual original schema and remains readable after worker reopen',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-work-backup13-'));let works=new Workspaces(join(root,'app'),join(process.cwd(),'prisma/migrations')),candidate:PGlite|undefined
 try{
  await works.initialize();const workPath=join(root,'work');await mkdir(workPath);const authority=new DirectoryAuthority(),grant=await authority.issue(workPath,'create-work','fixture'),work=await works.create(await authority.consume(grant.id,'create-work','fixture'),{title:'原作品',requestId:'backup-work'})
  await works.run(work.id,()=>prisma.novel.update({where:{id:work.novelId},data:{title:'真正写入的标题'}}))
  const backup=await works.backup(work.id,2);assert.equal((await works.backups(work.id)).length,1)
  await assert.rejects(works.backup('outside',2),/作品/)
  await works.close();works=new Workspaces(join(root,'app'),join(process.cwd(),'prisma/migrations'));await works.initialize()
  const restored=await works.readBackup(work.id,backup.id);assert.equal(restored.snapshot.work.id,work.id)
  candidate=await PGlite.create({loadDataDir:new Blob([new Uint8Array(restored.snapshot.database)])});assert.equal((await candidate.query<{title:string}>('SELECT title FROM "Novel"')).rows[0].title,'真正写入的标题')
  assert.equal(await works.run(work.id,()=>prisma.novel.count()),1);assert.ok((await readFile(join(workPath,'backups',`${backup.id}.xxbackup`))).length>0)
  await works.close();await rename(join(work.path,'database'),join(work.path,'damaged-original-database'))
  works=new Workspaces(join(root,'app'),join(process.cwd(),'prisma/migrations'));await works.initialize()
  assert.equal((await works.readBackup(work.id,backup.id)).snapshot.work.id,work.id,'reading a recovery source must not require opening the damaged current work database')
 }finally{await candidate?.close();await works.close();await rm(root,{recursive:true,force:true})}
})
