import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import fsPromises,{writeFile,rename,mkdir,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {checkpointFixture} from '../fixtures/application-restore-checkpoint'
import {ApplicationRestoreCheckpointSession} from '../../desktop/main/application-restore-checkpoint-session'
import {ApplicationRestoreProtectedService} from '../../desktop/main/application-restore-protected-service'
import {ModelRepository} from '../../desktop/main/model-repository'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {readRootAuthority,assertRootAuthorityDirectory} from '../../desktop/core/root-authority'
import {defaultState} from '../../desktop/core/settings'
import {randomUUID} from 'node:crypto'

const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true),declaration=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='initializeBusinessAfterApplicationProtection')
assert.ok(declaration)

// Actual main function + real ModelRepository and native root replacement.
// The ordinary worker/window are host doubles; there is no PG/native/model run.
test('AR107-B03 a consumed root physically replaced during business activation cannot be read as ordinary model/settings state',{timeout:20000},async t=>{
 const f=await checkpointFixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let run:Promise<void>|undefined
 try{
  const checkpoint=new ApplicationRestoreCheckpointSession({root:f.path,journal:f.journal,journalOwner:f.journalOwner,requests:f.requests,operationId:f.operationId,ownerNonce:f.owner,assertOwner:f.assertOwner,withWrite:run=>f.gate.writeFlight(run)})
  await checkpoint.persist(f.snapshot(1));await checkpoint.persist(f.snapshot(2));assert.equal(f.requests.startup().mode,'normal')
  const originalRetention=await f.retentionBytes(),foreign=structuredClone(defaultState);foreign.settings.user.penName='foreign-root-sentinel'
  let menus=0,foreignReads=0,terminations=0
  const repository=new ModelRepository(join(f.path,'state.json'),{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()},{replace(){},remove(){}},{withWrite:run=>f.gate.write(run)})
  let first=true
  const deps={applicationRequests:f.requests,window:{isDestroyed:()=>false},draftSession:{id:'original-native-session'},app:{hasSingleInstanceLock:()=>true},bootstrapPath:f.boot,dataRoot:f.path,async directoryIdentity(path:string){const identity=await directoryIdentity(path);if(first){first=false;entered.resolve();await release.promise}return identity},readRootAuthority,assertRootAuthorityDirectory,ApplicationRestoreProtectedService,repository,refreshMenus(){menus++},resumeWorkBackups:async()=>{},worker:{async terminate(){terminations++}}}
  const body=`let closingFlow=null,quitting=false,service,applicationProtectedOperationId=${JSON.stringify(f.operationId)},applicationBusinessFlight=null,applicationBusinessFailed=false,serviceProtected=false,ordinaryWorkerExited=false;${declaration.getText(source)};return{run:initializeBusinessAfterApplicationProtection,protected:()=>applicationProtectedOperationId}`
  const harness=new Function(...Object.keys(deps),transformSync(body,{loader:'ts'}).code)(...Object.values(deps)) as {run():Promise<void>;protected():string|null}
  run=harness.run();void run.catch(()=>{});await entered.promise
  await rename(f.path,f.path+'.original-root');await mkdir(f.path);const bytes=JSON.stringify({schemaVersion:1,revision:7,value:foreign});await writeFile(join(f.path,'state.json'),bytes)
  const originalRead=fsPromises.readFile
  t.mock.method(fsPromises,'readFile',(async(...args:Parameters<typeof fsPromises.readFile>)=>{if(String(args[0]).startsWith(f.path+'/'))foreignReads++;return originalRead(...args)}) as typeof fsPromises.readFile)
  release.resolve();await assert.rejects(run,'fresh control-file authority is insufficient when the actual root inode has changed')
  assert.equal(foreignReads,0,'no foreign state or marker may be read after physical root identity loss');assert.equal(menus,0);assert.equal(terminations,1);assert.equal(harness.protected(),f.operationId)
  assert.equal(await readFile(join(f.path,'state.json'),'utf8'),bytes);assert.deepEqual(await readFile(join(f.path+'.original-root','application-restore-drafts.json')),originalRetention)
 }finally{release.resolve();await run?.catch(()=>{});await f.close()}
})

