import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {exportConfiguration,prepareConfigurationImport,resolveConfigurationImport,ConfigurationTransferError,type ConfigurationSnapshot,type TrustedShortcutCatalogs} from '../../desktop/core/configuration-transfer'
import {defaultState,type PublicModel} from '../../desktop/core/settings'
import {RevisionConflict} from '../../desktop/core/versioned-store'
import {ModelRepository} from '../../desktop/main/model-repository'
import {isValidThinkingEffort} from '../../src/lib/ai/thinking-effort'
const current=():ConfigurationSnapshot=>({revision:2,settings:structuredClone(defaultState.settings),models:[]})
const model=():PublicModel=>({id:randomUUID(),name:'本机已授权模型',provider:'custom',protocol:'openai',modelId:'fixture-text',endpoint:'https://authorized.invalid/v1',kind:'TEXT',contextWindow:0,enabled:true,authRevision:1,keyMask:'••••••••',thinkingLevels:['low'],defaultThinking:'default'})
const catalogs:TrustedShortcutCatalogs={darwin:{resolved:true,commands:[{id:'file.save',label:'保存',scope:'global',locked:false,defaults:['Cmd+S']}]},win32:{resolved:true,commands:[{id:'file.save',label:'保存',scope:'global',locked:false,defaults:['Ctrl+S']}]}}
const code=(value:string)=>(error:unknown)=>error instanceof ConfigurationTransferError&&error.code===value

test('CFG58-01 inherited object keys are unknown command rows, so safe appearance choices can still be reviewed',()=>{
 const state=current(),source=current();source.settings.appearance.theme='ink'
 // These are valid JSON own keys. They are not application command IDs and
 // must produce per-row COMMAND_UNKNOWN rather than clone native functions.
 for(const id of ['toString','valueOf','hasOwnProperty','isPrototypeOf'])Object.defineProperty(source.settings.shortcuts.darwin,id,{value:[],enumerable:true})
 const original=structuredClone(state),plan=prepareConfigurationImport(exportConfiguration(source),state,catalogs)
 for(const id of ['toString','valueOf','hasOwnProperty','isPrototypeOf']){
  assert.ok(plan.issues.some(issue=>issue.path==='/shortcuts/darwin/'+id&&issue.code==='COMMAND_UNKNOWN'))
  assert.equal(plan.changes.find(change=>change.path==='/shortcuts/darwin/'+id)?.before,undefined)
 }
 assert.equal(resolveConfigurationImport(plan,state,{selectedPaths:['/appearance/theme']},catalogs).appearance.theme,'ink')
 assert.deepEqual(state,original);assert.equal(Object.hasOwn(Object.prototype,'file.save'),false)
})

test('CFG58-02 own prototype-sensitive keys reject without changing preferences or native object prototypes',()=>{
 const state=current(),file=JSON.parse(exportConfiguration(state)),original=structuredClone(state)
 for(const id of ['__proto__','constructor','prototype']){
  const input=structuredClone(file);Object.defineProperty(input.settings.shortcuts.win32,id,{value:['Ctrl+Alt+F6'],enumerable:true})
  assert.throws(()=>prepareConfigurationImport(JSON.stringify(input),state,catalogs),code('INVALID_SCHEMA'))
 }
 assert.deepEqual(state,original);assert.equal(Object.hasOwn(Object.prototype,'Ctrl+Alt+F6'),false)
})

test('CFG58-03 export and its reference preview contain none of the local credential or authority fields',()=>{
 const state=current(),saved=model();saved.endpoint='https://authorized.invalid/private-key-marker';saved.keyMask='MASK_MARKER';state.models=[saved];state.settings.general.defaultParent='/LOCAL_PATH_MARKER';state.settings.user.avatarAssetId=randomUUID();state.settings.agent.textModelId=saved.id
 const exported=exportConfiguration(state),row=JSON.parse(exported).modelReferences[0]
 for(const value of ['private-key-marker','MASK_MARKER','LOCAL_PATH_MARKER',state.settings.user.avatarAssetId])assert.equal(exported.includes(value),false)
 assert.deepEqual(Object.keys(row).sort(),['id','kind','modelId','name','protocol','provider'])
 const target=current(),plan=prepareConfigurationImport(exported,target)
 assert.ok(plan.issues.some(issue=>issue.code==='MODEL_MAPPING_REQUIRED'))
 assert.throws(()=>resolveConfigurationImport(plan,target,{selectedPaths:['/agent/textModelId'],modelBindings:{'/agent/textModelId':saved.id}}),code('MODEL_UNAVAILABLE'))
 assert.deepEqual(target.models,[])
})

