import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,realpath,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {canonical,digest} from '../../desktop/core/application-backup-files'
import {ApplicationRestoreHandoff} from '../../desktop/main/application-restore-handoff'

async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xx-ordinary-restore36-'))),boot=join(base,'boot'),source=join(base,'source'),target=join(base,'target'),id=randomUUID(),backupId=randomUUID(),ownerNonce=randomUUID()
 for(const path of[boot,source,target])await mkdir(path)
 await writeFile(join(boot,'data-root.json'),JSON.stringify({schemaVersion:1,revision:1,rootId:id,migrationId:null,root:await directoryIdentity(source)}))
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id,phase:'ready',inboxReady:true}))
 await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 const backup=join(source,'backups/application/packages',backupId);await mkdir(backup,{recursive:true})
 const body={format:'xuanxiang-application-backup',schemaVersion:1,id:backupId,appId:id,createdAt:'2026-10-08T00:00:00.000Z',phase:'verified',engine:{pglite:'0.5.8',postgresMajor:17},files:[],directories:[],bytes:0}
 await writeFile(join(backup,'xuanxiang-app-backup.json'),JSON.stringify({...body,checksum:digest(canonical(body))}))
 let ownerAlive=true,closed=false,choice:string|null=target,accepted:unknown=true;const events:string[]=[]
 const handoff=new ApplicationRestoreHandoff({bootstrap:await directoryIdentity(boot),root:source,ownerNonce,assertStableLock(){},assertOwner(){if(!ownerAlive)throw Error('owner gone')},assertClosed(){if(!closed||ownerAlive)throw Error('physical close pending')},async pauseSelection(){events.push('pause')},async releaseSelection(){events.push('release')},async chooseParent(){events.push('picker');return choice},async protectedDirectories(){return[]},async confirm(){return accepted as boolean},async requestClose(){events.push('close');closed=true;await handoff.commitClosed();return true},async destroyAndFlush(){events.push('flush-session');ownerAlive=false},relaunchAndQuit(){events.push('relaunch');events.push('quit')}})
 return{base,boot,source,target,backupId,handoff,events,setChoice:(v:string|null)=>choice=v,setConfirmation:(v:unknown)=>accepted=v,close:()=>rm(base,{recursive:true,force:true})}
}
test('ordinary restore selects only native empty layout, records prepared, then awaits actual shutdown before armed/relaunch',{timeout:15000},async()=>{
 const f=await fixture();try{
  const before=await readFile(join(f.boot,'data-root.json'));const selected=await f.handoff.command({type:'select',backupId:f.backupId})
  assert.equal(selected.phase,'prepared');assert.equal((await readdir(f.target)).length,4);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),before)
  const completed=await f.handoff.command({type:'start',operationId:selected.operationId!});assert.equal(completed.phase,'armed')
  assert.deepEqual(f.events,['pause','picker','release','close','flush-session','relaunch','quit']);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),before)
  const request=JSON.parse(await readFile(join(f.boot,'application-recovery-request.json'),'utf8'));assert.equal(request.state.operations[0].phase,'armed');assert.equal(request.state.operations[0].oldProcess.pid,process.pid)
 }finally{await f.close()}
})
test('native picker cancellation and non-boolean confirmation do not arm or quit; prepared can be cancelled safely',{timeout:15000},async()=>{
 const f=await fixture();try{
  f.setChoice(null);assert.equal((await f.handoff.command({type:'select',backupId:f.backupId})).phase,'idle');assert.deepEqual(await readdir(f.target),[])
  f.setChoice(f.target);const selected=await f.handoff.command({type:'select',backupId:f.backupId});f.setConfirmation('yes')
  await assert.rejects(f.handoff.command({type:'start',operationId:selected.operationId!}),/INVALID_CONFIRMATION/);assert(!f.events.includes('close'))
  assert.equal((await f.handoff.command({type:'cancel',operationId:selected.operationId!})).phase,'idle');assert(!f.events.includes('quit'))
 }finally{await f.close()}
})
test('catalog change after native selection revokes the approval; renderer paths and stale operation are rejected',{timeout:15000},async()=>{
 const f=await fixture();try{
  await assert.rejects(f.handoff.command({type:'select',backupId:f.backupId,path:f.target} as never));assert.deepEqual(await readdir(f.target),[])
  const selected=await f.handoff.command({type:'select',backupId:f.backupId});await writeFile(join(f.source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[]}))
  await assert.rejects(f.handoff.command({type:'start',operationId:selected.operationId!}));assert(!f.events.includes('close'));assert(!f.events.includes('quit'))
  await assert.rejects(f.handoff.command({type:'cancel',operationId:randomUUID()}));await f.handoff.command({type:'cancel',operationId:selected.operationId!})
 }finally{await f.close()}
})
