import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,rename,lstat,readdir} from 'node:fs/promises'
import fsPromises from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import type {Dir} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {ApplicationBackups} from '../../desktop/core/application-backups'
import {DataRootManager,RootMigrationError,type ClosedRootLease,type MigrationHost,type RootPointer} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {collectClosedRootFiles} from '../../desktop/main/owned-root-files'
import {inspectApplicationBackupInventory,ApplicationBackupInventoryGuardError} from '../../desktop/core/application-backup-inventory'
import {ROOT_MIGRATION_LIMITS} from '../../desktop/core/root-inventory-limits'
import {RootMigrationRequests} from '../../desktop/main/root-migration-request'
import {RootMaintenanceRunner} from '../../desktop/main/root-maintenance-runner'

// Real small FS packages use the original writer. Its semantic verifier is a
// controlled callback; these tests do not declare the fake database healthy.
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xx-independent96-'))),source=join(base,'source'),target=join(base,'target'),boot=join(base,'boot'),packages=join(source,'backups/application/packages'),appId=randomUUID()
 for(const path of [join(source,'inbox/database/global'),join(source,'inbox/database/pg_notify'),packages,target,boot])await mkdir(path,{recursive:true})
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}))
 await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));await writeFile(join(source,'state.json'),'closed global state')
 await writeFile(join(source,'inbox/database/PG_VERSION'),'18');await writeFile(join(source,'inbox/database/global/pg_control'),'small closed fixture')
 const root=await directoryIdentity(source);const pointer:RootPointer={schemaVersion:1,revision:1,rootId:appId,migrationId:null,root}
 await writeFile(join(boot,'data-root.json'),JSON.stringify(pointer));const pointerBytes=await readFile(join(boot,'data-root.json'))
 const store=new ApplicationBackups(await directoryIdentity(packages),appId,{pglite:'0.5.8',postgresMajor:18},{assertOwner:()=>{},assertClosed:()=>{},verifyCaptured:async()=>{}})
 const backup=await store.create(root,3),prefix=`backups/application/packages/${backup.id}`,packageDirectory=await directoryIdentity(join(packages,backup.id))
 return{base,source,target,boot,packages,appId,root,pointer,pointerBytes,store,backup,prefix,packageDirectory,close:()=>rm(base,{recursive:true,force:true})}
}

test('AM96-01 a catalog changed after its ownership read cannot authorize moving and deleting a newly catalogued work',async t=>{const f=await fixture(),originalOpen=fsPromises.open;try{
 const inventory=await collectClosedRootFiles(f.root,()=>{}),work=join(f.packages,f.backup.id,'data'),identity=await directoryIdentity(work)
 const changed=JSON.stringify({schemaVersion:1,revision:1,value:[{id:randomUUID(),path:work,identity:{device:identity.device,inode:identity.inode},novelId:'old-offline-work',title:'既有历史作品',requestId:'independent96',requestHash:'a'.repeat(64),createdAt:new Date().toISOString()}]})
 let mutated=false
 t.mock.method(fsPromises,'open',async(...args:Parameters<typeof originalOpen>)=>{const handle=await originalOpen(...args);if(!mutated&&String(args[0])===join(f.source,'catalog.json')){const close=handle.close.bind(handle);t.mock.method(handle,'close',async()=>{await close();if(!mutated){mutated=true;await writeFile(join(f.source,'catalog.json'),changed)}})}return handle});syncBuiltinESMExports()
 const host:MigrationHost={quiesce:async()=>({source:f.root,ownedFiles:inventory.files,ownedDirectories:inventory.directories,preserved:inventory.preserved,assertClosed:()=>{},release:()=>{}})}
 let error:unknown;try{await new DataRootManager(f.boot,f.source,{availableBytes:async()=>2**40}).migrate(await directoryIdentity(f.target),host)}catch(cause){error=cause}
 assert.equal(mutated,true);assert.equal(await readFile(join(work,'state.json'),'utf8').catch(()=>null),'closed global state','newly catalogued source work bytes must remain')
 assert.ok(error instanceof RootMigrationError,'stale ownership catalog must reject migration');assert.deepEqual(await readFile(join(f.boot,'data-root.json')),f.pointerBytes)
}finally{t.mock.restoreAll();syncBuiltinESMExports();await f.close()}})

