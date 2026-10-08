import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,realpath,writeFile,readFile,rename,rm,readdir} from 'node:fs/promises'
import fsPromises from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {RootRelocation,RootRelocationError,inspectRootRelocation,type RootRelocationOptions} from '../../desktop/core/root-relocation'
import {RootMigrationRequests} from '../../desktop/main/root-migration-request'
import {canonical,digest} from '../../desktop/core/application-backup-files'

// These are real, small, isolated files. Cold/owner/lock are injected contracts,
// not Electron shutdown, engine health, or native-dialog acceptance.
async function fixture(extra:Partial<RootRelocationOptions>={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-independent98-'))),source=join(base,'old'),moved=join(base,'moved'),boot=join(base,'bootstrap'),owner=randomUUID()
 await mkdir(boot);await mkdir(join(source,'inbox/database'),{recursive:true});await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}));await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));await writeFile(join(source,'inbox/database/PG_VERSION'),'18\n');await writeFile(join(source,'inbox/database/retained'), 'original physical bytes')
 const before=await new DataRootManager(boot,source).adopt(await directoryIdentity(source)),bootstrap=await directoryIdentity(boot);await rename(source,moved);const target=await directoryIdentity(moved)
 const options:RootRelocationOptions={assertCold:()=>{},assertStableLock:()=>{},assertOwner:nonce=>{assert.equal(nonce,owner)},confirm:async()=>true,...extra},locator=new RootRelocation(bootstrap,options)
 return{base,source,moved,boot,owner,before,bootstrap,target,options,locator,close:()=>rm(base,{recursive:true,force:true})}
}
const code=(expected:string)=>(error:unknown)=>error instanceof RootRelocationError&&error.code===expected&&error.message===expected&&!error.cause

test('RL98-01 moving the target during post-rename pointer directory sync cannot produce an ordinary successful relocation ACK',async()=>{let f!:Awaited<ReturnType<typeof fixture>>,actual='';f=await fixture({beforeDirectorySync:async stage=>{if(stage==='pointer'){actual=join(f.base,'moved-again');await rename(f.moved,actual)}}});try{
 const p=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,p.attemptId),code('DURABILITY_UNCONFIRMED'))
 assert.equal(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')).root.path,f.moved);assert.equal(await readFile(join(actual,'inbox/database/retained'),'utf8'),'original physical bytes');assert.equal((await readdir(f.boot)).filter(name=>name.startsWith('root-relocation-')).length,1)
 await assert.rejects(inspectRootRelocation(f.bootstrap,f.options))
}finally{await f.close()}})

test('RL98-02 changed original journal after pointer rename is preserved and cannot receive an ordinary commit ACK',async()=>{let f!:Awaited<ReturnType<typeof fixture>>;const changed='foreign journal bytes during physical sync';f=await fixture({beforeDirectorySync:async stage=>{if(stage==='pointer')await writeFile(join(f.boot,'root-migration.json'),changed)}});try{
 const migrationId=randomUUID(),old={...f.before,root:{...f.before.root,path:join(f.base,'earlier'),inode:String(BigInt(f.before.root.inode)+1n)}},current={...f.before,revision:2,migrationId},journal={schemaVersion:1,migrationId,phase:'cleanup-pending',source:old,target:f.before.root,stage:`.xuanxiang-migration-${migrationId}`,sourceInboxIdentity:{...old.root,path:join(old.root.path,'inbox')},files:[],createdAt:new Date().toISOString(),pending:['preserved-owned-file']}
 await writeFile(join(f.boot,'data-root.json'),JSON.stringify(current));await writeFile(join(f.boot,'root-migration.json'),JSON.stringify({journal,sha256:digest(canonical(journal))}))
 const p=await f.locator.prepare(f.owner,f.target);assert.equal(p.retainedMigration?.migrationId,migrationId);await assert.rejects(f.locator.commit(f.owner,p.attemptId),code('DURABILITY_UNCONFIRMED'))
 assert.equal(await readFile(join(f.boot,'root-migration.json'),'utf8'),changed);assert.equal(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')).revision,3);assert.equal(await readFile(join(f.moved,'inbox/database/retained'),'utf8'),'original physical bytes')
}finally{await f.close()}})

test('RL98-03 cold disposition cannot miss a foreign receipt added during its actual bootstrap directory sync',async t=>{const f=await fixture(),original=fsPromises.open;try{
 const p=await f.locator.prepare(f.owner,f.target);await f.locator.commit(f.owner,p.attemptId);const bytes=await readFile(join(f.boot,'data-root.json'));let injected=false
 t.mock.method(fsPromises,'open',async(...args:Parameters<typeof original>)=>{const handle=await original(...args);if(String(args[0])===f.boot){const sync=handle.sync.bind(handle);t.mock.method(handle,'sync',async()=>{if(!injected){await writeFile(join(f.boot,'root-relocation-foreign.json'),'foreign receipt kept');injected=true}await sync()})}return handle});syncBuiltinESMExports()
 await assert.rejects(inspectRootRelocation(f.bootstrap,f.options),error=>error instanceof RootRelocationError&&['RECEIPT_CHANGED','RECEIPT_INVALID','DURABILITY_UNCONFIRMED'].includes(error.code));assert.equal(injected,true);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),bytes);assert.equal(await readFile(join(f.boot,'root-relocation-foreign.json'),'utf8'),'foreign receipt kept')
}finally{t.mock.restoreAll();syncBuiltinESMExports();await f.close()}})


