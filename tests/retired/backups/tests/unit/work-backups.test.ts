import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,symlink,link,rename} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WorkBackups,type BackupSnapshot} from '../../desktop/core/work-backups'

async function fixture(){
 const path=await mkdtemp(join(tmpdir(),'xuanxiang-backup13-')),workId=randomUUID(),novelId='original-novel'
 const snapshot:BackupSnapshot={work:{schemaVersion:1,id:workId,phase:'ready',novelId,title:'原作品',requestId:'original-request',requestHash:'hash',createdAt:new Date().toISOString()},engine:{pglite:'0.5.8',postgres:'18.3',migrations:[{id:'001',checksum:'a'.repeat(64)}]},database:Buffer.from('fixture engine dump'),assets:[{filename:`${randomUUID()}.png`,bytes:Buffer.from('fixture asset')}]}
 const store=new WorkBackups(path,workId,{pglite:'0.5.8',postgresMajor:18})
 return{path,workId,snapshot,store,close:()=>rm(path,{recursive:true,force:true})}
}
test('backup container round trips complete database, work manifest, engine versions and every attachment',async()=>{
 const f=await fixture();try{const saved=await f.store.create(f.snapshot,2),rows=await f.store.list();assert.equal(rows.length,1);assert.equal(rows[0].id,saved.id);const restored=await f.store.read(saved.id);assert.deepEqual(restored.snapshot,f.snapshot);assert.equal(restored.receipt.id,saved.id);assert.equal(saved.assetCount,1);assert.equal(saved.workId,f.workId);assert.ok(saved.bytes>f.snapshot.database.byteLength)}finally{await f.close()}
})
test('retention runs only after a new verified backup; corrupt/unknown files are preserved and excluded',async()=>{
 const f=await fixture();try{
  const a=await f.store.create(f.snapshot,2),b=await f.store.create(f.snapshot,2);await writeFile(join(f.path,'backups','author.txt'),'keep');const damaged=randomUUID();await writeFile(join(f.path,'backups',`${damaged}.xxbackup`),'broken')
  const failing=new WorkBackups(f.path,f.workId,{pglite:'0.5.8',postgresMajor:18},{beforeVerify:async path=>{await writeFile(path,'truncated')}})
  await assert.rejects(failing.create(f.snapshot,2));assert.deepEqual((await f.store.list()).map(x=>x.id).sort(),[a.id,b.id].sort())
  const c=await f.store.create(f.snapshot,2);assert.equal((await f.store.list()).length,2);assert.ok((await f.store.list()).some(x=>x.id===c.id));assert.equal(await readFile(join(f.path,'backups','author.txt'),'utf8'),'keep');assert.equal(await readFile(join(f.path,'backups',`${damaged}.xxbackup`),'utf8'),'broken')
 }finally{await f.close()}
})
test('tampered payload, appended bytes, incompatible versions and wrong work identities are rejected',async()=>{
 const f=await fixture();try{
  const saved=await f.store.create(f.snapshot,2),path=join(f.path,'backups',`${saved.id}.xxbackup`),bytes=await readFile(path);bytes[bytes.length-1]^=1;await writeFile(path,bytes);await assert.rejects(f.store.read(saved.id),/校验|备份/)
  await assert.rejects(f.store.create({...f.snapshot,work:{...f.snapshot.work,id:randomUUID()}},2),/作品/)
  await assert.rejects(f.store.create({...f.snapshot,engine:{...f.snapshot.engine,pglite:'0.6.0'}},2),/引擎/)
  await assert.rejects(f.store.create({...f.snapshot,engine:{...f.snapshot.engine,postgres:'19.0'}},2),/引擎/)
  const second=await f.store.create(f.snapshot,2),p=join(f.path,'backups',`${second.id}.xxbackup`);await writeFile(p,Buffer.concat([await readFile(p),Buffer.from('extra')]));await assert.rejects(f.store.read(second.id),/备份/)
 }finally{await f.close()}
})
test('invalid IDs, asset traversal/duplicates, symlink and hardlink packages fail closed',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.store.read('../outside'));await assert.rejects(f.store.create({...f.snapshot,assets:[{filename:'../secret',bytes:Buffer.from('x')}]},2));await assert.rejects(f.store.create({...f.snapshot,assets:[...f.snapshot.assets,...f.snapshot.assets]},2))
  const saved=await f.store.create(f.snapshot,2),path=join(f.path,'backups',`${saved.id}.xxbackup`);await link(path,join(f.path,'alias'));await assert.rejects(f.store.read(saved.id));await rm(join(f.path,'alias'))
  await rename(path,join(f.path,'outside'));await symlink(join(f.path,'outside'),path);await assert.rejects(f.store.read(saved.id));assert.equal((await f.store.list()).length,0)
 }finally{await f.close()}
})
test('replacement backup directory is not adopted by an existing owner',async()=>{
 const f=await fixture();try{
  await f.store.create(f.snapshot,2);await rename(join(f.path,'backups'),join(f.path,'old-backups'));await mkdir(join(f.path,'backups'));await assert.rejects(f.store.create(f.snapshot,2),/目录|directory/);assert.deepEqual(await readdir(join(f.path,'backups')),[])
 }finally{await f.close()}
})
test('the package checksum covers manifest metadata as well as binary payloads',async()=>{
 const f=await fixture();try{
  const saved=await f.store.create(f.snapshot,2),path=join(f.path,'backups',`${saved.id}.xxbackup`),bytes=await readFile(path),at=bytes.indexOf(Buffer.from('原作品'));assert.ok(at>0);Buffer.from('新作品').copy(bytes,at);await writeFile(path,bytes)
  await assert.rejects(f.store.read(saved.id),/校验|备份/)
 }finally{await f.close()}
})
