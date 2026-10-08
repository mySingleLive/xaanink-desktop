import assert from 'node:assert/strict'
import {test} from 'node:test'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {randomUUID} from 'node:crypto'
import {mkdtemp,realpath,mkdir,writeFile,readFile,lstat,readdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {inspectTree} from '../../desktop/core/application-backup-files'
import {createApplicationStagingParent,cleanupApplicationStaging,ApplicationStagingError} from '../../desktop/core/application-staging'
const noop=()=>{}
const fixed=(error:unknown)=>error instanceof ApplicationStagingError&&/^APPLICATION_STAGING_[A-Z_]+$/.test(error.code)&&!Object.hasOwn(error,'cause')&&!error.message.includes('private')
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-staging91-'))),parentPath=join(base,'private-container'),directoryPath=join(parentPath,randomUUID()),neighborPath=join(parentPath,randomUUID())
 await mkdir(parentPath);await mkdir(directoryPath);await mkdir(neighborPath);await mkdir(join(directoryPath,'database'));await mkdir(join(directoryPath,'database/empty'))
 await writeFile(join(directoryPath,'a-receipt.json'),'original producer receipt');await writeFile(join(directoryPath,'database/b.bin'),'original engine file');await writeFile(join(neighborPath,'foreign.bin'),'unrelated private candidate')
 const parent=await directoryIdentity(parentPath),directory=await directoryIdentity(directoryPath),tree=await inspectTree(directory,noop)
 return{base,parentPath,directoryPath,neighborPath,parent,directory,tree,close:()=>rm(base,{recursive:true,force:true})}
}
test('ST91-01 original producer receipt and engine proof remove only the sealed UUID child; an unrelated candidate stays byte-identical',async()=>{const f=await fixture();try{
 assert.deepEqual(await cleanupApplicationStaging(f.parent,f.directory,f.tree,noop),{status:'removed',removedFiles:2,removedDirectories:3});await assert.rejects(lstat(f.directoryPath),{code:'ENOENT'});assert.equal(await readFile(join(f.neighborPath,'foreign.bin'),'utf8'),'unrelated private candidate');assert.deepEqual(await readdir(f.parentPath),[f.neighborPath.slice(f.parentPath.length+1)])
 }finally{await f.close()}})
test('ST91-02 cleanup never relearns a late producer/foreign receipt missing from the original proof',async()=>{const f=await fixture();try{
 await writeFile(join(f.directoryPath,'candidate-after-seal.json'),'not granted by the original producer');await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,noop),(error:unknown)=>fixed(error)&&(error as ApplicationStagingError).removedFiles===0);assert.equal(await readFile(join(f.directoryPath,'a-receipt.json'),'utf8'),'original producer receipt');assert.equal(await readFile(join(f.directoryPath,'database/b.bin'),'utf8'),'original engine file');assert.equal(await readFile(join(f.directoryPath,'candidate-after-seal.json'),'utf8'),'not granted by the original producer')
 }finally{await f.close()}})
test('ST91-03 same-inode content changed after the first unlink survives even when its original mtime is restored',async t=>{const f=await fixture(),original=fs.unlinkSync;let changed=false;try{
 const target=join(f.directoryPath,'database/b.bin'),before=await lstat(target)
 const mocked=t.mock.method(fs,'unlinkSync',(path:fs.PathLike)=>{const result=original(path);if(String(path).endsWith('a-receipt.json')){fs.writeFileSync(target,'foreign same inode bytes');fs.utimesSync(target,before.atime,before.mtime);changed=true}return result});syncBuiltinESMExports();t.after(()=>{mocked.mock.restore();syncBuiltinESMExports()})
 await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,noop),(error:unknown)=>fixed(error)&&(error as ApplicationStagingError).code==='APPLICATION_STAGING_CHANGED'&&(error as ApplicationStagingError).removedFiles===1);assert.equal(changed,true);assert.equal(await readFile(target,'utf8'),'foreign same inode bytes');assert.equal(await readFile(join(f.neighborPath,'foreign.bin'),'utf8'),'unrelated private candidate')
 }finally{await f.close()}})
