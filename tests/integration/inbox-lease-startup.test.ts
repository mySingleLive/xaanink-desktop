import assert from 'node:assert/strict'
import {test,after} from 'node:test'
import {Worker} from 'node:worker_threads'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {randomUUID,createHash} from 'node:crypto'
import {mkdtemp,mkdir,readFile,writeFile,readdir,realpath,rm,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import {hostname,tmpdir} from 'node:os'
import {build} from 'esbuild'
import {RpcPeer} from '../../desktop/service/rpc'
import {DataRootManager} from '../../desktop/core/data-root'
import {readRootStartup,createRootStartupBuffer} from '../../desktop/shared/root-startup'
import {inboxLeaseRecoveryRequired,prepareInboxLeaseRecovery} from '../../desktop/main/inbox-lease-recovery'
import {defaultState} from '../../desktop/core/settings'
import {freezeTaskDefaults} from '../../desktop/shared/task-defaults'

const output=join(process.cwd(),'dist','inbox42-test-'+randomUUID())
const built=build({bundle:true,platform:'node',target:'node24',format:'cjs',packages:'external',entryPoints:['desktop/service/index.ts'],outfile:join(output,'index.cjs'),define:{'import.meta.url':'__desktopImportMetaUrl'},banner:{js:'var __desktopImportMetaUrl = require("node:url").pathToFileURL(__filename).href;'}})
after(async()=>{await built;await rm(output,{recursive:true,force:true})})
const deadPid=(async()=>{const child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});await once(child,'exit');assert.ok(child.pid);assert.throws(()=>process.kill(child.pid!,0),{code:'ESRCH'});return child.pid!})()
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-inbox42-pg-'))),root=join(base,'root'),bootstrap=join(base,'bootstrap')
 await mkdir(bootstrap);let activeWorkers=0
 async function launch(){
  await built
  const startup=createRootStartupBuffer(),worker=new Worker(join(output,'index.cjs'),{workerData:{root,bootstrap,migrations:join(process.cwd(),'prisma/migrations'),startup}})
  activeWorkers++
  const rpc=new RpcPeer(worker,async method=>{if(method==='model.defaults')return freezeTaskDefaults(defaultState.settings.agent,0);throw Error('No model transport or main business calls permitted in this test')})
  worker.on('error',()=>rpc.dispose());worker.on('exit',()=>{activeWorkers--;rpc.dispose()})
  let ended=false
  return{rpc,result(){assert.notEqual(Atomics.wait(new Int32Array(startup,0,4),0,0,25000),'timed-out');return readRootStartup(startup)},async close(){if(ended)return;ended=true;await rpc.call('close').catch(()=>undefined);rpc.dispose();await worker.terminate()}}
 }
 async function request(rpc:RpcPeer,path:string,method='GET',data?:unknown){
  const id=randomUUID(),reply=await rpc.call<{status:number}>('start',{version:1,id,path,method,headers:data?{'Content-Type':'application/json'}:{},body:data?Array.from(Buffer.from(JSON.stringify(data))):undefined})
  const chunks:Uint8Array[]=[]
  for(;;){const part=await rpc.call<{done:boolean;bytes?:Uint8Array}>('read',id);if(part.done)break;chunks.push(part.bytes!)}
  return{status:reply.status,data:JSON.parse(Buffer.concat(chunks).toString('utf8'))}
 }
 const seed=await launch()
 try{assert.equal(seed.result()?.status,'ready');assert.equal(await seed.rpc.call('ready'),true);assert.equal((await request(seed.rpc,'/api/admin/prompts','POST',{key:'inbox42-original',name:'公开验收模板',content:'原有中文数据必须保留'})).status,201)}finally{await seed.close()}
 const lock=join(root,'inbox/.xaanink-lock'),ownerPath=join(lock,'owner.json')
 await mkdir(lock);const owner=JSON.stringify({token:randomUUID(),pid:await deadPid,host:hostname()});await writeFile(ownerPath,owner)
 const pointer=await new DataRootManager(bootstrap,root).resolve();assert.equal(pointer.state,'existing');if(pointer.state!=='existing')throw Error('Fixture did not adopt its actual root')
 async function databaseHashes(){
  const files:Array<[string,string]>=[]
  async function walk(path:string,prefix=''){for(const entry of await readdir(path,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())await walk(join(path,entry.name),name+'/');else{assert(entry.isFile());files.push([name,createHash('sha256').update(await readFile(join(path,entry.name))).digest('hex')])}}}
  await walk(join(root,'inbox/database'));return files.sort(([a],[b])=>a.localeCompare(b))
 }
 return{root,bootstrap,ownerPath,owner,pointer:pointer.pointer,launch,request,databaseHashes,options:{assertColdHost(){if(activeWorkers!==0)throw Error('Actual worker is still active')}},cleanup:()=>rm(base,{recursive:true,force:true})}
}
test('IL42-PG01 real built worker refuses stale inbox lease; cancelling repair preserves every closed database file', {timeout:90000},async()=>{
 const f=await fixture();try{
  const before=await f.databaseHashes(),blocked=await f.launch()
  try{assert.deepEqual(blocked.result(),{version:1,status:'failed',code:'ROOT_INITIALIZATION_FAILED'});await assert.rejects(blocked.rpc.call('ready'))}finally{await blocked.close()}
  const session=await prepareInboxLeaseRecovery(f.bootstrap,f.options);session.cancel();await assert.rejects(session.recover(true))
  assert.equal(await readFile(f.ownerPath,'utf8'),f.owner);assert.deepEqual(await f.databaseHashes(),before);assert.equal(inboxLeaseRecoveryRequired(f.pointer),true)
 }finally{await f.cleanup()}
})
test('IL42-PG02 explicit inbox lease repair changes no database bytes; actual PGlite worker reopens retained user template and closes its new lease normally', {timeout:90000},async()=>{
 const f=await fixture();try{
  const before=await f.databaseHashes(),session=await prepareInboxLeaseRecovery(f.bootstrap,f.options)
  assert.equal((await session.recover(true)).status,'recovered');session.assertRecovered();assert.deepEqual(await f.databaseHashes(),before);assert.equal(inboxLeaseRecoveryRequired(f.pointer),false)
  const running=await f.launch();try{assert.deepEqual(running.result(),{version:1,status:'ready',root:f.root});const reply=await f.request(running.rpc,'/api/admin/prompts');assert.equal(reply.status,200);assert(reply.data.prompts.some((row:{key:string;content:string})=>row.key==='inbox42-original'&&row.content==='原有中文数据必须保留'))}finally{await running.close()}
  await assert.rejects(lstat(join(f.root,'inbox/.xaanink-lock')),{code:'ENOENT'});assert.equal(inboxLeaseRecoveryRequired(f.pointer),false)
 }finally{await f.cleanup()}
})