test('CFG58-04 actual repository credential replacement makes the reviewed public snapshot stale without importing anything',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'xuanxiang-config-review-')),path=join(directory,'state.json')
 const repo=new ModelRepository(path,{isEncryptionAvailable:()=>true,encryptString:key=>Buffer.from('FIXTURE:'+key),decryptString:bytes=>bytes.toString().slice(8)},{replace(){},remove(){}})
 try{
  const saved=model(),{id:_id,authRevision:_revision,keyMask:_mask,...draft}=saved
  const before=await repo.saveModel(0,{...draft,apiKey:'isolated-initial'}),source=current();source.settings.appearance.theme='ink'
  const plan=prepareConfigurationImport(exportConfiguration(source),before)
  await repo.saveModel(before.revision,{...draft,id:before.models[0].id,apiKey:'isolated-replacement'})
  const currentSnapshot=await repo.read(),diskBefore=await readFile(path,'utf8')
  assert.throws(()=>resolveConfigurationImport(plan,currentSnapshot,{selectedPaths:['/appearance/theme']}),RevisionConflict)
  assert.equal(await readFile(path,'utf8'),diskBefore)
  assert.equal(await repo.keyFor(currentSnapshot.models[0].id,currentSnapshot.models[0].authRevision),'isolated-replacement')
  assert.equal(currentSnapshot.settings.appearance.theme,'paper')
 }finally{await rm(directory,{recursive:true,force:true})}
})

test('CFG58-05 clearing text defaults with high effort requires a reviewed reset instead of mutating the unselected field',()=>{
 const state=current(),saved=model(),source=current();saved.thinkingLevels=['high'];state.models=[saved];state.settings.agent.textModelId=saved.id;state.settings.agent.thinking='high'
 const plan=prepareConfigurationImport(exportConfiguration(source),state)
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:['/agent/textModelId']}),code('THINKING_UNAVAILABLE'))
 const next=resolveConfigurationImport(plan,state,{selectedPaths:['/agent/textModelId'],thinkingOverride:'default'})
 assert.equal(next.agent.textModelId,null);assert.equal(next.agent.thinking,'default');assert.equal(state.settings.agent.thinking,'high')
})

test('CFG58-06 conflict validation uses the selected merge independently in each platform namespace',()=>{
 const state=current(),source=current();state.settings.shortcuts.win32['file.save']=['Ctrl+Alt+S'];source.settings.shortcuts.darwin['file.save']=['Cmd+Alt+S'];source.settings.shortcuts.win32['unknown.command']=[]
 const plan=prepareConfigurationImport(exportConfiguration(source),state,catalogs)
 assert.ok(plan.issues.some(issue=>issue.path==='/shortcuts/win32/unknown.command'&&issue.code==='COMMAND_UNKNOWN'))
 const next=resolveConfigurationImport(plan,state,{selectedPaths:['/shortcuts/darwin/file.save']},catalogs)
 assert.deepEqual(next.shortcuts.darwin['file.save'],['Cmd+Alt+S']);assert.deepEqual(next.shortcuts.win32,state.settings.shortcuts.win32)
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:['/shortcuts/win32/unknown.command']},catalogs),code('COMMAND_UNKNOWN'))
})

test('CFG58-07 declared effort metadata cannot import an effort the installed provider translator rejects',()=>{
 const state=current(),saved=model(),source=current();saved.provider='anthropic';saved.protocol='anthropic';saved.modelId='claude-fixture';saved.thinkingLevels=['low','xhigh'];state.models=[saved];state.settings.agent.textModelId=saved.id;source.models=[saved];source.settings.agent.textModelId=saved.id;source.settings.agent.thinking='xhigh'
 // Product settings use the same actual effort table as the runtime (review45);
 // metadata includes xhigh, but Anthropic's installed budget mapper has no xhigh.
 assert.equal(isValidThinkingEffort(saved.provider,saved.modelId,'xhigh'),false)
 const plan=prepareConfigurationImport(exportConfiguration(source),state)
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:['/agent/thinking']}),code('THINKING_UNAVAILABLE'))
 assert.equal(resolveConfigurationImport(plan,state,{selectedPaths:['/agent/thinking'],thinkingOverride:'low'}).agent.thinking,'low')
 assert.equal(resolveConfigurationImport(plan,state,{selectedPaths:['/agent/thinking'],thinkingOverride:'default'}).agent.thinking,'default')
 assert.equal(state.settings.agent.thinking,'default')
})
