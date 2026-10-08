import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {WorkBackupControl} from '../../desktop/service/work-backup-control'
const a=randomUUID(),b=randomUUID(),backup=randomUUID()
test('backup control validates all caller actions before touching storage and exposes metadata only',async()=>{
 const calls:string[]=[],control=new WorkBackupControl({list:async()=>[{id:a,title:'第一部'}],backups:async id=>{calls.push(id);return[{id:backup,workId:a,title:'第一部',createdAt:'2026-10-08T00:00:00.000Z',bytes:12,assetCount:0,sha256:'a'.repeat(64)}]},backup:async()=>{throw Error('not called')},prepareRestore:async()=>{throw Error('not called')},cancelRestore:async()=>{},activateRestore:async()=>{throw Error('not called')}})
 await assert.rejects(control.handle({type:'list',workId:'../../database'}));await assert.rejects(control.handle({type:'now',retention:0}));await assert.rejects(control.handle({type:'list',workId:a,path:'/foreign'}));assert.equal(calls.length,0)
 assert.deepEqual(await control.handle({type:'works'}),{type:'works',works:[{id:a,title:'第一部'}]})
 const result=await control.handle({type:'list',workId:a});assert.equal(result.type,'list');assert.deepEqual(calls,[a]);assert.ok(!JSON.stringify(result).includes('database'))
})
test('scheduled/explicit backup continues past one unavailable work, records partial failure honestly and shares actual per-work retention',async()=>{
 const calls:Array<[string,number]>=[],control=new WorkBackupControl({list:async()=>[{id:a,title:'第一部'},{id:b,title:'第二部'}],backups:async()=>[],backup:async(id,retention)=>{calls.push([id,retention]);if(id===a)throw Error('路径不可用');return{id:backup,workId:b,title:'第二部',createdAt:'2026-10-08T00:00:00.000Z',bytes:12,assetCount:0,sha256:'a'.repeat(64)}},prepareRestore:async()=>{throw Error('not called')},cancelRestore:async()=>{},activateRestore:async()=>{throw Error('not called')}})
 const result=await control.handle({type:'now',retention:2});assert.equal(result.type,'now');if(result.type!=='now')throw Error('type');assert.equal(result.saved.length,1);assert.deepEqual(result.failed,[{workId:a,title:'第一部',message:'路径不可用'}]);assert.deepEqual(calls,[[a,2],[b,2]])
})
test('restore staging and activation forward semantic identity and CAS only; no path/binary API',async()=>{
 const candidate=randomUUID(),calls:unknown[]=[],control=new WorkBackupControl({list:async()=>[],backups:async()=>[],backup:async()=>{throw Error('not called')},prepareRestore:async(...args)=>{calls.push(args);return{id:candidate,revision:3,backupId:backup,createdAt:'2026-10-08T00:00:00.000Z'}},cancelRestore:async(...args)=>{calls.push(args)},activateRestore:async(...args)=>{calls.push(args);return{revision:4}}})
 assert.deepEqual(await control.handle({type:'prepare',workId:a,backupId:backup}),{type:'prepare',candidate:{id:candidate,revision:3,backupId:backup,createdAt:'2026-10-08T00:00:00.000Z'}})
 await control.handle({type:'activate',workId:a,candidateId:candidate,revision:3});await control.handle({type:'cancel',workId:a,candidateId:candidate});assert.deepEqual(calls,[[a,backup],[a,candidate,3],[a,candidate]])
})
