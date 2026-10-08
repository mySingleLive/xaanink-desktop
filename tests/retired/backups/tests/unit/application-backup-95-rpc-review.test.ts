import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {ApplicationBackupControl} from '../../desktop/service/application-backup-control'

const ast=ts.createSourceFile('worker.ts',readFileSync('desktop/service/index.ts','utf8'),ts.ScriptTarget.Latest,true)
let callback='';function find(node:ts.Node){if(ts.isNewExpression(node)&&node.expression.getText(ast)==='RpcPeer')callback=node.arguments![1].getText(ast);ts.forEachChild(node,find)}find(ast);assert.ok(callback)
function fixture(){
 const events:string[]=[],receipt={id:randomUUID(),appId:randomUUID(),createdAt:new Date().toISOString(),bytes:3,phase:'verified',privatePath:'/private/user/state.json',privateKey:'do-not-return',files:[{path:'secret.json'}]}
 let closeGate:Promise<void>|undefined,closeFails=false,storageFails=false,cleanupPending:unknown=[]
 const closeEntered=Promise.withResolvers<void>()
 const works={list:async()=>[],close:async()=>{events.push('close');closeEntered.resolve();await closeGate;if(closeFails)throw Error('actual-close-failed')},applicationBackups:async(retention?:number)=>{events.push('backup');if(storageFails)throw Error('apiKey=do-not-return /private/user/state.json');return retention===undefined?[receipt]:{receipt,retained:[],cleanupPending}}}
 const deps={ready:Promise.resolve(),works,ApplicationBackupControl,responses:new Map(),starting:new Map(),pendingStarts:new Set(),localAttemptCount:()=>0,cancel:async()=>{},closedWorkLeaseTarget:async(_works:unknown,input:unknown,guard:()=>void)=>{guard();return input}}
 const api=new Function(...Object.keys(deps),transformSync(`let closing=false,closedForMaintenance=false;return ${callback}`,{loader:'ts'}).code)(...Object.values(deps)) as(method:string,input?:unknown)=>Promise<unknown>
 return{api,events,receipt,closeEntered:closeEntered.promise,setCloseGate:(value:Promise<void>)=>{closeGate=value},failClose:()=>{closeFails=true},failStorage:()=>{storageFails=true},setCleanup:(value:unknown)=>{cleanupPending=value}}
}

test('AB95-R01 closed proof waits the complete physical close and any new engine-capable action revokes it before validation',{timeout:5000},async()=>{
 const r=fixture(),gate=Promise.withResolvers<void>();r.setCloseGate(gate.promise);const close=r.api('close');await r.closeEntered
 await assert.rejects(r.api('application-backup',{type:'now',retention:1}),/正在关闭/);await assert.rejects(r.api('closed-work-lease-target','closed-proof'),/尚未关闭/);assert.deepEqual(r.events,['close'])
 gate.resolve();await close;assert.equal(await r.api('closed-work-lease-target','closed-proof'),'closed-proof');await r.api('protected-directories');assert.equal(await r.api('closed-work-lease-target','closed-proof'),'closed-proof')
 await assert.rejects(r.api('application-backup',{type:'list',owner:'forbidden'}),/APPLICATION_BACKUP_ACTION_INVALID/);assert.deepEqual(r.events,['close']);await assert.rejects(r.api('closed-work-lease-target','closed-proof'),/尚未关闭/)
})

test('AB95-R02 failed close cannot publish authoritative closed-target evidence or block a later explicit safe operation',async()=>{
 const r=fixture();r.failClose();await assert.rejects(r.api('close'),/actual-close-failed/);await assert.rejects(r.api('closed-work-lease-target','proof'),/尚未关闭/)
 const result=await r.api('application-backup',{type:'list'});assert.deepEqual(result,{type:'list',backups:[{id:r.receipt.id,appId:r.receipt.appId,createdAt:r.receipt.createdAt,bytes:3}]});assert.deepEqual(r.events,['close','backup'])
})

test('AB95-R03 actual RPC result mapping emits only the public schema and masks internal failures and malformed internal cleanup',async()=>{
 const r=fixture(),result=await r.api('application-backup',{type:'now',retention:1});assert.deepEqual(result,{type:'now',backup:{id:r.receipt.id,appId:r.receipt.appId,createdAt:r.receipt.createdAt,bytes:3,retained:[],cleanupPending:0}});assert.doesNotMatch(JSON.stringify(result),/private|secret|do-not-return|files|key/i)
 r.setCleanup({privatePath:'/private/user'});await assert.rejects(r.api('application-backup',{type:'now',retention:1}),(error:unknown)=>{assert.ok(error instanceof Error);assert.equal(error.message,'APPLICATION_BACKUP_FAILED');assert.equal(error.cause,undefined);return true})
 r.failStorage();await assert.rejects(r.api('application-backup',{type:'list'}),(error:unknown)=>{assert.ok(error instanceof Error);assert.equal(error.message,'APPLICATION_BACKUP_FAILED');assert.equal(error.cause,undefined);return true})
})
