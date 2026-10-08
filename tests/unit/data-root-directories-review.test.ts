import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,readFile,readdir,realpath,rm,rename,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {PGlite} from '@electric-sql/pglite'
import {DataRootManager,RootMigrationCrash,type MigrationHost,type RootOptions} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {collectClosedRootFiles} from '../../desktop/main/owned-root-files'

async function fixture(options:RootOptions={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-review65-'))),source=join(base,'source'),target=join(base,'target'),boot=join(base,'bootstrap')
 for(const path of [source,target,boot])await mkdir(path)
 await mkdir(join(source,'inbox/database/pg_notify'),{recursive:true});await mkdir(join(source,'inbox/database/pg_wal/archive_status'),{recursive:true});await mkdir(join(source,'session'),{recursive:true})
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}));await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));await writeFile(join(source,'inbox/database/PG_VERSION'),'17');await writeFile(join(source,'session/Preferences'),'closed session data')
 const manager=new DataRootManager(boot,source,options),original=await manager.adopt(await directoryIdentity(source))
 const host:MigrationHost={async quiesce(pointer){const inventory=await collectClosedRootFiles(pointer.root,()=>{});return{source:pointer.root,ownedFiles:inventory.files,ownedDirectories:inventory.directories,assertClosed(){},release(){}}}}
 return{base,source,target,boot,manager,original,host,close:()=>rm(base,{recursive:true,force:true})}
}
const readMissing=async(path:string)=>readFile(path,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error})

