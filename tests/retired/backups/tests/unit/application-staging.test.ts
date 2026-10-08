import assert from 'node:assert/strict'
import {test,mock} from 'node:test'
import fs from 'node:fs'
import {syncBuiltinESMExports} from 'node:module'
import {mkdtemp,realpath,mkdir,writeFile,readFile,readdir,rename,rm,symlink,link,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import * as crypto from 'node:crypto'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {inspectTree,type StoredTree} from '../../desktop/core/application-backup-files'
import {createApplicationStagingParent,cleanupApplicationStaging,ApplicationStagingError,type ApplicationStagingGuard} from '../../desktop/core/application-staging'
const safe=(error:unknown)=>error instanceof ApplicationStagingError&&/^APPLICATION_STAGING_/.test(error.code)&&!Object.hasOwn(error,'cause')
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-staging24-'))),parentPath=join(base,'parent'),directoryPath=join(parentPath,randomUUID())
 await mkdir(parentPath);await mkdir(directoryPath);await mkdir(join(directoryPath,'data'));await mkdir(join(directoryPath,'data','empty'))
 await writeFile(join(directoryPath,'a.json'),'first captured metadata');await writeFile(join(directoryPath,'data/b.bin'),'second captured database bytes')
 const parent=await directoryIdentity(parentPath),directory=await directoryIdentity(directoryPath),tree=await inspectTree(directory,()=>{})
 const guard:ApplicationStagingGuard=async()=>{}
 return{base,parentPath,directoryPath,parent,directory,tree,guard,cleanup:()=>rm(base,{recursive:true,force:true})}
}
test('ST24-01: create claims only its wx UUID child, cleanup removes the complete proven tree and preserves neighboring UUIDs',async()=>{
 const f=await fixture()
 try{
  const created=await createApplicationStagingParent(f.parent,f.guard)
  assert.match(created.path.slice(f.parentPath.length+1),/^[0-9a-f-]{36}$/);assert.notEqual(created.path,f.directoryPath);assert.deepEqual(await readdir(created.path),[])
  const result=await cleanupApplicationStaging(f.parent,f.directory,f.tree,f.guard)
  assert.deepEqual(result,{status:'removed',removedFiles:2,removedDirectories:3})
  await assert.rejects(lstat(f.directoryPath),{code:'ENOENT'});assert.deepEqual(await readdir(created.path),[])
 }finally{await f.cleanup()}
})
test('ST24-02: saturated container fails before creation and preserves all 1000 unknown neighbors',async()=>{
 const f=await fixture()
 try{
  for(let batch=0;batch<999;batch+=40)await Promise.all(Array.from({length:Math.min(40,999-batch)},(_,i)=>writeFile(join(f.parentPath,'unknown-'+(batch+i)),'foreign')))
  await assert.rejects(createApplicationStagingParent(f.parent,f.guard),(error:unknown)=>safe(error)&&(error as ApplicationStagingError).code==='APPLICATION_STAGING_LIMIT')
  assert.equal((await readdir(f.parentPath)).length,1000);assert.equal(await readFile(join(f.parentPath,'unknown-998'),'utf8'),'foreign')
 }finally{await f.cleanup()}
})
test('ST24-03: cleanup cannot widen a UUID direct-child grant to a root, nested child or escaped forged tree',async()=>{
 const f=await fixture()
 try{
  await assert.rejects(cleanupApplicationStaging(f.parent,f.parent,f.tree,f.guard),safe)
  const nested=join(f.directoryPath,randomUUID());await mkdir(nested)
  await assert.rejects(cleanupApplicationStaging(f.parent,await directoryIdentity(nested),await inspectTree(await directoryIdentity(nested),()=>{}),f.guard),safe)
  const bad=structuredClone(f.tree);bad.files[0].path='../outside'
  await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,bad,f.guard),safe)
  assert.equal(await readFile(join(f.directoryPath,'a.json'),'utf8'),'first captured metadata')
 }finally{await f.cleanup()}
})
test('ST24-04: a preexisting unknown child blocks every deletion; it is never learned into the supplied seal',async()=>{
 const f=await fixture()
 try{
  await writeFile(join(f.directoryPath,'data/unknown'),'keep unknown')
  await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,f.guard),safe)
  assert.equal(await readFile(join(f.directoryPath,'a.json'),'utf8'),'first captured metadata');assert.equal(await readFile(join(f.directoryPath,'data/b.bin'),'utf8'),'second captured database bytes')
  assert.equal(await readFile(join(f.directoryPath,'data/unknown'),'utf8'),'keep unknown')
 }finally{await f.cleanup()}
})
test('ST24-05: same-byte replacement and same-inode changed content fail initial seal without removing original or replacement bytes',async()=>{
 for(const kind of ['replacement','content']){
  const f=await fixture()
  try{
   if(kind==='replacement')await rename(join(f.directoryPath,'a.json'),join(f.base,'retained-original'))
   await writeFile(join(f.directoryPath,'a.json'),kind==='replacement'?'first captured metadata':'different current contents')
   await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,f.guard),safe)
   assert.equal(await readFile(join(f.directoryPath,'data/b.bin'),'utf8'),'second captured database bytes')
   if(kind==='replacement')assert.equal(await readFile(join(f.base,'retained-original'),'utf8'),'first captured metadata')
   assert.equal(await readFile(join(f.directoryPath,'a.json'),'utf8'),kind==='replacement'?'first captured metadata':'different current contents')
  }finally{await f.cleanup()}
 }
})
test('ST24-06: symlink, hardlink and replaced ancestor directories are never deletion authority',async()=>{
 for(const kind of ['symlink','hardlink','ancestor']){
  const f=await fixture()
  try{
   if(kind==='ancestor'){
    await rename(join(f.directoryPath,'data'),join(f.base,'original-data'));await mkdir(join(f.directoryPath,'data'));await writeFile(join(f.directoryPath,'data/b.bin'),'foreign database')
   }else{
    await writeFile(join(f.base,'outside'),'foreign linked data');await rm(join(f.directoryPath,'a.json'))
    if(kind==='symlink')await symlink(join(f.base,'outside'),join(f.directoryPath,'a.json'));else await link(join(f.base,'outside'),join(f.directoryPath,'a.json'))
   }
   await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,f.guard),safe)
   if(kind==='ancestor')assert.equal(await readFile(join(f.base,'original-data/b.bin'),'utf8'),'second captured database bytes')
   else assert.equal(await readFile(join(f.base,'outside'),'utf8'),'foreign linked data')
  }finally{await f.cleanup()}
 }
})
test('ST24-07: already-cancelled or lost-owner cleanup preserves every captured byte',async()=>{
 for(const kind of ['cancel','owner']){
  const f=await fixture();const controller=new AbortController()
  try{
   if(kind==='cancel')controller.abort()
   await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,kind==='owner'?async()=>{throw Error('private owner lost')}:f.guard,controller.signal),safe)
   assert.equal(await readFile(join(f.directoryPath,'a.json'),'utf8'),'first captured metadata');assert.equal(await readFile(join(f.directoryPath,'data/b.bin'),'utf8'),'second captured database bytes')
  }finally{await f.cleanup()}
 }
})
test('ST24-08: cancellation waits for actual asynchronous ownership IO and prevents all later deletion',async()=>{
 const f=await fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),controller=new AbortController();let pending:Promise<unknown>|undefined
 try{
  const guard=async()=>{entered.resolve();await release.promise}
  let settled=false;pending=cleanupApplicationStaging(f.parent,f.directory,f.tree,guard,controller.signal);void pending.then(()=>{settled=true},()=>{settled=true})
  await entered.promise;controller.abort();await new Promise(setImmediate);assert.equal(settled,false)
  release.resolve();await assert.rejects(pending,safe)
  assert.equal(await readFile(join(f.directoryPath,'a.json'),'utf8'),'first captured metadata')
 }finally{release.resolve();await pending?.catch(()=>{});await f.cleanup()}
})
test('ST24-09: a foreign file replacement in an async guard after the first unlink survives, and the error reports only actual prior removals',async()=>{
 const f=await fixture();let replaced=false
 try{
  const guard=async()=>{
   if(!replaced&&!(await readFile(join(f.directoryPath,'a.json')).then(()=>true,()=>false))){
    replaced=true;await rename(join(f.directoryPath,'data/b.bin'),join(f.base,'original-b'));await writeFile(join(f.directoryPath,'data/b.bin'),'foreign replacement')
   }
  }
  await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,guard),(error:unknown)=>safe(error)&&(error as ApplicationStagingError).removedFiles===1)
  assert.equal(replaced,true);assert.equal(await readFile(join(f.directoryPath,'data/b.bin'),'utf8'),'foreign replacement');assert.equal(await readFile(join(f.base,'original-b'),'utf8'),'second captured database bytes')
 }finally{await f.cleanup()}
})
test('ST24-10: a late unknown neighbor survives non-recursive rmdir and produces retained partial cleanup, never success',async()=>{
 const f=await fixture();let inserted=false
 try{
  const guard=async()=>{
   if(!inserted&&!(await readFile(join(f.directoryPath,'a.json')).then(()=>true,()=>false))){inserted=true;await writeFile(join(f.directoryPath,'data/unknown'),'foreign late neighbor')}
  }
  await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,guard),(error:unknown)=>safe(error)&&(error as ApplicationStagingError).removedFiles===2)
  assert.equal(inserted,true);assert.equal(await readFile(join(f.directoryPath,'data/unknown'),'utf8'),'foreign late neighbor');await assert.rejects(readFile(join(f.directoryPath,'data/b.bin')),{code:'ENOENT'})
 }finally{await f.cleanup()}
})
test('ST24-11: actual unlink EIO rejects with safe partial counts, preserves remaining files and performs no recursive deletion',async()=>{
 const f=await fixture(),original=fs.unlinkSync;let calls=0
 try{
  const mocked=mock.method(fs,'unlinkSync',(path:fs.PathLike)=>{if(++calls===2)throw Object.assign(Error('private staging syscall path'),{code:'EIO'});return original(path)});syncBuiltinESMExports()
  try{await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,f.guard),(error:unknown)=>safe(error)&&(error as ApplicationStagingError).removedFiles===1&&!/private/.test((error as Error).message))}
  finally{mocked.mock.restore();syncBuiltinESMExports()}
  assert.equal(await readFile(join(f.directoryPath,'data/b.bin'),'utf8'),'second captured database bytes');assert.equal((await lstat(join(f.directoryPath,'data/empty'))).isDirectory(),true)
 }finally{fs.unlinkSync=original;syncBuiltinESMExports();await f.cleanup()}
})
test('ST24-12: concurrent cleanup cannot publish duplicate removals or release the active owner before its guard settles',async()=>{
 const f=await fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let pending:Promise<unknown>|undefined
 try{
  pending=cleanupApplicationStaging(f.parent,f.directory,f.tree,async()=>{entered.resolve();await release.promise});void pending.catch(()=>{})
  await entered.promise
  await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,f.guard),(error:unknown)=>safe(error)&&(error as ApplicationStagingError).code==='APPLICATION_STAGING_BUSY')
  assert.equal(await readFile(join(f.directoryPath,'a.json'),'utf8'),'first captured metadata')
  release.resolve();await pending;await assert.rejects(lstat(f.directoryPath),{code:'ENOENT'})
 }finally{release.resolve();await pending?.catch(()=>{});await f.cleanup()}
})
test('ST24-13: a newly created parent gaining a foreign neighbor in its last owner check cannot be reported as an empty new staging parent',async()=>{
 const f=await fixture();let introduced=false,created=''
 try{
  const before=new Set(await readdir(f.parentPath))
  const guard=async()=>{
   const added=(await readdir(f.parentPath)).filter(name=>!before.has(name))
   if(added.length){created=join(f.parentPath,added[0]);await writeFile(join(created,'foreign'),'late foreign bytes');introduced=true}
  }
  await assert.rejects(createApplicationStagingParent(f.parent,guard),safe)
  assert.equal(introduced,true);assert.equal(await readFile(join(created,'foreign'),'utf8'),'late foreign bytes')
 }finally{await f.cleanup()}
})
test('ST24-14: an exclusive UUID collision must retain an existing directory without adopting or deleting it',async()=>{
 const f=await fixture();const cryptoModule=await import('node:crypto');const mutable=cryptoModule.default
 try{
  const name=f.directoryPath.slice(f.parentPath.length+1)
  const mocked=mock.method(mutable,'randomUUID',()=>name as ReturnType<typeof crypto.randomUUID>);syncBuiltinESMExports()
  try{await assert.rejects(createApplicationStagingParent(f.parent,f.guard),safe)}finally{mocked.mock.restore();syncBuiltinESMExports()}
  assert.equal(await readFile(join(f.directoryPath,'a.json'),'utf8'),'first captured metadata');assert.deepEqual(await readdir(f.parentPath),[name])
 }finally{await f.cleanup()}
})
test('ST24-15: replacement of an ancestor inside a guard after the first unlink cannot delete anything in the foreign replacement',async()=>{
 const f=await fixture();let replaced=false
 try{
  const guard=async()=>{
   if(!replaced&&!(await readFile(join(f.directoryPath,'a.json')).then(()=>true,()=>false))){
    replaced=true;await rename(join(f.directoryPath,'data'),join(f.base,'preserved-data'));await mkdir(join(f.directoryPath,'data'));await writeFile(join(f.directoryPath,'data/b.bin'),'foreign in replacement ancestor')
   }
  }
  await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,guard),(error:unknown)=>safe(error)&&(error as ApplicationStagingError).removedFiles===1)
  assert.equal(await readFile(join(f.directoryPath,'data/b.bin'),'utf8'),'foreign in replacement ancestor');assert.equal(await readFile(join(f.base,'preserved-data/b.bin'),'utf8'),'second captured database bytes')
 }finally{await f.cleanup()}
})
test('ST24-16: a recreated UUID directory after original rmdir is foreign and never removed or reported as completed cleanup',async()=>{
 const f=await fixture();let replaced=false
 try{
  const guard=async()=>{
   if(!replaced&&!(await lstat(f.directoryPath).then(()=>true,()=>false))){replaced=true;await mkdir(f.directoryPath);await writeFile(join(f.directoryPath,'foreign'),'foreign after original cleanup')}
  }
  await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,guard),(error:unknown)=>safe(error)&&(error as ApplicationStagingError).removedFiles===2&&(error as ApplicationStagingError).removedDirectories===3)
  assert.equal(replaced,true);assert.equal(await readFile(join(f.directoryPath,'foreign'),'utf8'),'foreign after original cleanup')
 }finally{await f.cleanup()}
})
test('ST24-17: caller mutations during asynchronous authorization cannot expand the immutable captured tree or directory grant',async()=>{
 const f=await fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let pending:Promise<unknown>|undefined,first=true
 try{
  const directory={...f.directory},tree=structuredClone(f.tree)
  pending=cleanupApplicationStaging(f.parent,directory,tree,async()=>{if(first){first=false;entered.resolve();await release.promise}});void pending.catch(()=>{})
  await entered.promise;directory.path=f.base;tree.files[0].path='../outside';release.resolve()
  await pending;await assert.rejects(lstat(f.directoryPath),{code:'ENOENT'});assert.equal((await lstat(f.base)).isDirectory(),true)
 }finally{release.resolve();await pending?.catch(()=>{});await f.cleanup()}
})
test('ST24-18: last-slot concurrent creators and late parent neighbors cannot exceed the capacity while claiming success',async()=>{
 for(const kind of ['concurrent','late']){
  const f=await fixture()
  try{
   for(let batch=0;batch<998;batch+=40)await Promise.all(Array.from({length:Math.min(40,998-batch)},(_,i)=>writeFile(join(f.parentPath,'unknown-'+(batch+i)),'foreign')))
   if(kind==='concurrent'){
    const results=await Promise.allSettled([createApplicationStagingParent(f.parent,f.guard),createApplicationStagingParent(f.parent,f.guard)])
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1)
    assert.equal((await readdir(f.parentPath)).length,1000)
   }else{
    const before=new Set(await readdir(f.parentPath));let inserted=false
    const guard=async()=>{if(!inserted&&(await readdir(f.parentPath)).some(name=>!before.has(name))){inserted=true;await writeFile(join(f.parentPath,'late-unknown'),'late foreign')}}
    await assert.rejects(createApplicationStagingParent(f.parent,guard),(error:unknown)=>safe(error)&&(error as ApplicationStagingError).code==='APPLICATION_STAGING_LIMIT')
    assert.equal(inserted,true);assert.equal((await readdir(f.parentPath)).length,1001);assert.equal(await readFile(join(f.parentPath,'late-unknown'),'utf8'),'late foreign')
   }
   assert.equal(await readFile(join(f.parentPath,'unknown-997'),'utf8'),'foreign')
  }finally{await f.cleanup()}
 }
})
test('ST24-19: cancellation does not release busy while a real post-unlink directory fsync is still physically pending',async()=>{
 const f=await fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),controller=new AbortController();let pending:Promise<unknown>|undefined
 const handle=await fs.promises.open(f.directoryPath,'r'),prototype=Object.getPrototypeOf(handle),originalSync=prototype.sync;await handle.close()
 const mocked=mock.method(prototype,'sync',async function(this:{fd:number}){
  const info=fs.fstatSync(this.fd,{bigint:true})
  if(info.isDirectory()&&String(info.ino)===f.directory.inode){entered.resolve();await release.promise}
  return originalSync.call(this)
 })
 try{
  let settled=false;pending=cleanupApplicationStaging(f.parent,f.directory,f.tree,f.guard,controller.signal);void pending.then(()=>{settled=true},()=>{settled=true})
  await entered.promise;controller.abort();await new Promise(setImmediate);assert.equal(settled,false)
  await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,f.guard),(error:unknown)=>safe(error)&&(error as ApplicationStagingError).code==='APPLICATION_STAGING_BUSY')
  release.resolve();await assert.rejects(pending,(error:unknown)=>safe(error)&&(error as ApplicationStagingError).removedFiles===1)
  assert.equal(await readFile(join(f.directoryPath,'data/b.bin'),'utf8'),'second captured database bytes')
 }finally{release.resolve();await pending?.catch(()=>{});mocked.mock.restore();await f.cleanup()}
})
test('ST24-20: real directory fsync or rmdir faults cannot disappear into successful cleanup or erase remaining directories',async()=>{
 for(const fault of ['sync','rmdir']){
  const f=await fixture();let restore=()=>{}
  try{
   if(fault==='sync'){
    const handle=await fs.promises.open(f.directoryPath,'r'),prototype=Object.getPrototypeOf(handle),original=prototype.sync;await handle.close()
    const mocked=mock.method(prototype,'sync',function(this:{fd:number}){const info=fs.fstatSync(this.fd,{bigint:true});if(info.isDirectory()&&String(info.ino)===f.directory.inode)throw Error('private fsync error');return original.call(this)})
    restore=()=>mocked.mock.restore()
   }else{const mocked=mock.method(fs,'rmdirSync',()=>{throw Object.assign(Error('private busy directory'),{code:'EBUSY'})});syncBuiltinESMExports();restore=()=>{mocked.mock.restore();syncBuiltinESMExports()}}
   await assert.rejects(cleanupApplicationStaging(f.parent,f.directory,f.tree,f.guard),(error:unknown)=>safe(error)&&(error as ApplicationStagingError).removedFiles===(fault==='sync'?1:2)&&(error as ApplicationStagingError).removedDirectories===0)
   restore();restore=()=>{}
   assert.equal((await lstat(join(f.directoryPath,'data/empty'))).isDirectory(),true)
   if(fault==='sync')assert.equal(await readFile(join(f.directoryPath,'data/b.bin'),'utf8'),'second captured database bytes')
  }finally{restore();await f.cleanup()}
 }
})
test('ST24-21: 1400 sealed real files are reclaimed without a complete remaining-tree rescan per unlink',async()=>{
 const f=await fixture();let scans=0
 try{
  for(let batch=0;batch<1400;batch+=40)await Promise.all(Array.from({length:40},(_,i)=>writeFile(join(f.directoryPath,'data','owned-'+(batch+i)),String(batch+i))))
  const tree=await inspectTree(f.directory,()=>{}),original=fs.readdirSync
  const mocked=mock.method(fs,'readdirSync',((...args:unknown[])=>{scans++;return (original as Function)(...args)}) as typeof fs.readdirSync);syncBuiltinESMExports()
  let result
  try{result=await cleanupApplicationStaging(f.parent,f.directory,tree,f.guard)}finally{mocked.mock.restore();syncBuiltinESMExports()}
  assert.equal(result.removedFiles,1402);assert.ok(scans<=20,`whole-directory scans must not grow per file: ${scans}`)
  await assert.rejects(lstat(f.directoryPath),{code:'ENOENT'})
 }finally{await f.cleanup()}
})
