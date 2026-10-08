import assert from 'node:assert/strict'
import {test} from 'node:test'
import fs from 'node:fs'
import promises, {mkdtemp,realpath,mkdir,writeFile,readFile,rm,lstat,readdir} from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {hostname,tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {WorkLeaseRecovery,WorkLeaseRecoveryError,WORK_LEASE_AUDIT_FILENAME,type WorkLeaseRecoveryOptions} from '../../desktop/core/work-lease-recovery'

const exitedPid=(async()=>{const child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});await once(child,'exit');assert.ok(child.pid);assert.throws(()=>process.kill(child.pid!,0),{code:'ESRCH'});return child.pid!})()
const safeFailure=(error:unknown)=>error instanceof WorkLeaseRecoveryError && !Object.hasOwn(error,'cause') && !/private|xuanxiang-lease87/i.test(error.message)
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-lease87-'))),lock=join(root,'.xuanxiang-lock'),ownerPath=join(lock,'owner.json');await mkdir(lock)
 const owner={token:randomUUID(),pid:await exitedPid,host:hostname()},bytes=JSON.stringify(owner);await writeFile(ownerPath,bytes)
 const original=join(root,'draft-unmanaged.txt');await writeFile(original,'original work content')
 let host=true;const confirmations=new Set<string>()
 const options:WorkLeaseRecoveryOptions={assertHost(){if(!host)throw Error('private authority lost')},assertWorkClosed(){},assertConfirmed(id){if(!confirmations.has(id))throw Error('private unconfirmed')}}
 const service=new WorkLeaseRecovery(options),work=await directoryIdentity(root)
 return{root,lock,ownerPath,bytes,original,owner,work,options,service,confirm:(id:string)=>confirmations.add(id),loseHost(){host=false},cleanup:()=>rm(root,{recursive:true,force:true})}
}

test('WL87-01 actual owner-unlink failure has a fixed safe error and preserves owner, work and inert audit',async()=>{
 const f=await fixture(),original=fs.unlinkSync;let reached=false
 try{
  const preview=await f.service.prepare(f.work);f.confirm(preview.requestId)
  fs.unlinkSync=((path:fs.PathLike)=>{if(String(path)===f.ownerPath){reached=true;throw Object.assign(Error(`private unlink failure ${f.ownerPath}`),{code:'EIO',path:f.ownerPath})}return original(path)}) as typeof fs.unlinkSync;syncBuiltinESMExports()
  await assert.rejects(f.service.recover(preview.requestId),safeFailure);assert.equal(reached,true)
  assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes);assert.equal(await readFile(f.original,'utf8'),'original work content')
  assert.equal(JSON.parse(await readFile(join(f.root,WORK_LEASE_AUDIT_FILENAME),'utf8')).payload.phase,'observed')
 }finally{fs.unlinkSync=original;syncBuiltinESMExports();await f.service.flush();await f.cleanup()}
})

test('WL87-02 actual lock-directory read failure cannot expose native path or untrusted cause',async()=>{
 const f=await fixture(),original=promises.readdir;let reached=false
 try{
  promises.readdir=(async(...args:Parameters<typeof promises.readdir>)=>{if(String(args[0])===f.lock){reached=true;throw Object.assign(Error(`private readdir failure ${f.lock}`),{code:'EACCES',path:f.lock})}return Reflect.apply(original,promises,args)}) as typeof promises.readdir;syncBuiltinESMExports()
  await assert.rejects(f.service.prepare(f.work),safeFailure);assert.equal(reached,true);assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes)
  await assert.rejects(lstat(join(f.root,WORK_LEASE_AUDIT_FILENAME)),{code:'ENOENT'})
 }finally{promises.readdir=original;syncBuiltinESMExports();await f.cleanup()}
})

test('WL87-03 host loss during the real asynchronous closed-work proof cannot publish a preview or modify owner',async()=>{
 const f=await fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>()
 try{
  f.options.assertWorkClosed=async()=>{entered.resolve();await release.promise}
  const preparing=f.service.prepare(f.work);void preparing.catch(()=>{});await entered.promise;f.loseHost();release.resolve()
  await assert.rejects(preparing,error=>error instanceof WorkLeaseRecoveryError&&error.code==='HOST_NOT_OWNED')
  assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes);await assert.rejects(lstat(join(f.root,WORK_LEASE_AUDIT_FILENAME)),{code:'ENOENT'})
 }finally{release.resolve();await f.cleanup()}
})

