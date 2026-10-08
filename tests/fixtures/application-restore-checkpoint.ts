import assert from 'node:assert/strict'
import {mkdtemp,mkdir,realpath,writeFile,readFile,rename,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {canonical,digest} from '../../desktop/core/application-backup-files'
import {observeRootAuthority} from '../../desktop/core/root-authority'
import {ApplicationRestoreRequests,type ApplicationRestoreRequestOptions} from '../../desktop/main/application-restore-request'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
import {prepareApplicationDraftRetention,persistApplicationDraftRetention,installInertApplicationDraftJournal} from '../../desktop/core/application-restore-drafts'
import {applicationDraftRecoveryItems} from '../../desktop/shared/application-restore'
import type {StoreOptions} from '../../desktop/core/versioned-store'

/** Seeded physical core authority, not a producer capability or PG activation.
 * The request PID handoff and subsequent journal/barrier/attestations are real. */
export async function checkpointFixture(hooks:Pick<StoreOptions,'beforeRename'>={},requestHooks:ApplicationRestoreRequestOptions['writeHooks']={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-checkpoint36-'))),boot=join(base,'bootstrap'),source=join(base,'source'),backup=join(base,'backup'),parent=join(base,'parent')
 for(const path of[boot,source,backup,parent])await mkdir(path)
 const appId=randomUUID(),backupId=randomUUID(),owner=randomUUID(),gate=new ApplicationMetadataGate()
 const marker={schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:appId,phase:'ready',inboxReady:true}
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify(marker))
 const original=new DraftJournal(source);const release=original.activate('original')
 await original.persist('original',{version:1,revision:1,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft:'current unsent text',queuedRequests:[{approved:true,prompt:'never replay'}]}},issues:[]});release()
 const pointer={schemaVersion:1,revision:1,rootId:appId,migrationId:null,root:await directoryIdentity(source)},bootstrap=await directoryIdentity(boot)
 await writeFile(join(boot,'data-root.json'),JSON.stringify(pointer)+'\n')
 const backupBody={format:'xuanxiang-application-backup',schemaVersion:1,id:backupId,appId,createdAt:'2026-10-08T00:00:00.000Z',phase:'verified',engine:{pglite:'0.5.8',postgresMajor:17},files:[],directories:[],bytes:0}
 await writeFile(join(backup,'xuanxiang-app-backup.json'),JSON.stringify({...backupBody,checksum:digest(canonical(backupBody))}))
 const selection={backup:{directory:await directoryIdentity(backup),backupId},parent:await directoryIdentity(parent)}
 const module=join(process.cwd(),'desktop/main/application-restore-request.ts'),ownership=join(process.cwd(),'desktop/core/root-ownership.ts')
 const script=`import {ApplicationRestoreRequests} from ${JSON.stringify(module)};import {directoryIdentity} from ${JSON.stringify(ownership)};import {once} from 'node:events';const owner=${JSON.stringify(owner)},manager=new ApplicationRestoreRequests(await directoryIdentity(${JSON.stringify(boot)}),{assertStableLock(){},assertOwner(n){if(n!==owner)throw Error('expired')},assertQuiesced(){},assertOldProcessExited(){},assertCold(){},assertExecutionSettled(){},inspectPendingEvidence(){return{operationIds:[],unknown:false}}});const request=await manager.prepare(owner,${JSON.stringify(selection)});await manager.arm(owner,request.operationId);process.stdout.write(request.operationId+'\\n');process.stdin.resume();await once(process.stdin,'data');process.stdin.pause();`
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']}),exited=once(child,'exit');let output='',errors=''
 child.stderr.on('data',data=>{errors+=data})
 const operationId=await new Promise<string>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('handoff child timeout '+errors)),8000);child.stdout.on('data',data=>{output+=data;if(output.includes('\n')){clearTimeout(timeout);resolve(output.split('\n')[0])}});child.once('error',cause=>{clearTimeout(timeout);reject(cause)});child.once('exit',()=>{clearTimeout(timeout);if(!output.includes('\n'))reject(Error('handoff child exited '+errors))})})
 child.stdin.end('exit');assert.equal((await exited)[0],0,errors)
 let live=true
 const options:ApplicationRestoreRequestOptions={assertStableLock(){},assertOwner(value){if(value!==owner||!live)throw Error('owner expired')},assertQuiesced(){},assertOldProcessExited(){},assertCold(){},assertExecutionSettled(){},inspectPendingEvidence(){return{operationIds:[],unknown:false}},withWrite:run=>gate.write(run),writeHooks:requestHooks}
 const requests=new ApplicationRestoreRequests(bootstrap,options),execution=await requests.beginExecution(owner,operationId)
 const candidateId=randomUUID(),path=join(parent,candidateId);await mkdir(path);await writeFile(join(path,'xuanxiang-app.json'),JSON.stringify(marker))
 const old=new DraftJournal(path);const oldRelease=old.activate('backup')
 await old.persist('backup',{version:1,revision:1,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft:'backup unsent text',pendingRequest:{approved:true,prompt:'never submit'}}},issues:[]});oldRelease()
 const target=await directoryIdentity(path),beforePointerFile=observeRootAuthority(bootstrap,'data-root.json',16384)!.proof
 const retained=await installInertApplicationDraftJournal(await persistApplicationDraftRetention(await prepareApplicationDraftRetention({appId,operationId,candidateId,current:pointer.root,backup:target},()=>{}),{appId,operationId,candidateId,backup:target}))
 const after={...pointer,revision:2,root:target},temp='.test-fixture-pointer';await writeFile(join(boot,temp),JSON.stringify(after)+'\n')
 const {ctimeNs:_ctime,...pointerFile}=observeRootAuthority(bootstrap,temp,16384)!.proof
 const record={schemaVersion:1,type:'application',receiptId:operationId,createdAt:new Date().toISOString(),bootstrap,before:pointer,beforePointerFile,after,pointerFile,candidate:{id:candidateId,backupId,backupChecksum:digest(canonical(backupBody)),initialChecksum:'1'.repeat(64),finalChecksum:'2'.repeat(64),retentionChecksum:retained.retention.checksum,barrierToken:retained.retention.barrier.token},currentRootAvailable:true,beforeSnapshot:{id:randomUUID(),checksum:'3'.repeat(64),directory:selection.backup.directory,data:selection.backup.directory},marker:observeRootAuthority(target,'xuanxiang-app.json',16384)!.proof,controls:{journal:null,request:null},history:[]}
 await writeFile(join(boot,`application-restore-${operationId}.json`),JSON.stringify({record,sha256:digest(canonical(record))})+'\n');await rename(join(boot,temp),join(boot,'data-root.json'))
 await requests.activated(execution)
 const journal=new DraftJournal(path,{withWrite:run=>gate.write(run),...hooks}),journalOwner='window',releaseJournal=journal.activate(journalOwner),items=applicationDraftRecoveryItems(retained.retention)
 const snapshot=(revision:number)=>({version:1 as const,revision,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{recovery:{version:1,items:structuredClone(items)}},issues:[]})
 const assertOwner=()=>{if(!live)throw Error('owner expired')}
 return{base,boot,source,path,owner,operationId,retained,items,requests,journal,journalOwner,gate,snapshot,options,assertOwner,revoke(){live=false;releaseJournal()},async close(){releaseJournal();await requests.flush();gate.revoke();await rm(base,{recursive:true,force:true})},retentionBytes:()=>readFile(join(path,'application-restore-drafts.json'))}
}
