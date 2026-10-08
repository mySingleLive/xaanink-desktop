import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {WorkBackups,type BackupSnapshot} from '../../desktop/core/work-backups'
test('the explicitly retained pre-restore receipt survives normal retention without consuming the normal backup count',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xx-backup-pin-')),id=randomUUID(),snapshot:BackupSnapshot={work:{schemaVersion:1,id,phase:'ready',novelId:'novel',title:'正文',requestId:'request',requestHash:'hash',createdAt:new Date().toISOString()},engine:{pglite:'0.5.8',postgres:'18.3',migrations:[]},database:Buffer.from('engine fixture'),assets:[]},store=new WorkBackups(root,id,{pglite:'0.5.8',postgresMajor:18})
 try{const restore=await store.create(snapshot,2),pins=[restore.id];await store.create(snapshot,2,pins);await store.create(snapshot,2,pins);const newest=await store.create(snapshot,2,pins);const all=await store.list();assert.equal(all.length,3);assert.ok(all.some(x=>x.id===restore.id));assert.ok(all.some(x=>x.id===newest.id));assert.equal((await store.read(restore.id)).receipt.sha256,restore.sha256)
 const before=await readdir(join(root,'backups'));await assert.rejects(store.create(snapshot,2,['../../outside']));assert.deepEqual(await readdir(join(root,'backups')),before)
 }finally{await rm(root,{recursive:true,force:true})}
})
