import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {mkdtemp,realpath,rm,mkdir,lstat,readFile,writeFile,readdir,unlink,rmdir} from 'node:fs/promises'
import {tmpdir,hostname} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {z} from 'zod'
import {VersionedStore} from '../../desktop/core/versioned-store'
import {directoryIdentity,assertDirectory,readMetadata} from '../../desktop/core/root-ownership'
import {APPLICATION_BACKUP_LIMITS} from '../../desktop/shared/application-backup'
import {runInDatabaseContext,getDatabaseContext} from '../../desktop/service/context'
import {catalogSchema} from '../../desktop/service/workspaces'

// Execute the complete installed Workspaces class body. Only the Session loader
// and engine/DB are controlled; actual AsyncLocalStorage, root identity and
// serialize/run/close methods remain original. No PGlite or build is started.
const ast=ts.createSourceFile('workspaces.ts',readFileSync('desktop/service/workspaces.ts','utf8'),ts.ScriptTarget.Latest,true)
const body=ast.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='Workspaces')!.getText(ast).replace(/^export /,'')
interface ControlledEngine{closed:boolean;close():Promise<void>}
interface ControlledConnection{engine:ControlledEngine;db:{$disconnect():Promise<void>};assertLease():Promise<void>;unlock():Promise<void>;assets:object;storagePath:string}
interface SessionOptions{source:Awaited<ReturnType<typeof directoryIdentity>>;engine:ControlledEngine;assertLive():Promise<void>}
async function workspaceFixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'xx-independent95-'))),events:string[]=[],receipt={id:randomUUID(),appId:randomUUID(),createdAt:new Date().toISOString(),bytes:1,phase:'verified'}
 const engine:ControlledEngine={closed:false,close:async()=>{events.push('engine-close');engine.closed=true}},db={$disconnect:async()=>{events.push('disconnect')}}
 let leaseGate:Promise<void>|undefined,loaderGate:Promise<void>|undefined,live=true
 const connection:ControlledConnection={engine,db,assertLease:async()=>{events.push('lease');await leaseGate;if(!live)throw Error('REAL_LEASE_REVOKED')},unlock:async()=>{events.push('unlock')},assets:{},storagePath:join(root,'inbox')}
 let operation:(options:SessionOptions)=>Promise<unknown>=async options=>{await options.assertLive();return{receipt,retained:[],cleanupPending:[]}}
 const loaded=Promise.withResolvers<void>(),created=Promise.withResolvers<SessionOptions>()
 class Session{constructor(private options:SessionOptions){created.resolve(options)}create(){events.push('create');return operation(this.options)}async list(){events.push('list');await this.options.assertLive();return[receipt]}}
 const deps={VersionedStore,catalogSchema,APPLICATION_BACKUP_LIMITS,z,join,directoryIdentity,runInDatabaseContext,getDatabaseContext,loadApplicationBackupSession:async()=>{loaded.resolve();await loaderGate;return{ApplicationBackupSession:Session}}}
 const Constructor=new Function(...Object.keys(deps),transformSync(body+';return Workspaces',{loader:'ts'}).code)(...Object.values(deps))
 const works=new Constructor(root,'/unused-migrations'),slot={connection:Promise.resolve(connection),active:0,lastUsed:0};works.slots.set('inbox',slot)
 return{root,events,receipt,works,slot,engine,connection,created:created.promise,loaded:loaded.promise,operation:(fn:typeof operation)=>{operation=fn},leaseGate:(value:Promise<void>|undefined)=>{leaseGate=value},loaderGate:(value:Promise<void>|undefined)=>{loaderGate=value},revoke:()=>{live=false},cleanup:()=>rm(root,{recursive:true,force:true})}
}

test('AB95-01 captured engine identity is rechecked after the physical source lease await',async()=>{const r=await workspaceFixture();try{
 const gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();r.operation(async options=>{assert.equal(options.engine,r.engine);r.leaseGate(gate.promise);entered.resolve();await options.assertLive();return{receipt:r.receipt,retained:[],cleanupPending:[]}})
 const backup=r.works.applicationBackups(1);await Promise.race([entered.promise,backup]);r.connection.engine={closed:false,close:async()=>{}};gate.resolve()
 await assert.rejects(backup,/APPLICATION_BACKUP_INBOX_CHANGED/);assert.equal(r.slot.active,0)
}finally{await r.cleanup()}})

