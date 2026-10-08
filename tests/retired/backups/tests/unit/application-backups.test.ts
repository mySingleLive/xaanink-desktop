import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath,symlink,link,cp,rename,truncate,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {ApplicationBackups,type ApplicationBackupOptions,type ApplicationBackupHost} from '../../desktop/core/application-backups'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {canonical,digest,inspectTree} from '../../desktop/core/application-backup-files'
import {verifyApplicationRestore,cancelApplicationRestore} from '../../desktop/service/database/application-restore'
async function fixture(options:ApplicationBackupOptions={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-appbackup17-'))),source=join(base,'source'),parent=join(base,'backups'),appId=randomUUID()
 for(const path of [join(source,'inbox/database/pg_notify'),join(source,'inbox/database/global'),join(source,'assets/global'),parent])await mkdir(path,{recursive:true})
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}))
 await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 await writeFile(join(source,'state.json'),'opaque settings and encrypted vault')
 await writeFile(join(source,'inbox/database/PG_VERSION'),'18')
 await writeFile(join(source,'inbox/database/global/pg_control'),'closed engine bytes')
 const root=await directoryIdentity(source),directory=await directoryIdentity(parent)
 let closed=true,owner=true,healthy=true,verifyHook:((id:string)=>Promise<void>)|undefined
 const host={assertOwner:async()=>{if(!owner)throw Error('OWNER_LOST')},assertClosed:async()=>{if(!closed)throw Error('SOURCE_ACTIVE')},verifyCaptured:async(backup:{id:string})=>{if(!healthy)throw Error('INBOX_VERIFICATION_FAILED');await verifyHook?.(backup.id)}}
 const store=new ApplicationBackups(directory,appId,{pglite:'0.5.8',postgresMajor:18},host,options)
 return{base,source,parent,root,directory,appId,store,host,setClosed:(v:boolean)=>{closed=v},setOwner:(v:boolean)=>{owner=v},setHealthy:(v:boolean)=>{healthy=v},setVerifyHook:(hook:(id:string)=>Promise<void>)=>{verifyHook=hook},cleanup:()=>rm(base,{recursive:true,force:true})}
}
test('APP17-01: independent root package includes state/avatars/closed inbox empty dirs, excluding sessions/unknown/catalogued works',async()=>{
 const f=await fixture();try{
  const avatar=randomUUID()+'.png';await writeFile(join(f.source,'assets/global',avatar),'immutable avatar bytes')
  for(const path of ['drafts.json','backup-plan.json','restore-draft-barrier.json'])await writeFile(join(f.source,path),'owned immutable '+path)
  await mkdir(join(f.source,'inbox/snapshots'));const priorSnapshot='before-upgrade-1760000000000-'+randomUUID()+'.tar.gz';await writeFile(join(f.source,'inbox/snapshots',priorSnapshot),'existing backup archive bytes')
  await mkdir(join(f.source,'session/Cache'),{recursive:true});await writeFile(join(f.source,'session/Cache/data_0'),'not a backup')
  await writeFile(join(f.source,'author-notes.txt'),'unknown stays')
  await mkdir(join(f.source,'inbox/database/234'));await writeFile(join(f.source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[{path:join(f.source,'inbox/database/234')}]}))
  await writeFile(join(f.source,'inbox/database/234/xuanxiang-work.json'),'independent work')
  const backup=await f.store.create(f.root,2)
  assert.equal(backup.appId,f.appId);assert.ok(backup.directories.includes('inbox/database/pg_notify'))
  assert.ok(backup.files.some(file=>file.path===`assets/global/${avatar}`));assert.ok(backup.files.some(file=>file.path==='state.json'))
  for(const path of ['drafts.json','backup-plan.json','restore-draft-barrier.json'])assert.equal(await readFile(join(f.parent,backup.id,'data',path),'utf8'),'owned immutable '+path)
  assert.equal(backup.files.some(file=>file.path.startsWith('session/')||file.path.includes('author-notes')||file.path.includes('/234/')),false)
  assert.equal(backup.files.some(file=>file.path.startsWith('inbox/snapshots/')),false);assert.equal(await readFile(join(f.source,'inbox/snapshots',priorSnapshot),'utf8'),'existing backup archive bytes')
  assert.equal(await readFile(join(f.parent,backup.id,'data/state.json'),'utf8'),'opaque settings and encrypted vault')
  assert.equal(await readFile(join(f.source,'author-notes.txt'),'utf8'),'unknown stays')
  assert.deepEqual(await f.store.read(backup.id),Object.fromEntries(Object.entries(backup).filter(([k])=>k!=='retained')))
 }finally{await f.cleanup()}
})
test('APP17-02: active source or lost owner cannot create a package or modify original bytes',async()=>{
 for(const condition of ['active','owner']){const f=await fixture();try{
  const before=await readFile(join(f.source,'state.json'))
  if(condition==='active')f.setClosed(false);else f.setOwner(false)
  await assert.rejects(f.store.create(f.root,2),/SOURCE_ACTIVE|OWNER_LOST/);assert.deepEqual(await readdir(f.parent),[])
  assert.deepEqual(await readFile(join(f.source,'state.json')),before)
 }finally{await f.cleanup()}}
})
test('APP17-03: source managed symlink and hardlink are refused, never copied or removed',async()=>{
 for(const kind of ['symlink','hardlink']){const f=await fixture();try{
  await writeFile(join(f.base,'outside'),'outside bytes');await rm(join(f.source,'state.json'))
  if(kind==='symlink')await symlink(join(f.base,'outside'),join(f.source,'state.json'));else await link(join(f.base,'outside'),join(f.source,'state.json'))
  await assert.rejects(f.store.create(f.root,2));assert.equal(await readFile(join(f.base,'outside'),'utf8'),'outside bytes')
 }finally{await f.cleanup()}}
})
test('APP17-04: closure lost during copy preserves old verified packages and current original bytes',async()=>{
 let fail=false;const f=await fixture({hook:phase=>{if(fail&&phase==='file-copied')f.setClosed(false)}})
 try{const old=await f.store.create(f.root,1);fail=true;await assert.rejects(f.store.create(f.root,1),/SOURCE_ACTIVE/)
  assert.equal((await f.store.read(old.id)).id,old.id);assert.equal(await readFile(join(f.source,'state.json'),'utf8'),'opaque settings and encrypted vault')
 }finally{await f.cleanup()}
})
test('APP17-05: sealed new snapshot gates retention; pins, corrupt packages and unknown neighbors remain',async()=>{
 let damage=false;const f=await fixture({hook:async(phase,path)=>{if(damage&&phase==='before-seal')await writeFile(join(path,'data/state.json'),'externally changed')}})
 try{const pin=await f.store.create(f.root,1);const second=await f.store.create(f.root,1,[pin.id]);assert.equal((await f.store.list()).length,2)
  await writeFile(join(f.parent,'author-file'),'keep');const broken=randomUUID();await mkdir(join(f.parent,broken));await writeFile(join(f.parent,broken,'unknown'),'keep broken bytes')
  damage=true;await assert.rejects(f.store.create(f.root,1),/CHANGED|VERIFY|校验/)
  assert.equal((await f.store.read(pin.id)).id,pin.id);assert.equal((await f.store.read(second.id)).id,second.id)
  assert.equal(await readFile(join(f.parent,broken,'unknown'),'utf8'),'keep broken bytes');assert.equal(await readFile(join(f.parent,'author-file'),'utf8'),'keep')
 }finally{await f.cleanup()}
})
test('APP17-06: validated directory package is portable without its original inode or readable current source',async()=>{
 const f=await fixture();try{const backup=await f.store.create(f.root,2),imported=join(f.base,'imported');await mkdir(imported);await cp(join(f.parent,backup.id),join(imported,backup.id),{recursive:true})
  await rm(f.source,{recursive:true});f.setClosed(false)
  const store=new ApplicationBackups(await directoryIdentity(imported),f.appId,{pglite:'0.5.8',postgresMajor:18},{assertOwner:async()=>{},assertClosed:async()=>{throw Error('broken source must not open')},verifyCaptured:async()=>{throw Error('read must not create or validate against current source')}})
  assert.equal((await store.read(backup.id)).checksum,backup.checksum)
 }finally{await f.cleanup()}
})
test('APP17-07: same-byte source inode replacement during copying is a failed snapshot, with original replacements retained',async()=>{
 let replace=false;const f=await fixture({hook:async(phase,path)=>{if(replace&&phase==='file-copied'&&path.endsWith('/state.json')){await rename(join(f.source,'state.json'),join(f.source,'old-state-kept'));await writeFile(join(f.source,'state.json'),'opaque settings and encrypted vault')}}})
 try{replace=true;await assert.rejects(f.store.create(f.root,1),/CHANGED/);assert.equal(await readFile(join(f.source,'old-state-kept'),'utf8'),'opaque settings and encrypted vault');assert.equal(await readFile(join(f.source,'state.json'),'utf8'),'opaque settings and encrypted vault')}
 finally{await f.cleanup()}
})
test('APP17-08: a replaced empty destination directory cannot be accepted merely because the backup hashes remain valid',async()=>{
 let replace=false;const f=await fixture({hook:async(phase,path)=>{if(replace&&phase==='before-seal'){await rename(join(path,'data/inbox/database/pg_notify'),join(f.base,'retained-original'));await mkdir(join(path,'data/inbox/database/pg_notify'))}}})
 try{const old=await f.store.create(f.root,1);replace=true;await assert.rejects(f.store.create(f.root,1),/changed|CHANGED/);assert.equal((await f.store.read(old.id)).id,old.id)}
 finally{await f.cleanup()}
})
test('APP17-09: verified retention removes only the old complete package, never an unknown neighbor',async()=>{
 const f=await fixture();try{const old=await f.store.create(f.root,1);await writeFile(join(f.parent,'unknown'),'keep');const next=await f.store.create(f.root,1)
  assert.equal((await f.store.list()).length,1);assert.equal((await f.store.read(next.id)).id,next.id);await assert.rejects(stat(join(f.parent,old.id)),{code:'ENOENT'});assert.equal(await readFile(join(f.parent,'unknown'),'utf8'),'keep')
 }finally{await f.cleanup()}
})
test('APP17-10: identical-byte externally replaced old package is retained instead of pruned',async()=>{
 let replace=false;const f=await fixture({hook:async(phase,path)=>{if(replace&&phase==='before-prune'){const elsewhere=join(f.base,'original-package');await rename(path,elsewhere);await cp(elsewhere,path,{recursive:true})}}})
 try{const old=await f.store.create(f.root,1);replace=true;const next=await f.store.create(f.root,1);assert.deepEqual(next.retained,[old.id]);assert.equal((await f.store.list()).length,2);assert.equal((await f.store.read(old.id)).id,old.id)}finally{await f.cleanup()}
})
test('APP17-11: oversized sparse managed file rejects before bytes are copied and does not truncate the source',async()=>{
 const f=await fixture();try{await truncate(join(f.source,'state.json'),512*1024*1024+1);await assert.rejects(f.store.create(f.root,1),/LIMIT/);assert.equal((await stat(join(f.source,'state.json'))).size,512*1024*1024+1);assert.deepEqual(await readdir(f.parent),[])}finally{await f.cleanup()}
})
async function candidateFixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-appcandidate17-'))),id=randomUUID(),appId=randomUUID(),path=join(base,id)
 await mkdir(path);await writeFile(join(path,'state.json'),'sealed candidate bytes')
 const parent=await directoryIdentity(base),directory=await directoryIdentity(path),tree=await inspectTree(directory,async()=>{})
 const body={format:'xuanxiang-application-candidate' as const,schemaVersion:1 as const,id,appId,backupId:randomUUID(),backupChecksum:'0'.repeat(64),createdAt:new Date().toISOString(),phase:'ready' as const,directory,engine:{pglite:'0.5.8',postgresMajor:18},migrations:[],files:tree.files,directories:tree.directories}
 const metadata=join(path,'.xuanxiang-application-candidate.json'),initial={...body,checksum:digest(canonical(body))};await writeFile(metadata,JSON.stringify(initial))
 let guards=0;const changedBody={...body,phase:'cancelled' as const},changed={...changedBody,checksum:digest(canonical(changedBody))}
 const host={expectedAppId:appId,assertOwner:async()=>{if(++guards===2)await writeFile(metadata,JSON.stringify(changed))}}
 return{base,id,appId,parent,metadata,host,changed,cleanup:()=>rm(base,{recursive:true,force:true})}
}
test('APP17-12: readonly candidate verification cannot return an obsolete ready receipt after its metadata changes at an owner guard',async()=>{
 const f=await candidateFixture();try{await assert.rejects(verifyApplicationRestore(f.parent,f.id,f.host),/CHANGED|CANCELLED/);assert.deepEqual(JSON.parse(await readFile(f.metadata,'utf8')),f.changed)}finally{await f.cleanup()}
})
test('APP17-13: candidate cancellation must not overwrite metadata changed since its initial receipt read',async()=>{
 const f=await candidateFixture();try{await assert.rejects(cancelApplicationRestore(f.parent,f.id,f.host,async()=>false),/CHANGED/);assert.deepEqual(JSON.parse(await readFile(f.metadata,'utf8')),f.changed);assert.equal(await readFile(join(f.base,f.id,'state.json'),'utf8'),'sealed candidate bytes')}finally{await f.cleanup()}
})
test('APP17-14: candidate verification rechecks files already hashed before returning its seal',async()=>{
 const f=await candidateFixture();let guards=0
 const host={expectedAppId:f.appId,assertOwner:async()=>{if(++guards===10)await writeFile(join(f.base,f.id,'state.json'),'later replacement bytes')}}
 try{await assert.rejects(verifyApplicationRestore(f.parent,f.id,host),/CHANGED/);assert.equal(await readFile(join(f.base,f.id,'state.json'),'utf8'),'later replacement bytes')}finally{await f.cleanup()}
})
test('APP17-15: failed required inbox verification preserves the captured package and every prior verified package before retention',async()=>{
 const f=await fixture();try{const old=await f.store.create(f.root,1);f.setHealthy(false)
  await assert.rejects(f.store.create(f.root,1),/INBOX_VERIFICATION_FAILED/);assert.equal((await f.store.read(old.id)).id,old.id)
  const ids=(await readdir(f.parent)).filter(id=>id!==old.id);assert.equal(ids.length,1)
  const captured=await f.store.read(ids[0]);assert.equal(captured.phase,'captured');assert.equal(await readFile(join(f.parent,ids[0],'data/state.json'),'utf8'),'opaque settings and encrypted vault')
  assert.deepEqual((await f.store.list()).map(p=>p.id),[old.id])
 }finally{await f.cleanup()}
})
test('APP17-16: a host without the mandatory semantic verifier is refused at construction',async()=>{
 const f=await fixture();try{assert.throws(()=>new ApplicationBackups(f.directory,f.appId,{pglite:'0.5.8',postgresMajor:18},{assertOwner:async()=>{},assertClosed:async()=>{}} as unknown as ApplicationBackupHost),/VERIFIER_REQUIRED/)}finally{await f.cleanup()}
})
test('APP17-17: a new package changed during semantic verification cannot authorize retention',async()=>{
 const f=await fixture();try{const old=await f.store.create(f.root,1)
  f.setVerifyHook(async id=>{await writeFile(join(f.parent,id,'data/state.json'),'changed while isolated verifier ran')})
  await assert.rejects(f.store.create(f.root,1),/CHANGED|VERIFY/);assert.equal((await f.store.read(old.id)).id,old.id)
 }finally{await f.cleanup()}
})
test('APP17-18: backup containers cannot authorize writes inside inbox/assets/session or a catalogued independent work',async()=>{
 for(const target of ['source','inbox','assets','session','work']){const f=await fixture();try{
  const path=target==='source'?f.source:target==='inbox'?join(f.source,'inbox/database/pg_notify'):target==='assets'?join(f.source,'assets/global'):target==='session'?join(f.source,'session'):join(f.base,'independent-work')
  if(target==='session'||target==='work')await mkdir(path)
  if(target==='work')await writeFile(join(f.source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[{path}]}))
  const before=await readdir(path),store=new ApplicationBackups(await directoryIdentity(path),f.appId,{pglite:'0.5.8',postgresMajor:18},f.host)
  await assert.rejects(store.create(f.root,1),/TARGET_UNSAFE/);assert.deepEqual(await readdir(path),before)
 }finally{await f.cleanup()}}
})