test('AR107-B04 root replacement inside actual repository initialization cannot publish foreign model authorization before the outer main seal',{timeout:20000},async t=>{
 const f=await checkpointFixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let run:Promise<void>|undefined
 try{
  const checkpoint=new ApplicationRestoreCheckpointSession({root:f.path,journal:f.journal,journalOwner:f.journalOwner,requests:f.requests,operationId:f.operationId,ownerNonce:f.owner,assertOwner:f.assertOwner,withWrite:run=>f.gate.writeFlight(run)})
  await checkpoint.persist(f.snapshot(1));await checkpoint.persist(f.snapshot(2));assert.equal(f.requests.startup().mode,'normal')
  const originalRetention=await f.retentionBytes(),foreign=structuredClone(defaultState)
  foreign.models.push({id:randomUUID(),name:'foreign fixture model',provider:'custom',protocol:'openai',modelId:'foreign-fixture',endpoint:'https://fixture.invalid/v1',kind:'TEXT',contextWindow:128000,enabled:true,authRevision:1,encryptedKey:Buffer.from('public-fixture-only').toString('base64'),keyMask:'fixture',thinkingLevels:[],defaultThinking:'default'})
  let menus=0,authorizations=0,terminations=0,intercept=true
  const repository=new ModelRepository(join(f.path,'state.json'),{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()},{replace(){authorizations++},remove(){}},{withWrite:run=>f.gate.write(run)})
  const originalRead=fsPromises.readFile
  t.mock.method(fsPromises,'readFile',(async(...args:Parameters<typeof fsPromises.readFile>)=>{if(String(args[0])===join(f.path,'state.json')&&intercept){intercept=false;entered.resolve();await release.promise}return originalRead(...args)}) as typeof fsPromises.readFile)
  const deps={applicationRequests:f.requests,window:{isDestroyed:()=>false},draftSession:{id:'original-native-session'},app:{hasSingleInstanceLock:()=>true},bootstrapPath:f.boot,dataRoot:f.path,directoryIdentity,readRootAuthority,assertRootAuthorityDirectory,ApplicationRestoreProtectedService,repository,refreshMenus(){menus++},resumeWorkBackups:async()=>{},worker:{async terminate(){terminations++}}}
  const body=`let closingFlow=null,quitting=false,service,applicationProtectedOperationId=${JSON.stringify(f.operationId)},applicationBusinessFlight=null,applicationBusinessFailed=false,serviceProtected=false,ordinaryWorkerExited=false;${declaration!.getText(source)};return{run:initializeBusinessAfterApplicationProtection,protected:()=>applicationProtectedOperationId}`
  const harness=new Function(...Object.keys(deps),transformSync(body,{loader:'ts'}).code)(...Object.values(deps)) as {run():Promise<void>;protected():string|null}
  run=harness.run();void run.catch(()=>{});await entered.promise
  await rename(f.path,f.path+'.original-root');await mkdir(f.path);const bytes=JSON.stringify({schemaVersion:1,revision:7,value:foreign});await writeFile(join(f.path,'state.json'),bytes)
  release.resolve();await assert.rejects(run)
  assert.equal(authorizations,0,'an outer post-await seal must not permit ModelRepository.initialize to publish foreign gateway authorization first')
  assert.equal(menus,0);assert.equal(terminations,1);assert.equal(harness.protected(),f.operationId)
  assert.equal(await readFile(join(f.path,'state.json'),'utf8'),bytes);assert.deepEqual(await readFile(join(f.path+'.original-root','application-restore-drafts.json')),originalRetention)
 }finally{release.resolve();await run?.catch(()=>{});await f.close()}
})
