import assert from 'node:assert/strict'
import {test,type TestContext} from 'node:test'
import {constants} from 'node:fs'
import fsPromises from 'node:fs/promises'
import {mkdtemp,mkdir,realpath,writeFile,readFile,readdir,rename,rm,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {preserveClosedApplicationSource,validateApplicationColdSourceProof,ApplicationColdSourceError,type ApplicationColdSourceHost} from '../../desktop/core/application-cold-source'

const refused=(cause:unknown)=>cause instanceof ApplicationColdSourceError&&/^APPLICATION_COLD_SOURCE_[A-Z_]+$/.test(cause.message)&&!Object.hasOwn(cause,'cause')
async function fixture(t:TestContext){
 let engineOpens=0,live=true
 t.mock.method(PGlite,'create',async()=>{engineOpens++;throw Error('review raw source cannot open engine')})
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review104-closed-'))),source=join(base,'source'),boot=join(base,'bootstrap'),parent=join(base,randomUUID()),candidateParent=join(base,randomUUID()),appId=randomUUID(),operationId=randomUUID()
 for(const path of[source,boot,parent,candidateParent])await mkdir(path)
 for(const path of['inbox/database/pg_wal/archive_status','assets/global','session/Local Storage/leveldb','backups','unknown-local'])await mkdir(join(source,path),{recursive:true})
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}));await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));await writeFile(join(source,'inbox/database/PG_VERSION'),Buffer.from([0,255,4,8]));await writeFile(join(source,'state.json'),'{"state":"original local bytes"}');await writeFile(join(source,'session/Local Storage/leveldb/CURRENT'),'closed local session');await writeFile(join(source,'unknown-local/owned-by-user.txt'),'stay original');await writeFile(join(source,'backups/old-package.txt'),'stay original');const avatar=randomUUID()+'.png';await writeFile(join(source,'assets/global',avatar),Buffer.from([137,80,78,71]))
 const journal=new DraftJournal(source),deactivate=journal.activate('old');await journal.persist('old',{version:1,revision:8,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft:'full unsent source',request:{approved:true,body:'never execute'}},staged:{request:{approved:true,method:'POST'}}},issues:[]});deactivate()
 const root=await directoryIdentity(source),bootstrap=await directoryIdentity(boot),sourcePointer=await new DataRootManager(boot,source).adopt(root),input={operationId,bootstrap,parent:await directoryIdentity(parent),candidateParent:await directoryIdentity(candidateParent)},expected={operationId,bootstrap,appId,source:root,sourcePointer},host:ApplicationColdSourceHost={assertStableLock(){if(!live)throw Error('native grant expired')},assertCold(){if(!live)throw Error('cold grant expired')},assertOwnerImmediately(){if(!live)throw Error('directory grant expired')}}
 return{base,source,boot,parent,candidateParent,avatar,input,expected,host,engineOpens:()=>engineOpens,revoke(){live=false},close:()=>rm(base,{recursive:true,force:true})}
}

test('AR104-C01 the private source-only post-CAS seal protects raw bytes but cannot reconstruct the former pointer authority or an execution proof',{timeout:10000},async t=>{
 const f=await fixture(t)
 try{
  const originalDraft=await readFile(join(f.source,'drafts.json')),proof=await preserveClosedApplicationSource(f.input,f.host),verified=validateApplicationColdSourceProof(proof,f.expected);assert.equal(proof.receipt.health,'not-verified');assert.equal(f.engineOpens(),0);assert.deepEqual(await readFile(join(proof.receipt.data.path,'drafts.json')),originalDraft)
  proof.assertCurrent=()=>{};for(const mismatch of[{...f.expected,operationId:randomUUID()},{...f.expected,sourcePointer:{...f.expected.sourcePointer,revision:f.expected.sourcePointer.revision+1}},{...f.expected,source:{...f.expected.source,inode:'1'}}])assert.throws(()=>validateApplicationColdSourceProof(proof,mismatch),refused)
  const pointerFile=join(f.boot,'data-root.json'),pointerBytes=await readFile(pointerFile);await rename(pointerFile,pointerFile+'.old-owned');await writeFile(pointerFile,pointerBytes)
  assert.throws(()=>verified.assertCurrent());assert.equal(verified.assertSourceCurrent(),undefined,'source-only seal deliberately supplies no permission to change or inspect the new pointer')
  const unknown=join(f.source,'unknown-local');await rename(unknown,unknown+'.old-owned');await mkdir(unknown);await writeFile(join(unknown,'foreign.txt'),'foreign untouched')
  assert.throws(()=>verified.assertSourceCurrent(),refused);assert.equal(await readFile(join(unknown,'foreign.txt'),'utf8'),'foreign untouched');assert.equal(f.engineOpens(),0)
 }finally{await f.close()}
})

