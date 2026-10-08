import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID,createHash} from 'node:crypto'
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,cp,rename,symlink,link,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import fsPromises from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import type {Dir} from 'node:fs'
import {ApplicationBackups} from '../../desktop/core/application-backups'
import {canonical,digest} from '../../desktop/core/application-backup-files'
import {collectClosedRootFiles} from '../../desktop/main/owned-root-files'
import {allowedManagedFile,allowedManagedDirectory,directoryIdentity} from '../../desktop/core/root-ownership'
import {DataRootManager,RootMigrationError,type MigrationHost} from '../../desktop/core/data-root'
import {ROOT_MIGRATION_LIMITS} from '../../desktop/core/root-inventory-limits'

// These are genuine small filesystem packages produced by the original 17
// writer. Its semantic engine verifier is controlled: no PGlite/native claim.
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-migration29-'))),source=join(base,'old'),target=join(base,'new'),boot=join(base,'bootstrap'),packages=join(source,'backups/application/packages'),appId=randomUUID()
 for(const path of [join(source,'inbox/database/pg_notify'),join(source,'inbox/database/global'),packages,join(source,'backups/application/staging'),join(source,'backups/application/validation'),target,boot])await mkdir(path,{recursive:true})
 const put=async(path:string,text:string)=>{await mkdir(join(source,path,'..'),{recursive:true});await writeFile(join(source,path),text)}
 await put('xuanxiang-app.json',JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}));await put('catalog.json',JSON.stringify({schemaVersion:1,revision:0,value:[]}));await put('state.json','opaque local settings');await put('inbox/database/PG_VERSION','18');await put('inbox/database/global/pg_control','closed small fixture')
 const root=await directoryIdentity(source),host={assertOwner:async()=>{},assertClosed:async()=>{},verifyCaptured:async()=>{}},store=new ApplicationBackups(await directoryIdentity(packages),appId,{pglite:'0.5.8',postgresMajor:18},host)
 await writeFile(join(boot,'data-root.json'),JSON.stringify({schemaVersion:1,revision:1,rootId:appId,migrationId:null,root}))
 return{base,source,target,boot,packages,appId,root,store,host,put,close:()=>rm(base,{recursive:true,force:true})}
}
const packagePrefix=(id:string)=>`backups/application/packages/${id}`

test('ABM29-01 a verified original package is an exact owned file and directory inventory',async()=>{const f=await fixture();try{
 const backup=await f.store.create(f.root,3),prefix=packagePrefix(backup.id),inventory=await collectClosedRootFiles(f.root,()=>{})
 for(const path of ['xuanxiang-app-backup.json',...backup.files.map(file=>'data/'+file.path)])assert.ok(inventory.files.includes(prefix+'/'+path),path)
 for(const path of [prefix,prefix+'/data',...backup.directories.map(path=>prefix+'/data/'+path)])assert.ok(inventory.directories.includes(path),path)
 assert.equal(inventory.preserved.some(path=>path===prefix||path==='backups'),false)
 }finally{await f.close()}})

test('ABM29-02 captured, foreign-app, bad-checksum and unknown-content packages are individually preserved',async()=>{const f=await fixture();try{
 const good=await f.store.create(f.root,3),goodPath=join(f.packages,good.id),variants=['captured','foreign-app','checksum','unknown-child','wrong-hash','symlink','hardlink']
 const bad:string[]=[]
 for(const variant of variants){const id=randomUUID(),path=join(f.packages,id);bad.push(id);await cp(goodPath,path,{recursive:true});const metadata=join(path,'xuanxiang-app-backup.json'),original=JSON.parse(await readFile(metadata,'utf8'));const{checksum,...body}=original;body.id=id
  if(variant==='captured')body.phase='captured';if(variant==='foreign-app')body.appId=randomUUID();if(variant==='wrong-hash')body.files.find((file:{path:string})=>file.path==='state.json').sha256='0'.repeat(64)
  await writeFile(metadata,JSON.stringify({...body,checksum:variant==='checksum'?'0'.repeat(64):digest(canonical(body))}))
  if(variant==='unknown-child')await writeFile(join(path,'author-note'),'unknown kept')
  if(variant==='symlink'||variant==='hardlink'){const leaf=join(path,'data/state.json');await rm(leaf);if(variant==='symlink')await symlink(join(goodPath,'data/state.json'),leaf);else await link(join(goodPath,'data/state.json'),leaf)}
 }
 // A hardlink also makes the original data file non-owned; preserve that
 // package too rather than silently claiming the linked outside bytes.
 const inventory=await collectClosedRootFiles(f.root,()=>{})
 for(const id of bad){assert.ok(inventory.preserved.includes(packagePrefix(id)),id);assert.equal(inventory.files.some(path=>path.startsWith(packagePrefix(id)+'/')),false)}
 assert.equal(await readFile(join(f.packages,bad[3],'author-note'),'utf8'),'unknown kept');assert.equal(await readFile(join(goodPath,'data/state.json'),'utf8'),'opaque local settings')
 }finally{await f.close()}})

