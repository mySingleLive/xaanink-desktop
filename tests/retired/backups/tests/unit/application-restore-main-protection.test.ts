import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {z} from 'zod'
import {checkpointFixture} from '../fixtures/application-restore-checkpoint'
import {ApplicationRestoreCheckpointSession} from '../../desktop/main/application-restore-checkpoint-session'
import {BusinessGate} from '../../desktop/main/business-gate'
import {rootRelocationPreflight} from '../../desktop/main/root-relocation-preflight'

const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
const find=(predicate:(n:ts.Node)=>boolean)=>{const rows:ts.Node[]=[];const visit=(n:ts.Node)=>{if(predicate(n))rows.push(n);ts.forEachChild(n,visit)};visit(source);assert.equal(rows.length,1);return rows[0]}
const evaluate=(code:string,deps:Record<string,unknown>)=>new Function(...Object.keys(deps),transformSync(`return (${code})`,{loader:'ts'}).code)(...Object.values(deps))
const callback=(name:string)=>{const call=find(n=>ts.isCallExpression(n)&&['businessHandle','ipcMain.handle'].includes(n.expression.getText(source))&&n.arguments[0]?.getText(source)===JSON.stringify(name)) as ts.CallExpression;return call.arguments[1].getText(source)}

test('actual protected bootstrap exposes only recovery context, without reading settings/model catalog or ordinary work restore state',{timeout:20000},async()=>{
 const f=await checkpointFixture()
 try{
  let businessReads=0
  const window={webContents:{id:37},isDestroyed:()=>false},draftSession={owner:37,id:randomUUID(),ready:false,applicationNonce:f.owner,release(){}}
  const handler=evaluate(callback('desktop:bootstrap'),{trusted(){},window,draftSession,repository:{async read(){businessReads++;return{revision:1,settings:{secret:'must not publish'},models:[{id:'must not publish'}]}}},restoreDraftBarrier:{async inspect(){businessReads++;return null}},applicationBlocked:()=>true,applicationProtectedOperationId:f.operationId,applicationRequests:f.requests,ApplicationRestoreCheckpointSession,draftJournal:f.journal,applicationMetadata:f.gate,process:{platform:'darwin'},app:{getVersion:()=> '0.1.0'},dataRoot:f.path,nativeTheme:{shouldUseDarkColors:false}})
  const bootstrap=await handler({sender:{id:37}})
  assert.equal(bootstrap.kind,'application-protected');assert.equal(businessReads,0)
  assert.equal('settings' in bootstrap,false);assert.equal('models' in bootstrap,false);assert.equal(bootstrap.applicationRestore.token,f.retained.retention.barrier.token)
 }finally{await f.close()}
})

test('actual business IPC gate rejects all ordinary operations while allowing the protected bootstrap read',async()=>{
 const captured=new Map<string,Function>(),gate=new BusinessGate()
 const node=find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='businessHandle') as ts.FunctionDeclaration
 const register=evaluate(node.getText(source),{ipcMain:{handle(channel:string,handler:Function){captured.set(channel,handler)}},businessGate:gate,applicationBlocked:()=>true})
 let executed=0
 register('desktop:model-test',async()=>{executed++});register('desktop:request',async()=>{executed++});register('desktop:bootstrap',async()=> 'protected read')
 await assert.rejects(captured.get('desktop:model-test')!({}));await assert.rejects(captured.get('desktop:request')!({}));assert.equal(executed,0)
 assert.equal(await captured.get('desktop:bootstrap')!({}),'protected read')
})

test('a new actual window can publish business after the previous owner completed durable consumption but lost its final renderer reply',{timeout:20000},async()=>{
 const f=await checkpointFixture()
 try{
  const checkpoint=new ApplicationRestoreCheckpointSession({root:f.path,journal:f.journal,journalOwner:f.journalOwner,requests:f.requests,operationId:f.operationId,ownerNonce:f.owner,assertOwner:f.assertOwner,withWrite:run=>f.gate.writeFlight(run)})
  await checkpoint.persist(f.snapshot(1));await checkpoint.persist(f.snapshot(2));assert.equal(f.requests.startup().mode,'normal')
  let initialized=0
  const window={webContents:{id:38},isDestroyed:()=>false},draftSession={owner:38,id:randomUUID(),ready:false,applicationNonce:f.owner,release(){}}
  const handler=evaluate(callback('desktop:bootstrap'),{trusted(){},window,draftSession,repository:{async initialize(){initialized++},async read(){return{revision:1,settings:{user:{}},models:[]}}},restoreDraftBarrier:{async inspect(){return null}},applicationBlocked:()=>true,applicationProtectedOperationId:f.operationId,applicationRequests:f.requests,ApplicationRestoreCheckpointSession,draftJournal:f.journal,applicationMetadata:f.gate,process:{platform:'darwin'},app:{getVersion:()=> '0.1.0'},dataRoot:f.path,bootstrapPath:f.boot,rootRelocationPreflight,nativeTheme:{shouldUseDarkColors:false},resumeWorkBackups:async()=>{},initializeBusinessAfterApplicationProtection:async()=>{initialized++}})
  const bootstrap=await handler({sender:{id:38}})
  assert.equal('kind' in bootstrap,false);assert.equal(initialized,1);assert.ok(bootstrap.settings)
 }finally{await f.close()}
})
