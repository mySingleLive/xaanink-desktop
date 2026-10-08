import assert from 'node:assert/strict'
import {test} from 'node:test'
import fs from 'node:fs'
import {syncBuiltinESMExports} from 'node:module'
import {once} from 'node:events'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {hostname,tmpdir} from 'node:os'
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm,lstat,rename,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {inboxLeaseRecoveryRequired,prepareInboxLeaseRecovery,type InboxLeaseRecoveryOptions} from '../../desktop/main/inbox-lease-recovery'

const deadPid=(async()=>{const child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});await once(child,'exit');assert.ok(child.pid);assert.throws(()=>process.kill(child.pid!,0),{code:'ESRCH'});return child.pid!})()
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-inbox116-'))),boot=join(base,'bootstrap'),root=join(base,'root'),inbox=join(root,'inbox'),database=join(inbox,'database'),lock=join(inbox,'.xuanxiang-lock'),audit=join(inbox,'.xuanxiang-lease-recovery.json'),ownerPath=join(lock,'owner.json')
 await mkdir(boot);await mkdir(database,{recursive:true});await mkdir(lock)
 await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}))
 await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));await writeFile(join(database,'original.bin'),'original inbox bytes')
 const bytes=JSON.stringify({token:randomUUID(),pid:await deadPid,host:hostname()});await writeFile(ownerPath,bytes)
 const pointer=await new DataRootManager(boot,root).adopt(await directoryIdentity(root))
 let live=true
 const options:InboxLeaseRecoveryOptions={assertColdHost(){if(!live)throw Error('native lifetime revoked')}}
 return{base,boot,root,inbox,database,lock,audit,ownerPath,bytes,pointer,options,revoke(){live=false},cleanup:()=>rm(base,{recursive:true,force:true})}
}

test('IL116-R01 a revoked original host callback cannot be replaced with a noop after a genuine prepare',async()=>{
 const f=await fixture();try{
  const session=await prepareInboxLeaseRecovery(f.boot,f.options)
  f.revoke();f.options.assertColdHost=()=>{}
  await assert.rejects(session.recover(true),'original native lifetime must remain required')
  assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes)
  await assert.rejects(lstat(f.audit),{code:'ENOENT'})
 }finally{await f.cleanup()}
})

test('IL116-R02 completed audit replaced during the subsequent lock probe cannot classify startup as normal',async()=>{
 const f=await fixture(),original=fs.lstatSync;let injected=false
 try{
  const session=await prepareInboxLeaseRecovery(f.boot,f.options)
  assert.equal((await session.recover(true)).status,'recovered')
  assert.equal(inboxLeaseRecoveryRequired(f.pointer),false)
  const replacement=((path:fs.PathLike,...args:unknown[])=>{
   try{return(original as (...values:unknown[])=>unknown)(path,...args)}catch(error){
    if(String(path)===f.lock&&(error as NodeJS.ErrnoException).code==='ENOENT'&&!injected){injected=true;fs.writeFileSync(f.audit,'unknown audit after prior observation')}
    throw error
   }
  }) as typeof fs.lstatSync
  Object.defineProperty(fs,'lstatSync',{value:replacement})
  syncBuiltinESMExports()
  assert.throws(()=>inboxLeaseRecoveryRequired(f.pointer),'a changed unknown audit must block ordinary startup')
  assert.equal(injected,true)
  assert.equal(await readFile(f.audit,'utf8'),'unknown audit after prior observation')
 }finally{Object.defineProperty(fs,'lstatSync',{value:original});syncBuiltinESMExports();await f.cleanup()}
})

test('IL116-C03 genuine observed audit with no lock requires fresh confirmation before completion',async()=>{
 const f=await fixture();try{
  let commits=0;f.options.hook=phase=>{if(phase==='before-audit-rename'&&++commits===2)throw Error('isolated final receipt IO interruption')}
  const first=await prepareInboxLeaseRecovery(f.boot,f.options)
  assert.equal((await first.recover(true)).status,'cleanup-pending')
  await assert.rejects(lstat(f.lock),{code:'ENOENT'});assert.equal(JSON.parse(await readFile(f.audit,'utf8')).payload.phase,'observed')
  assert.equal(inboxLeaseRecoveryRequired(f.pointer),true);first.cancel();delete f.options.hook
  const next=await prepareInboxLeaseRecovery(f.boot,f.options)
  assert.equal(next.preview.stage,'lock-absent');assert.notEqual(next.preview.requestId,first.preview.requestId)
  await assert.rejects(next.recover(false));assert.equal((await next.recover(true)).status,'recovered')
  assert.equal(inboxLeaseRecoveryRequired(f.pointer),false);assert.equal(await readFile(join(f.database,'original.bin'),'utf8'),'original inbox bytes')
 }finally{await f.cleanup()}
})

test('IL116-C04 same-byte marker replacement and database inode replacement before unlink preserve the original owner',async()=>{
 for(const kind of ['marker','database']){const f=await fixture();try{
  const session=await prepareInboxLeaseRecovery(f.boot,f.options)
  f.options.hook=async phase=>{if(phase!=='before-owner-unlink')return
   if(kind==='marker'){const path=join(f.root,'xuanxiang-app.json'),bytes=await readFile(path);await rename(path,path+'.original');await writeFile(path,bytes)}
   else{await rename(f.database,f.database+'.original');await mkdir(f.database)}
  }
  await assert.rejects(session.recover(true));assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes)
  assert.equal(await readFile(join(kind==='database'?f.database+'.original':f.database,'original.bin'),'utf8'),'original inbox bytes')
 }finally{await f.cleanup()}}
})

test('IL116-C05 a cached recovered request cannot approve a subsequently arrived writer lease',async()=>{
 const f=await fixture();try{
  const session=await prepareInboxLeaseRecovery(f.boot,f.options);assert.equal((await session.recover(true)).status,'recovered')
  await mkdir(f.lock);const newOwner=JSON.stringify({token:randomUUID(),pid:process.pid,host:hostname()});await writeFile(f.ownerPath,newOwner)
  await assert.rejects(session.recover(true));assert.equal(await readFile(f.ownerPath,'utf8'),newOwner);assert.deepEqual(await readdir(f.lock),['owner.json'])
 }finally{await f.cleanup()}
})

test('IL116-R03 a new lease appearing during recovered-audit observation must fail the final completion seal',async()=>{
 const f=await fixture(),original=fs.openSync;let injected=false
 const newOwner=JSON.stringify({token:randomUUID(),pid:process.pid,host:hostname()})
 try{
  const session=await prepareInboxLeaseRecovery(f.boot,f.options);assert.equal((await session.recover(true)).status,'recovered');session.assertRecovered()
  fs.openSync=((path:fs.PathLike,...args:unknown[])=>{
   const fd=(original as (...values:unknown[])=>number)(path,...args)
   if(String(path)===f.audit&&!injected){injected=true;fs.mkdirSync(f.lock);fs.writeFileSync(f.ownerPath,newOwner)}
   return fd
  }) as typeof fs.openSync
  syncBuiltinESMExports()
  assert.throws(()=>session.assertRecovered(),'completion must reject a new lease before returning its final seal')
  assert.equal(injected,true);assert.equal(await readFile(f.ownerPath,'utf8'),newOwner)
 }finally{fs.openSync=original;syncBuiltinESMExports();await f.cleanup()}
})