test('AM96-02 every accepted journal capacity supports both possible rollback locations without an unpersistable outcome',async()=>{const f=await fixture();try{
 const manager=new DataRootManager(f.boot,f.source),migrationId=randomUUID(),stage='.xuanxiang-migration-'+migrationId;await mkdir(join(f.target,stage))
 const sourceIdentity={device:f.root.device,inode:f.root.inode},count=Math.min(ROOT_MIGRATION_LIMITS.files,Math.floor(ROOT_MIGRATION_LIMITS.pending/2)+1)
 assert.ok(count<=ROOT_MIGRATION_LIMITS.files)
 const journal={schemaVersion:1,migrationId,phase:'verified',source:f.pointer,target:await directoryIdentity(f.target),stage,stageIdentity:await directoryIdentity(join(f.target,stage)),sourceInboxIdentity:await directoryIdentity(join(f.source,'inbox')),files:Array.from({length:count},(_,i)=>({path:'inbox/database/base/1/'+i,size:0,sha256:'0'.repeat(64),sourceIdentity,stageIdentity:sourceIdentity})),createdAt:new Date().toISOString(),pending:[]}
 const core=manager as unknown as {assertJournalCapacity(value:unknown):void;rollback(value:unknown):Promise<{status:string;pending:string[]}>;guardedUnlink():Promise<boolean>;removeOwnedParents():Promise<void>;removeOwnedDirectories():Promise<string[]>;removeEmptyTree():Promise<void>}
 // Execute the actual capacity/rollback/writer, substituting only per-copy
 // mutation refusals. No 62502 files or actual deletions are fabricated.
 let admitted=true;try{core.assertJournalCapacity(journal)}catch{admitted=false}
 if(!admitted){assert.equal(await readFile(join(f.boot,'data-root.json'),'utf8'),f.pointerBytes.toString('utf8'));return}
 core.guardedUnlink=async()=>false;core.removeOwnedParents=async()=>{};core.removeOwnedDirectories=async()=>[];core.removeEmptyTree=async()=>{}
 const outcome=await core.rollback(journal)
 assert.equal(outcome.status,'rollback-pending');assert.ok(outcome.pending.length>=count*2)
 const recorded=await new DataRootManager(f.boot,f.source).recordedMigration(migrationId);assert.equal(recorded?.phase,'rollback-pending')
}finally{await f.close()}})

test('AM96-03 the final async package guard cannot publish an obsolete file seal and guard failures never become an ordinary bad package',async()=>{const f=await fixture();try{
 let calls=0;await inspectApplicationBackupInventory(f.packageDirectory,f.appId,f.backup.id,()=>{calls++});let cursor=0
 await assert.rejects(inspectApplicationBackupInventory(f.packageDirectory,f.appId,f.backup.id,async()=>{if(++cursor===calls)await writeFile(join(f.packageDirectory.path,'data/state.json'),'changed in final guard')}))
 await assert.rejects(collectClosedRootFiles(f.root,()=>{throw new ApplicationBackupInventoryGuardError()}),ApplicationBackupInventoryGuardError)
 assert.equal(await readFile(join(f.packageDirectory.path,'data/state.json'),'utf8'),'changed in final guard')
}finally{await f.close()}})