test('AR104-C02 cancellation during a real target write waits that physical IO, refuses proof and preserves an intervening foreign file replacement',{timeout:10000},async t=>{
 const f=await fixture(t),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),abort=new AbortController(),originalOpen=fsPromises.open;let target:string|undefined,settled=false
 t.mock.method(fsPromises,'open',async(...args:Parameters<typeof fsPromises.open>)=>{const handle=await originalOpen(...args),path=String(args[0]),flags=args[1];if(!target&&path.startsWith(f.parent+'/')&&path.endsWith('/data/state.json')&&typeof flags==='number'&&(flags&constants.O_WRONLY)){target=path;const originalWrite=handle.writeFile.bind(handle);t.mock.method(handle,'writeFile',async(...writeArgs:Parameters<typeof handle.writeFile>)=>{entered.resolve();await release.promise;return originalWrite(...writeArgs)})}return handle})
 const originalSource=await readFile(join(f.source,'state.json')),operation=preserveClosedApplicationSource(f.input,f.host,{signal:abort.signal});void operation.finally(()=>{settled=true}).catch(()=>{})
 try{
  await entered.promise;await rename(target!,target!+'.old-owned');await writeFile(target!,'foreign replacement must remain');abort.abort('private fixture cancellation');await new Promise(setImmediate);assert.equal(settled,false);release.resolve();await assert.rejects(operation,refused);assert.equal(await readFile(target!,'utf8'),'foreign replacement must remain');assert.deepEqual(await readFile(join(f.source,'state.json')),originalSource);assert.equal(f.engineOpens(),0)
  for(const id of await readdir(f.parent))await assert.rejects(readFile(join(f.parent,id,'xuanxiang-application-closed-source.json')),cause=>(cause as NodeJS.ErrnoException).code==='ENOENT')
 }finally{release.resolve();await operation.catch(()=>{});await f.close()}
})

test('AR104-C03 a managed directory replacement during yielded inventory IO cannot be learned as original ownership',{timeout:10000},async t=>{
 const f=await fixture(t),originalLstat=fsPromises.lstat;let replaced=false
 t.mock.method(fsPromises,'lstat',async(...args:Parameters<typeof fsPromises.lstat>)=>{if(!replaced&&String(args[0])===join(f.source,'state.json')){replaced=true;const old=join(f.source,'assets/global');await rename(old,old+'.old-owned');await mkdir(old);await writeFile(join(old,f.avatar),Buffer.from([137,80,78,71]))}return originalLstat(...args)})
 try{await assert.rejects(preserveClosedApplicationSource(f.input,f.host),refused);assert.equal(replaced,true);assert.deepEqual(await readFile(join(f.source,'assets/global',f.avatar)),Buffer.from([137,80,78,71]));assert.equal(f.engineOpens(),0);for(const id of await readdir(f.parent))await assert.rejects(readFile(join(f.parent,id,'xuanxiang-application-closed-source.json')),cause=>(cause as NodeJS.ErrnoException).code==='ENOENT')}finally{await f.close()}
})

test('AR104-C04 revoking captured native callbacks invalidates an already issued proof even after its public callback is replaced',{timeout:10000},async t=>{
 const f=await fixture(t)
 try{const proof=await preserveClosedApplicationSource(f.input,f.host),seal=validateApplicationColdSourceProof(proof,f.expected),bytes=await readFile(join(proof.receipt.directory.path,'xuanxiang-application-closed-source.json'));f.revoke();f.host.assertStableLock=()=>{};f.host.assertCold=()=>{};f.host.assertOwnerImmediately=()=>{};proof.assertCurrent=()=>{};assert.throws(()=>validateApplicationColdSourceProof(proof,f.expected),refused);assert.throws(()=>seal.assertCurrent(),refused);assert.throws(()=>seal.assertSourceCurrent(),refused);assert.deepEqual(await readFile(join(proof.receipt.directory.path,'xuanxiang-application-closed-source.json')),bytes);assert.equal(f.engineOpens(),0)}finally{await f.close()}
})

test('AR104-C05 a catalog work symlink alias cannot hide that the native preservation parent is physically inside a registered work',{timeout:10000},async t=>{
 const f=await fixture(t)
 try{
  const work=join(f.base,'actual-work'),alias=join(f.base,'catalog-work-alias');await mkdir(work);await symlink(work,alias);const selected=join(work,randomUUID());await mkdir(selected);const identity=await directoryIdentity(work),record={id:randomUUID(),path:alias,identity:{device:identity.device,inode:identity.inode},novelId:'isolated-never-open-work',title:'isolated fixture',requestId:randomUUID(),requestHash:'1'.repeat(64),createdAt:'2026-10-08T00:00:00.000Z'}
  await writeFile(join(f.source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[record]}));const input={...f.input,parent:await directoryIdentity(selected)}
  await assert.rejects(preserveClosedApplicationSource(input,f.host),refused,'work overlap is physical, not only lexical catalog path comparison');assert.deepEqual(await readdir(selected),[],'the native parent inside the work must not be populated');assert.equal(f.engineOpens(),0)
 }finally{await f.close()}
})
