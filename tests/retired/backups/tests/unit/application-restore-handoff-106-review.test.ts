import assert from 'node:assert/strict'
import {test} from 'node:test'
import fsPromises from 'node:fs/promises'
import {mkdtemp,mkdir,realpath,readFile,writeFile,rename,readdir,rm,symlink} from 'node:fs/promises'
import fs from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {canonical,digest} from '../../desktop/core/application-backup-files'
import {ApplicationRestoreHandoff,type ApplicationRestoreHandoffOptions} from '../../desktop/main/application-restore-handoff'
import {applicationRestorePreflight} from '../../desktop/main/application-restore-preflight'

// Actual filesystem intent/layout/phase records; trusted window/session host
// callbacks are lifecycle doubles. This does not prove Electron close or ESRCH.
async function fixture(additional:Pick<ApplicationRestoreHandoffOptions,'closedHandoffPending'>={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-handoff106-review-'))),boot=join(base,'bootstrap'),source=join(base,'source'),target=join(base,'target'),appId=randomUUID(),backupId=randomUUID(),ownerNonce=randomUUID(),events:string[]=[]
 for(const path of[boot,source,target])await mkdir(path)
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}))
 await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 await writeFile(join(boot,'data-root.json'),JSON.stringify({schemaVersion:1,revision:1,rootId:appId,migrationId:null,root:await directoryIdentity(source)})+'\n')
 const backup=join(source,'backups/application/packages',backupId);await mkdir(backup,{recursive:true})
 const body={format:'xuanxiang-application-backup',schemaVersion:1,id:backupId,appId,createdAt:'2026-10-08T00:00:00.000Z',phase:'verified',engine:{pglite:'0.5.8',postgresMajor:17},files:[],directories:[],bytes:0}
 await writeFile(join(backup,'xuanxiang-app-backup.json'),JSON.stringify({...body,checksum:digest(canonical(body))}))
 let ownerAlive=true,dataClosed=false,picker=async():Promise<string|null>=>target,close=async()=>{dataClosed=true;await handoff.commitClosed();return true},destroy=async()=>{events.push('destroy');ownerAlive=false}
 const options:ApplicationRestoreHandoffOptions={bootstrap:await directoryIdentity(boot),root:source,ownerNonce,assertStableLock(){},assertOwner(){if(!ownerAlive)throw Error('original owner revoked')},assertClosed(){if(ownerAlive||!dataClosed)throw Error('physical close incomplete')},async pauseSelection(){events.push('pause')},async releaseSelection(){events.push('release')},chooseParent:()=>picker(),async protectedDirectories(){return[]},async confirm(){return true},requestClose:()=>close(),destroyAndFlush:()=>destroy(),relaunchAndQuit(){events.push('relaunch')}}
 Object.assign(options,additional)
 const handoff=new ApplicationRestoreHandoff(options),selected=()=>handoff.command({type:'select',backupId})
 return{base,boot,source,target,backupId,handoff,options,events,selected,setPicker:(value:typeof picker)=>picker=value,setClose:(value:typeof close)=>close=value,setDestroy:(value:typeof destroy)=>destroy=value,markDataClosed(){dataClosed=true},revoke(){ownerAlive=false},close:()=>rm(base,{recursive:true,force:true})}
}

test('AR106-H01 same-byte catalog inode substitution during native picker does not create a layout or prepared intent',{timeout:15000},async()=>{
 const f=await fixture()
 try{
  const path=join(f.source,'catalog.json'),before=await readFile(path);f.setPicker(async()=>{await rename(path,path+'.original');await writeFile(path,before);return f.target})
  await assert.rejects(f.selected());assert.equal(f.handoff.state().phase,'idle');assert.deepEqual(await readdir(f.target),[]);assert.deepEqual(await readdir(f.boot),['data-root.json']);assert.deepEqual(await readFile(path),before);assert.deepEqual(await readFile(path+'.original'),before);assert.deepEqual(f.events,['pause','release'])
 }finally{await f.close()}
})