test('AM96-04 inert candidates and unknown package neighbors survive a durable migrate and repeated cleanup recovery',async()=>{const f=await fixture();try{
 const candidate=`backups/application/validation/${randomUUID()}`,unknown=`backups/application/packages/${randomUUID()}`
 await mkdir(join(f.source,candidate),{recursive:true});await writeFile(join(f.source,candidate,'unapproved.json'),'unapproved bytes')
 await mkdir(join(f.source,unknown));await writeFile(join(f.source,unknown,'neighbor'),'foreign package bytes')
 const inventory=await collectClosedRootFiles(f.root,()=>{}),lease:ClosedRootLease={source:f.root,ownedFiles:inventory.files,ownedDirectories:inventory.directories,preserved:inventory.preserved,assertClosed:()=>{},release:()=>{}},host:MigrationHost={quiesce:async()=>lease}
 const result=await new DataRootManager(f.boot,f.source,{availableBytes:async()=>2**40}).migrate(await directoryIdentity(f.target),host)
 assert.equal(result.status,'cleanup-pending');assert.ok(result.pending.includes(candidate));assert.ok(result.pending.includes(unknown))
 const journal=JSON.parse(await readFile(join(f.boot,'root-migration.json'),'utf8'));assert.ok(journal.journal.preserved.includes(candidate));assert.ok(journal.journal.preserved.includes(unknown))
 await new DataRootManager(f.boot,f.source).recover(host)
 assert.equal(await readFile(join(f.source,candidate,'unapproved.json'),'utf8'),'unapproved bytes');assert.equal(await readFile(join(f.source,unknown,'neighbor'),'utf8'),'foreign package bytes')
 const moved=new ApplicationBackups(await directoryIdentity(join(f.target,'backups/application/packages')),f.appId,{pglite:'0.5.8',postgresMajor:18},{assertOwner:()=>{},assertClosed:()=>{},verifyCaptured:async()=>{}})
 assert.equal((await moved.read(f.backup.id)).checksum,f.backup.checksum);const next=await moved.create(await directoryIdentity(f.target),3)
 assert.equal(next.files.some(file=>file.path.startsWith('backups/')),false)
}finally{await f.close()}})

test('AM96-05 late root replacement in the last close guard never yields an inventory for a foreign directory',async()=>{const f=await fixture();try{
 // Exclude history so the root seal itself must guard the terminal return.
 let calls=0;await collectClosedRootFiles(f.root,()=>{calls++},{includeApplicationBackups:false});let cursor=0,mutated=false
 await assert.rejects(collectClosedRootFiles(f.root,async()=>{if(++cursor===calls){await rename(f.source,f.source+'-owned');await mkdir(f.source);await writeFile(join(f.source,'foreign'),'replacement retained');mutated=true}},{includeApplicationBackups:false}))
 assert.equal(mutated,true);assert.equal(await readFile(join(f.source,'foreign'),'utf8'),'replacement retained');assert.ok((await readdir(f.source+'-owned')).includes('state.json'))
}finally{await f.close()}})

test('AM96-06 actual request finish and cold ledger decoder share the maximum pending capacity and reject overflow without clearing authority',async()=>{const f=await fixture();try{
 const manager=new DataRootManager(f.boot,f.source),owner=randomUUID(),options={resolveSource:()=>manager.resolve(),assertStableLock:()=>{},assertOwner:(nonce:string)=>{assert.equal(nonce,owner)},assertClosed:()=>{}}
 const requests=new RootMigrationRequests(f.boot,options),prepared=await requests.prepare(owner,await directoryIdentity(f.target)),armed=await requests.arm(owner,prepared.requestId),execution=await requests.startArmed(armed.requestId)
 const pending=Array.from({length:ROOT_MIGRATION_LIMITS.pending},(_,i)=>'inbox/database/base/1/'+i),result={status:'rollback-pending' as const,migrationId:execution.executionNonce,root:f.pointer,pending}
 const receipt=await requests.finish(execution.requestId,execution.executionNonce,result);assert.equal('pendingCount'in receipt.outcome&&receipt.outcome.pendingCount,ROOT_MIGRATION_LIMITS.pending)
 const disk=await readFile(join(f.boot,'root-migration-request.json')),reopened=new RootMigrationRequests(f.boot,options)
 assert.deepEqual(await reopened.readResult(),receipt);await assert.rejects(reopened.finish(execution.requestId,execution.executionNonce,{...result,pending:[...pending,'UNOWNED_TARGET_REMAINS']}))
 assert.deepEqual(await readFile(join(f.boot,'root-migration-request.json')),disk);assert.deepEqual(await reopened.readResult(),receipt)
}finally{await f.close()}})

