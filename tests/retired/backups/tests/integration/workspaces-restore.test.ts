import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Workspaces} from '../../desktop/service/workspaces'
import {DirectoryAuthority} from '../../desktop/main/directory-authority'
import {prisma} from '../../src/lib/db'
import {PGlite} from '@electric-sql/pglite'
test('author-approved restore swaps real Workspaces storage, preserves last original edits and cold-reopens only the new authority',async()=>{
 const base=await mkdtemp(join(tmpdir(),'xuanxiang-workspaces-restore13-')),root=join(base,'app'),migrations=join(process.cwd(),'prisma/migrations');let works=new Workspaces(root,migrations),old:PGlite|undefined
 try{
  await works.initialize();const path=join(base,'work');await mkdir(path);const grants=new DirectoryAuthority(),grant=await grants.issue(path,'create-work','fixture'),work=await works.create(await grants.consume(grant.id,'create-work','fixture'),{title:'备份内原始标题',requestId:'restore-activation'})
  const saved=await works.backup(work.id,2);await works.run(work.id,()=>prisma.novel.update({where:{id:work.novelId},data:{title:'准备候选前的编辑'}}))
  const prepared=await works.prepareRestore(work.id,saved.id);await works.run(work.id,()=>prisma.novel.update({where:{id:work.novelId},data:{title:'启用前最后编辑'}}))
  const restored=await works.activateRestore(work.id,prepared.id,prepared.revision);assert.equal(restored.active.kind,'candidate')
  assert.equal((await works.run(work.id,()=>prisma.novel.findUniqueOrThrow({where:{id:work.novelId}}))).title,'备份内原始标题')
  const preceding=await works.readBackup(work.id,restored.previous!.backupId);old=await PGlite.create({loadDataDir:new Blob([new Uint8Array(preceding.snapshot.database)])});assert.equal((await old.query<{title:string}>('SELECT title FROM "Novel"')).rows[0].title,'启用前最后编辑');await old.close();old=undefined
  await works.close();works=new Workspaces(root,migrations);await works.initialize();assert.equal((await works.run(work.id,()=>prisma.novel.findUniqueOrThrow({where:{id:work.novelId}}))).title,'备份内原始标题')
  for(let i=0;i<3;i++)await works.backup(work.id,1)
  assert.equal((await works.readBackup(work.id,restored.previous!.backupId)).receipt.id,restored.previous!.backupId)
  await works.close();const pointer=join(work.path,'xuanxiang-storage.json'),bytes=await readFile(pointer);await rm(pointer)
  await assert.rejects(works.run(work.id,()=>prisma.novel.count()),/指针|缺失/);await writeFile(pointer,bytes)
  assert.equal((await works.run(work.id,()=>prisma.novel.findUniqueOrThrow({where:{id:work.novelId}}))).title,'备份内原始标题')
 }finally{await old?.close();await works.close();await rm(base,{recursive:true,force:true})}
})
