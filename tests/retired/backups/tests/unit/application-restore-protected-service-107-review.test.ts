import assert from 'node:assert/strict'
import {test} from 'node:test'
import fs,{writeFileSync,renameSync,mkdirSync,linkSync} from 'node:fs'
import {writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {checkpointFixture} from '../fixtures/application-restore-checkpoint'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {ApplicationRestoreProtectedService} from '../../desktop/main/application-restore-protected-service'

// Genuine protected request/journal/authority on isolated FS. No ordinary
// worker, engine, provider or Electron session is used in this helper review.
test('AR107-S01 a catalog that becomes multiply linked during actual readonly delivery is rejected while both linked bytes and protected drafts remain preserved',{timeout:20000},async()=>{
 const f=await checkpointFixture();let service:ApplicationRestoreProtectedService|undefined
 try{
  const catalog=join(f.path,'catalog.json'),alias=join(f.base,'catalog-linked-retained.json'),bytes=JSON.stringify({schemaVersion:1,revision:0,value:[]});await writeFile(catalog,bytes)
  service=new ApplicationRestoreProtectedService(await directoryIdentity(f.boot),await directoryIdentity(f.path),f.assertOwner)
  const retention=await f.retentionBytes(),reading=service.call('protected-directories'),rejected=assert.rejects(reading)
  await Promise.resolve();linkSync(catalog,alias);await rejected
  assert.equal(await readFile(catalog,'utf8'),bytes);assert.equal(await readFile(alias,'utf8'),bytes);assert.deepEqual(await f.retentionBytes(),retention);assert.equal(f.requests.startup().mode,'protected')
  assert.equal(await service.call('close'),true);await assert.rejects(service.call('ready'))
 }finally{service?.dispose();await service?.call('close').catch(()=>{});await f.close()}
})

test('AR107-S02 replacing the actual protected root with a foreign same-marker directory after admission never reads foreign catalog or grants a late result',{timeout:20000},async t=>{
 const f=await checkpointFixture();let service:ApplicationRestoreProtectedService|undefined
 try{
  const catalog=join(f.path,'catalog.json'),bytes=JSON.stringify({schemaVersion:1,revision:0,value:[]});await writeFile(catalog,bytes);const marker=await readFile(join(f.path,'xuanxiang-app.json')),retention=await f.retentionBytes()
  service=new ApplicationRestoreProtectedService(await directoryIdentity(f.boot),await directoryIdentity(f.path),f.assertOwner)
  const reading=service.call('protected-directories'),rejected=assert.rejects(reading);await Promise.resolve()
  renameSync(f.path,f.path+'.original-protected');mkdirSync(f.path);writeFileSync(join(f.path,'xuanxiang-app.json'),marker);writeFileSync(catalog,'foreign catalog must stay unopened')
  const original=fs.openSync;let foreignOpens=0
  t.mock.method(fs,'openSync',((path:fs.PathLike,flags:fs.OpenMode,mode?:fs.Mode)=>{if(String(path).startsWith(f.path+'/'))foreignOpens++;return original(path,flags,mode)}) as typeof fs.openSync)
  await rejected;assert.equal(foreignOpens,0);assert.deepEqual(await readFile(join(f.path+'.original-protected','application-restore-drafts.json')),retention);assert.equal(await readFile(catalog,'utf8'),'foreign catalog must stay unopened')
  assert.equal(await service.call('close'),true)
 }finally{service?.dispose();await service?.call('close').catch(()=>{});await f.close()}
})
