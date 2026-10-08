import assert from 'node:assert/strict'
import {test,type TestContext} from 'node:test'
import {mkdtemp,mkdir,realpath,readFile,writeFile,rm,readdir,rename} from 'node:fs/promises'
import {writeFileSync,renameSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {Workspaces} from '../../desktop/service/workspaces'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {ApplicationRestoreProtectedService} from '../../desktop/main/application-restore-protected-service'

async function fixture(t:TestContext){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-protected-service36-'))),boot=join(base,'bootstrap'),root=join(base,'root'),work=join(base,'work'),appId=randomUUID()
 for(const path of[boot,root,work])await mkdir(path)
 await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}))
 const physicalWork=await directoryIdentity(work),catalog={schemaVersion:1,revision:1,value:[{id:randomUUID(),novelId:'protected-work',title:'do not initialize',path:work,identity:{device:physicalWork.device,inode:physicalWork.inode},requestId:randomUUID(),requestHash:'a'.repeat(64),createdAt:'2026-10-08T00:00:00.000Z'}]}
 await writeFile(join(root,'catalog.json'),JSON.stringify(catalog));await mkdir(join(root,'inbox/database'),{recursive:true});await writeFile(join(root,'inbox/database/PG_VERSION'),'damaged source is never opened');await writeFile(join(work,'private-author.txt'),'preserve exact work bytes')
 const bootstrap=await directoryIdentity(boot),identity=await directoryIdentity(root),pointer=await new DataRootManager(boot,root).adopt(identity)
 let lock=true,opens=0,initializations=0
 t.mock.method(PGlite,'create',async()=>{opens++;throw Error('protected service must not open any engine')})
 t.mock.method(Workspaces.prototype,'initialize',async()=>{initializations++;throw Error('protected service must not initialize workspaces')})
 const host={assertLock(){if(!lock)throw Error('native instance lock revoked')}},service=new ApplicationRestoreProtectedService(bootstrap,identity,host.assertLock)
 t.after(async()=>{service.dispose();await service.call('close').catch(()=>{});await rm(base,{recursive:true,force:true})})
 return{base,boot,root,work,bootstrap,identity,pointer,catalog,service,host,revoke(){lock=false},counts(){assert.equal(opens,0);assert.equal(initializations,0)}}
}
test('APS36-01 only actual readonly protected directories and no-worker status are exposed; broken database and work bytes stay untouched',async t=>{
 const f=await fixture(t),before=await readFile(join(f.root,'catalog.json')),pointer=await readFile(join(f.boot,'data-root.json')),files=await readdir(f.root)
 assert.deepEqual(await f.service.call('protected-directories'),[f.work]);assert.deepEqual(await f.service.call('task-status'),{active:0})
 assert.equal(await f.service.call('ready'),true);assert.equal(await f.service.call('stop-tasks'),true)
 assert.deepEqual(await readFile(join(f.root,'catalog.json')),before);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),pointer);assert.deepEqual(await readdir(f.root),files)
 assert.equal(await readFile(join(f.root,'inbox/database/PG_VERSION'),'utf8'),'damaged source is never opened');assert.equal(await readFile(join(f.work,'private-author.txt'),'utf8'),'preserve exact work bytes');f.counts()
})
test('APS36-02 unknown business/model/SQL methods and all renderer payload values are rejected without initialization',async t=>{
 const f=await fixture(t)
 for(const method of['start','read','create-work','open-work','application-backup','conversation.create-work','model.send','SQL','initialize','ready '])await assert.rejects(f.service.call(method))
 for(const method of['ready','stop-tasks','task-status','protected-directories','close'])for(const value of[null,{},false,'/forged'])await assert.rejects(f.service.call(method,value))
 assert.deepEqual(await f.service.call('protected-directories'),[f.work]);f.counts()
})
test('APS36-03 close drains its actual admitted readonly flight, closes admission immediately and remains idempotent',async t=>{
 const f=await fixture(t),reading=f.service.call<string[]>('protected-directories'),closing=f.service.call('close')
 assert.equal(closing,f.service.call('close'));let settled=false;void closing.then(()=>{settled=true})
 await Promise.resolve();assert.equal(settled,false);await assert.rejects(f.service.call('task-status'));assert.deepEqual(await reading,[f.work]);assert.equal(await closing,true)
 for(const method of['protected-directories','task-status','stop-tasks','ready'])await assert.rejects(f.service.call(method));assert.equal(await f.service.call('close'),true);f.counts()
})
test('APS36-04 dispose revokes an admitted readonly result, leaves its real flight drainable and never restores service by public host replacement',async t=>{
 const f=await fixture(t),reading=f.service.call('protected-directories'),rejected=assert.rejects(reading)
 await Promise.resolve();f.service.dispose();await rejected;assert.equal(await f.service.call('close'),true);await assert.rejects(f.service.call('ready'));f.counts()
})
for(const change of['catalog-bytes','catalog-inode','pointer','root-marker','root-directory','work-availability','lock']as const)test(`APS36-05 ${change} changes during the actual readonly flight cannot return stale protection`,async t=>{
 const f=await fixture(t),reading=f.service.call('protected-directories'),rejected=assert.rejects(reading)
 await Promise.resolve()
 if(change==='catalog-bytes')writeFileSync(join(f.root,'catalog.json'),JSON.stringify({...f.catalog,revision:2}))
 if(change==='catalog-inode'){const bytes=JSON.stringify(f.catalog);renameSync(join(f.root,'catalog.json'),join(f.root,'catalog.retained'));writeFileSync(join(f.root,'catalog.json'),bytes)}
 if(change==='pointer')writeFileSync(join(f.boot,'data-root.json'),JSON.stringify({...f.pointer,revision:f.pointer.revision+1}))
 if(change==='root-marker')writeFileSync(join(f.root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}))
 if(change==='root-directory')renameSync(f.root,f.root+'.retained')
 if(change==='work-availability')renameSync(f.work,f.work+'.retained')
 if(change==='lock'){f.revoke();f.host.assertLock=()=>{};(f.service as unknown as {assertLock:()=>void}).assertLock=()=>{}}
 await rejected;assert.equal(await f.service.call('close'),true);f.counts()
})
test('APS36-06 each new call captures fresh authoritative catalog bytes, while constructor inputs cannot rebind an existing service',async t=>{
 const f=await fixture(t);assert.deepEqual(await f.service.call('protected-directories'),[f.work])
 await writeFile(join(f.root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:2,value:[]}));assert.deepEqual(await f.service.call('protected-directories'),[])
 f.identity.path='/caller-replaced-root';f.bootstrap.path='/caller-replaced-bootstrap';assert.deepEqual(await f.service.call('task-status'),{active:0});f.counts()
})
test('APS36-07 a physically different same-app root and asynchronous lock assertion cannot construct a protected service',async t=>{
 const f=await fixture(t),other=join(f.base,'other-root');await mkdir(other);await writeFile(join(other,'xuanxiang-app.json'),await readFile(join(f.root,'xuanxiang-app.json')));await writeFile(join(other,'catalog.json'),JSON.stringify(f.catalog))
 assert.throws(()=>new ApplicationRestoreProtectedService(f.bootstrap,{...f.identity,path:other},()=>{}));assert.throws(()=>new ApplicationRestoreProtectedService(f.bootstrap,f.identity,async()=>{}));f.counts()
})
test('APS36-08 unknown or malformed catalog ownership blocks protected export paths without writes or repairing the source',async t=>{
 const f=await fixture(t),pointer=await readFile(join(f.boot,'data-root.json'))
 for(const body of[{...f.catalog,extra:'unknown'}, {...f.catalog,value:[{...f.catalog.value[0],path:'../unsafe'}]}, {schemaVersion:1,revision:3,value:[{...f.catalog.value[0],identity:{device:'unknown',inode:'unknown'}}]}]){
  const bytes=JSON.stringify(body);await writeFile(join(f.root,'catalog.json'),bytes);await assert.rejects(f.service.call('protected-directories'));assert.equal(await readFile(join(f.root,'catalog.json'),'utf8'),bytes);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),pointer)
 }f.counts()
})