test('WL87-04 cancelled in-flight work is still drained and cannot be replaced with a new recovery while its closed proof waits',async()=>{
 const f=await fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>()
 try{
  const preview=await f.service.prepare(f.work);f.confirm(preview.requestId)
  f.options.assertWorkClosed=async()=>{entered.resolve();await release.promise}
  const recovering=f.service.recover(preview.requestId);void recovering.catch(()=>{});await entered.promise;f.service.cancel(preview.requestId)
  await assert.rejects(f.service.prepare(f.work),error=>error instanceof WorkLeaseRecoveryError&&error.code==='RECOVERY_BUSY')
  let drained=false;const draining=f.service.flush().then(()=>{drained=true});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(drained,false)
  release.resolve();await assert.rejects(recovering,error=>error instanceof WorkLeaseRecoveryError&&error.code==='REQUEST_INVALID');await draining
  assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes);await assert.rejects(lstat(join(f.root,WORK_LEASE_AUDIT_FILENAME)),{code:'ENOENT'})
 }finally{release.resolve();await f.service.flush();await f.cleanup()}
})

test('WL87-05 interrupted cleanup never removes a foreign neighbour, and a fresh instance needs a new explicit confirmation',async()=>{
 const f=await fixture()
 try{
  const preview=await f.service.prepare(f.work);f.confirm(preview.requestId)
  f.options.hook=phase=>{if(phase==='after-owner-unlink')throw Error('private interrupted cleanup')}
  assert.equal((await f.service.recover(preview.requestId)).status,'cleanup-pending');assert.deepEqual(await readdir(f.lock),[])
  delete f.options.hook;await writeFile(join(f.lock,'foreign-note.txt'),'keep unknown bytes')
  await assert.rejects(new WorkLeaseRecovery(f.options).prepare(f.work),error=>error instanceof WorkLeaseRecoveryError&&error.code==='LOCK_CONTENTS_UNKNOWN')
  assert.equal(await readFile(join(f.lock,'foreign-note.txt'),'utf8'),'keep unknown bytes');assert.equal(await readFile(f.original,'utf8'),'original work content')
  await promises.unlink(join(f.lock,'foreign-note.txt'))
  const next=new WorkLeaseRecovery(f.options),retry=await next.prepare(f.work)
  assert.equal(retry.stage,'empty-lock');assert.notEqual(retry.requestId,preview.requestId)
  await assert.rejects(next.recover(retry.requestId),error=>error instanceof WorkLeaseRecoveryError&&error.code==='CONFIRMATION_REQUIRED')
  assert.deepEqual(await readdir(f.lock),[]);f.confirm(retry.requestId);assert.equal((await next.recover(retry.requestId)).status,'recovered')
 }finally{await f.service.flush();await f.cleanup()}
})

test('WL87-06 pre-existing previews cannot bypass the 32-running-recovery limit',{timeout:10000},async()=>{
 const fixtures:Awaited<ReturnType<typeof fixture>>[]=[],release=Promise.withResolvers<void>(),flights:Promise<unknown>[]=[]
 try{
  for(let i=0;i<33;i++)fixtures.push(await fixture())
  const first=fixtures[0],previews=[]
  for(const f of fixtures){const preview=await first.service.prepare(f.work);first.confirm(preview.requestId);previews.push(preview)}
  first.options.assertWorkClosed=async()=>{await release.promise}
  for(const preview of previews.slice(0,32)){const flight=first.service.recover(preview.requestId);void flight.catch(()=>{});flights.push(flight)}
  const extra=first.service.recover(previews[32].requestId);void extra.catch(()=>{});flights.push(extra)
  let outcome='pending';void extra.then(()=>{outcome='allowed'},error=>{outcome=error instanceof WorkLeaseRecoveryError?error.code:'unsafe'})
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(outcome,'RECOVERY_BUSY','a prepared preview must not admit a 33rd physical recovery while the first 32 await the host')
  assert.equal(await readFile(fixtures[32].ownerPath,'utf8'),fixtures[32].bytes)
 }finally{release.resolve();await Promise.allSettled(flights);for(const f of fixtures)await f.cleanup()}
})
