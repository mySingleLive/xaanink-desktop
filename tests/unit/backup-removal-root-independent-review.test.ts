import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {mkdtemp,mkdir,readFile,writeFile,rename,readdir,realpath,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {assertNoLegacyBackupRecovery} from '../../desktop/main/legacy-recovery-preflight'
import {rootRelocationPreflight} from '../../desktop/main/root-relocation-preflight'
import {rootMaintenanceRequired} from '../../desktop/main/root-maintenance-preflight'
import {inboxLeaseRecoveryRequired} from '../../desktop/main/inbox-lease-recovery'
import {RootMigrationRequests} from '../../desktop/main/root-migration-request'
import {DataRootManager} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {defaultState,stateSchema} from '../../desktop/core/settings'
import {VersionedStore} from '../../desktop/core/versioned-store'
import {exportConfiguration,prepareConfigurationImport,resolveConfigurationImport} from '../../desktop/core/configuration-transfer'

const source=ts.createSourceFile('main.ts',readFileSync('desktop/main/index.ts','utf8'),ts.ScriptTarget.Latest,true),branch=source.statements.at(-1)
assert(branch&&ts.isIfStatement(branch)&&branch.getText(source).includes('app.requestSingleInstanceLock()'))
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-removal-independent-root-'))),boot=join(base,'bootstrap'),root=join(base,'source'),target=join(base,'target')
 for(const path of [boot,root,target,join(root,'inbox')])await mkdir(path)
 const pointer={schemaVersion:1 as const,revision:1,rootId:randomUUID(),migrationId:null,root:await directoryIdentity(root)}
 await writeFile(join(boot,'data-root.json'),JSON.stringify(pointer));await writeFile(join(root,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:pointer.rootId,phase:'ready',inboxReady:true}));await writeFile(join(root,'author.txt'),'independent original author bytes')
 console.log('Retained independent root review fixture:',base);return{base,boot,root,target,pointer}
}
async function route(boot:string,defaultRoot:string){
 const trace:string[]=[],messages:string[]=[]
 const dependencies={assertNoLegacyBackupRecovery,rootRelocationPreflight,rootMaintenanceRequired,inboxLeaseRecoveryRequired,app:{requestSingleInstanceLock:()=>true,hasSingleInstanceLock:()=>true,quit:()=>trace.push('quit'),exit:()=>trace.push('exit')},launch:async()=>{trace.push('ordinary-selected')},launchRootMaintenance:async(path:string,root:string)=>{assert.equal(path,boot);assert.equal(root,defaultRoot);trace.push('maintenance-selected')},launchRootRelocation:async()=>{trace.push('relocation-selected')},launchInboxLeaseRecovery:async()=>{throw Error('unexpected inbox recovery in independent root fixture')},bootstrapPath:boot,startupPaths:{bootstrap:boot,defaultRoot,encryptionFamily:'legacy'},startupSelectionError:null,isolatedRoot:null,join,homedir:()=>'/unused-default',failedRootBeforeSession:false,dialog:{showErrorBox:(_title:string,message:string)=>{messages.push(message);trace.push('error')}}}
 new Function(...Object.keys(dependencies),transformSync(branch!.getText(source),{loader:'ts'}).code)(...Object.values(dependencies));await new Promise(resolve=>setImmediate(resolve));return{trace,messages}
}
test('BR-IR01 actual first main branch with actual readonly preflights permits a fresh bootstrap and leaves all paths untouched',async()=>{
 const f=await fixture();await unlink(join(f.boot,'data-root.json'));const before=await readdir(f.boot),bytes=await readFile(join(f.root,'author.txt'))
 const result=await route(f.boot,f.root);assert.deepEqual(result.trace,['ordinary-selected']);assert.deepEqual(result.messages,[]);assert.deepEqual(await readdir(f.boot),before);assert.deepEqual(await readFile(join(f.root,'author.txt')),bytes)
})
test('BR-IR02 genuine armed ordinary migration plus its malformed journal remains owned by maintenance triage rather than old backup cold admission',async()=>{
 const f=await fixture(),owner=randomUUID(),manager=new DataRootManager(f.boot,f.root),requests=new RootMigrationRequests(f.boot,{resolveSource:()=>manager.resolve(),assertStableLock:()=>{},assertOwner:value=>assert.equal(value,owner),assertClosed:()=>{}})
 const prepared=await requests.prepare(owner,await directoryIdentity(f.target));await requests.arm(owner,prepared.requestId);await writeFile(join(f.boot,'root-migration.json'),'{}');const before=await readFile(join(f.boot,'root-migration-request.json')),journal=await readFile(join(f.boot,'root-migration.json'))
 assert.equal(rootMaintenanceRequired(f.boot),true);assert.doesNotThrow(()=>assertNoLegacyBackupRecovery(f.boot,()=>{}));assert.deepEqual((await route(f.boot,f.root)).trace,['maintenance-selected']);assert.deepEqual(await readFile(join(f.boot,'root-migration-request.json')),before);assert.deepEqual(await readFile(join(f.boot,'root-migration.json')),journal)
})
test('BR-IR03 actual physically lost root routes directly to strict relocation, preserving old root and exact pointer bytes',async()=>{
 const f=await fixture(),before=await readFile(join(f.boot,'data-root.json'));await rename(f.root,f.root+'-preserved')
 assert.deepEqual((await route(f.boot,f.root)).trace,['relocation-selected']);assert.deepEqual(await readFile(join(f.boot,'data-root.json')),before);assert.equal(await readFile(join(f.root+'-preserved','author.txt'),'utf8'),'independent original author bytes')
})
test('BR-IR04 existing pending legacy work recovery blocks the actual main branch before selecting any worker/window, without rewriting files',async()=>{
 const f=await fixture(),file=join(f.root,'restore-draft-barrier.json');await writeFile(file,JSON.stringify({schemaVersion:1,revision:2,active:{token:randomUUID(),workId:randomUUID(),candidateId:randomUUID(),createdAt:new Date().toISOString(),outcome:{status:'activated'}}}));const before=await readFile(file)
 const result=await route(f.boot,f.root);assert.deepEqual(result.trace,['error','exit']);assert(result.messages[0].includes('旧版本'));assert.deepEqual(await readFile(file),before)
})
test('BR-IR05 actual state read preserves old file bytes; next normal CAS settings write retains other preferences and removes only obsolete general fields',async()=>{
 const f=await fixture(),file=join(f.root,'state.json'),legacy={...structuredClone(defaultState),settings:{...structuredClone(defaultState.settings),general:{defaultParent:'/original-parent',restoreSession:false,backupIntervalMinutes:30,backupRetention:12}}}
 legacy.settings.user.penName='原作者';legacy.settings.appearance.bodyFontSize=21;const original=JSON.stringify({schemaVersion:1,revision:7,value:legacy})+'\n';await writeFile(file,original)
 const store=new VersionedStore(file,defaultState,stateSchema.parse),current=await store.read();assert.equal(await readFile(file,'utf8'),original);assert.deepEqual(current.value.settings.general,{defaultParent:'/original-parent',restoreSession:false});assert.equal(current.value.settings.user.penName,'原作者')
 const next=structuredClone(current.value);next.settings.appearance.theme='ink';const saved=await store.update(current.revision,next);assert.equal(saved.revision,8);assert.equal(saved.value.settings.appearance.bodyFontSize,21);assert.equal(saved.value.settings.user.penName,'原作者');const disk=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(disk.value.settings.general,{defaultParent:'/original-parent',restoreSession:false});assert.equal(disk.value.settings.appearance.theme,'ink')
})
test('BR-IR06 actual portable legacy settings cannot turn backup fields into selectable writes, while normal reviewed import remains functional',()=>{
 const current={revision:4,settings:structuredClone(defaultState.settings),models:[]},file=JSON.parse(exportConfiguration(current));file.settings.general.backupIntervalMinutes=15;file.settings.general.backupRetention=10;file.settings.appearance.theme='ink'
 const plan=prepareConfigurationImport(JSON.stringify(file),current);assert.deepEqual(plan.changes.map(row=>row.path),['/appearance/theme']);assert.throws(()=>resolveConfigurationImport(plan,current,{selectedPaths:['/general/backupRetention']}),{code:'INVALID_SELECTION'})
 const result=resolveConfigurationImport(plan,current,{selectedPaths:['/appearance/theme']});assert.equal(result.appearance.theme,'ink');assert.deepEqual(result.general,current.settings.general);const text=exportConfiguration({...current,settings:result});assert.equal(text.includes('backupRetention'),false);assert.equal(text.includes('backupIntervalMinutes'),false)
})
test('BR-IR07 completed legacy work barrier stays byte-for-byte inert through actual normal main routing',async()=>{
 const f=await fixture(),file=join(f.root,'restore-draft-barrier.json');await writeFile(file,JSON.stringify({schemaVersion:1,revision:8,active:null}));const before=await readFile(file)
 assert.deepEqual((await route(f.boot,f.root)).trace,['ordinary-selected']);assert.deepEqual(await readFile(file),before)
})