test('AR106-H02 revoking the original owner during picker cannot be bypassed by replacing public host fields',{timeout:15000},async()=>{
 const f=await fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<string|null>();f.setPicker(()=>{entered.resolve();return release.promise});const pending=f.selected()
 try{
  await entered.promise;f.revoke();f.options.assertOwner=()=>{};f.options.assertStableLock=()=>{};release.resolve(f.target)
  await assert.rejects(pending);assert.equal(f.handoff.state().phase,'idle');assert.deepEqual(await readdir(f.target),[]);assert.deepEqual(await readdir(f.boot),['data-root.json']);assert.deepEqual(f.events,['pause','release'])
 }finally{release.resolve(null);await pending.catch(()=>{});await f.handoff.flush();await f.close()}
})

test('AR106-H03 session flush IO failure after destruction preserves prepared evidence and enters inspection rather than remaining an active closing phase',{timeout:15000},async()=>{
 const f=await fixture()
 try{
  const selected=await f.selected(),pointer=await readFile(join(f.boot,'data-root.json')),request=await readFile(join(f.boot,'application-recovery-request.json'))
  f.setDestroy(async()=>{f.events.push('destroy');f.revoke();await readFile(join(f.base,'missing-session-flush-file'))})
  await assert.rejects(f.handoff.command({type:'start',operationId:selected.operationId!}));assert.equal(f.handoff.state().phase,'inspection','a destroyed original window cannot still own an in-progress closing flow');assert.equal(f.handoff.pending,true);assert.equal(f.handoff.inspection,true)
  assert.deepEqual(await readFile(join(f.boot,'data-root.json')),pointer);assert.deepEqual(await readFile(join(f.boot,'application-recovery-request.json')),request);assert(!f.events.includes('relaunch'));assert.equal(applicationRestorePreflight(f.boot,()=>{}).startup.mode,'cold')
 }finally{await f.handoff.flush();await f.close()}
})

test('AR106-H04 late armed phase directory-sync failure remains unknown inspection and retains immutable intent instead of cancelling or relaunching',{timeout:15000},async t=>{
 const f=await fixture()
 try{
  const selected=await f.selected(),pointer=await readFile(join(f.boot,'data-root.json')),header=await readFile(join(f.boot,'application-recovery-request.json')),originalOpen=fsPromises.open;let injected=false
  t.mock.method(fsPromises,'open',async(...args:Parameters<typeof fsPromises.open>)=>{const handle=await originalOpen(...args);if(!injected&&String(args[0])===f.boot){injected=true;t.mock.method(handle,'sync',async()=>{throw Error('isolated directory sync fault')})}return handle})
  await assert.rejects(f.handoff.command({type:'start',operationId:selected.operationId!}));assert.equal(injected,true);assert.equal(f.handoff.state().phase,'inspection');assert.equal(f.handoff.pending,true);assert(!f.events.includes('relaunch'))
  assert.deepEqual(await readFile(join(f.boot,'data-root.json')),pointer);assert.deepEqual(await readFile(join(f.boot,'application-recovery-request.json')),header)
  assert.equal((await readdir(f.boot)).filter(name=>name.startsWith('application-recovery-phase-')).length,2,'the incomplete published armed phase is retained for inspection');assert.equal(applicationRestorePreflight(f.boot,()=>{}).startup.mode,'cold')
 }finally{await f.handoff.flush();await f.close()}
})

test('AR106-H05 cancelling the normal close decision retains prepared intent and permits explicit cancellation without claiming old process exit',{timeout:15000},async()=>{
 const f=await fixture()
 try{
  const selected=await f.selected();f.setClose(async()=>false)
  assert.equal((await f.handoff.command({type:'start',operationId:selected.operationId!})).phase,'prepared');assert(!f.events.includes('destroy'));assert(!f.events.includes('relaunch'))
  assert.equal((await f.handoff.command({type:'cancel',operationId:selected.operationId!})).phase,'idle');const header=JSON.parse(await readFile(join(f.boot,'application-recovery-request.json'),'utf8'));assert.equal(header.state.operations[0].phase,'cancelled');assert.equal(header.state.operations[0].oldProcess.pid,process.pid);assert.equal(applicationRestorePreflight(f.boot,()=>{}).startup.mode,'normal')
 }finally{await f.handoff.flush();await f.close()}
})

