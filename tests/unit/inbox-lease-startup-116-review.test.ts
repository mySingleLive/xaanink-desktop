import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {hostname,tmpdir} from 'node:os'
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm,lstat} from 'node:fs/promises'
import {join} from 'node:path'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {inboxLeaseRecoveryRequired} from '../../desktop/main/inbox-lease-recovery'
import {assertNoLegacyBackupRecovery} from '../../desktop/main/legacy-recovery-preflight'
import {rootRelocationPreflight} from '../../desktop/main/root-relocation-preflight'
import {rootMaintenanceRequired} from '../../desktop/main/root-maintenance-preflight'
import {RootMigrationRequests} from '../../desktop/main/root-migration-request'

const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
const branch=source.statements.at(-1)
assert.ok(branch&&ts.isIfStatement(branch)&&branch.getText(source).includes('app.requestSingleInstanceLock()'))
const code=transformSync(branch.getText(source),{loader:'ts'}).code
async function fixture(existing=true){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-inbox-startup116-'))),boot=join(base,'bootstrap'),root=join(base,'root'),inbox=join(root,'inbox'),lock=join(inbox,'.xuanxiang-lock')
 await mkdir(boot)
 if(existing){await mkdir(join(inbox,'database'),{recursive:true});await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}));await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}));await new DataRootManager(boot,root).adopt(await directoryIdentity(root))}
 return{base,boot,root,inbox,lock,cleanup:()=>rm(base,{recursive:true,force:true})}
}
async function start(boot:string,defaultRoot:string){
 const trace:string[]=[],exits:number[]=[]
 const deps={app:{requestSingleInstanceLock:()=>true,hasSingleInstanceLock:()=>true,exit(code:number){exits.push(code)},quit(){trace.push('quit')}},BrowserWindow:{getAllWindows:()=>[]},assertNoLegacyBackupRecovery:(path:string,guard:()=>void)=>{trace.push('legacy');assertNoLegacyBackupRecovery(path,guard)},rootRelocationPreflight:(path:string)=>{trace.push('relocation');return rootRelocationPreflight(path)},rootMaintenanceRequired:(path:string)=>{trace.push('maintenance');return rootMaintenanceRequired(path)},inboxLeaseRecoveryRequired:(pointer:Parameters<typeof inboxLeaseRecoveryRequired>[0])=>{trace.push('inbox');return inboxLeaseRecoveryRequired(pointer)},launchRootRelocation:async()=>{trace.push('relocation-window')},launchRootMaintenance:async(path:string,root:string)=>{assert.equal(path,boot);assert.equal(root,defaultRoot);trace.push('maintenance-window')},launchInboxLeaseRecovery:async(_path:string,guard:()=>void)=>{trace.push('inbox-cold');guard()},launch:async()=>{trace.push('ordinary')},bootstrapPath:boot,startupPaths:{bootstrap:boot,defaultRoot,encryptionFamily:'legacy'},startupSelectionError:null,isolatedRoot:null,join,homedir:()=>'/unused-fixture-home',dialog:{showErrorBox(){trace.push('blocked-error')}}}
 new Function(...Object.keys(deps),`let worker,window,repository,modelService;let failedRootBeforeSession=false,ordinaryWorkerExited=false;${code}`)(...Object.values(deps))
 await new Promise<void>(resolve=>setImmediate(resolve))
 return{trace,exits}
}
test('IL116-S01 real first-start and existing-root filesystem triage retain ordinary routing with no recovery writes',async()=>{
 for(const existing of [false,true]){const f=await fixture(existing);try{
  const {trace,exits}=await start(f.boot,f.root);assert.deepEqual(trace,['legacy','relocation','maintenance','inbox','ordinary']);assert.deepEqual(exits,[])
  await assert.rejects(lstat(join(f.boot,'session')),{code:'ENOENT'});if(existing)await assert.rejects(lstat(join(f.inbox,'.xuanxiang-lease-recovery.json')),{code:'ENOENT'})
 }finally{await f.cleanup()}}
})
test('IL116-S02 actual main branch routes an inbox lease before the ordinary host and rechecks original triage in its cold guard',async()=>{
 const f=await fixture();try{
  await mkdir(f.lock);const bytes=JSON.stringify({token:randomUUID(),pid:process.pid,host:hostname()});await writeFile(join(f.lock,'owner.json'),bytes)
  const {trace,exits}=await start(f.boot,f.root);assert.deepEqual(trace,['legacy','relocation','maintenance','inbox','inbox-cold','legacy','relocation','maintenance']);assert.deepEqual(exits,[]);assert.equal(await readFile(join(f.lock,'owner.json'),'utf8'),bytes)
 }finally{await f.cleanup()}
})
test('IL116-S03 genuine armed migration retains maintenance priority over an existing inbox lock',async()=>{
 const f=await fixture();try{
  await mkdir(f.lock);await writeFile(join(f.lock,'owner.json'),'retained lock bytes')
  const target=join(f.base,'new-root');await mkdir(target);const manager=new DataRootManager(f.boot,f.root),nonce=randomUUID()
  const requests=new RootMigrationRequests(f.boot,{resolveSource:()=>manager.resolve(),assertStableLock(){},assertOwner(value){assert.equal(value,nonce)},assertClosed(){}})
  const prepared=await requests.prepare(nonce,await directoryIdentity(target));await requests.arm(nonce,prepared.requestId)
  const {trace,exits}=await start(f.boot,f.root);assert.deepEqual(trace,['legacy','relocation','maintenance','maintenance-window']);assert.deepEqual(exits,[]);assert.equal(await readFile(join(f.lock,'owner.json'),'utf8'),'retained lock bytes')
 }finally{await f.cleanup()}
})
test('IL116-S04 unknown inbox audit blocks actual top-level startup without either ordinary or repair launch',async()=>{
 const f=await fixture();try{
  const path=join(f.inbox,'.xuanxiang-lease-recovery.json');await writeFile(path,'unknown audit bytes')
  const {trace,exits}=await start(f.boot,f.root);assert.deepEqual(trace,['legacy','relocation','maintenance','inbox','blocked-error']);assert.deepEqual(exits,[1]);assert.equal(await readFile(path,'utf8'),'unknown audit bytes')
 }finally{await f.cleanup()}
})
