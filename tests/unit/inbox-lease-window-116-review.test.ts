import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {once} from 'node:events'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {hostname,tmpdir} from 'node:os'
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {prepareSessionDirectory} from '../../desktop/main/session-directory'
import {prepareInboxLeaseRecovery,type InboxLeaseRecoveryOptions} from '../../desktop/main/inbox-lease-recovery'

// Executes the actual module function with controlled native ports, while the
// ownership/lease/session filesystem operations remain actual. No Electron app,
// renderer, source DB, default directory or network is started by these tests.
const source=ts.createSourceFile('inbox-window.ts',readFileSync('desktop/main/inbox-lease-recovery-window.ts','utf8'),ts.ScriptTarget.Latest,true)
const declaration=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='launchInboxLeaseRecovery')
assert.ok(declaration)
const code=transformSync(declaration.getText(source).replace(/^export\s+/,''),{loader:'ts'}).code
const factory=new Function('app','BrowserWindow','dialog','Menu','prepareSessionDirectory','prepareInboxLeaseRecovery',`${code};return launchInboxLeaseRecovery`)
const deadPid=(async()=>{const child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});await once(child,'exit');assert.ok(child.pid);assert.throws(()=>process.kill(child.pid!,0),{code:'ESRCH'});return child.pid!})()
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-inbox-window116-'))),boot=join(base,'bootstrap'),root=join(base,'root'),inbox=join(root,'inbox'),database=join(inbox,'database'),lock=join(inbox,'.xuanxiang-lock'),ownerPath=join(lock,'owner.json')
 await mkdir(boot);await mkdir(database,{recursive:true});await mkdir(lock)
 await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}))
 await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));await writeFile(join(database,'original.bin'),'original source bytes')
 const bytes=JSON.stringify({token:randomUUID(),pid:await deadPid,host:hostname()});await writeFile(ownerPath,bytes)
 await new DataRootManager(boot,root).adopt(await directoryIdentity(root))
 return{base,boot,root,inbox,database,lock,ownerPath,bytes,cleanup:()=>rm(base,{recursive:true,force:true})}
}
function nativePorts(choose:(number:number)=>Promise<{response:number}>,hook?:InboxLeaseRecoveryOptions['hook']){
 let locked=true,profile='';let beforeQuit:(event:{preventDefault():void})=>void=()=>{}
 const exits:number[]=[],messages:{message:string}[]=[]
 const app={setPath(_name:string,value:string){profile=value},getPath(){return profile},hasSingleInstanceLock(){return locked},whenReady:async()=>{},on(name:string,run:typeof beforeQuit){if(name==='before-quit')beforeQuit=run},exit(code:number){exits.push(code)}}
 const launch=factory(app,{getAllWindows:()=>[]},{showMessageBox:async(value:{message:string})=>{messages.push(value);return choose(messages.length)}},{buildFromTemplate:(value:unknown)=>value,setApplicationMenu(){}},prepareSessionDirectory,(boot:string,options:InboxLeaseRecoveryOptions)=>prepareInboxLeaseRecovery(boot,{...options,hook})) as (bootstrap:string,assertNoOrdinaryHost:()=>void)=>Promise<void>
 return{launch,exits,messages,get profile(){return profile},revoke(){locked=false},quit(){let prevented=false;beforeQuit({preventDefault(){prevented=true}});return prevented}}
}

test('IL116-W01 native cancellation preserves real owner bytes and prepares session only under bootstrap',async()=>{
 const f=await fixture(),ports=nativePorts(async()=>({response:0}));try{
  await ports.launch(f.boot,()=>{})
  assert.deepEqual(ports.exits,[0]);assert.equal(ports.messages.length,1);assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes)
  assert.equal(ports.profile,join(f.boot,'session'));await assert.rejects(lstat(join(f.root,'session')),{code:'ENOENT'});await assert.rejects(lstat(join(f.inbox,'.xuanxiang-lease-recovery.json')),{code:'ENOENT'})
 }finally{await f.cleanup()}
})

test('IL116-W02 before-quit cannot end a real recovery filesystem flight paused immediately before unlink',async()=>{
 const f=await fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>()
 const ports=nativePorts(async number=>({response:number===1?1:0}),async phase=>{if(phase==='before-owner-unlink'){entered.resolve();await release.promise}})
 let flight:Promise<void>|undefined
 try{
  flight=ports.launch(f.boot,()=>{});await entered.promise
  assert.equal(ports.quit(),true);assert.deepEqual(ports.exits,[]);assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes)
  release.resolve();await flight
  assert.deepEqual(ports.exits,[0]);await assert.rejects(lstat(f.lock),{code:'ENOENT'});assert.equal(JSON.parse(await readFile(join(f.inbox,'.xuanxiang-lease-recovery.json'),'utf8')).payload.phase,'recovered');assert.equal(await readFile(join(f.database,'original.bin'),'utf8'),'original source bytes')
 }finally{release.resolve();await flight;await f.cleanup()}
})

test('IL116-W03 a new live lease during the final result dialog is preserved and cannot produce a successful exit',async()=>{
 const f=await fixture();let newOwner=''
 const ports=nativePorts(async number=>{
  if(number===2){await mkdir(f.lock);newOwner=JSON.stringify({token:randomUUID(),pid:process.pid,host:hostname()});await writeFile(f.ownerPath,newOwner)}
  return{response:number===1?1:0}
 })
 try{
  await ports.launch(f.boot,()=>{});assert.deepEqual(ports.exits,[1]);assert.equal(ports.messages.length,3);assert.equal(ports.messages[2].message,'本地写入锁未能安全处理');assert.equal(await readFile(f.ownerPath,'utf8'),newOwner)
 }finally{await f.cleanup()}
})

test('IL116-W04 stable native host revocation during the confirmation dialog prevents all recovery writes',async()=>{
 const f=await fixture();const ports=nativePorts(async number=>{if(number===1)ports.revoke();return{response:1}})
 try{
  await ports.launch(f.boot,()=>{});assert.deepEqual(ports.exits,[1]);assert.equal(ports.messages.length,2);assert.equal(await readFile(f.ownerPath,'utf8'),f.bytes);await assert.rejects(lstat(join(f.inbox,'.xuanxiang-lease-recovery.json')),{code:'ENOENT'})
 }finally{await f.cleanup()}
})
