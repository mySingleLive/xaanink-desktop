import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {writeFile,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {checkpointFixture} from '../fixtures/application-restore-checkpoint'
import {startOwnedRoot} from '../../desktop/service/root-startup'
import {RootStartupError,ROOT_STARTUP_BYTES} from '../../desktop/shared/root-startup'
import {ApplicationRestoreProtectedService} from '../../desktop/main/application-restore-protected-service'
import {ApplicationRestoreRequests} from '../../desktop/main/application-restore-request'
import {applicationRestorePreflight,inspectApplicationRestoreProtection} from '../../desktop/main/application-restore-preflight'
import {inspectApplicationRestoreLayouts} from '../../desktop/main/application-restore-layout'

const source=ts.createSourceFile('service.ts',readFileSync('desktop/service/index.ts','utf8'),ts.ScriptTarget.Latest,true)
let ready='';const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='ready')ready=node.initializer!.getText(source);ts.forEachChild(node,visit)};visit(source);assert.ok(ready)
const main=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true)
const launch=main.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='launch') as ts.FunctionDeclaration
assert.ok(launch?.body)
const profile=launch.body.statements.findIndex(node=>ts.isExpressionStatement(node)&&ts.isCallExpression(node.expression)&&node.expression.expression.getText(main)==='app.setPath')
assert.ok(profile>0)
const admission=launch.body.statements.slice(0,profile).map(node=>node.getText(main)).join('\n')

// Actual protected FS authority and actual owned-root bootstrap, executing the
// exact main worker-admission route and actual protected endpoint. The old
// ordinary service initializer remains executable as the observer callback,
// so admitting that worker would still execute the original failing oracle.
// Workspaces/SQL/domain callbacks are spies, not Electron or PG acceptance.
test('AR107-W01 a genuinely protected restored root starts no ordinary workspace/template/conversation recovery before its two real checkpoints',{timeout:20000},async()=>{
 const f=await checkpointFixture(),calls:string[]=[]
 try{
  assert.equal(f.requests.startup().mode,'protected');const retention=await f.retentionBytes();await writeFile(join(f.path,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
  class ObservedWorkspaces{
   constructor(){calls.push('Workspaces')}
   async initialize(){calls.push('initialize')}
   async run(_id:string,run:()=>Promise<unknown>){calls.push('inbox');return run()}
   async close(){calls.push('close')}
  }
  const deps={workerData:{root:f.path,bootstrap:f.boot,startup:new SharedArrayBuffer(ROOT_STARTUP_BYTES),applicationRestoreProtected:true,migrations:'unused-isolated-migrations'},ROOT_STARTUP_BYTES,RootStartupError,readRootStartup(){},startOwnedRoot,Workspaces:ObservedWorkspaces,withApplicationMetadataSnapshot:async(_main:unknown,run:()=>Promise<unknown>)=>run(),main:{},localTemplateLibrary:{async initialize(){calls.push('templates')}},configureConversationTransfers(){calls.push('configure-conversation')},async recoverConversationTransfers(){calls.push('recover-conversation')},LocalDispatcher:class{constructor(){calls.push('dispatcher')}}}
  const ordinaryCode=transformSync(`let works,dispatcher;return (${ready})`,{loader:'ts'}).code
  const ordinaryReady=()=>new Function(...Object.keys(deps),ordinaryCode)(...Object.values(deps))
  const mainDeps={ApplicationRestoreProtectedService,ApplicationRestoreRequests,applicationRestorePreflight,inspectApplicationRestoreProtection,inspectApplicationRestoreLayouts,applicationMetadata:f.gate,bootstrapPath:f.boot,window:{isDestroyed:()=>false,webContents:{id:41}},draftSession:{owner:41,applicationNonce:f.owner},app:{hasSingleInstanceLock:()=>true,isPackaged:true},process:{env:{}},resolve,join,homedir:()=>f.base,createOrdinaryServiceWorker(){calls.push('ordinary-worker');return new SharedArrayBuffer(ROOT_STARTUP_BYTES)},waitRootStartup:()=>({status:'ready',root:f.path})}
  const route=transformSync(`let applicationProtectedOperationId=null,applicationRequests,dataRoot,service={call:ordinaryReady},serviceProtected=false,ordinaryWorkerExited=false;return(async()=>{${admission};await service.call('ready');return{serviceProtected,ordinaryWorkerExited,dataRoot}})()`,{loader:'ts'}).code
  const admitted=await new Function(...Object.keys(mainDeps),'ordinaryReady',route)(...Object.values(mainDeps),ordinaryReady)
  assert.deepEqual(calls,[],'only a protected draft bootstrap is authorized before actual journal/barrier consumption; no ordinary inbox initialization or saved conversation recovery')
  assert.equal(admitted.serviceProtected,true);assert.equal(admitted.ordinaryWorkerExited,true);assert.equal(admitted.dataRoot,f.path)
  assert.deepEqual(await f.retentionBytes(),retention);assert.equal(f.requests.startup().mode,'protected');assert.ok(await readFile(join(f.path,'drafts.json')))
 }finally{await f.close()}
})