test('ST91-04 a cancellation during actual directory fsync drains the open IO and keeps the cleanup reservation until settlement',async t=>{const f=await fixture(),original=fsPromises.open,entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),controller=new AbortController();let waiting:Promise<unknown>|undefined,blocked=false;try{
 const mocked=t.mock.method(fsPromises,'open',async(...args:Parameters<typeof fsPromises.open>)=>{const handle=await original(...args);if(String(args[0])!==f.directoryPath)return handle;return new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{if(!blocked){blocked=true;entered.resolve();await release.promise}return target.sync()};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}})});syncBuiltinESMExports();t.after(()=>{mocked.mock.restore();syncBuiltinESMExports()})
 let settled=false;waiting=cleanupApplicationStaging(f.parent,f.directory,f.tree,noop,controller.signal);void waiting.then(()=>{settled=true},()=>{settled=true});await entered.promise;controller.abort();await new Promise(setImmediate);assert.equal(settled,false)
 await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,noop),(error:unknown)=>fixed(error)&&(error as ApplicationStagingError).code==='APPLICATION_STAGING_BUSY');assert.equal(await readFile(join(f.directoryPath,'database/b.bin'),'utf8'),'original engine file');release.resolve();await assert.rejects(waiting,(error:unknown)=>fixed(error)&&(error as ApplicationStagingError).code==='APPLICATION_STAGING_CANCELLED'&&(error as ApplicationStagingError).removedFiles===1)
 }finally{release.resolve();await waiting?.catch(()=>{});await f.close()}})
test('ST91-05 parallel exclusive creators share the last capacity slot without adopting a preexisting neighbor',async()=>{const f=await fixture();try{
 for(let i=0;i<997;i++)await writeFile(join(f.parentPath,'preserved-'+i),'foreign')
 const results=await Promise.allSettled([createApplicationStagingParent(f.parent,noop),createApplicationStagingParent(f.parent,noop)]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);const failure=results.find(result=>result.status==='rejected');assert.ok(failure&&failure.status==='rejected'&&fixed(failure.reason)&&failure.reason.code==='APPLICATION_STAGING_LIMIT');assert.equal((await readdir(f.parentPath)).length,1000);assert.equal(await readFile(join(f.neighborPath,'foreign.bin'),'utf8'),'unrelated private candidate')
 }finally{await f.close()}})
test('ST91-06 a failed final parent fsync reports actual removals and never announces complete cleanup or erases a neighbor',async t=>{const f=await fixture(),original=fsPromises.open;try{
 const mocked=t.mock.method(fsPromises,'open',async(...args:Parameters<typeof fsPromises.open>)=>{const handle=await original(...args);if(String(args[0])!==f.parentPath)return handle;return new Proxy(handle,{get(target,key){if(key==='sync')return async()=>{throw Object.assign(Error('private physical fsync failure'),{code:'EIO'})};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}})});syncBuiltinESMExports();t.after(()=>{mocked.mock.restore();syncBuiltinESMExports()})
 await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,noop),(error:unknown)=>fixed(error)&&(error as ApplicationStagingError).code==='APPLICATION_STAGING_IO_FAILED'&&(error as ApplicationStagingError).removedFiles===2&&(error as ApplicationStagingError).removedDirectories===3);await assert.rejects(lstat(f.directoryPath),{code:'ENOENT'});assert.equal(await readFile(join(f.neighborPath,'foreign.bin'),'utf8'),'unrelated private candidate')
 }finally{await f.close()}})
test('ST91-07 invalid duplicate producer paths reject before destructive IO and do not leak the reservation into a later valid call',async()=>{const f=await fixture();try{
 const invalid=structuredClone(f.tree);invalid.files.push(structuredClone(invalid.files[0]));await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,invalid,noop),(error:unknown)=>fixed(error)&&(error as ApplicationStagingError).code==='APPLICATION_STAGING_INPUT_INVALID');assert.equal(await readFile(join(f.directoryPath,'a-receipt.json'),'utf8'),'original producer receipt');assert.equal((await cleanupApplicationStaging(f.parent,f.directory,f.tree,noop)).removedFiles,2)
 }finally{await f.close()}})
test('ST91-08 authorization rejection after exclusive creation retains its uncertain empty directory instead of deleting by pathname',async()=>{const f=await fixture();let checked=0;try{
 const before=new Set(await readdir(f.parentPath));await assert.rejects(createApplicationStagingParent(f.parent,async()=>{if(++checked===2)throw Error('private namespace owner lost')}),(error:unknown)=>fixed(error)&&(error as ApplicationStagingError).code==='APPLICATION_STAGING_OWNER_LOST');const created=(await readdir(f.parentPath)).filter(name=>!before.has(name));assert.equal(created.length,1);assert.match(created[0],/^[0-9a-f-]{36}$/);assert.deepEqual(await readdir(join(f.parentPath,created[0])),[]);assert.equal(await readFile(join(f.neighborPath,'foreign.bin'),'utf8'),'unrelated private candidate')
 }finally{await f.close()}})
