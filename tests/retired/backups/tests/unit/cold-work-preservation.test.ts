import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {preserveColdWork,verifyColdPreservation} from '../../desktop/service/database/cold-work-preservation'
test('cold preservation retains exact damaged bytes and absent database status without opening or inventing an engine backup',async()=>{
 const base=await mkdtemp(join(tmpdir(),'xuanxiang-cold-preserve-')),workId=randomUUID()
 try{await mkdir(join(base,'assets'));await writeFile(join(base,'assets','unknown.bin'),'raw evidence');const root=await directoryIdentity(await realpath(base))
 const saved=await preserveColdWork(root,root,workId,async()=>{});assert.deepEqual(saved.missing,['database']);assert.equal(saved.kind,'closed-source');assert.equal(await readFile(join(saved.directory.path,'assets','unknown.bin'),'utf8'),'raw evidence');await verifyColdPreservation(saved,async()=>{})
 await writeFile(join(saved.directory.path,'assets','unknown.bin'),'changed');await assert.rejects(verifyColdPreservation(saved,async()=>{}));assert.equal(await readFile(join(base,'assets','unknown.bin'),'utf8'),'raw evidence')
 }finally{await rm(base,{recursive:true,force:true})}
})
test('cold preservation refuses links, and before-commit source changes do not earn a verified receipt',async()=>{
 const base=await mkdtemp(join(tmpdir(),'xuanxiang-cold-preserve-'))
 try{await mkdir(join(base,'database'));await writeFile(join(base,'database','PG_VERSION'),'damaged');await symlink('/etc/hosts',join(base,'database','linked'));const root=await directoryIdentity(await realpath(base))
 await assert.rejects(preserveColdWork(root,root,randomUUID(),async()=>{}),/安全|链接|普通|unsafe/);await rm(join(base,'database','linked'))
 await assert.rejects(preserveColdWork(root,root,randomUUID(),async()=>{},{beforeCommit:async()=>{await writeFile(join(base,'database','PG_VERSION'),'modified')}}));assert.equal(await readFile(join(base,'database','PG_VERSION'),'utf8'),'modified')
 }finally{await rm(base,{recursive:true,force:true})}
})
