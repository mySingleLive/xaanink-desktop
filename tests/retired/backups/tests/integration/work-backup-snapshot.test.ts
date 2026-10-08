import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {PGlite} from '@electric-sql/pglite'
import {randomUUID} from 'node:crypto'
import {captureWorkBackup} from '../../desktop/service/database/backup-snapshot'
import {WorkspaceAssets} from '../../desktop/service/workspace-assets'
import {validateEngineArchive} from '../../desktop/service/database/backup-archive'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
test('engine backup waits for the real transaction lease, round trips the committed state and attachments',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-snapshot13-')),engine=await PGlite.create({dataDir:join(root,'database'),relaxedDurability:false});let restored:PGlite|undefined
 try{
  await engine.exec('CREATE TABLE "_desktop_migrations" (id TEXT,checksum TEXT); CREATE TABLE draft (text TEXT); INSERT INTO draft VALUES (\'before\')')
  const assets=new WorkspaceAssets(root),image=await assets.save(png)
  const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>()
  const tx=engine.transaction(async tx=>{await tx.query("UPDATE draft SET text='committed'");entered.resolve();await release.promise});await entered.promise
  let done=false;const backup=captureWorkBackup(engine,assets,{schemaVersion:1,id:randomUUID(),phase:'ready',novelId:'novel',title:'测试',requestId:'test',requestHash:'hash',createdAt:new Date().toISOString()}).then(value=>{done=true;return value})
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(done,false);release.resolve();await tx
  const snapshot=await backup;assert.equal(snapshot.assets.length,1);assert.equal(snapshot.assets[0].filename,image.filename);assert.deepEqual(Buffer.from(snapshot.assets[0].bytes),png)
  await engine.query("UPDATE draft SET text='after backup'")
  const archive=await validateEngineArchive(snapshot.database,Number(snapshot.engine.postgres.split('.')[0]))
  restored=await PGlite.create({loadDataDir:new Blob([new Uint8Array(archive)],{type:'application/x-tar'})});assert.equal((await restored.query<{text:string}>('SELECT text FROM draft')).rows[0].text,'committed');assert.equal((await engine.query<{text:string}>('SELECT text FROM draft')).rows[0].text,'after backup')
 }finally{await restored?.close();await engine.close();await rm(root,{recursive:true,force:true})}
})
test('asset snapshot owns a mutation lease and never reads unknown files into a backup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-assets-snapshot13-'))
 try{
  const assets=new WorkspaceAssets(root),image=await assets.save(png);await writeFile(join(root,'assets','author.txt'),'private unrelated')
  const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>()
  const snapshot=assets.snapshot(async files=>{entered.resolve();assert.deepEqual(files.map(f=>f.filename),[image.filename]);await release.promise;return files})
  await entered.promise;let removed=false;const remove=assets.removeCreated(image.filename).then(()=>{removed=true});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(removed,false);release.resolve();await snapshot;await remove
  assert.equal(await readFile(join(root,'assets','author.txt'),'utf8'),'private unrelated')
 }finally{await rm(root,{recursive:true,force:true})}
})