test('AR106-H06 a known backup UUID whose managed package directory becomes a symbolic link is refused before reading foreign metadata or creating a layout',{timeout:15000},async t=>{
 const f=await fixture()
 try{
  const packagePath=join(f.source,'backups/application/packages',f.backupId),foreign=join(f.base,'foreign-package');await mkdir(foreign);const receipt=await readFile(join(packagePath,'xuanxiang-app-backup.json'));await writeFile(join(foreign,'xuanxiang-app-backup.json'),receipt);await rename(packagePath,packagePath+'.original');await symlink(foreign,packagePath,'dir')
  const originalOpen=fs.openSync;let foreignOpens=0
  t.mock.method(fs,'openSync',((path:fs.PathLike,flags:fs.OpenMode,mode?:fs.Mode)=>{if(String(path).startsWith(foreign+'/'))foreignOpens++;return originalOpen(path,flags,mode)}) as typeof fs.openSync)
  await assert.rejects(f.selected(),'semantic UUID selection must not grant ownership of a newly linked external backup package');assert.equal(foreignOpens,0);assert.deepEqual(await readdir(f.target),[]);assert.deepEqual(await readdir(f.boot),['data-root.json']);assert.deepEqual(await readFile(join(foreign,'xuanxiang-app-backup.json')),receipt)
 }finally{await f.handoff.flush();await f.close()}
})

test('AR106-H07 a native UUID child replaced before its asynchronous identity observation cannot become a trusted prepared candidate parent',{timeout:15000},async t=>{
 const f=await fixture()
 try{
  const originalLstat=fsPromises.lstat,originalOpen=fsPromises.open;let swapped=false
  const replace=async(path:string)=>{swapped=true;await rename(path,join(f.base,'retained-owned-native-child'));await mkdir(path)}
  t.mock.method(fsPromises,'lstat',(async(...args:Parameters<typeof fsPromises.lstat>)=>{
   const path=String(args[0]);if(!swapped&&path.startsWith(f.target+'/')&&/^[0-9a-f-]{36}$/.test(path.slice(f.target.length+1)))await replace(path)
   return originalLstat(...args)
  }) as typeof fsPromises.lstat)
  // A correct synchronous identity capture removes the unsafe async lstat.
  // Keep the same physical substitution at the next real directory-sync IO
  // boundary so the final refusal assertion still exercises a live race.
  t.mock.method(fsPromises,'open',async(...args:Parameters<typeof fsPromises.open>)=>{const handle=await originalOpen(...args);if(!swapped&&String(args[0])===f.target){const children=await readdir(f.target),name=children.find(row=>/^[0-9a-f-]{36}$/.test(row));if(name)await replace(join(f.target,name))}return handle})
  await assert.rejects(f.selected(),'a new native grant must pin the identity of the directory it actually created, not learn a foreign replacement after yielding');assert.equal(swapped,true);assert.equal(f.handoff.inspection,true);assert.ok((await readdir(f.base)).includes('retained-owned-native-child'));assert.ok(!(await readdir(f.boot)).includes('application-recovery-request.json'))
 }finally{await f.handoff.flush();await f.close()}
})

test('AR106-H08 data-close success followed by a failed shutdown step retains closing intent and permits only a close retry before arming',{timeout:15000},async()=>{
 let physicallyClosed=false,calls=0
 const f=await fixture({closedHandoffPending:()=>physicallyClosed})
 try{
  const selected=await f.selected(),pointer=await readFile(join(f.boot,'data-root.json'));f.setClose(async()=>{
   calls++;physicallyClosed=true;f.markDataClosed()
   if(calls===1){try{await readFile(join(f.base,'missing-worker-shutdown-evidence'))}catch{return false}}
   await f.handoff.commitClosed();return true
  })
  assert.equal((await f.handoff.command({type:'start',operationId:selected.operationId!})).phase,'closing');assert.equal(f.handoff.closing,true)
  await assert.rejects(f.handoff.command({type:'cancel',operationId:selected.operationId!}));assert(!f.events.includes('destroy'));assert(!f.events.includes('relaunch'));assert.equal(JSON.parse(await readFile(join(f.boot,'application-recovery-request.json'),'utf8')).state.operations[0].phase,'prepared')
  assert.equal((await f.handoff.command({type:'start',operationId:selected.operationId!})).phase,'armed');assert.equal(calls,2);assert.equal(f.events.filter(row=>row==='destroy').length,1);assert.equal(f.events.filter(row=>row==='relaunch').length,1);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),pointer)
 }finally{await f.handoff.flush();await f.close()}
})
