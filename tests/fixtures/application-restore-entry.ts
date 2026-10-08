import assert from 'node:assert/strict'
import {mkdtemp,mkdir,realpath,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {canonical,digest} from '../../desktop/core/application-backup-files'
import {ApplicationRestoreRequests} from '../../desktop/main/application-restore-request'
import {inspectApplicationRestoreLayouts,loadApplicationRestoreLayout} from '../../desktop/main/application-restore-layout'

export async function entryFixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-entry36-lifecycle-'))),boot=join(root,'bootstrap'),source=join(root,'source'),parent=join(root,'selected-empty'),backupId=randomUUID(),backup=join(root,backupId),appId=randomUUID(),owner=randomUUID()
 for(const path of[boot,source,parent,backup])await mkdir(path)
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}))
 await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 await writeFile(join(boot,'data-root.json'),JSON.stringify({schemaVersion:1,revision:1,rootId:appId,migrationId:null,root:await directoryIdentity(source)}))
 const body={format:'xuanxiang-application-backup',schemaVersion:1,id:backupId,appId,createdAt:'2026-10-08T00:00:00.000Z',phase:'verified',engine:{pglite:'0.5.8',postgresMajor:17},files:[],directories:[],bytes:0}
 await writeFile(join(backup,'xuanxiang-app-backup.json'),JSON.stringify({...body,checksum:digest(canonical(body))}))
 const bootstrap=await directoryIdentity(boot),options={assertStableLock(){},assertOwner(){},assertQuiesced(){},assertOldProcessExited(){},assertCold(){},assertExecutionSettled(){},inspectPendingEvidence(){return inspectApplicationRestoreLayouts(bootstrap)}}
 return{root,boot,source,parent,backup,backupId,appId,owner,bootstrap,options,manager:()=>new ApplicationRestoreRequests(bootstrap,options),close:()=>rm(root,{recursive:true,force:true})}
}
/** Real old process owns its native layout and append-only request. Parent
 * obtains execution only after this process exits; no phase DTO is forged. */
export async function armedEntryChild(f:Awaited<ReturnType<typeof entryFixture>>){
 const request=join(process.cwd(),'desktop/main/application-restore-request.ts'),layout=join(process.cwd(),'desktop/main/application-restore-layout.ts'),ownership=join(process.cwd(),'desktop/core/root-ownership.ts')
 const script=`import {ApplicationRestoreRequests} from ${JSON.stringify(request)};import {createNativeApplicationRestoreLayout,bindApplicationRestoreLayout,inspectApplicationRestoreLayouts} from ${JSON.stringify(layout)};import {directoryIdentity} from ${JSON.stringify(ownership)};import {once} from 'node:events';const boot=await directoryIdentity(${JSON.stringify(f.boot)}),owner=${JSON.stringify(f.owner)},handle=await createNativeApplicationRestoreLayout(boot,await directoryIdentity(${JSON.stringify(f.parent)}),owner,'healthy',()=>{}),manager=new ApplicationRestoreRequests(boot,{assertStableLock(){},assertOwner(){},assertQuiesced(){},assertOldProcessExited(){},assertCold(){},assertExecutionSettled(){},inspectPendingEvidence(){return inspectApplicationRestoreLayouts(boot,{allowed:handle})}}),r=await manager.prepare(owner,{backup:{directory:await directoryIdentity(${JSON.stringify(f.backup)}),backupId:${JSON.stringify(f.backupId)}},parent:handle.layout.parents.candidate});await bindApplicationRestoreLayout(handle,r);await manager.arm(owner,r.operationId);console.log(JSON.stringify({operationId:r.operationId,pid:process.pid}));process.stdin.resume();await once(process.stdin,'data');process.stdin.pause();`
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']}),exited=once(child,'exit');let output='',errors='',stopped=false
 child.stderr.on('data',data=>{errors+=data})
 const result=await new Promise<{operationId:string;pid:number}>((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill();reject(Error('old process timeout '+errors))},10000)
  child.stdout.on('data',data=>{output+=data;if(output.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(output.split('\n')[0]))}catch(cause){reject(cause)}}})
  child.once('error',cause=>{clearTimeout(timer);reject(cause)});child.once('exit',()=>{clearTimeout(timer);if(!output.includes('\n'))reject(Error('old process failed '+errors))})
 })
 return{...result,async stop(){if(stopped)return;stopped=true;child.stdin.end('exit');const[code]=await exited;assert.equal(code,0,errors)}}
}
export async function executingEntry(f:Awaited<ReturnType<typeof entryFixture>>){const child=await armedEntryChild(f);await child.stop();const manager=f.manager(),handle=await manager.beginExecution(f.owner,child.operationId),request=manager.inspect().request!;return{manager,handle,request,layout:loadApplicationRestoreLayout(f.bootstrap,request)}}
