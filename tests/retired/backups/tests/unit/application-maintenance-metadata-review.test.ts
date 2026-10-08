// Independent review 92: actual isolated files and original readers. No engine,
// activation, timer, main process or native lifecycle claim.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtemp,realpath,readFile,writeFile,rename,rm,lstat,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {VersionedStore} from '../../desktop/core/versioned-store'
import {backupPlanSchema} from '../../desktop/shared/backup-plan'
import {WorkRestoreDraftBarrier} from '../../desktop/main/work-restore-draft-barrier'
import {ApplicationMaintenanceMetadataError,validateApplicationMaintenanceMetadata} from '../../desktop/service/database/application-maintenance-metadata'

const noop=()=>{}
const safeError=(code:string)=>(error:unknown)=>error instanceof ApplicationMaintenanceMetadataError&&error.code===code&&error.message===code&&!Object.hasOwn(error,'cause')
async function fixture(){const root=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review92-')));return{root,directory:await directoryIdentity(root),plan:join(root,'backup-plan.json'),barrier:join(root,'restore-draft-barrier.json'),close:()=>rm(root,{recursive:true,force:true})}}
async function seed(root:string){const store=new VersionedStore(join(root,'backup-plan.json'),{lastSuccess:null as number|null},value=>backupPlanSchema.parse(value));const plan=await store.update(0,{lastSuccess:123});const barrier=new WorkRestoreDraftBarrier(root);const active=await barrier.begin({workId:randomUUID(),candidateId:randomUUID(),operationId:randomUUID()},async()=>{});return{plan,active,barrier}}
async function unchanged(path:string){const bytes=await readFile(path),info=await lstat(path,{bigint:true});return{bytes,inode:info.ino,size:info.size,mtime:info.mtimeNs,ctime:info.ctimeNs}}

test('AM92-01: disappearance during the original barrier reader cannot become a default success snapshot',async t=>{const f=await fixture();try{
 await seed(f.root);const before=await unchanged(f.barrier),plan=await readFile(f.plan),inspect=WorkRestoreDraftBarrier.prototype.inspect
 t.mock.method(WorkRestoreDraftBarrier.prototype,'inspect',async function(this:WorkRestoreDraftBarrier){const result=await inspect.call(this);await rename(f.plan,f.plan+'.retained');return result})
 await assert.rejects(validateApplicationMaintenanceMetadata(f.directory,noop),safeError('APPLICATION_MAINTENANCE_CHANGED'))
 assert.deepEqual(await readFile(f.plan+'.retained'),plan);assert.deepEqual(await unchanged(f.barrier),before);await assert.rejects(lstat(f.plan),{code:'ENOENT'})
 }finally{await f.close()}})

test('AM92-02: a pending marker appearing after initial absence is retained without being adopted or acknowledged',async t=>{const f=await fixture();try{
 const inspect=WorkRestoreDraftBarrier.prototype.inspect;let created:unknown
 t.mock.method(WorkRestoreDraftBarrier.prototype,'inspect',async function(this:WorkRestoreDraftBarrier){const absent=await inspect.call(this);assert.equal(absent,null);const barrier=new WorkRestoreDraftBarrier(f.root);created=await barrier.begin({workId:randomUUID(),candidateId:randomUUID()},async()=>{});return absent})
 await assert.rejects(validateApplicationMaintenanceMetadata(f.directory,noop),safeError('APPLICATION_MAINTENANCE_CHANGED'))
 assert.deepEqual(JSON.parse(await readFile(f.barrier,'utf8')).active,created);await assert.rejects(lstat(f.plan),{code:'ENOENT'})
 }finally{await f.close()}})

test('AM92-03: same bytes renamed to a new inode in the final awaited guard do not authorize the replacement',async t=>{const f=await fixture();try{
 await seed(f.root);const bytes=await readFile(f.plan),inspect=WorkRestoreDraftBarrier.prototype.inspect;let armed=false,calls=0
 t.mock.method(WorkRestoreDraftBarrier.prototype,'inspect',async function(this:WorkRestoreDraftBarrier){const result=await inspect.call(this);armed=true;return result})
 await assert.rejects(validateApplicationMaintenanceMetadata(f.directory,async()=>{if(armed&&++calls===2){await rename(f.plan,f.plan+'.retained');await writeFile(f.plan,bytes)}}),safeError('APPLICATION_MAINTENANCE_CHANGED'))
 assert.equal(calls,2);assert.deepEqual(await readFile(f.plan),bytes);assert.deepEqual(await readFile(f.plan+'.retained'),bytes);assert.notEqual((await lstat(f.plan)).ino,(await lstat(f.plan+'.retained')).ino)
 }finally{await f.close()}})

test('AM92-04: late ownership failure is safe and preserves valid pending bytes without invoking begin, settle or acknowledge',async t=>{const f=await fixture();try{
 await seed(f.root);const before=await Promise.all([unchanged(f.plan),unchanged(f.barrier)]),inspect=WorkRestoreDraftBarrier.prototype.inspect;let valid=true
 for(const name of ['begin','settle','acknowledge'] as const)t.mock.method(WorkRestoreDraftBarrier.prototype,name,()=>{throw Error('validation must never execute restore actions')})
 t.mock.method(WorkRestoreDraftBarrier.prototype,'inspect',async function(this:WorkRestoreDraftBarrier){const result=await inspect.call(this);valid=false;return result})
 await assert.rejects(validateApplicationMaintenanceMetadata(f.directory,async()=>{if(!valid)throw Error('private-path-key-in-owner-rejection')}),safeError('APPLICATION_MAINTENANCE_GUARD_REJECTED'))
 assert.deepEqual(await Promise.all([unchanged(f.plan),unchanged(f.barrier)]),before)
 }finally{await f.close()}})

test('AM92-05: exact 16KiB legitimate files keep original envelope annotations and inert unknown outcomes byte-for-byte',async t=>{const f=await fixture();try{
 const active={token:randomUUID(),operationId:randomUUID(),workId:randomUUID(),candidateId:randomUUID(),createdAt:'2026-10-08T00:00:00.000Z',outcome:{status:'failed' as const,message:'已记录的失败文本；不是执行指令'}}
 const inputs=[{path:f.plan,value:{schemaVersion:1,revision:4,value:{lastSuccess:Number.MAX_SAFE_INTEGER},annotation:{unknown:'原始信封注释保留'}}},{path:f.barrier,value:{schemaVersion:1,revision:7,active}}]
 for(const {path,value}of inputs){const json=JSON.stringify(value);await writeFile(path,json+' '.repeat(16384-Buffer.byteLength(json)))}
 const foreign=join(f.root,'unrelated-task.json');await writeFile(foreign,'{"execute":"do-not-run"}');const names=await readdir(f.root),before=await Promise.all([unchanged(f.plan),unchanged(f.barrier),unchanged(foreign)])
 for(const name of ['begin','settle','acknowledge'] as const)t.mock.method(WorkRestoreDraftBarrier.prototype,name,()=>{throw Error('read-only validation must not execute restore')})
 const result=await validateApplicationMaintenanceMetadata(f.directory,noop)
 assert.deepEqual(result,{backupPlan:{revision:4,value:{lastSuccess:Number.MAX_SAFE_INTEGER}},restoreBarrier:active})
 assert.deepEqual(await Promise.all([unchanged(f.plan),unchanged(f.barrier),unchanged(foreign)]),before);assert.deepEqual(await readdir(f.root),names)
 }finally{await f.close()}})

test('AM92-06: original barrier reader errors cannot leak arbitrary causes or create missing defaults',async t=>{const f=await fixture();try{
 await seed(f.root);const before=await Promise.all([unchanged(f.plan),unchanged(f.barrier)])
 t.mock.method(WorkRestoreDraftBarrier.prototype,'inspect',async()=>{throw new Error('private-path-key-reader',{cause:new Error('arbitrary internal cause')})})
 await assert.rejects(validateApplicationMaintenanceMetadata(f.directory,noop),safeError('APPLICATION_MAINTENANCE_BARRIER_INVALID'))
 assert.deepEqual(await Promise.all([unchanged(f.plan),unchanged(f.barrier)]),before)
 }finally{await f.close()}})

test('AM92-07: independent concurrent reads return isolated data and cannot rewrite plan or replay a marker',async()=>{const f=await fixture();try{
 const initial=await seed(f.root),before=await Promise.all([unchanged(f.plan),unchanged(f.barrier)]),results=await Promise.all(Array.from({length:8},()=>validateApplicationMaintenanceMetadata(f.directory,noop)))
 assert.ok(results.every(result=>result.backupPlan?.value.lastSuccess===123&&result.restoreBarrier?.token===initial.active.token))
 results[0].backupPlan!.value.lastSuccess=0;results[0].restoreBarrier!.outcome={status:'activated'}
 assert.equal(results[1].backupPlan?.value.lastSuccess,123);assert.equal(results[1].restoreBarrier?.outcome.status,'pending');assert.deepEqual(await Promise.all([unchanged(f.plan),unchanged(f.barrier)]),before)
 }finally{await f.close()}})