test('DR65-01: migration cannot adopt and later delete a foreign empty directory inserted before owned-directory promotion',async()=>{
 const abort=new AbortController();let f:Awaited<ReturnType<typeof fixture>>,foreign:{device:string;inode:string}|undefined
 f=await fixture({async hook(phase,path){if(phase==='verified'){const p=join(f.target,'inbox/database/pg_notify');await mkdir(p,{recursive:true});const s=await stat(p);foreign={device:String(s.dev),inode:String(s.ino)}}if(phase==='ready-to-commit')abort.abort()}})
 try{
  await assert.rejects(f.manager.migrate(await directoryIdentity(f.target),f.host,abort.signal));assert.ok(foreign)
  const identity=await directoryIdentity(join(f.target,'inbox/database/pg_notify')).catch(error=>{if(error.code==='ENOENT')return null;throw error})
  assert.deepEqual(identity&&{device:identity.device,inode:identity.inode},foreign,'rollback must retain an externally-created empty directory, not claim the same pathname as an app mkdir receipt')
  assert.deepEqual(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')),f.original);assert.equal(await readMissing(join(f.source,'inbox/database/PG_VERSION')),'17')
 }finally{await f.close()}
})

test('DR65-02: losing one required target directory before cleanup retains the entire old engine file set as the last usable layout',async()=>{
 let f:Awaited<ReturnType<typeof fixture>>;f=await fixture({async hook(phase){if(phase==='cleanup')await rm(join(f.target,'inbox/database/pg_notify'),{recursive:true})}})
 try{
  const result=await f.manager.migrate(await directoryIdentity(f.target),f.host)
  assert.equal(result.status,'cleanup-pending');assert.equal(await readMissing(join(f.source,'inbox/database/PG_VERSION')),'17','the old engine files must survive while a required new engine directory is missing')
  assert.deepEqual(await readdir(join(f.source,'inbox/database/pg_notify')),[]);assert.equal(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')).root.path,f.target)
 }finally{await f.close()}
})

test('DR65-03: real closed PGlite survives two inventory-driven migrations and cold reopen, while catalogued works and unknown content stay put',async()=>{
 const f=await fixture();let engine:PGlite|undefined
 try{
  await rm(join(f.source,'inbox/database'),{recursive:true});engine=await PGlite.create({dataDir:join(f.source,'inbox/database'),relaxedDurability:false});await engine.exec('CREATE TABLE review65 (id int primary key, draft text); INSERT INTO review65 VALUES (1,\'真实本地正文\')');await engine.close();engine=undefined
  const work=join(f.source,'session/Local Storage');await mkdir(join(work,'leveldb'),{recursive:true});await writeFile(join(work,'leveldb/000003.log'),'catalogued work bytes');await writeFile(join(f.source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[{path:work}]}));await writeFile(join(f.source,'inbox/database/author-notes.txt'),'unknown inside engine');await mkdir(join(f.source,'session/author-directory'));const snapshot=`inbox/snapshots/before-upgrade-${Date.now()}-${randomUUID()}.tar.gz`;await mkdir(join(f.source,'inbox/snapshots'));await writeFile(join(f.source,snapshot),'opaque app-owned upgrade backup');await writeFile(join(f.source,snapshot+'.json'),'opaque backup metadata')
  const first=await f.manager.migrate(await directoryIdentity(f.target),f.host);assert.equal(first.status,'complete');engine=await PGlite.create({dataDir:join(f.target,'inbox/database'),relaxedDurability:false});assert.deepEqual((await engine.query('SELECT draft FROM review65')).rows,[{draft:'真实本地正文'}]);await engine.close();engine=undefined
  const second=join(f.base,'second-target');await mkdir(second);const next=await f.manager.migrate(await directoryIdentity(second),f.host);assert.equal(next.status,'complete');assert.equal(next.root.revision,3);assert.equal(next.root.rootId,f.original.rootId)
  engine=await PGlite.create({dataDir:join(second,'inbox/database'),relaxedDurability:false});assert.deepEqual((await engine.query('SELECT draft FROM review65')).rows,[{draft:'真实本地正文'}]);await engine.close();engine=undefined
  assert.equal(await readFile(join(f.source,'inbox/database/author-notes.txt'),'utf8'),'unknown inside engine');assert.equal(await readFile(join(work,'leveldb/000003.log'),'utf8'),'catalogued work bytes');assert.deepEqual(await readdir(join(f.source,'session/author-directory')),[]);assert.equal(await readFile(join(second,snapshot),'utf8'),'opaque app-owned upgrade backup');assert.equal((await readdir(second)).filter(path=>path.startsWith('.xuanxiang-root-recovery-')).length,2)
 }finally{await engine?.close();await f.close()}
})

for(const phase of ['verified','pointer-written'] as const)test('DR65-04-'+phase+': deterministic crash recovery preserves the authoritative pointer and explicit directory layout',async()=>{
 let crash=true;const f=await fixture({hook(name){if(crash&&name===phase)throw new RootMigrationCrash('isolated phase loss')}})
 try{
  await assert.rejects(f.manager.migrate(await directoryIdentity(f.target),f.host),RootMigrationCrash);crash=false;const recovered=await new DataRootManager(f.boot,f.source).recover(f.host);assert.ok(recovered)
  if(phase==='verified'){assert.equal(recovered.status,'rolled-back');assert.deepEqual(await readdir(f.target),[]);assert.equal(await readMissing(join(f.source,'inbox/database/PG_VERSION')),'17');assert.deepEqual(await readdir(join(f.source,'inbox/database/pg_notify')),[])}
  else{assert.equal(recovered.status,'complete');assert.equal(recovered.root.root.path,f.target);assert.deepEqual(await readdir(join(f.target,'inbox/database/pg_notify')),[]);assert.equal(await readMissing(join(f.target,'inbox/database/PG_VERSION')),'17')}
  assert.equal(await new DataRootManager(f.boot,f.source).recover(f.host),null)
 }finally{await f.close()}
})

test('DR65-05: a strict legacy journal without the new optional directory field still recovers precommit instead of reinitializing data',async()=>{
 const f=await fixture({hook(phase){if(phase==='verified')throw new RootMigrationCrash('legacy boundary')}})
 try{
  const legacyHost:MigrationHost={async quiesce(pointer){const lease=await f.host.quiesce(pointer);const {ownedDirectories:_directories,...legacy}=lease;return legacy}}
  await assert.rejects(f.manager.migrate(await directoryIdentity(f.target),legacyHost),RootMigrationCrash)
  const path=join(f.boot,'root-migration.json'),envelope=JSON.parse(await readFile(path,'utf8'));delete envelope.journal.directories
  const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>[key,canonical(v)])):value
  const {createHash}=await import('node:crypto');envelope.sha256=createHash('sha256').update(JSON.stringify(canonical(envelope.journal))).digest('hex');await writeFile(path,JSON.stringify(envelope))
  const restored=await new DataRootManager(f.boot,f.source).recover(legacyHost);assert.equal(restored?.status,'rolled-back');assert.equal(await readMissing(join(f.source,'inbox/database/PG_VERSION')),'17');assert.deepEqual(await readdir(f.target),[]);assert.equal((await new DataRootManager(f.boot,f.source).resolve()).state,'existing')
 }finally{await f.close()}
})

