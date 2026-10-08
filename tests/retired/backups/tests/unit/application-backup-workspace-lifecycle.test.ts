import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {APPLICATION_BACKUP_LIMITS} from '../../desktop/shared/application-backup'
import ts from 'typescript'
import {transformSync} from 'esbuild'
const source=ts.createSourceFile('workspaces.ts',readFileSync('desktop/service/workspaces.ts','utf8'),ts.ScriptTarget.Latest,true)
const declaration=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='Workspaces')!.getText(source).replace(/^export /,'')
function fixture(){
 const events:string[]=[],created=Promise.withResolvers<any>(),receipt={id:randomUUID(),appId:randomUUID(),createdAt:new Date().toISOString(),bytes:1,phase:'verified'}
 const engine={closed:false,close:async()=>{events.push('engine-close');engine.closed=true}},db={$disconnect:async()=>events.push('disconnect')}
 let lease=true,wait:Promise<void>|undefined,operation:(options:any)=>Promise<any>=async options=>{await options.assertLive();return{receipt,retained:[],cleanupPending:[]}}
 const connection={engine,db,assets:{},storagePath:'/fixture/app/inbox',assertLease:async()=>{events.push('lease');await wait;if(!lease)throw Error('LEASE_REVOKED')},unlock:async()=>events.push('unlock')}
 let works:any
 class Session{constructor(public options:any){created.resolve(options)}async create(retention:number){events.push('create:'+retention);return operation(this.options)}async list(){events.push('list');await this.options.assertLive();return[receipt]}}
 const dependencies={loadApplicationBackupSession:async()=>({ApplicationBackupSession:Session}),VersionedStore:class{},APPLICATION_BACKUP_LIMITS,z,join,directoryIdentity:async(path:string)=>({path,device:'1',inode:'2'}),getDatabaseContext:()=>({database:db}),runInDatabaseContext:async(context:any,fn:any)=>{assert.equal(context.workspaceId,'inbox');return fn()}}
 const Class=new Function(...Object.keys(dependencies),transformSync(declaration+';return Workspaces',{loader:'ts'}).code)(...Object.values(dependencies))
 works=new Class('/fixture/app','/fixture/migrations');const slot={connection:Promise.resolve(connection),active:0,lastUsed:0};works.slots.set('inbox',slot)
 return{works,slot,connection,engine,events,created,receipt,operation:(fn:typeof operation)=>operation=fn,lease:(value:boolean)=>lease=value,wait:(value:Promise<void>|undefined)=>wait=value}
}
test('AW27-01 exact inbox connection stays live through isolated validation and cleanup; close waits physical completion',async()=>{
 const r=fixture(),validation=Promise.withResolvers<void>(),cleanup=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>()
 r.operation(async options=>{assert.equal(options.engine,r.engine);assert.deepEqual(options.source,{path:'/fixture/app',device:'1',inode:'2'});await options.assertLive();entered.resolve();await validation.promise;await options.assertLive();r.events.push('cleanup-enter');await cleanup.promise;await options.assertLive();return{receipt:r.receipt,retained:[],cleanupPending:[]}})
 const backup=r.works.applicationBackups(2);await Promise.race([entered.promise,backup]);assert.equal(r.slot.active,1)
 let closed=false;const closing=r.works.close().then(()=>{closed=true});await new Promise(setImmediate);assert.equal(closed,false);assert.equal(r.engine.closed,false)
 await assert.rejects(r.works.applicationBackups(),/关闭/);validation.resolve();await new Promise(setImmediate);assert.ok(r.events.includes('cleanup-enter'));assert.equal(closed,false);assert.equal(r.slot.active,1)
 cleanup.resolve();await backup;await closing;assert.equal(closed,true);assert.equal(r.slot.active,0);assert.deepEqual(r.events.slice(-3),['disconnect','engine-close','unlock'])
})
test('AW27-02 a retired/replaced/closed/unretained inbox or revoked real lease cannot authorize another session step',async()=>{
 for(const variant of ['replaced','closed','inactive','lease'] as const){const r=fixture();r.operation(async options=>{if(variant==='replaced')r.works.slots.set('inbox',{...r.slot});if(variant==='closed')r.engine.closed=true;if(variant==='inactive')r.slot.active=0;if(variant==='lease')r.lease(false);await options.assertLive();throw Error('must not reach')});await assert.rejects(r.works.applicationBackups(1),/APPLICATION_BACKUP_INBOX_CHANGED|LEASE_REVOKED/);assert.ok(!r.events.includes('engine-close'))}
})
test('AW27-03 retention validation touches no session/engine and the existing serialization orders list and now',async()=>{
 const r=fixture();for(const retention of [0,1001,NaN,1.5])await assert.rejects(r.works.applicationBackups(retention));assert.deepEqual([...r.events],[])
 const gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();r.operation(async options=>{await options.assertLive();entered.resolve();await gate.promise;return{receipt:r.receipt,retained:[],cleanupPending:[]}})
 const first=r.works.applicationBackups(1);await Promise.race([entered.promise,first]);const second=r.works.applicationBackups();await new Promise(setImmediate);assert.ok(!r.events.includes('list'));gate.resolve();await first;assert.deepEqual(await second,[r.receipt]);assert.equal(r.slot.active,0);await r.works.close()
})
test('AW27-04 lease verification is an awaited physical boundary and connection identity is rechecked after it',async()=>{
 const r=fixture(),gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();r.operation(async options=>{r.wait(gate.promise);entered.resolve();await options.assertLive();throw Error('must not reach')})
 const pending=r.works.applicationBackups(1);await Promise.race([entered.promise,pending]);await new Promise(setImmediate);r.engine.closed=true;let settled=false;void pending.catch(()=>{settled=true});await new Promise(setImmediate);assert.equal(settled,false);assert.equal(r.slot.active,1)
 gate.resolve();await assert.rejects(pending,/APPLICATION_BACKUP_INBOX_CHANGED/);assert.equal(r.slot.active,0)
})