test('RL98-04 exact production ACK subsets stay valid through a second same-inode relocation without changing either audit receipt',async()=>{const f=await fixture();try{
 const result=()=>{const request={requestId:randomUUID(),ownerNonce:randomUUID(),source:f.before,target:{...f.target,path:join(f.base,'unused')},createdAt:new Date().toISOString()};return{...request,receiptId:randomUUID(),executionNonce:null,finishedAt:new Date().toISOString(),outcome:{status:'cancelled' as const}}},a=result(),b=result(),path=join(f.boot,'root-migration-request.json')
 await writeFile(path,JSON.stringify({schemaVersion:1,revision:4,active:null,results:[a,b]}));const firstPreview=await f.locator.prepare(f.owner,f.target),first=await f.locator.commit(f.owner,firstPreview.attemptId),firstReceipt=join(f.boot,`root-relocation-${first.receiptId}.json`),firstBytes=await readFile(firstReceipt)
 let pointer=first.pointer;const requests=new RootMigrationRequests(f.boot,{assertStableLock:f.options.assertStableLock,assertOwner:f.options.assertOwner,assertClosed:()=>{},resolveSource:async()=>({state:'existing',pointer})})
 assert.equal(await requests.acknowledgeResult(a.requestId,a.receiptId),true);assert.deepEqual((await inspectRootRelocation(f.bootstrap,f.options))?.unreadMigrationResultIds,[b.receiptId])
 const third=join(f.base,'third');await rename(f.moved,third);const locator=new RootRelocation(f.bootstrap,f.options),p=await locator.prepare(f.owner,await directoryIdentity(third));assert.equal(p.unreadMigrationResults,1);const second=await locator.commit(f.owner,p.attemptId);pointer=second.pointer;const secondReceipt=join(f.boot,`root-relocation-${second.receiptId}.json`),secondBytes=await readFile(secondReceipt)
 assert.equal(await requests.acknowledgeResult(b.requestId,b.receiptId),true);await requests.flush();const final=await inspectRootRelocation(f.bootstrap,f.options);assert.deepEqual(final?.unreadMigrationResultIds,[]);assert.equal(final?.receiptId,second.receiptId);assert.equal(final?.pointer.root.path,third)
 assert.deepEqual(await readFile(firstReceipt),firstBytes);assert.deepEqual(await readFile(secondReceipt),secondBytes);assert.equal(await readFile(join(third,'inbox/database/retained'),'utf8'),'original physical bytes')
}finally{await f.close()}})

test('RL98-05 uncertain receipt directory sync is never automatic permission; a new explicit attempt can safely retain that receipt and commit',async()=>{let failed=false;const f=await fixture({beforeDirectorySync:stage=>{if(stage==='receipt'&&!failed){failed=true;throw Object.assign(Error('isolated actual IO failure'),{code:'EIO'})}}});try{
 const pointer=await readFile(join(f.boot,'data-root.json')),first=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,first.attemptId),code('DURABILITY_UNCONFIRMED'));await f.locator.flush();assert.deepEqual(await readFile(join(f.boot,'data-root.json')),pointer);assert.equal(await inspectRootRelocation(f.bootstrap,f.options),null)
 const retained=join(f.boot,`root-relocation-${first.attemptId}.json`),bytes=await readFile(retained),p=await f.locator.prepare(f.owner,f.target),second=await f.locator.commit(f.owner,p.attemptId);assert.notEqual(second.receiptId,first.attemptId);assert.deepEqual(await readFile(retained),bytes);assert.equal((await inspectRootRelocation(f.bootstrap,f.options))?.receiptId,second.receiptId)
}finally{await f.close()}})

test('RL98-06 late cancellation after pointer rename drains the pending physical durability stage and preserves the committed authority',async()=>{const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),f=await fixture({beforeDirectorySync:async stage=>{if(stage==='pointer'){entered.resolve();await release.promise}}});try{
 const p=await f.locator.prepare(f.owner,f.target),pending=f.locator.commit(f.owner,p.attemptId);void pending.catch(()=>{});await entered.promise;assert.equal(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')).revision,2)
 let cancelled=false;const cancel=f.locator.cancel(f.owner,p.attemptId).then(()=>{cancelled=true});await new Promise(setImmediate);assert.equal(cancelled,false);await assert.rejects(f.locator.prepare(f.owner,f.target),code('RELOCATION_BUSY'))
 release.resolve();await assert.rejects(pending,code('DURABILITY_UNCONFIRMED'));await cancel;assert.equal(cancelled,true);const disposition=await inspectRootRelocation(f.bootstrap,f.options);assert.equal(disposition?.receiptId,p.attemptId);assert.equal(disposition?.pointer.root.path,f.moved);assert.equal(await readFile(join(f.moved,'inbox/database/retained'),'utf8'),'original physical bytes')
}finally{release.resolve();await f.locator.flush();await f.close()}})