test('DR65-06: cleanup preserves a replacement source directory identity and its user content after pointer commit',async()=>{
 let f:Awaited<ReturnType<typeof fixture>>,replacement:{path:string;device:string;inode:string}|undefined
 f=await fixture({async hook(phase){if(phase==='cleanup'){const path=join(f.source,'inbox/database/pg_notify');await rename(path,path+'-old-layout');await mkdir(path);await writeFile(join(path,'author.txt'),'foreign replacement');replacement=await directoryIdentity(path)}}})
 try{const result=await f.manager.migrate(await directoryIdentity(f.target),f.host);assert.equal(result.status,'cleanup-pending');assert.deepEqual(await directoryIdentity(join(f.source,'inbox/database/pg_notify')),replacement);assert.equal(await readFile(join(f.source,'inbox/database/pg_notify/author.txt'),'utf8'),'foreign replacement');assert.deepEqual(await readdir(join(f.target,'inbox/database/pg_notify')),[]);assert.ok(result.pending.includes('inbox/database/pg_notify'))}finally{await f.close()}
})

test('DR65-07: a crash before the directory receipt reaches disk preserves unreceipted target directories and the authoritative old root',async()=>{
 const f=await fixture();let crashed=false
 const host:MigrationHost={async quiesce(pointer){const lease=await f.host.quiesce(pointer);return{...lease,async assertClosed(){await lease.assertClosed();if(!crashed&&await directoryIdentity(join(f.target,'inbox')).catch(()=>null)){crashed=true;throw new RootMigrationCrash('directory created before durable receipt')}}}}}
 try{
  await assert.rejects(f.manager.migrate(await directoryIdentity(f.target),host),RootMigrationCrash);assert.equal(crashed,true)
  const unreceipted=await directoryIdentity(join(f.target,'inbox'))
  const restarted=new DataRootManager(f.boot,f.source),result=await restarted.recover(f.host)
  assert.equal(result?.status,'rollback-pending');assert.ok(result?.pending.includes('UNOWNED_TARGET_REMAINS'))
  assert.deepEqual(await directoryIdentity(join(f.target,'inbox')),unreceipted);assert.equal(await readMissing(join(f.source,'inbox/database/PG_VERSION')),'17');assert.deepEqual(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')),f.original)
  assert.equal((await restarted.resolve()).state,'existing');assert.equal((await restarted.recover(f.host))?.status,'rollback-pending')
 }finally{await f.close()}
})

test('DR65-08: a legacy journal cannot delete a replacement target parent directory without a directory ownership receipt',async()=>{
 const f=await fixture({hook(phase,path){if(phase==='file-promoted'&&path==='inbox/database/PG_VERSION')throw new RootMigrationCrash('legacy partial promotion')}})
 try{
  await assert.rejects(f.manager.migrate(await directoryIdentity(f.target),f.host),RootMigrationCrash)
  const journalPath=join(f.boot,'root-migration.json'),envelope=JSON.parse(await readFile(journalPath,'utf8'));delete envelope.journal.directories
  const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>[key,canonical(v)])):value
  const {createHash}=await import('node:crypto');envelope.sha256=createHash('sha256').update(JSON.stringify(canonical(envelope.journal))).digest('hex');await writeFile(journalPath,JSON.stringify(envelope))
  const path=join(f.target,'inbox/database');await rename(path,path+'-original');await mkdir(path);const foreign=await directoryIdentity(path)
  const result=await new DataRootManager(f.boot,f.source).recover(f.host)
  assert.equal(result?.status,'rollback-pending');assert.deepEqual(await directoryIdentity(path).catch(error=>{if(error.code==='ENOENT')return null;throw error}),foreign,'absence of a legacy parent-directory receipt must retain the replacement inode')
  assert.equal(await readMissing(join(f.source,'inbox/database/PG_VERSION')),'17');assert.deepEqual(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')),f.original)
 }finally{await f.close()}
})
