import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {mkdtemp,mkdir,writeFile,readFile,rename,rm,realpath,readdir,symlink,link} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {RootRelocationController,RootRelocationControllerError,type RootRelocationControllerOptions} from '../../desktop/main/root-relocation-controller'
import {rootRelocationPreflight} from '../../desktop/main/root-relocation-preflight'
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{resolve,promise}}
async function fixture(extra:Partial<RootRelocationControllerOptions>={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-entry33-'))),root=join(base,'root'),moved=join(base,'moved'),boot=join(base,'boot'),owner=randomUUID()
 await mkdir(boot);await mkdir(join(root,'inbox','database'),{recursive:true});await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}));await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));await writeFile(join(root,'inbox','database','PG_VERSION'),'17\n');await writeFile(join(root,'inbox','database','content'),'original bytes')
 const pointer=await new DataRootManager(boot,root).adopt(await directoryIdentity(root)),bootstrap=await directoryIdentity(boot);await rename(root,moved)
 let live=true,cold=true,locked=true,picks=0,confirmations=0,restarts=0,quits=0
 const options:RootRelocationControllerOptions={bootstrap,mode:'lost',theme:'paper',assertStableLock(){if(!locked)throw Error('private lock')},assertCold(){if(!cold)throw Error('private session')},assertOwner(nonce){if(!live||nonce!==owner)throw Error('private nonce')},async chooseDirectory(){picks++;return moved},async confirm(){confirmations++;return true},async restart(){restarts++},async quit(){quits++},...extra},controller=new RootRelocationController(options)
 return{base,root,moved,boot,bootstrap,pointer,owner,options,controller,picks:()=>picks,confirmations:()=>confirmations,restarts:()=>restarts,quits:()=>quits,expire(){live=false},warm(){cold=false},unlock(){locked=false},close:()=>rm(base,{recursive:true,force:true})}
}
test('RE33-01 synchronous preflight distinguishes valid physical loss, live original and never initializes',async()=>{
 const f=await fixture();try{assert.equal(rootRelocationPreflight(f.boot).mode,'lost');await rename(f.moved,f.root);assert.equal(rootRelocationPreflight(f.boot).mode,'none');assert.deepEqual(await readdir(f.boot),['data-root.json'])}finally{await f.close()}
})
test('RE33-02 malformed, symlink, hardlink and oversized pointer are blocked instead of recoverable lost',async()=>{
 for(const mode of ['malformed','symlink','hardlink','oversize']){const f=await fixture();try{const path=join(f.boot,'data-root.json');if(mode==='malformed')await writeFile(path,'{}');if(mode==='oversize')await writeFile(path,' '.repeat(16385));if(mode==='hardlink')await link(path,join(f.base,'other'));if(mode==='symlink'){await rename(path,join(f.base,'other'));await symlink(join(f.base,'other'),path)}assert.equal(rootRelocationPreflight(f.boot).mode,'blocked');assert.equal((await readdir(f.boot)).filter(n=>n.startsWith('root-relocation-')).length,0)}finally{await f.close()}}
})
test('RE33-03 pointer absent with historical journal/request/receipt is blocked; genuinely empty bootstrap is none',async()=>{
 for(const history of ['root-migration.json','root-migration-request.json',`root-relocation-${randomUUID()}.json`,null]){const f=await fixture();try{await rm(join(f.boot,'data-root.json'));if(history)await writeFile(join(f.boot,history),'unknown history');assert.equal(rootRelocationPreflight(f.boot).mode,history?'blocked':'none');assert.equal(await readdir(f.boot).then(a=>a.includes('data-root.json')),false)}finally{await f.close()}}
})
test('RE33-04 blocked controller has diagnosis and quit only, never opens native picker or creates new pointer',async()=>{
 const f=await fixture({mode:'blocked',notice:'pointer-invalid'});try{const original=await readFile(join(f.boot,'data-root.json'));await f.controller.start(f.owner);assert.equal(f.controller.state().phase,'blocked');assert.equal(f.controller.state().canChoose,false);await assert.rejects(f.controller.choose(f.owner),error=>error instanceof RootRelocationControllerError);assert.equal(f.picks(),0);await f.controller.quit(f.owner);assert.equal(f.quits(),1);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),original)}finally{await f.close()}
})
test('RE33-05 native selected original directory uses real authority+core, true confirm then durable commit before cold restart',async()=>{
 const f=await fixture();try{await f.controller.start(f.owner);assert.equal(f.controller.state().phase,'unavailable');assert.equal(f.controller.state().sourcePath,f.root);await f.controller.choose(f.owner);assert.equal(f.picks(),1);assert.equal(f.confirmations(),1);assert.equal(f.restarts(),1);assert.equal(f.controller.state().phase,'complete');assert.deepEqual(JSON.parse(await readFile(join(f.boot,'data-root.json'),'utf8')),{...f.pointer,revision:2,root:await directoryIdentity(f.moved)});assert.equal(await readFile(join(f.moved,'inbox','database','content'),'utf8'),'original bytes')}finally{await f.close()}
})
test('RE33-06 native picker and confirmation cancellation preserve pointer and history without success/restart',async()=>{
 for(const stage of ['picker','confirm']){const f=await fixture(stage==='picker'?{async chooseDirectory(){return null}}:{async confirm(){return false}});try{await f.controller.start(f.owner);const bytes=await readFile(join(f.boot,'data-root.json'));await f.controller.choose(f.owner);assert.equal(f.controller.state().phase,'cancelled');assert.equal(f.controller.state().canChoose,true);assert.equal(f.restarts(),0);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),bytes);assert.equal((await readdir(f.boot)).filter(n=>n.startsWith('root-relocation-')).length,0)}finally{await f.close()}}
})
test('RE33-07 choosing empty or copied root fails safely and leaves the original data unmodified',async()=>{
 let f!:Awaited<ReturnType<typeof fixture>>;f=await fixture({async chooseDirectory(){const copy=join(f.base,'copy');await mkdir(copy);await writeFile(join(copy,'xuanxiang-app.json'),await readFile(join(f.moved,'xuanxiang-app.json')));return copy}});try{await f.controller.start(f.owner);const bytes=await readFile(join(f.boot,'data-root.json'));await assert.rejects(f.controller.choose(f.owner));assert.equal(f.controller.state().notice,'target-not-original');assert.equal(f.restarts(),0);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),bytes)}finally{await f.close()}
})
test('RE33-08 choose reserves exact shared flight before callbacks and synchronous state observer reentry',async()=>{
 const gate=deferred<string|null>(),entered=deferred<void>(),f=await fixture({async chooseDirectory(){entered.resolve();return gate.promise}});try{await f.controller.start(f.owner);let nested:Promise<void>|undefined;f.controller.subscribe(s=>{if(s.phase==='picking'&&!nested)nested=f.controller.choose(f.owner)});const first=f.controller.choose(f.owner);await entered.promise;assert.equal(nested,first);assert.equal(f.controller.choose(f.owner),first);gate.resolve(null);await first;assert.equal(f.controller.state().phase,'cancelled')}finally{gate.resolve(null);await f.close()}
})
test('RE33-09 cancellation waits real picker flight and revokes late native directory before issue/consume/commit',async()=>{
 const gate=deferred<string|null>(),entered=deferred<void>(),f=await fixture({async chooseDirectory(){entered.resolve();return gate.promise}});try{await f.controller.start(f.owner);const choose=f.controller.choose(f.owner);void choose.catch(()=>{});await entered.promise;let drained=false;const cancel=f.controller.cancel(f.owner).then(()=>{drained=true});await new Promise(r=>setImmediate(r));assert.equal(drained,false);assert.equal(f.controller.state().canChoose,false);gate.resolve(f.moved);await Promise.allSettled([choose,cancel]);assert.equal(drained,true);assert.equal(f.controller.state().phase,'cancelled');assert.equal(f.confirmations(),0);assert.equal(f.restarts(),0);assert.deepEqual(await readdir(f.boot),['data-root.json'])}finally{gate.resolve(null);await f.close()}
})
test('RE33-10 cancellation during native confirmation holds the actual core flight until it settles',async()=>{
 const gate=deferred<boolean>(),entered=deferred<void>(),f=await fixture({async confirm(){entered.resolve();return gate.promise}});try{await f.controller.start(f.owner);const choose=f.controller.choose(f.owner);void choose.catch(()=>{});await entered.promise;let done=false;const cancel=f.controller.cancel(f.owner).then(()=>{done=true});await new Promise(r=>setImmediate(r));assert.equal(done,false);gate.resolve(true);await Promise.allSettled([choose,cancel]);assert.equal(f.controller.state().phase,'cancelled');assert.equal(f.restarts(),0);assert.equal((await readdir(f.boot)).filter(n=>n.startsWith('root-relocation-')).length,0)}finally{gate.resolve(false);await f.close()}
})
test('RE33-11 owner loss, warm host and returned native object never permit deletion/commit',async()=>{
 for(const mode of ['owner','warm','truthy']as const){let f!:Awaited<ReturnType<typeof fixture>>;f=await fixture({async confirm(){if(mode==='owner')f.expire();if(mode==='warm')f.warm();return mode==='truthy'?{response:0} as unknown as boolean:true}});try{await f.controller.start(f.owner);const bytes=await readFile(join(f.boot,'data-root.json'));await assert.rejects(f.controller.choose(f.owner));assert.equal(f.restarts(),0);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),bytes);assert.equal(f.controller.state().canRestart,false)}finally{await f.close()}}
})
test('RE33-12 quit during physical picker drains before actual process quit and does not reopen old editing',async()=>{
 const gate=deferred<string|null>(),entered=deferred<void>(),f=await fixture({async chooseDirectory(){entered.resolve();return gate.promise}});try{await f.controller.start(f.owner);const choose=f.controller.choose(f.owner);void choose.catch(()=>{});await entered.promise;const quit=f.controller.quit(f.owner);await new Promise(r=>setImmediate(r));assert.equal(f.quits(),0);gate.resolve(f.moved);await Promise.allSettled([choose,quit]);assert.equal(f.quits(),1);assert.equal(f.restarts(),0);assert.deepEqual(await readdir(f.boot),['data-root.json'])}finally{gate.resolve(null);await f.close()}
})
test('RE33-13 cancelling blocked diagnostics never revives a picker or clears unsafe-history diagnosis',async()=>{
 const f=await fixture();try{await writeFile(join(f.boot,'root-migration.json'),'unsafe history');await f.controller.start(f.owner);const blocked=f.controller.state();assert.equal(blocked.phase,'blocked');await f.controller.cancel(f.owner);assert.equal(f.controller.state().phase,'blocked');assert.equal(f.controller.state().notice,blocked.notice);assert.equal(f.controller.state().canChoose,false);await assert.rejects(f.controller.choose(f.owner));assert.equal(f.picks(),0)}finally{await f.close()}
})
test('RE33-14 accepting quit during initial inspection closes admission before a late state observer can choose',async()=>{
 let picks=0;const f=await fixture({async chooseDirectory(){picks++;return null}});let choice:Promise<void>|undefined;try{f.controller.subscribe(state=>{if(state.canChoose&&!choice){choice=f.controller.choose(f.owner);void choice.catch(()=>{})}});const start=f.controller.start(f.owner),quit=f.controller.quit(f.owner);await Promise.allSettled([start,quit]);await choice?.catch(()=>{});assert.equal(picks,0);assert.equal(f.quits(),1);assert.equal((await readdir(f.boot)).filter(name=>name.startsWith('root-relocation-')).length,0)}finally{await f.close()}
})
test('RE33-15 final restart publication is still followed by an exact synchronous authority seal',async()=>{
 const f=await fixture();let changed=false
 try{await f.controller.start(f.owner);f.controller.subscribe(state=>{if(state.phase==='complete'&&!state.canRestart&&!changed){changed=true;writeFileSync(join(f.boot,'data-root.json'),'foreign final publication pointer')}});await f.controller.choose(f.owner).catch(()=>{});assert.equal(changed,true);assert.equal(f.restarts(),0);assert.equal(f.controller.state().canRestart,false);assert.equal(f.controller.state().notice,'write-unconfirmed');assert.equal(await readFile(join(f.boot,'data-root.json'),'utf8'),'foreign final publication pointer');assert.equal(await readFile(join(f.moved,'inbox','database','content'),'utf8'),'original bytes')}finally{await f.close()}
})
