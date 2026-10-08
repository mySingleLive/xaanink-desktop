import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {ApplicationBackupControl} from '../../desktop/service/application-backup-control'
import type {ApplicationBackup} from '../../desktop/shared/application-backup'
const id=randomUUID(),appId=randomUUID(),retained=randomUUID(),createdAt='2026-10-08T00:00:00.000Z'
function receipt(phase:'captured'|'verified'='verified'):ApplicationBackup{return{format:'xuanxiang-application-backup',schemaVersion:1,id,appId,createdAt,phase,engine:{pglite:'0.5.8',postgresMajor:18},files:[{path:'state.json',size:3,sha256:'a'.repeat(64)}],directories:['inbox'],bytes:3,checksum:'b'.repeat(64)}}
test('AC27-01 strict semantic actions reject unknown path/owner/binary/type and invalid retention before storage',async()=>{
 let calls=0;const control=new ApplicationBackupControl({applicationBackups:async()=>{calls++;return []}} as any)
 for(const input of [null,{type:'restore',path:'/outside'},{type:'list',path:'/outside'},{type:'now',retention:0},{type:'now',retention:1001},{type:'now',retention:1.5},{type:'now',retention:1,bytes:new Uint8Array([1])},{type:'now',retention:1,owner:'renderer'}])await assert.rejects(control.handle(input),/APPLICATION_BACKUP_ACTION_INVALID/)
 assert.equal(calls,0)
})
test('AC27-02 create exports an explicit bounded summary and cleanup count, never internal paths/manifest/ciphertext',async()=>{
 const calls:number[]=[],control=new ApplicationBackupControl({applicationBackups:async(value:number)=>{calls.push(value);return{receipt:{...receipt(),privateKey:'never-export'},retained:[retained],cleanupPending:['validation/'+randomUUID(),'staging/'+randomUUID()]}}} as any)
 const result=await control.handle({type:'now',retention:2})
 assert.deepEqual(result,{type:'now',backup:{id,appId,createdAt,bytes:3,retained:[retained],cleanupPending:2}});assert.deepEqual(calls,[2])
 assert.doesNotMatch(JSON.stringify(result),/privateKey|never-export|state\.json|validation|staging|checksum|engine/)
})
test('AC27-03 listing includes only verified summaries and refuses invalid outward metadata',async()=>{
 let rows:any[]=[receipt('captured'),receipt()],args:unknown[]=[];const control=new ApplicationBackupControl({applicationBackups:async(...input:unknown[])=>{args.push(input);return rows}} as any)
 assert.deepEqual(await control.handle({type:'list'}),{type:'list',backups:[{id,appId,createdAt,bytes:3}]});assert.deepEqual(args,[[]])
 rows=[{...receipt(),id:'/secret/current-root'}];await assert.rejects(control.handle({type:'list'}),/APPLICATION_BACKUP_FAILED/)
})
test('AC27-04 storage and lease failures cross RPC as a fixed safe error without message/cause',async()=>{
 const control=new ApplicationBackupControl({applicationBackups:async()=>{throw new Error('/private/app/state.json apiKey=secret',{cause:Error('encrypted-state')})}} as any)
 for(const input of [{type:'list'},{type:'now',retention:1}])await assert.rejects(control.handle(input),(error:unknown)=>{assert.ok(error instanceof Error);assert.equal(error.message,'APPLICATION_BACKUP_FAILED');assert.equal(error.cause,undefined);assert.doesNotMatch(JSON.stringify(error),/secret|private|state/);return true})
})
