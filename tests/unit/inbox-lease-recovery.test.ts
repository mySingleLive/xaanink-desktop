import assert from 'node:assert/strict'
import {test} from 'node:test'
import {once} from 'node:events'
import {spawn} from 'node:child_process'
import {randomUUID,createHash} from 'node:crypto'
import {hostname,tmpdir} from 'node:os'
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm,lstat,readdir,rename,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {inboxLeaseRecoveryRequired,prepareInboxLeaseRecovery} from '../../desktop/main/inbox-lease-recovery'

const deadPid=(async()=>{const child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});await once(child,'exit');assert.ok(child.pid);assert.throws(()=>process.kill(child.pid!,0),{code:'ESRCH'});return child.pid!})()
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-inbox42-'))),boot=join(base,'bootstrap'),root=join(base,'root'),inbox=join(root,'inbox'),database=join(inbox,'database'),lock=join(inbox,'.xuanxiang-lock')
 await mkdir(boot);await mkdir(database,{recursive:true});await mkdir(lock)
 await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}))
 await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 await writeFile(join(root,'state.json'),'preserved settings');await writeFile(join(root,'drafts.json'),'preserved drafts');await writeFile(join(database,'original.bin'),new Uint8Array([0,255,8,9]))
 const owner={token:randomUUID(),pid:await deadPid,host:hostname()},ownerPath=join(lock,'owner.json'),bytes=JSON.stringify(owner)
 await writeFile(ownerPath,bytes)
 const pointer=await new DataRootManager(boot,root).adopt(await directoryIdentity(root))
 let cold=true
 const options:{assertColdHost():void;hook?:(phase:string)=>void|Promise<void>}={assertColdHost(){if(!cold)throw Error('ordinary worker/source session is now active')}}
 return{base,boot,root,inbox,database,lock,ownerPath,bytes,owner,pointer,options,setCold:(value:boolean)=>{cold=value},cleanup:()=>rm(base,{recursive:true,force:true}),async preserved(){return Promise.all(['xuanxiang-app.json','catalog.json','state.json','drafts.json','inbox/database/original.bin'].map(async name=>[name,createHash('sha256').update(await readFile(join(root,name))).digest('hex')]))}}
}
test('IL42-01 startup recognizes a dead inbox lease before opening any source engine',async()=>{
 const f=await fixture();try{assert.equal(inboxLeaseRecoveryRequired(f.pointer),true);assert.equal(inboxLeaseRecoveryRequired(null),false);assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes)}finally{await f.cleanup()}
})
test('IL42-02 confirmed repair removes only stale lock; original application bytes remain and recovered audit permits normal startup',async()=>{
 const f=await fixture();try{const before=await f.preserved(),session=await prepareInboxLeaseRecovery(f.boot,f.options);assert.equal(session.preview.work.path,f.inbox);assert.equal(session.preview.owner.pid,f.owner.pid);assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes);assert.equal((await session.recover(true)).status,'recovered');await assert.rejects(lstat(f.lock),{code:'ENOENT'});assert.deepEqual(await f.preserved(),before);assert.equal(inboxLeaseRecoveryRequired(f.pointer),false)}finally{await f.cleanup()}
})
test('IL42-03 missing confirmation and cancelled preview never change owner or create an audit',async()=>{
 const f=await fixture();try{const session=await prepareInboxLeaseRecovery(f.boot,f.options);await assert.rejects(session.recover(false));session.cancel();await assert.rejects(session.recover(true));assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes);await assert.rejects(lstat(join(f.inbox,'.xuanxiang-lease-recovery.json')),{code:'ENOENT'})}finally{await f.cleanup()}
})
test('IL42-04 live and foreign owners are blocked and kept exactly as observed',async()=>{
 for(const ownerKind of ['live','foreign']){const f=await fixture();try{const bytes=JSON.stringify({...f.owner,...(ownerKind==='live'?{pid:process.pid}:{host:'foreign-host.invalid'})});await writeFile(f.ownerPath,bytes);await assert.rejects(prepareInboxLeaseRecovery(f.boot,f.options));assert.equal(await readFile(f.ownerPath,'utf8'),bytes)}finally{await f.cleanup()}}
})
test('IL42-05 unknown lock neighbours and inbox symlink cannot authorize repair',async()=>{
 for(const kind of ['unknown','symlink']){const f=await fixture();try{if(kind==='unknown')await writeFile(join(f.lock,'foreign'),'keep');else{await rename(f.inbox,f.inbox+'-original');await symlink(f.inbox+'-original',f.inbox)}await assert.rejects(prepareInboxLeaseRecovery(f.boot,f.options));assert.equal(await readFile(kind==='symlink'?join(f.inbox+'-original','.xuanxiang-lock/owner.json'):f.ownerPath,'utf8'),f.bytes)}finally{await f.cleanup()}}
})
test('IL42-06 partial initialization marker does not become a repair capability',async()=>{
 const f=await fixture();try{const path=join(f.root,'xuanxiang-app.json'),marker=JSON.parse(await readFile(path,'utf8'));await writeFile(path,JSON.stringify({...marker,inboxReady:false}));await assert.rejects(prepareInboxLeaseRecovery(f.boot,f.options));assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes)}finally{await f.cleanup()}
})
test('IL42-07 replacing same pointer bytes or revoking cold host just before unlink keeps the original lease',async()=>{
 for(const kind of ['pointer','cold']){const f=await fixture();try{const session=await prepareInboxLeaseRecovery(f.boot,f.options);f.options.hook=async phase=>{if(phase!=='before-owner-unlink')return;if(kind==='cold')f.setCold(false);else{const path=join(f.boot,'data-root.json'),bytes=await readFile(path);await rename(path,path+'.original');await writeFile(path,bytes)}};await assert.rejects(session.recover(true));assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes)}finally{await f.cleanup()}}
})
test('IL42-08 interrupted empty-lock cleanup is detected on a new startup and requires fresh confirmation',async()=>{
 const f=await fixture();try{f.options.hook=async phase=>{if(phase==='after-owner-unlink')throw Error('simulated interruption')};const first=await prepareInboxLeaseRecovery(f.boot,f.options);assert.equal((await first.recover(true)).status,'cleanup-pending');assert.deepEqual(await readdir(f.lock),[]);first.cancel();delete f.options.hook;assert.equal(inboxLeaseRecoveryRequired(f.pointer),true);const retry=await prepareInboxLeaseRecovery(f.boot,f.options);assert.notEqual(retry.preview.requestId,first.preview.requestId);await assert.rejects(retry.recover(false));assert.equal((await retry.recover(true)).status,'recovered');assert.equal(inboxLeaseRecoveryRequired(f.pointer),false)}finally{await f.cleanup()}
})
test('IL42-09 a copied audit cannot confer authority over a different inbox directory',async()=>{
 const a=await fixture(),b=await fixture();try{const session=await prepareInboxLeaseRecovery(a.boot,a.options);assert.equal((await session.recover(true)).status,'recovered');await writeFile(join(b.inbox,'.xuanxiang-lease-recovery.json'),await readFile(join(a.inbox,'.xuanxiang-lease-recovery.json')));await assert.rejects(prepareInboxLeaseRecovery(b.boot,b.options));assert.equal(await readFile(b.ownerPath,'utf8'),b.bytes)}finally{await a.cleanup();await b.cleanup()}
})
test('IL42-10 result/exit assertion and cached replay never remove a newly arrived live lock',async()=>{
 const f=await fixture();try{const session=await prepareInboxLeaseRecovery(f.boot,f.options);assert.equal((await session.recover(true)).status,'recovered');session.assertRecovered();await mkdir(f.lock);const bytes=JSON.stringify({...f.owner,pid:process.pid,token:randomUUID()});await writeFile(f.ownerPath,bytes);assert.throws(()=>session.assertRecovered());await assert.rejects(session.recover(true));assert.equal(await readFile(f.ownerPath,'utf8'),bytes)}finally{await f.cleanup()}
})
