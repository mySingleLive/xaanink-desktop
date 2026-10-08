import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID,createHash} from 'node:crypto'
import fs from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {mkdtemp,readFile,writeFile,readdir,rm,rename,lstat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WorkBackups,type BackupSnapshot} from '../../desktop/core/work-backups'

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-review74-')),workId=randomUUID()
 const snapshot:BackupSnapshot={work:{schemaVersion:1,id:workId,phase:'ready',novelId:'review-novel',title:'原作品',requestId:'review-create',requestHash:'review-hash',createdAt:new Date().toISOString()},engine:{pglite:'0.5.8',postgres:'18.3',migrations:[{id:'review-migration',checksum:'a'.repeat(64)}]},database:Buffer.from('controlled engine snapshot'),assets:[]}
 const compatibility={pglite:'0.5.8',postgresMajor:18},store=new WorkBackups(root,workId,compatibility)
 return{root,workId,snapshot,compatibility,store,path:(id:string)=>join(root,'backups',`${id}.xxbackup`),close:()=>rm(root,{recursive:true,force:true})}
}

test('WB74-01 retention preserves an externally replaced previous package even when its bytes are identical',async()=>{
 const f=await fixture()
 try{
  const old=await f.store.create(f.snapshot,2),oldPath=f.path(old.id),oldBytes=await readFile(oldPath),identity=await lstat(oldPath,{bigint:true})
  let replacementInode:bigint|undefined
  const next=new WorkBackups(f.root,f.workId,f.compatibility,{beforeVerify:async()=>{
   await rename(oldPath,join(f.root,'held-original'));await writeFile(oldPath,oldBytes,{flag:'wx'});replacementInode=(await lstat(oldPath,{bigint:true})).ino
  }})
  const receipt=await next.create(f.snapshot,1)
  assert.notEqual(replacementInode,identity.ino)
  assert.deepEqual(await readFile(oldPath),oldBytes,'retention must preserve the newly encountered external inode')
  assert.ok(receipt.retainedFiles.includes(`${old.id}.xxbackup`))
  assert.equal((await next.read(receipt.id)).snapshot.work.id,f.workId)
 }finally{await f.close()}
})

test('WB74-02 retention cannot delete the last good prior package after the new package becomes unreadable',async()=>{
 const f=await fixture()
 try{
  const old=await f.store.create(f.snapshot,2),oldBytes=await readFile(f.path(old.id));let newPath=''
  const next=new WorkBackups(f.root,f.workId,f.compatibility,{beforeVerify:async path=>{newPath=path},beforePrune:async()=>{await writeFile(newPath,'external damaged new package')}})
  const outcome=await next.create(f.snapshot,1).then(value=>({value}),error=>({error}))
  assert.deepEqual(await readFile(f.path(old.id)),oldBytes,'a good previous copy must survive when the replacement is no longer verified')
  const rows=await next.list();assert.ok(rows.some(row=>row.id===old.id))
  if('value' in outcome)assert.ok(outcome.value.retainedFiles.includes(`${old.id}.xxbackup`))
 }finally{await f.close()}
})

test('WB74-03 caller mutation after create cannot alter the queued sealed package',async()=>{
 const f=await fixture()
 try{
  const bytes=Buffer.from(f.snapshot.database),title=f.snapshot.work.title,pending=f.store.create(f.snapshot,2)
  f.snapshot.database.fill(0);f.snapshot.work.title='后来输入';f.snapshot.engine.migrations[0].checksum='b'.repeat(64)
  const saved=await pending,read=await f.store.read(saved.id)
  assert.equal(read.snapshot.work.title,title);assert.deepEqual(read.snapshot.database,bytes);assert.equal(read.snapshot.engine.migrations[0].checksum,'a'.repeat(64))
 }finally{await f.close()}
})

test('WB74-04 separately forged valid checksums do not permit wrong work, file ID or duplicate metadata',async()=>{
 const f=await fixture()
 try{
  const original=await f.store.create(f.snapshot,2),file=await readFile(f.path(original.id)),magic=Buffer.from('XAANINK_BACKUP\x01\n'),start=magic.length+4,size=file.readUInt32BE(magic.length)
  const header=JSON.parse(file.subarray(start,start+size).toString()),payload=file.subarray(start+size,-32)
  for(const patch of [(m:any)=>{m.work.id=randomUUID()},(m:any)=>{m.id=randomUUID()},(m:any)=>{m.engine.migrations.push({...m.engine.migrations[0]})}]){
   const metadata=structuredClone(header);patch(metadata);const json=Buffer.from(JSON.stringify(metadata)),length=Buffer.alloc(4);length.writeUInt32BE(json.length)
   const content=Buffer.concat([magic,length,json,payload]),forged=Buffer.concat([content,createHash('sha256').update(content).digest()])
   await writeFile(f.path(original.id),forged);await assert.rejects(f.store.read(original.id));assert.equal((await f.store.list()).length,0)
  }
 }finally{await f.close()}
})

test('WB74-05 acknowledging a new package verifies the originally sealed content, not only its inode and self-consistent footer',async()=>{
 const f=await fixture()
 try{
  const old=await f.store.create(f.snapshot,2),oldBytes=await readFile(f.path(old.id))
  const next=new WorkBackups(f.root,f.workId,f.compatibility,{beforeVerify:async path=>{
   const bytes=await readFile(path),at=bytes.indexOf(Buffer.from('原作品'));assert.ok(at>0)
   Buffer.from('外部稿').copy(bytes,at)
   createHash('sha256').update(bytes.subarray(0,-32)).digest().copy(bytes,bytes.length-32)
   await writeFile(path,bytes)
  }})
  await assert.rejects(next.create(f.snapshot,1),'a same-inode package changed after our write cannot be acknowledged as our captured snapshot')
  assert.deepEqual(await readFile(f.path(old.id)),oldBytes)
 }finally{await f.close()}
})


test('WB74-06 retention rechecks the old path identity after asynchronous new-package validation',async()=>{
 const f=await fixture(),realOpen=fs.open
 try{
  const old=await f.store.create(f.snapshot,2),oldPath=f.path(old.id),oldBytes=await readFile(oldPath);let newestPath='',armed=false,replaced=false
  const next=new WorkBackups(f.root,f.workId,f.compatibility,{beforeVerify:async path=>{newestPath=path},beforePrune:async()=>{armed=true}})
  fs.open=(async (...args:Parameters<typeof realOpen>)=>{
   if(armed&&!replaced&&String(args[0])===newestPath){
    replaced=true;await rename(oldPath,join(f.root,'held-original'));await writeFile(oldPath,oldBytes,{flag:'wx'})
   }
   return realOpen(...args)
  }) as typeof realOpen
  syncBuiltinESMExports()
  const receipt=await next.create(f.snapshot,1)
  assert.equal(replaced,true,'instrumentation must run only while validating the newly verified package')
  assert.deepEqual(await readFile(oldPath),oldBytes,'the externally replaced inode must survive after the final awaited validation')
  assert.ok(receipt.retainedFiles.includes(`${old.id}.xxbackup`))
 }finally{fs.open=realOpen;syncBuiltinESMExports();await f.close()}
})