test('ABM29-03 staging and validation candidates remain inert exact pending paths, never migration ownership',async()=>{const f=await fixture();try{
 const staged=`backups/application/staging/${randomUUID()}`,validation=`backups/application/validation/${randomUUID()}`
 await f.put(staged+'/unknown.json','failed unowned stage');await f.put(validation+'/candidate.json','unknown validation');await symlink(f.source,join(f.source,'backups/application/staging/foreign-link'))
 const inventory=await collectClosedRootFiles(f.root,()=>{})
 for(const path of [staged,validation,'backups/application/staging/foreign-link']){assert.ok(inventory.preserved.includes(path));assert.equal(inventory.files.some(file=>file===path||file.startsWith(path+'/')),false);assert.equal(inventory.directories.includes(path),false)}
 }finally{await f.close()}})

test('ABM29-04 real migration makes packages portable and journals untouched candidates as cleanup-pending',async()=>{const f=await fixture();try{
 const backup=await f.store.create(f.root,3),stage=`backups/application/staging/${randomUUID()}`;await f.put(stage+'/author-draft','do not discard');const marker=await readFile(join(f.packages,backup.id,'xuanxiang-app-backup.json'))
 const inventory=await collectClosedRootFiles(f.root,()=>{}),host:MigrationHost={quiesce:async()=>({source:f.root,ownedFiles:inventory.files,ownedDirectories:inventory.directories,preserved:inventory.preserved,assertClosed:()=>{},release:()=>{}})}
 const manager=new DataRootManager(f.boot,f.source,{availableBytes:async()=>2**40}),result=await manager.migrate(await directoryIdentity(f.target),host)
 assert.equal(result.root.root.path,f.target);assert.equal(result.status,'cleanup-pending');assert.ok(result.pending.includes(stage));assert.equal(await readFile(join(f.source,stage,'author-draft'),'utf8'),'do not discard')
 assert.deepEqual(await readFile(join(f.target,packagePrefix(backup.id),'xuanxiang-app-backup.json')),marker);await assert.rejects(lstat(join(f.source,packagePrefix(backup.id))),{code:'ENOENT'})
 const moved=new ApplicationBackups(await directoryIdentity(join(f.target,'backups/application/packages')),f.appId,{pglite:'0.5.8',postgresMajor:18},f.host)
 assert.equal((await moved.read(backup.id)).checksum,backup.checksum)
 const journal=JSON.parse(await readFile(join(f.boot,'root-migration.json'),'utf8'));assert.ok(journal.journal.preserved.includes(stage))
 }finally{await f.close()}})

test('ABM29-05 application backups never recursively capture existing package history after migration allowlist expands',async()=>{const f=await fixture();try{
 const first=await f.store.create(f.root,3),second=await f.store.create(f.root,3)
 assert.equal(second.files.some(file=>file.path==='backups'||file.path.startsWith('backups/')),false);assert.equal(second.directories.some(path=>path==='backups'||path.startsWith('backups/')),false)
 assert.equal((await f.store.read(first.id)).checksum,first.checksum);assert.equal((await f.store.read(second.id)).checksum,second.checksum)
 }finally{await f.close()}})

test('ABM29-06 package allowlist permits only the exact archive/data layout, excluding candidates and nested backups',()=>{
 const id=randomUUID(),prefix=packagePrefix(id)
 for(const path of [prefix+'/xuanxiang-app-backup.json',prefix+'/data/state.json',prefix+'/data/inbox/database/PG_VERSION'])assert.equal(allowedManagedFile(path),true,path)
 for(const path of ['backups','backups/application','backups/application/packages',prefix,prefix+'/data',prefix+'/data/inbox/database'])assert.equal(allowedManagedDirectory(path),true,path)
 for(const path of [prefix+'/author-note',prefix+'/data/'+prefix+'/xuanxiang-app-backup.json',`backups/application/staging/${id}/state.json`,`backups/application/validation/${id}/state.json`])assert.equal(allowedManagedFile(path),false,path)
})

