import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {checkpointFixture} from '../fixtures/application-restore-checkpoint'
import {ApplicationRestoreCheckpointSession} from '../../desktop/main/application-restore-checkpoint-session'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {readRootAuthority,assertRootAuthorityDirectory} from '../../desktop/core/root-authority'
import {ApplicationRestoreProtectedService} from '../../desktop/main/application-restore-protected-service'

const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
const declaration=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='initializeBusinessAfterApplicationProtection')
assert.ok(declaration)

// Exact main activation function, with actual consumed request/two journal
// checkpoints/authority. Electron window/worker/repository initialization are
// explicit host doubles; the late read failure is real isolated ENOENT IO.
test('AR107-B01 a late settings IO failure during ordinary business initialization cannot clear the application protection admission flag',{timeout:20000},async()=>{
 const f=await checkpointFixture()
 try{
  const checkpoint=new ApplicationRestoreCheckpointSession({root:f.path,journal:f.journal,journalOwner:f.journalOwner,requests:f.requests,operationId:f.operationId,ownerNonce:f.owner,assertOwner:f.assertOwner,withWrite:run=>f.gate.writeFlight(run)})
  await checkpoint.persist(f.snapshot(1));await checkpoint.persist(f.snapshot(2));assert.equal(f.requests.startup().mode,'normal')
  let menus=0,backups=0,initializations=0,terminations=0
  const deps={applicationRequests:f.requests,window:{isDestroyed:()=>false},draftSession:{id:'original-native-session'},app:{hasSingleInstanceLock:()=>true},bootstrapPath:f.boot,dataRoot:f.path,directoryIdentity,readRootAuthority,assertRootAuthorityDirectory,ApplicationRestoreProtectedService,repository:{async initialize(){initializations++},async read(){return readFile(join(f.path,'missing-settings-delivery.json'))}},refreshMenus(){menus++},async resumeWorkBackups(){backups++},worker:{async terminate(){terminations++}}}
  const body=`let closingFlow=null,quitting=false,service,applicationProtectedOperationId=${JSON.stringify(f.operationId)},applicationBusinessFlight=null,applicationBusinessFailed=false,serviceProtected=false,ordinaryWorkerExited=false;${declaration.getText(source)};return{run:initializeBusinessAfterApplicationProtection,protected:()=>applicationProtectedOperationId,failed:()=>applicationBusinessFailed}`
  const harness=new Function(...Object.keys(deps),transformSync(body,{loader:'ts'}).code)(...Object.values(deps)) as {run():Promise<void>;protected():string|null;failed():boolean}
  await assert.rejects(harness.run(),{code:'ENOENT'});assert.equal(initializations,1);assert.equal(menus,0);assert.equal(backups,0);assert.equal(terminations,1);assert.equal(harness.failed(),true)
  assert.equal(harness.protected(),f.operationId,'failed ordinary initialization must keep business IPC/assets/menus blocked until explicit safe restart')
  await assert.rejects(harness.run(),/APPLICATION_RESTORE_RESTART_REQUIRED/)
 }finally{await f.close()}
})

test('AR107-B02 native owner replacement during settings delivery cannot publish old menus or remove recovery admission for the new lifetime',{timeout:20000},async()=>{
 const f=await checkpointFixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>()
 try{
  const checkpoint=new ApplicationRestoreCheckpointSession({root:f.path,journal:f.journal,journalOwner:f.journalOwner,requests:f.requests,operationId:f.operationId,ownerNonce:f.owner,assertOwner:f.assertOwner,withWrite:run=>f.gate.writeFlight(run)})
  await checkpoint.persist(f.snapshot(1));await checkpoint.persist(f.snapshot(2));assert.equal(f.requests.startup().mode,'normal')
  const settings=join(f.base,'isolated-menu-settings.json');await writeFile(settings,JSON.stringify({revision:1,settings:{appearance:{theme:'paper'}},models:[]}));let menus=0,backups=0,terminations=0
  const deps={applicationRequests:f.requests,originalWindow:{isDestroyed:()=>false},originalSession:{id:'original-native-session'},app:{hasSingleInstanceLock:()=>true},bootstrapPath:f.boot,dataRoot:f.path,directoryIdentity,readRootAuthority,assertRootAuthorityDirectory,ApplicationRestoreProtectedService,repository:{async initialize(){},async read(){const state=JSON.parse(await readFile(settings,'utf8'));entered.resolve();await release.promise;return state}},refreshMenus(){menus++},async resumeWorkBackups(){backups++},worker:{async terminate(){terminations++}}}
  const body=`let closingFlow=null,quitting=false,service,window=originalWindow,draftSession=originalSession,applicationProtectedOperationId=${JSON.stringify(f.operationId)},applicationBusinessFlight=null,applicationBusinessFailed=false,serviceProtected=false,ordinaryWorkerExited=false;${declaration!.getText(source)};return{run:initializeBusinessAfterApplicationProtection,protected:()=>applicationProtectedOperationId,replace(){window={isDestroyed:()=>false};draftSession={id:'new-native-session'}}}`
  const harness=new Function(...Object.keys(deps),transformSync(body,{loader:'ts'}).code)(...Object.values(deps)) as {run():Promise<void>;protected():string|null;replace():void}
  const run=harness.run(),rejected=assert.rejects(run,/OWNER_EXPIRED/);await entered.promise;harness.replace();release.resolve();await rejected
  assert.equal(menus,0,'original owner must be revalidated before publishing its settings into process-global menus');assert.equal(backups,0);assert.equal(terminations,1);assert.equal(harness.protected(),f.operationId)
 }finally{release.resolve();await f.close()}
})