test('AB95-02 replacing the same slot connection promise cannot authorize the old Session lease',async()=>{const r=await workspaceFixture();try{
 const gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();r.operation(async options=>{entered.resolve();await gate.promise;await options.assertLive();return{receipt:r.receipt,retained:[],cleanupPending:[]}})
 const backup=r.works.applicationBackups(1);await Promise.race([entered.promise,backup]);r.slot.connection=Promise.resolve({...r.connection,engine:{closed:false,close:async()=>{}}});gate.resolve()
 await assert.rejects(backup,/APPLICATION_BACKUP_INBOX_CHANGED/);assert.equal(r.slot.active,0)
}finally{await r.cleanup()}})

test('AB95-03 lazy Session loading and late cleanup remain inside the original close queue', {timeout:5000},async()=>{const r=await workspaceFixture(),loader=Promise.withResolvers<void>(),cleanup=Promise.withResolvers<void>();try{
 r.loaderGate(loader.promise);r.operation(async options=>{await cleanup.promise;await options.assertLive();return{receipt:r.receipt,retained:[],cleanupPending:[]}})
 const backup=r.works.applicationBackups(1);await Promise.race([r.loaded,backup]);let closed=false;const close=r.works.close().then(()=>{closed=true});await new Promise(setImmediate)
 assert.equal(closed,false);assert.equal(r.slot.active,1);assert.equal(r.events.includes('create'),false);await assert.rejects(r.works.applicationBackups(),/关闭/)
 loader.resolve();await r.created;await new Promise(setImmediate);assert.equal(closed,false);assert.equal(r.engine.closed,false)
 cleanup.resolve();await backup;await close;assert.equal(closed,true);assert.equal(r.slot.active,0);assert.deepEqual(r.events.slice(-3),['disconnect','engine-close','unlock'])
}finally{loader.resolve();cleanup.resolve();await r.cleanup()}})

test('AB95-04 queued requests do not reopen an inbox after close begins and physical unlock is awaited',{timeout:5000},async()=>{const r=await workspaceFixture(),cleanup=Promise.withResolvers<void>(),unlock=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>(),unlockEntered=Promise.withResolvers<void>();try{
 r.operation(async()=>{entered.resolve();await cleanup.promise;return{receipt:r.receipt,retained:[],cleanupPending:[]}});r.connection.unlock=async()=>{unlockEntered.resolve();await unlock.promise;r.events.push('unlock')}
 const active=r.works.applicationBackups(1);await Promise.race([entered.promise,active]);const queued=r.works.applicationBackups();const rejected=assert.rejects(queued,/关闭/);let closed=false;const close=r.works.close().then(()=>{closed=true})
 cleanup.resolve();await active;await rejected;await unlockEntered.promise;assert.equal(closed,false);assert.equal(r.engine.closed,true);assert.equal(r.events.includes('list'),false);await assert.rejects(r.works.applicationBackups(1),/关闭/)
 unlock.resolve();await close;assert.equal(closed,true)
}finally{cleanup.resolve();unlock.resolve();await r.cleanup()}})

test('AB95-05 database context identity is not borrowed from a modified Connection after awaiting its lease',async()=>{const r=await workspaceFixture(),gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();try{
 r.operation(async options=>{r.leaseGate(gate.promise);entered.resolve();await options.assertLive();return{receipt:r.receipt,retained:[],cleanupPending:[]}});const backup=r.works.applicationBackups(1);await Promise.race([entered.promise,backup]);r.connection.db={$disconnect:async()=>{}};gate.resolve();await assert.rejects(backup,/APPLICATION_BACKUP_INBOX_CHANGED/)
 assert.equal(r.slot.active,0)
}finally{gate.resolve();await r.cleanup()}})

test('AB95-06 Session steps observe the actual original writer lease owner file and do not publish after it changes',async()=>{const r=await workspaceFixture();try{
 const node=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='lockDirectory');assert.ok(node)
 const deps={join,randomUUID,mkdir,lstat,readFile,writeFile,readdir,unlink,rmdir,hostname,directoryIdentity,assertDirectory,readMetadata,realpath}
 const lock=new Function(...Object.keys(deps),transformSync(node.getText(ast)+';return lockDirectory',{loader:'ts'}).code)(...Object.values(deps)) as(path:string)=>Promise<(()=>Promise<void>)&{assertHeld():Promise<void>}>
 const lease=await lock(r.root);r.connection.assertLease=lease.assertHeld
 r.operation(async options=>{await options.assertLive();const ownerPath=join(r.root,'.xuanxiang-lock/owner.json'),owner=JSON.parse(await readFile(ownerPath,'utf8'));await writeFile(ownerPath,JSON.stringify({...owner,token:randomUUID()}));await options.assertLive();return{receipt:r.receipt,retained:[],cleanupPending:[]}})
 await assert.rejects(r.works.applicationBackups(1),/锁归属发生变化/);assert.equal(r.slot.active,0);assert.equal(r.engine.closed,false)
}finally{await r.cleanup()}})
