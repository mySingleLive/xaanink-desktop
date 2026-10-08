import assert from 'node:assert/strict'
import {test} from 'node:test'
import filesystem from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,readFile,rename,rm,realpath,readdir,symlink,link} from 'node:fs/promises'
import {lstatSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DataRootManager,type RootPointer} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {canonical,digest} from '../../desktop/core/application-backup-files'
import {RootRelocation,RootRelocationError,inspectRootRelocation,type RootRelocationOptions} from '../../desktop/core/root-relocation'
import {RootMigrationRequests} from '../../desktop/main/root-migration-request'
const safe=(code:string)=>(error:unknown)=>error instanceof RootRelocationError&&error.code===code&&error.message===code&&error.cause===undefined
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{resolve,promise}}
async function fixture(extra:Partial<RootRelocationOptions>={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-locate31-'))),root=join(base,'old'),moved=join(base,'renamed'),boot=join(base,'bootstrap'),owner=randomUUID()
 await mkdir(boot);await mkdir(join(root,'inbox','database'),{recursive:true})
 await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}));await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));await writeFile(join(root,'inbox','database','PG_VERSION'),'17\n');await writeFile(join(root,'inbox','database','private-data'),'original database bytes')
 const manager=new DataRootManager(boot,root),before=await manager.adopt(await directoryIdentity(root)),bootstrap=await directoryIdentity(boot);await rename(root,moved);const target=await directoryIdentity(moved)
 let live=true,cold=true,locked=true,confirms=0
 const options:RootRelocationOptions={assertStableLock(){if(!locked)throw Error('private-lock-path')},assertCold(){if(!cold)throw Error('private-session-path')},assertOwner(nonce){if(!live||nonce!==owner)throw Error('private-owner')},async confirm(){confirms++;return true},...extra},locator=new RootRelocation(bootstrap,options)
 return{base,root,moved,boot,owner,before,bootstrap,target,options,locator,manager,confirms:()=>confirms,expire(){live=false},warm(){cold=false},unlock(){locked=false},close:()=>rm(base,{recursive:true,force:true})}
}
test('RL31-01 same physical renamed ready root: preview writes nothing; exact true commits only pointer and receipt',async()=>{
 const f=await fixture();try{
  const original=await readFile(join(f.boot,'data-root.json')),data=await readFile(join(f.moved,'inbox','database','private-data')),preview=await f.locator.prepare(f.owner,f.target)
  assert.deepEqual(preview.source,f.before);assert.deepEqual(await readdir(f.boot),['data-root.json']);assert.equal(f.confirms(),0)
  const result=await f.locator.commit(f.owner,preview.attemptId);assert.deepEqual(result.pointer,{...f.before,revision:2,root:f.target});assert.equal(result.requiresColdStart,true);assert.equal(f.confirms(),1)
  assert.notDeepEqual(await readFile(join(f.boot,'data-root.json')),original);assert.deepEqual(await readFile(join(f.moved,'inbox','database','private-data')),data)
  assert.equal((await readdir(f.boot)).filter(name=>name.startsWith('root-relocation-')).length,1)
  const disposition=await inspectRootRelocation(f.bootstrap,f.options);assert.deepEqual(disposition!.pointer,result.pointer);assert.equal(disposition!.receiptId,result.receiptId)
 }finally{await f.close()}
})
test('RL31-02 copied root, empty root, work root, incomplete marker and symlink targets are refused without control writes',async()=>{
 for(const mode of ['copy','empty','work','initializing','symlink']as const){const f=await fixture();try{
  let selected=f.target
  if(mode==='copy'||mode==='empty'){const alternate=join(f.base,'alternate');await mkdir(alternate);if(mode==='copy')await writeFile(join(alternate,'xuanxiang-app.json'),await readFile(join(f.moved,'xuanxiang-app.json')));selected=await directoryIdentity(alternate)}
  if(mode==='work')await writeFile(join(f.moved,'xuanxiang-work.json'),'{}')
  if(mode==='initializing'){const marker=JSON.parse(await readFile(join(f.moved,'xuanxiang-app.json'),'utf8'));marker.phase='initializing';await writeFile(join(f.moved,'xuanxiang-app.json'),JSON.stringify(marker))}
  if(mode==='symlink'){const alternate=join(f.base,'alias');await symlink(f.moved,alternate);selected={...f.target,path:alternate}}
  await assert.rejects(f.locator.prepare(f.owner,selected),error=>error instanceof RootRelocationError&&['TARGET_CHANGED','TARGET_INVALID','TARGET_NOT_ORIGINAL'].includes(error.code));assert.deepEqual(await readdir(f.boot),['data-root.json']);assert.equal(f.confirms(),0)
 }finally{await f.close()}}
})
test('RL31-03 missing, malformed, hardlinked or symlinked pointer never initializes an empty fallback',async()=>{
 for(const mode of ['missing','malformed','hardlink','symlink']as const){const f=await fixture();try{
  const path=join(f.boot,'data-root.json');if(mode==='missing')await rm(path);if(mode==='malformed')await writeFile(path,'{"rootId":"guess"}');if(mode==='hardlink')await link(path,join(f.base,'foreign'));if(mode==='symlink'){await rename(path,join(f.base,'foreign'));await symlink(join(f.base,'foreign'),path)}
  await assert.rejects(f.locator.prepare(f.owner,f.target),error=>error instanceof RootRelocationError&&['POINTER_INVALID','CONTROL_UNSAFE'].includes(error.code));assert.equal(f.confirms(),0);assert.equal((await readdir(f.boot)).filter(name=>name.startsWith('root-relocation-')).length,0)
 }finally{await f.close()}}
})
test('RL31-04 original root becomes reachable after prepare: even confirmed commit must not replace it',async()=>{
 const f=await fixture();try{const preview=await f.locator.prepare(f.owner,f.target),bytes=await readFile(join(f.boot,'data-root.json'));await rename(f.moved,f.root);await assert.rejects(f.locator.commit(f.owner,preview.attemptId),safe('ROOT_ALREADY_AVAILABLE'));assert.deepEqual(await readFile(join(f.boot,'data-root.json')),bytes)}finally{await f.close()}
})
test('RL31-05 nonboolean truthy native replies never grant relocation',async()=>{
 for(const answer of [false,'false',{response:0},1]as unknown[]){const f=await fixture({async confirm(){return answer as boolean}});try{const p=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,p.attemptId),safe('CONFIRMATION_REQUIRED'));assert.deepEqual(await readdir(f.boot),['data-root.json'])}finally{await f.close()}}
})
test('RL31-06 delayed confirmation cancel waits physical IO, revokes authorization, blocks busy prepare and never writes',async()=>{
 const gate=deferred(),entered=deferred(),f=await fixture({async confirm(){entered.resolve();await gate.promise;return true}});try{
  const p=await f.locator.prepare(f.owner,f.target),pending=f.locator.commit(f.owner,p.attemptId);void pending.catch(()=>{});await entered.promise
  let drained=false;const cancel=f.locator.cancel(f.owner,p.attemptId).then(()=>{drained=true});await new Promise(r=>setImmediate(r));assert.equal(drained,false);await assert.rejects(f.locator.prepare(f.owner,f.target),safe('RELOCATION_BUSY'))
  gate.resolve();await assert.rejects(pending,safe('ATTEMPT_EXPIRED'));await cancel;assert.deepEqual(await readdir(f.boot),['data-root.json'])
 }finally{gate.resolve();await f.close()}
})
test('RL31-07 cold host, stable lock and exact owner are necessary and errors contain no original cause',async()=>{
 for(const mode of ['warm','unlock','expire']as const){const f=await fixture();try{f[mode]();await assert.rejects(f.locator.prepare(f.owner,f.target),safe(mode==='warm'?'SOURCE_NOT_CLOSED':mode==='unlock'?'LOCK_REQUIRED':'OWNER_EXPIRED'));assert.deepEqual(await readdir(f.boot),['data-root.json'])}finally{await f.close()}}
})
test('RL31-08 pointer or target replacement at final CAS preserves external state and original data',async()=>{
 for(const mode of ['pointer','target']as const){let f!:Awaited<ReturnType<typeof fixture>>;f=await fixture({async beforePointerRename(){if(mode==='pointer')await writeFile(join(f.boot,'data-root.json'),JSON.stringify({...f.before,revision:10}));else{await rename(f.moved,join(f.base,'preserved'));await mkdir(f.moved)}}});try{
  const p=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,p.attemptId),safe(mode==='pointer'?'POINTER_CHANGED':'TARGET_CHANGED'));assert.equal(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')).revision,mode==='pointer'?10:1);assert.equal(await readFile(join(mode==='target'?join(f.base,'preserved'):f.moved,'inbox','database','private-data'),'utf8'),'original database bytes')
 }finally{await f.close()}}
})
test('RL31-09 fsync ambiguity leaves committed pointer/receipt and cold read verifies it without rollback',async()=>{
 const f=await fixture({beforeDirectorySync(record){if(record==='pointer')throw Error('private EIO')}});try{
  const p=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,p.attemptId),safe('DURABILITY_UNCONFIRMED'));assert.deepEqual(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')),{...f.before,revision:2,root:f.target})
  const state=await inspectRootRelocation(f.bootstrap,{assertStableLock:f.options.assertStableLock,assertCold:f.options.assertCold});assert.equal(state!.pointer.revision,2);assert.equal(await readFile(join(f.moved,'inbox','database','private-data'),'utf8'),'original database bytes')
 }finally{await f.close()}
})
test('RL31-10 foreign same-byte pointer replacement after rename cannot be acknowledged as our commit',async()=>{
 let f!:Awaited<ReturnType<typeof fixture>>;f=await fixture({async beforeDirectorySync(record){if(record==='pointer'){const path=join(f.boot,'data-root.json'),bytes=await readFile(path);await rename(path,join(f.base,'our-pointer'));await writeFile(path,bytes)}}});try{const p=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,p.attemptId),safe('DURABILITY_UNCONFIRMED'))}finally{await f.close()}
})
test('RL31-11 request active refuses; residual results are retained byte-for-byte and returned for later UI',async()=>{
 for(const active of [true,false]){const f=await fixture();try{
  const request={requestId:randomUUID(),ownerNonce:randomUUID(),source:f.before,target:{...f.target,path:join(f.base,'another')},createdAt:new Date().toISOString()},result={...request,receiptId:randomUUID(),executionNonce:null,finishedAt:new Date().toISOString(),outcome:{status:'cancelled'}},state={schemaVersion:1,revision:1,active:active?{...request,phase:'prepared'}:null,results:active?[]:[result]},path=join(f.boot,'root-migration-request.json');await writeFile(path,JSON.stringify(state));const bytes=await readFile(path)
  if(active)await assert.rejects(f.locator.prepare(f.owner,f.target),safe('MIGRATION_REQUEST_ACTIVE'));else{const p=await f.locator.prepare(f.owner,f.target);assert.equal(p.unreadMigrationResults,1);await f.locator.commit(f.owner,p.attemptId);assert.deepEqual((await inspectRootRelocation(f.bootstrap,f.options))!.unreadMigrationResultIds,[result.receiptId])}
  assert.deepEqual(await readFile(path),bytes)
 }finally{await f.close()}}
})
test('RL31-12 old cleanup-pending journal is strictly correlated and remains unchanged through multiple renames',async()=>{
 const f=await fixture();try{
  const id=randomUUID(),oldSource={...f.before,root:{...f.before.root,path:join(f.base,'previous-root')},revision:1},current={...f.before,revision:2,migrationId:id},journal={schemaVersion:1,migrationId:id,phase:'cleanup-pending',source:oldSource,target:f.before.root,stage:`.xuanxiang-migration-${id}`,sourceInboxIdentity:{...f.before.root,path:join(oldSource.root.path,'inbox')},files:[],createdAt:new Date().toISOString(),pending:['old-file']};oldSource.root.inode=String(BigInt(oldSource.root.inode)+1n)
  await writeFile(join(f.boot,'data-root.json'),JSON.stringify(current));await writeFile(join(f.boot,'root-migration.json'),JSON.stringify({journal,sha256:digest(canonical(journal))}));const bytes=await readFile(join(f.boot,'root-migration.json'))
  const p=await f.locator.prepare(f.owner,f.target);assert.equal(p.retainedMigration!.phase,'cleanup-pending');await f.locator.commit(f.owner,p.attemptId)
  const second=join(f.base,'renamed-again');await rename(f.moved,second);const locator=new RootRelocation(f.bootstrap,f.options),next=await locator.prepare(f.owner,await directoryIdentity(second));await locator.commit(f.owner,next.attemptId)
  const state=await inspectRootRelocation(f.bootstrap,f.options);assert.equal(state!.retainedMigration!.migrationId,id);assert.equal(state!.pointer.revision,4);assert.deepEqual(await readFile(join(f.boot,'root-migration.json')),bytes)
 }finally{await f.close()}
})
test('RL31-13 malformed/nonterminal journal or late control mutation never becomes a silent retained disposition',async()=>{
 for(const mode of ['malformed','late-ledger']as const){let f!:Awaited<ReturnType<typeof fixture>>;f=await fixture(mode==='late-ledger'?{async beforePointerRename(){await writeFile(join(f.boot,'root-migration-request.json'),'{broken')}}:{});try{
  if(mode==='malformed')await writeFile(join(f.boot,'root-migration.json'),'{}')
  if(mode==='malformed')await assert.rejects(f.locator.prepare(f.owner,f.target),safe('JOURNAL_INVALID'));else{const p=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,p.attemptId),safe('CONTROL_CHANGED'))}
  assert.equal(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')).revision,1)
 }finally{await f.close()}}
})
test('RL31-14 candidate layout is read-only and stable proofs reject marker inode replacement after confirmation',async()=>{
 let f!:Awaited<ReturnType<typeof fixture>>;f=await fixture({async confirm(){const path=join(f.moved,'xuanxiang-app.json'),bytes=await readFile(path);await rename(path,join(f.base,'original-marker'));await writeFile(path,bytes);return true}});try{
  const catalogPath=join(f.moved,'catalog.json'),stat=lstatSync(catalogPath,{bigint:true}),p=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,p.attemptId),safe('TARGET_CHANGED'));const after=lstatSync(catalogPath,{bigint:true});assert.equal(after.mtimeNs,stat.mtimeNs);assert.equal(after.ctimeNs,stat.ctimeNs)
 }finally{await f.close()}
})
test('RL31-15 a new foreign relocation receipt appearing before pointer CAS is preserved and prevents commit',async()=>{
 let f!:Awaited<ReturnType<typeof fixture>>;f=await fixture({async beforePointerRename(){await writeFile(join(f.boot,'root-relocation-foreign.json'),'foreign bytes')}});try{
  const p=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,p.attemptId),safe('RECEIPT_CHANGED'));assert.equal(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')).revision,1);assert.equal(await readFile(join(f.boot,'root-relocation-foreign.json'),'utf8'),'foreign bytes')
 }finally{await f.close()}
})
test('RL31-16 lost owner during pointer durability never receives ordinary successful acknowledgment',async()=>{
 let f!:Awaited<ReturnType<typeof fixture>>;f=await fixture({beforeDirectorySync(stage){if(stage==='pointer')f.expire()}});try{
  const p=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,p.attemptId),safe('DURABILITY_UNCONFIRMED'));assert.equal(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')).revision,2)
 }finally{await f.close()}
})
test('RL31-17 recovery never recognizes a same-byte external pointer inode after uncertain commit',async()=>{
 let f!:Awaited<ReturnType<typeof fixture>>;f=await fixture({async beforeDirectorySync(record){if(record==='pointer'){const path=join(f.boot,'data-root.json'),bytes=await readFile(path);await rename(path,join(f.base,'our-pointer'));await writeFile(path,bytes)}}});try{
  const p=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,p.attemptId),safe('DURABILITY_UNCONFIRMED'));await assert.rejects(inspectRootRelocation(f.bootstrap,f.options),safe('POINTER_CHANGED'))
 }finally{await f.close()}
})
test('RL31-18 corrupted UTF8, oversize controls and receipt replacement fail closed without secret errors',async()=>{
 for(const mode of ['utf8','oversize','receipt']as const){const f=await fixture();try{
  if(mode==='utf8')await writeFile(join(f.boot,'data-root.json'),Buffer.from([0xff,0xfe]));if(mode==='oversize')await writeFile(join(f.boot,'data-root.json'),' '.repeat(16385));if(mode==='receipt')await writeFile(join(f.boot,`root-relocation-${randomUUID()}.json`),'{"secret":"do not echo"}')
  await assert.rejects(f.locator.prepare(f.owner,f.target),error=>error instanceof RootRelocationError&&['CONTROL_UNSAFE','RECEIPT_INVALID'].includes(error.code)&&error.message===error.code&&error.cause===undefined);assert.equal(f.confirms(),0)
 }finally{await f.close()}}
})
test('RL31-19 nonterminal strictly valid journal cannot be bypassed by locating a directory',async()=>{
 for(const phase of ['copying','verified','committed']as const){const f=await fixture();try{
  const migrationId=randomUUID(),source={...f.before,root:{...f.before.root,path:join(f.base,'previous'),inode:String(BigInt(f.before.root.inode)+1n)}},journal={schemaVersion:1,migrationId,phase,source,target:f.before.root,stage:`.xuanxiang-migration-${migrationId}`,sourceInboxIdentity:{...f.before.root,path:join(source.root.path,'inbox')},files:[],createdAt:new Date().toISOString(),pending:[]};await writeFile(join(f.boot,'root-migration.json'),JSON.stringify({journal,sha256:digest(canonical(journal))}));const bytes=await readFile(join(f.boot,'root-migration.json'))
  await assert.rejects(f.locator.prepare(f.owner,f.target),safe('MIGRATION_RECOVERY_REQUIRED'));assert.deepEqual(await readFile(join(f.boot,'root-migration.json')),bytes)
 }finally{await f.close()}}
})
test('RL31-20 receipt durable before pointer failure does not grant cold automatic execution',async()=>{
 const f=await fixture({beforePointerRename(){throw Error('private cause')}});try{
  const p=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,p.attemptId),safe('RELOCATION_FAILED'));assert.equal((await readdir(f.boot)).filter(n=>n.startsWith('root-relocation-')).length,1);assert.equal(await inspectRootRelocation(f.bootstrap,f.options),null);assert.equal(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')).revision,1)
 }finally{await f.close()}
})
test('RL31-21 real separate process is not a closed host; after exit the same immutable data may be located',async()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await once(child,'spawn');let exited=false
 const f=await fixture({assertCold(){if(!exited)throw Error('live source process')}});try{
  assert.doesNotThrow(()=>process.kill(child.pid!,0));await assert.rejects(f.locator.prepare(f.owner,f.target),safe('SOURCE_NOT_CLOSED'));child.kill('SIGTERM');await once(child,'exit');exited=true;assert.throws(()=>process.kill(child.pid!,0),error=>(error as NodeJS.ErrnoException).code==='ESRCH')
  const p=await f.locator.prepare(f.owner,f.target);assert.equal((await f.locator.commit(f.owner,p.attemptId)).requiresColdStart,true)
 }finally{child.kill('SIGKILL');await f.close()}
})
test('RL31-22 an uncommitted old receipt never makes a later successful receipt chain ambiguous',async()=>{
 let failOnce=true;const f=await fixture({beforePointerRename(){if(failOnce){failOnce=false;throw Error('one failure')}}});try{
  const first=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,first.attemptId),safe('RELOCATION_FAILED'));const second=await f.locator.prepare(f.owner,f.target),result=await f.locator.commit(f.owner,second.attemptId);assert.equal((await inspectRootRelocation(f.bootstrap,f.options))!.receiptId,result.receiptId);assert.equal((await readdir(f.boot)).filter(n=>n.startsWith('root-relocation-')).length,2)
 }finally{await f.close()}
})
test('RL31-23 bounded receipts retain all failed attempts and reject a seventeenth instead of deleting evidence',async()=>{
 const f=await fixture({beforePointerRename(){throw Error('leave receipt')}});try{
  for(let index=0;index<16;index++){const p=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,p.attemptId),safe('RELOCATION_FAILED'))}
  const original=await readdir(f.boot);await assert.rejects(f.locator.prepare(f.owner,f.target),safe('RECEIPT_LIMIT'));assert.deepEqual(await readdir(f.boot),original);assert.equal(original.filter(n=>n.startsWith('root-relocation-')).length,16);assert.equal(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')).revision,1)
 }finally{await f.close()}
})
test('RL31-24 replacing an owned temp with same-byte foreign inode never publishes or deletes that replacement',async()=>{
 let f!:Awaited<ReturnType<typeof fixture>>,foreignPath='';f=await fixture({async beforeReceiptRename(){const names=(await readdir(f.boot)).filter(n=>n.startsWith('.root-relocation-'));foreignPath=join(f.boot,names[0]);const bytes=await readFile(foreignPath);await rename(foreignPath,join(f.base,'own-temp'));await writeFile(foreignPath,bytes)}});try{
  const p=await f.locator.prepare(f.owner,f.target);await assert.rejects(f.locator.commit(f.owner,p.attemptId),safe('CONTROL_CHANGED'));assert.ok((await readFile(foreignPath)).length>0);assert.equal(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')).revision,1)
 }finally{await f.close()}
})
test('RL31-25 Windows unsupported directory sync may continue, actual EIO never acknowledges commit',async t=>{
 const originalPlatform=Object.getOwnPropertyDescriptor(process,'platform')!,originalOpen=filesystem.open
 for(const code of ['EINVAL','EIO']){const f=await fixture();try{
  const p=await f.locator.prepare(f.owner,f.target)
  Object.defineProperty(process,'platform',{value:'win32',configurable:true})
  t.mock.method(filesystem,'open',async(...args:Parameters<typeof filesystem.open>)=>{const handle=await originalOpen(...args);if(args[0]===f.boot)t.mock.method(handle,'sync',async()=>{throw Object.assign(Error('private IO path'),{code})});return handle});syncBuiltinESMExports()
  if(code==='EINVAL')assert.equal((await f.locator.commit(f.owner,p.attemptId)).requiresColdStart,true);else await assert.rejects(f.locator.commit(f.owner,p.attemptId),safe('DURABILITY_UNCONFIRMED'))
 }finally{t.mock.restoreAll();syncBuiltinESMExports();Object.defineProperty(process,'platform',originalPlatform);await f.close()}}
})
test('RL31-26 persisted explicit ACK can cold reopen while the original receipt remains immutable',async()=>{
 const f=await fixture();try{
  const request={requestId:randomUUID(),ownerNonce:randomUUID(),source:f.before,target:{...f.target,path:join(f.base,'elsewhere')},createdAt:new Date().toISOString()},result={...request,receiptId:randomUUID(),executionNonce:null,finishedAt:new Date().toISOString(),outcome:{status:'cancelled'}},path=join(f.boot,'root-migration-request.json');await writeFile(path,JSON.stringify({schemaVersion:1,revision:3,active:null,results:[result]}))
  const p=await f.locator.prepare(f.owner,f.target),outcome=await f.locator.commit(f.owner,p.attemptId),receiptPath=join(f.boot,`root-relocation-${outcome.receiptId}.json`),audit=await readFile(receiptPath)
  // The existing maintenance ledger performs the explicit user ACK through its
  // production atomic/fsync writer. The locator does not acknowledge anything.
  const ledger=new RootMigrationRequests(f.boot,{assertStableLock:f.options.assertStableLock,assertOwner:f.options.assertOwner,assertClosed:f.options.assertCold,resolveSource:async()=>({state:'existing',pointer:outcome.pointer})})
  assert.equal((await ledger.readResult())!.receiptId,result.receiptId);assert.equal(await ledger.acknowledgeResult(result.requestId,result.receiptId),true);await ledger.flush();assert.equal((await ledger.inspect()).revision,4)
  const cold=await inspectRootRelocation(f.bootstrap,f.options);assert.equal(cold!.receiptId,outcome.receiptId);assert.deepEqual(cold!.unreadMigrationResultIds,[]);assert.deepEqual(await readFile(receiptPath),audit)
 }finally{await f.close()}
})
test('RL31-27 post-relocation changed, inserted or revision-regressed completions never inherit old journal disposition',async()=>{
 for(const mode of ['changed','new','regressed']as const){const f=await fixture();try{
  const request={requestId:randomUUID(),ownerNonce:randomUUID(),source:f.before,target:{...f.target,path:join(f.base,'elsewhere')},createdAt:new Date().toISOString()},result={...request,receiptId:randomUUID(),executionNonce:null,finishedAt:new Date().toISOString(),outcome:{status:'cancelled'}},path=join(f.boot,'root-migration-request.json');await writeFile(path,JSON.stringify({schemaVersion:1,revision:3,active:null,results:[result]}));const p=await f.locator.prepare(f.owner,f.target);await f.locator.commit(f.owner,p.attemptId)
  const next=mode==='new'?{...result,requestId:randomUUID(),receiptId:randomUUID()}:mode==='changed'?{...result,finishedAt:new Date(Date.now()+1000).toISOString()}:result;const bytes=JSON.stringify({schemaVersion:1,revision:mode==='regressed'?2:4,active:null,results:[next]});await writeFile(path,bytes)
  await assert.rejects(inspectRootRelocation(f.bootstrap,f.options),safe('CONTROL_CHANGED'));assert.equal(await readFile(path,'utf8'),bytes)
 }finally{await f.close()}}
})
test('RL31-28 async or boolean host assertions are not a synchronous closed/lock/owner proof',async()=>{
 for(const name of ['assertCold','assertStableLock','assertOwner']as const){const f=await fixture({[name]:async()=>{}});try{await assert.rejects(f.locator.prepare(f.owner,f.target),safe(name==='assertCold'?'SOURCE_NOT_CLOSED':name==='assertStableLock'?'LOCK_REQUIRED':'OWNER_EXPIRED'));assert.deepEqual(await readdir(f.boot),['data-root.json'])}finally{await f.close()}}
 const f=await fixture({assertCold:()=>true});try{await assert.rejects(f.locator.prepare(f.owner,f.target),safe('SOURCE_NOT_CLOSED'));assert.deepEqual(await readdir(f.boot),['data-root.json'])}finally{await f.close()}
})
test('RL31-29 mutating caller bootstrap identity cannot relocate the fixed authority directory',async()=>{
 const f=await fixture();try{const next=join(f.base,'other-bootstrap');await rename(f.boot,next);f.bootstrap.path=next;await assert.rejects(f.locator.prepare(f.owner,f.target),safe('BOOTSTRAP_CHANGED'));assert.deepEqual(await readdir(next),['data-root.json'])}finally{await f.close()}
})
