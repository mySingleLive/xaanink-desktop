import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {Workspaces} from '../../desktop/service/workspaces'
import {WorkBackups} from '../../desktop/core/work-backups'
import {DirectoryAuthority} from '../../desktop/main/directory-authority'
import {prisma} from '../../src/lib/db'
import {loadMigrations} from '../../desktop/service/database/migrations'
import {prepareWorkRestore,verifyWorkRestore} from '../../desktop/service/database/restore-candidate'
import {WorkspaceAssets} from '../../desktop/service/workspace-assets'

test('RC75-01 restore rejects a dangling local scene-image API reference rather than publishing a ready candidate',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-review75-scene-')),migrationsPath=join(process.cwd(),'prisma/migrations'),works=new Workspaces(join(root,'app'),migrationsPath)
 try{
  await works.initialize();const path=join(root,'work');await mkdir(path)
  const authority=new DirectoryAuthority(),grant=await authority.issue(path,'create-work','review'),work=await works.create(await authority.consume(grant.id,'create-work','review'),{title:'审核场景图',requestId:'review75-scene'})
  const sceneId='review-scene',url=`/api/novels/${work.novelId}/scenes/${sceneId}/images/${randomUUID()}/asset`
  await works.run(work.id,()=>prisma.scene.create({data:{id:sceneId,novelId:work.novelId,name:'实际场景',exteriorImageUrl:url}}))
  const backup=await works.backup(work.id,2),snapshot=await works.readBackup(work.id,backup.id),store=new WorkBackups(work.path,work.id,{pglite:snapshot.snapshot.engine.pglite,postgresMajor:Number(snapshot.snapshot.engine.postgres.split('.')[0])})
  const manifestBefore=await readFile(join(work.path,'xuanxiang-work.json'))
  await assert.rejects(prepareWorkRestore(work,store,backup.id,await loadMigrations(migrationsPath)),/场景|附件|图片|引用/)
  assert.deepEqual(await readFile(join(work.path,'xuanxiang-work.json')),manifestBefore)
  assert.equal((await works.run(work.id,()=>prisma.scene.findUniqueOrThrow({where:{id:sceneId}}))).exteriorImageUrl,url)
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'),image=await new WorkspaceAssets(work.path).save(png)
  const validUrl=`/api/novels/${work.novelId}/scenes/${sceneId}/images/${image.id}/asset`
  await works.run(work.id,()=>prisma.$transaction(async tx=>{await tx.sceneImage.create({data:{id:image.id,sceneId,kind:'exterior',source:'UPLOAD',url:validUrl,filename:image.filename}});await tx.scene.update({where:{id:sceneId},data:{exteriorImageUrl:validUrl}})}))
  const validBackup=await works.backup(work.id,3),candidate=await prepareWorkRestore(work,store,validBackup.id,await loadMigrations(migrationsPath))
  assert.equal(candidate.phase,'ready');assert.equal((await verifyWorkRestore(work,candidate.id)).id,candidate.id)
  assert.deepEqual(await readFile(join(candidate.directory.path,'assets',image.filename)),png)
  assert.equal((await works.run(work.id,()=>prisma.scene.findUniqueOrThrow({where:{id:sceneId}}))).exteriorImageUrl,validUrl)
  assert.deepEqual(await readFile(join(work.path,'xuanxiang-work.json')),manifestBefore)
 }finally{await works.close();await rm(root,{recursive:true,force:true})}
})