function rootCanonical(value:unknown):unknown{return Array.isArray(value)?value.map(rootCanonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,rootCanonical(item)])):value}
test('ABM29-07 journal accepts 20001 records and more than 16MiB without opening thousands of files',async()=>{const f=await fixture();try{
 const id=randomUUID(),source=JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')),target=await directoryIdentity(f.target),identity={device:f.root.device,inode:f.root.inode},journal={schemaVersion:1,migrationId:id,phase:'complete',source,target,stage:'.xuanxiang-migration-'+id,sourceInboxIdentity:await directoryIdentity(join(f.source,'inbox')),files:Array.from({length:20001},(_,i)=>({path:`inbox/database/base/5/${i}${'0'.repeat(760)}`,size:0,sha256:'0'.repeat(64),sourceIdentity:identity})),createdAt:new Date().toISOString(),pending:[]}
 const encoded=JSON.stringify({journal,sha256:createHash('sha256').update(JSON.stringify(rootCanonical(journal))).digest('hex')});assert.ok(Buffer.byteLength(encoded)>16*1024*1024);assert.ok(Buffer.byteLength(encoded)<ROOT_MIGRATION_LIMITS.journalBytes)
 await writeFile(join(f.boot,'root-migration.json'),encoded)
 const recorded=await new DataRootManager(f.boot,f.source).recordedMigration(id);assert.equal(recorded?.migrationId,id);assert.equal(recorded?.phase,'complete')
 }finally{await f.close()}})

test('ABM29-08 checksum-correct package with a malformed catalog still fails original ownership recognition',async()=>{const f=await fixture();try{
 const backup=await f.store.create(f.root,3),path=join(f.packages,backup.id),metadata=join(path,'xuanxiang-app-backup.json'),catalog='not a catalog envelope'
 await writeFile(join(path,'data/catalog.json'),catalog)
 const original=JSON.parse(await readFile(metadata,'utf8')),{checksum,...body}=original,file=body.files.find((file:{path:string})=>file.path==='catalog.json');file.size=Buffer.byteLength(catalog);file.sha256=createHash('sha256').update(catalog).digest('hex');body.bytes=body.files.reduce((sum:number,file:{size:number})=>sum+file.size,0);await writeFile(metadata,JSON.stringify({...body,checksum:digest(canonical(body))}))
 const inventory=await collectClosedRootFiles(f.root,()=>{});assert.ok(inventory.preserved.includes(packagePrefix(backup.id)));assert.equal(inventory.files.some(file=>file.startsWith(packagePrefix(backup.id)+'/')),false);assert.equal(await readFile(join(path,'data/catalog.json'),'utf8'),catalog)
 }finally{await f.close()}})

test('ABM29-09 corruption after inventory cannot become the migration core new hash baseline',async()=>{const f=await fixture();try{
 const backup=await f.store.create(f.root,3),inventory=await collectClosedRootFiles(f.root,()=>{}),oldPointer=await readFile(join(f.boot,'data-root.json')),changed=join(f.packages,backup.id,'data/state.json')
 const host:MigrationHost={quiesce:async()=>{await writeFile(changed,'late corrupted package');return{source:f.root,ownedFiles:inventory.files,ownedDirectories:inventory.directories,preserved:inventory.preserved,assertClosed:()=>{},release:()=>{}}}}
 await assert.rejects(new DataRootManager(f.boot,f.source).migrate(await directoryIdentity(f.target),host),(error:unknown)=>error instanceof RootMigrationError&&error.code==='SOURCE_UNSAFE')
 assert.deepEqual(await readFile(join(f.boot,'data-root.json')),oldPointer);assert.equal(await readFile(changed,'utf8'),'late corrupted package');await assert.rejects(lstat(join(f.boot,'root-migration.json')),{code:'ENOENT'})
 }finally{await f.close()}})

test('ABM29-10 oversized journal bytes are rejected before replacing the prior durable journal',async()=>{const f=await fixture();try{
 const manager=new DataRootManager(f.boot,f.source),id=randomUUID(),source=JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')),journal={schemaVersion:1,migrationId:id,phase:'complete',source,target:await directoryIdentity(f.target),stage:'.xuanxiang-migration-'+id,sourceInboxIdentity:await directoryIdentity(join(f.source,'inbox')),files:[],createdAt:'x'.repeat(ROOT_MIGRATION_LIMITS.journalBytes),pending:[]},prior='retained prior journal'
 await writeFile(join(f.boot,'root-migration.json'),prior)
 await assert.rejects((manager as unknown as{writeJournal(value:unknown):Promise<void>}).writeJournal(journal),(error:unknown)=>error instanceof RootMigrationError&&error.code==='JOURNAL_TOO_LARGE')
 assert.equal(await readFile(join(f.boot,'root-migration.json'),'utf8'),prior)
 }finally{await f.close()}})

