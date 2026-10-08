import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,rm,readFile,writeFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Workspaces} from '../../desktop/service/workspaces'
import {WorkBackups} from '../../desktop/core/work-backups'
import {DirectoryAuthority} from '../../desktop/main/directory-authority'
import {prisma} from '../../src/lib/db'
import {loadMigrations} from '../../desktop/service/database/migrations'
import {prepareWorkRestore,verifyWorkRestore,cancelWorkRestore} from '../../desktop/service/database/restore-candidate'
import {PGlite} from '@electric-sql/pglite'
test('valid restore is an isolated persistent original-schema candidate; current edits and cancellation stay separate',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-restore13-')),migrationsPath=join(process.cwd(),'prisma/migrations'),works=new Workspaces(join(root,'app'),migrationsPath);let restored:PGlite|undefined
 try{
  await works.initialize();const workPath=join(root,'work');await mkdir(workPath);const grants=new DirectoryAuthority(),grant=await grants.issue(workPath,'create-work','fixture'),work=await works.create(await grants.consume(grant.id,'create-work','fixture'),{title:'备份时标题',requestId:'restore-work'})
  const saved=await works.backup(work.id,2),backup=await works.readBackup(work.id,saved.id),store=new WorkBackups(work.path,work.id,{pglite:backup.snapshot.engine.pglite,postgresMajor:Number(backup.snapshot.engine.postgres.split('.')[0])})
  await works.run(work.id,()=>prisma.novel.update({where:{id:work.novelId},data:{title:'备份后继续编辑'}}))
  const manifestBefore=await readFile(join(work.path,'xuanxiang-work.json'))
  const candidate=await prepareWorkRestore(work,store,saved.id,await loadMigrations(migrationsPath));assert.equal(candidate.phase,'ready');assert.equal(candidate.backupId,saved.id)
  assert.equal((await works.run(work.id,()=>prisma.novel.findUniqueOrThrow({where:{id:work.novelId}}))).title,'备份后继续编辑');assert.deepEqual(await readFile(join(work.path,'xuanxiang-work.json')),manifestBefore)
  const verified=await verifyWorkRestore(work,candidate.id);restored=await PGlite.create({dataDir:join(verified.directory.path,'database')});assert.equal((await restored.query<{title:string}>('SELECT title FROM "Novel"')).rows[0].title,'备份时标题');await restored.close();restored=undefined
  // Opening a candidate changes engine files; it is no longer an untouched activation candidate.
  await assert.rejects(verifyWorkRestore(work,candidate.id),/候选|变化|校验/)
  const second=await prepareWorkRestore(work,store,saved.id,await loadMigrations(migrationsPath));await cancelWorkRestore(work,second.id,async()=>false);await assert.rejects(verifyWorkRestore(work,second.id),/取消|候选/)
  assert.equal((await works.run(work.id,()=>prisma.novel.findUniqueOrThrow({where:{id:work.novelId}}))).title,'备份后继续编辑')
  const third=await prepareWorkRestore(work,store,saved.id,await loadMigrations(migrationsPath));await assert.rejects(cancelWorkRestore(work,third.id,async()=>true),/启用/)
  await writeFile(join(third.directory.path,'database','PG_VERSION'),'99');await assert.rejects(verifyWorkRestore(work,third.id),/候选|校验/)
 }finally{await restored?.close();await works.close();await rm(root,{recursive:true,force:true})}
})