test('AM96-07 original runner quiesce passes exact preserved paths, publishes owned progress only and does not invent inventory on recovery',async()=>{const f=await fixture();try{
 const path='backups/application/staging/'+randomUUID();await mkdir(join(f.source,path),{recursive:true});await writeFile(join(f.source,path,'unapproved'),'keep raw intent')
 const manager=new DataRootManager(f.boot,f.source),owner=randomUUID(),requests=new RootMigrationRequests(f.boot,{resolveSource:()=>manager.resolve(),assertStableLock:()=>{},assertOwner:nonce=>assert.equal(nonce,owner),assertClosed:()=>{}})
 const prepared=await requests.prepare(owner,await directoryIdentity(f.target));await requests.arm(owner,prepared.requestId);const execution=await requests.startArmed(prepared.requestId)
 let live=true;const runner=new RootMaintenanceRunner({bootstrap:f.boot,defaultRoot:f.source,requests,theme:'paper',host:{assertMaintenanceClosed:()=>{if(!live)throw Error('HOST_CLOSED_PROOF_REVOKED')}},onContinue:async()=>{},onQuit:async()=>{}})
 const factory=runner as unknown as {host(value:typeof execution,recovering:boolean):MigrationHost},host=factory.host(execution,false),lease=await host.quiesce(f.pointer)
 assert.ok(lease.preserved?.includes(path));assert.equal(lease.ownedFiles.some(file=>file.startsWith(path+'/')),false);assert.equal(runner.state().totalFiles,lease.ownedFiles.length)
 const recovery=await factory.host(execution,true).quiesce(f.pointer);assert.deepEqual(recovery.ownedFiles,[]);assert.deepEqual(recovery.ownedDirectories,[]);assert.deepEqual(recovery.preserved,[])
 live=false;await assert.rejects(async()=>lease.assertClosed(),/HOST_CLOSED_PROOF_REVOKED/);assert.equal(await readFile(join(f.source,path,'unapproved'),'utf8'),'keep raw intent')
}finally{await f.close()}})

test('AM96-08 actual package-container Dir is released on parent identity failure without deleting its foreign replacement',async t=>{const f=await fixture(),original=fsPromises.opendir;let opened:Dir|undefined;try{
 t.mock.method(fsPromises,'opendir',async(...args:Parameters<typeof original>)=>{const directory=await original(...args);if(String(args[0])===f.packages){opened=directory;await rename(f.packages,f.packages+'-owned');await mkdir(f.packages);await writeFile(join(f.packages,'foreign'),'neighbor preserved')}return directory});syncBuiltinESMExports()
 await assert.rejects(collectClosedRootFiles(f.root,()=>{}));assert.ok(opened);await assert.rejects(opened.read(),{code:'ERR_DIR_CLOSED'});assert.equal(await readFile(join(f.packages,'foreign'),'utf8'),'neighbor preserved')
}finally{t.mock.restoreAll();syncBuiltinESMExports();await opened?.close().catch(()=>{});await f.close()}})

test('AM96-09 catalog protection is rechecked after the last cleanup host await before irreversible source deletion',async()=>{const f=await fixture();try{
 const inventory=await collectClosedRootFiles(f.root,()=>{}),victim=join(f.source,inventory.files[0]),original=await readFile(victim),work=join(f.packageDirectory.path,'data'),identity=await directoryIdentity(work)
 assert.ok(inventory.files[0].startsWith(f.prefix+'/data/'))
 const changed=JSON.stringify({schemaVersion:1,revision:1,value:[{id:randomUUID(),path:work,identity:{device:identity.device,inode:identity.inode},novelId:'late-catalogued',title:'待保留的原目录',requestId:'independent96-cleanup',requestHash:'b'.repeat(64),createdAt:new Date().toISOString()}]})
 let cleaning=false,calls=0,mutated=false
 const host:MigrationHost={quiesce:async()=>({source:f.root,ownedFiles:inventory.files,ownedDirectories:inventory.directories,preserved:inventory.preserved,assertClosed:async()=>{if(cleaning&&++calls===5){await writeFile(join(f.source,'catalog.json'),changed);mutated=true}},release:()=>{}})}
 const result=await new DataRootManager(f.boot,f.source,{availableBytes:async()=>2**40,hook:phase=>{if(phase==='cleanup')cleaning=true}}).migrate(await directoryIdentity(f.target),host)
 assert.equal(mutated,true);assert.deepEqual(await readFile(victim).catch(()=>null),original,'last host await must not bypass the newly catalogued source path')
 assert.equal(result.status,'cleanup-pending');assert.equal(result.root.root.path,f.target)
}finally{await f.close()}})