test('ABM29-11 directory identity failure after opendir closes the actual directory handle',async(t)=>{const f=await fixture();let opened:Dir|undefined;const original=fsPromises.opendir;try{
 t.mock.method(fsPromises,'opendir',async(path:Parameters<typeof original>[0],...args:unknown[])=>{
  const directory=await original(path,...args as []);if(String(path)===f.source){opened=directory;await rename(f.source,f.source+'-replaced');await mkdir(f.source)}return directory
 });syncBuiltinESMExports()
 await assert.rejects(collectClosedRootFiles(f.root,()=>{}));assert.ok(opened)
 await assert.rejects(opened.read(),{code:'ERR_DIR_CLOSED'})
 }finally{t.mock.restoreAll();syncBuiltinESMExports();await opened?.close().catch(()=>{});await f.close()}})

test('ABM29-12 catalog changes in the final precommit hook cannot pass the pointer publication boundary',async()=>{const f=await fixture();try{
 const backup=await f.store.create(f.root,3),inventory=await collectClosedRootFiles(f.root,()=>{}),pointer=await readFile(join(f.boot,'data-root.json')),work=join(f.packages,backup.id,'data')
 const host:MigrationHost={quiesce:async()=>({source:f.root,ownedFiles:inventory.files,ownedDirectories:inventory.directories,preserved:inventory.preserved,assertClosed:()=>{},release:()=>{}})}
 const manager=new DataRootManager(f.boot,f.source,{availableBytes:async()=>2**40,hook:async phase=>{if(phase==='ready-to-commit')await writeFile(join(f.source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[{path:work}]}))}})
 await assert.rejects(manager.migrate(await directoryIdentity(f.target),host),(error:unknown)=>error instanceof RootMigrationError)
 assert.deepEqual(await readFile(join(f.boot,'data-root.json')),pointer);assert.equal(await readFile(join(work,'state.json'),'utf8'),'opaque local settings')
 }finally{await f.close()}})

test('ABM29-13 a postcommit catalog change preserves the latest source work through cleanup and later recovery',async()=>{const f=await fixture();try{
 const backup=await f.store.create(f.root,3),inventory=await collectClosedRootFiles(f.root,()=>{}),work=join(f.packages,backup.id,'data')
 const lease={source:f.root,ownedFiles:inventory.files,ownedDirectories:inventory.directories,preserved:inventory.preserved,assertClosed:()=>{},release:()=>{}},host:MigrationHost={quiesce:async()=>lease}
 const manager=new DataRootManager(f.boot,f.source,{availableBytes:async()=>2**40,hook:async phase=>{if(phase==='cleanup')await writeFile(join(f.source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[{path:work}]}))}})
 const result=await manager.migrate(await directoryIdentity(f.target),host);assert.equal(result.status,'cleanup-pending');assert.equal(result.root.root.path,f.target)
 assert.equal(await readFile(join(work,'state.json'),'utf8'),'opaque local settings')
 await assert.rejects(new DataRootManager(f.boot,f.source).recover(host));assert.equal(await readFile(join(work,'state.json'),'utf8'),'opaque local settings')
 }finally{await f.close()}})

test('ABM29-14 a newly catalogued directory is preserved when the last directory proof yields',async t=>{const f=await fixture(),original=fsPromises.lstat;try{
 await f.store.create(f.root,3);const inventory=await collectClosedRootFiles(f.root,()=>{}),empty=join(f.source,'inbox/database/pg_notify')
 let cleaning=false,calls=0,changed=false
 t.mock.method(fsPromises,'lstat',async(...args:Parameters<typeof original>)=>{const result=await original(...args);if(cleaning&&String(args[0])===empty&&++calls===2){await writeFile(join(f.source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[{path:join(f.source,'inbox')}]}));changed=true}return result});syncBuiltinESMExports()
 const host:MigrationHost={quiesce:async()=>({source:f.root,ownedFiles:inventory.files,ownedDirectories:inventory.directories,preserved:inventory.preserved,assertClosed:()=>{},release:()=>{}})}
 const result=await new DataRootManager(f.boot,f.source,{availableBytes:async()=>2**40,hook:phase=>{if(phase==='cleanup')cleaning=true}}).migrate(await directoryIdentity(f.target),host)
 assert.equal(changed,true);assert.ok((await lstat(empty)).isDirectory());assert.equal(result.status,'cleanup-pending');assert.ok(result.pending.includes('inbox/database/pg_notify'))
}finally{t.mock.restoreAll();syncBuiltinESMExports();await f.close()}})
