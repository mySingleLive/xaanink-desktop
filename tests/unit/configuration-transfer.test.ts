import assert from "node:assert/strict"
import {test} from "node:test"
import {randomUUID} from "node:crypto"
import {mkdtemp,readFile,rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {defaultState,type PublicModel} from "../../desktop/core/settings"
import {RevisionConflict} from "../../desktop/core/versioned-store"
import {ModelRepository} from "../../desktop/main/model-repository"
import {exportConfiguration,prepareConfigurationImport,resolveConfigurationImport,ConfigurationTransferError,type ConfigurationSnapshot,type TrustedShortcutCatalogs} from "../../desktop/core/configuration-transfer"
import type {ShortcutCommand} from "../../desktop/core/shortcuts"

function current():ConfigurationSnapshot{return{revision:4,settings:structuredClone(defaultState.settings),models:[]}}
function model(kind:"TEXT"|"IMAGE"="TEXT"):PublicModel{return{id:randomUUID(),name:"saved local model",provider:"custom",protocol:"openai",modelId:"fixture-model",endpoint:"https://local-authorized.invalid/v1",kind,contextWindow:0,enabled:true,authRevision:3,keyMask:"••••••••",thinkingLevels:["high"],defaultThinking:"default"}}
const portable=(state:ConfigurationSnapshot)=>JSON.parse(exportConfiguration(state))
const expectCode=(code:string)=>(error:unknown)=>error instanceof ConfigurationTransferError&&error.code===code
const command=(id:string,key:string,scope:"global"|"input"="global",locked=false):ShortcutCommand=>({id,label:id,scope,locked,defaults:key?[key]:[]})
const catalog:TrustedShortcutCatalogs={darwin:{resolved:true,commands:[command("ai.send","Cmd+Enter","input"),command("file.save","Cmd+S"),command("file.open","Cmd+O")]},win32:{resolved:true,commands:[command("ai.send","Ctrl+Enter","input"),command("file.save","Ctrl+S"),command("file.open","Ctrl+O")]}}

test("CFG01: portable export is a strict versioned allowlist with no key, authorization, path or avatar data",()=>{
 const state=current(),saved={...model(),encryptedKey:"secret-os-cipher",apiKey:"secret-plain",keyMask:"secret-mask"};state.models=[saved];state.settings.agent.textModelId=saved.id;state.settings.general.defaultParent="/private/author";state.settings.user.avatarAssetId=randomUUID()
 const text=exportConfiguration(state),data=JSON.parse(text)
 assert.equal(data.format,"xaanink-settings");assert.equal(data.version,1)
 for(const value of ["secret-os-cipher","secret-plain","secret-mask","/private/author",state.settings.user.avatarAssetId,"local-authorized.invalid"])assert.equal(text.includes(value!),false)
 for(const key of ["encryptedKey","apiKey","keyMask","authRevision","enabled","endpoint"])assert.equal(key in data.modelReferences[0],false)
 assert.equal(data.modelReferences[0].id,saved.id);assert.deepEqual(data.settings.shortcuts,state.settings.shortcuts)
})

test("CFG02: preview is inert and field selection preserves every unselected value, local path and avatar",()=>{
 const before=current(),source=current();before.settings.general.defaultParent="/chosen/parent";before.settings.user.avatarAssetId=randomUUID();source.settings.appearance.theme="ink";source.settings.general.restoreSession=false
 const original=structuredClone(before),plan=prepareConfigurationImport(exportConfiguration(source),before)
 assert.ok(plan.changes.some(row=>row.path==="/appearance/theme"));assert.ok(plan.changes.some(row=>row.path==="/general/restoreSession"));assert.deepEqual(before,original)
 const next=resolveConfigurationImport(plan,before,{selectedPaths:["/appearance/theme"]})
 assert.equal(next.appearance.theme,"ink");assert.equal(next.general.restoreSession,true);assert.equal(next.general.defaultParent,"/chosen/parent");assert.equal(next.user.avatarAssetId,before.settings.user.avatarAssetId);assert.deepEqual(before,original)
 assert.deepEqual(resolveConfigurationImport(plan,before,{selectedPaths:[]}),before.settings)
})

test("CFG03: malformed JSON, future schema and forbidden nested secrets/authority fields reject without a plan",()=>{
 const state=current(),base=portable(state)
 assert.throws(()=>prepareConfigurationImport("{broken",state),expectCode("INVALID_JSON"))
 assert.throws(()=>prepareConfigurationImport(JSON.stringify({...base,version:2}),state),expectCode("UNSUPPORTED_VERSION"))
 for(const change of [(data:any)=>data.apiKey="secret",(data:any)=>data.settings.general.defaultParent="/other/root",(data:any)=>data.settings.user.avatarAssetId=randomUUID(),(data:any)=>data.modelReferences.push({...model(),encryptedKey:"secret"})]){
  const data=structuredClone(base);change(data)
  assert.throws(()=>prepareConfigurationImport(JSON.stringify(data),state),expectCode("INVALID_SCHEMA"))
 }
 assert.throws(()=>prepareConfigurationImport(JSON.stringify(base).replace('"darwin":{}','"darwin":{"__proto__":[]}'),state),expectCode("INVALID_SCHEMA"))
})

test("CFG17: review display exposes conflicts without trusting file-supplied command definitions",()=>{
 const state=current(),source=current();source.settings.shortcuts.darwin={"file.save":["Cmd+O"]}
 const plan=prepareConfigurationImport(exportConfiguration(source),state,catalog)
 assert.ok(plan.issues.some(issue=>issue.path==="/shortcuts/darwin/file.save"&&issue.code==="SHORTCUT_CONFLICT"))
 assert.deepEqual(plan.catalogResolved,{darwin:true,win32:true})
 const data=portable(source);data.catalog={resolved:true,commands:[command("file.open","")]}
 assert.throws(()=>prepareConfigurationImport(JSON.stringify(data),state,catalog),expectCode("INVALID_SCHEMA"))
 assert.equal(state.settings.shortcuts.darwin["file.save"],undefined)
})

test("CFG18: pointer escaping cannot turn a reviewed command ID into another setting path",()=>{
 const state=current(),source=current(),id="editor/~special/action";source.settings.shortcuts.darwin={[id]:["Cmd+Alt+F7"]}
 const trusted={...catalog,darwin:{resolved:true,commands:[...catalog.darwin!.commands,command(id,"")]}}
 const plan=prepareConfigurationImport(exportConfiguration(source),state,trusted),path="/shortcuts/darwin/editor~1~0special~1action"
 assert.ok(plan.changes.some(row=>row.path===path))
 assert.deepEqual(resolveConfigurationImport(plan,state,{selectedPaths:[path]},trusted).shortcuts.darwin[id],["Cmd+Alt+F7"])
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/shortcuts/darwin/"+id]},trusted),expectCode("INVALID_SELECTION"))
})

test("CFG19: scoped commands may share keys while overlapping text/global defaults still block",()=>{
 const state=current(),source=current();source.settings.shortcuts.darwin={"input.action":["Cmd+Alt+F6"]}
 const independent={darwin:{resolved:true,commands:[command("input.action","","input"),{...command("editor.action","Cmd+Alt+F6"),scope:"markdown" as const}]}}
 const plan=prepareConfigurationImport(exportConfiguration(source),state,independent)
 assert.deepEqual(resolveConfigurationImport(plan,state,{selectedPaths:["/shortcuts/darwin/input.action"]},independent).shortcuts.darwin["input.action"],["Cmd+Alt+F6"])
 const shared={darwin:{resolved:true,commands:[independent.darwin.commands[0],{...independent.darwin.commands[1],scope:"text" as const}]}}
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/shortcuts/darwin/input.action"]},shared),expectCode("SHORTCUT_CONFLICT"))
})

test("CFG20: review and image roles require separate explicit local mappings; missing foreign metadata cannot authorize them",()=>{
 const state=current(),source=current(),text=model(),image=model("IMAGE");state.models=[text,image]
 source.settings.agent.reviewModelId=randomUUID();source.settings.agent.imageModelId=randomUUID()
 const plan=prepareConfigurationImport(exportConfiguration(source),state),selectedPaths=["/agent/reviewModelId","/agent/imageModelId"]
 assert.deepEqual(plan.modelReferences,[])
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths,modelBindings:{"/agent/reviewModelId":text.id}}),expectCode("MODEL_MAPPING_REQUIRED"))
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths,modelBindings:{"/agent/reviewModelId":text.id,"/agent/imageModelId":text.id}}),expectCode("MODEL_UNAVAILABLE"))
 const next=resolveConfigurationImport(plan,state,{selectedPaths,modelBindings:{"/agent/reviewModelId":text.id,"/agent/imageModelId":image.id}})
 assert.equal(next.agent.reviewModelId,text.id);assert.equal(next.agent.imageModelId,image.id)
})

test("CFG21: unselected mappings and thinking resets cannot mutate unrelated preferences",()=>{
 const state=current(),source=current();source.settings.appearance.theme="ink";const plan=prepareConfigurationImport(exportConfiguration(source),state)
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/appearance/theme"],modelBindings:{"/agent/textModelId":null}}),expectCode("INVALID_SELECTION"))
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/appearance/theme"],thinkingOverride:"default"}),expectCode("INVALID_SELECTION"))
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/appearance/theme"],extraSetting:true} as any),expectCode("INVALID_SELECTION"))
})

test("CFG22: deep-frozen reference and incoming arrays cannot change reviewed bytes",()=>{
 const state=current(),source=current(),saved=model();source.models=[saved];source.settings.agent.textModelId=saved.id;source.settings.shortcuts.darwin={"ai.send":["Cmd+Shift+Enter"]}
 const plan=prepareConfigurationImport(exportConfiguration(source),state,catalog),row=plan.changes.find(change=>change.path==="/shortcuts/darwin/ai.send")!
 assert.equal(Object.isFrozen(plan.modelReferences[0]),true);assert.equal(Object.isFrozen(row.incoming),true);assert.equal(Object.isFrozen(row),true)
 assert.throws(()=>{(row.incoming as string[]).push("Cmd+Tab")},TypeError)
 assert.throws(()=>{plan.modelReferences[0].modelId="changed"},TypeError)
 assert.deepEqual(resolveConfigurationImport(plan,state,{selectedPaths:[row.path]},catalog).shortcuts.darwin["ai.send"],["Cmd+Shift+Enter"])
})

test("CFG23: named local models may reorder without invalidating a plan, but replacement authorization cannot",()=>{
 const first=model(),second=model(),state={...current(),models:[first,second]},source=current();source.settings.general.restoreSession=false
 const plan=prepareConfigurationImport(exportConfiguration(source),state)
 assert.equal(resolveConfigurationImport(plan,{...state,models:[second,first]},{selectedPaths:["/general/restoreSession"]}).general.restoreSession,false)
 assert.throws(()=>resolveConfigurationImport(plan,{...state,models:[{...first,authRevision:4},second]},{selectedPaths:["/general/restoreSession"]}),RevisionConflict)
})

test("CFG24: schema and command-list bounds fail closed and error text does not repeat untrusted values",()=>{
 const state=current(),source=current(),secret="SECRET_SHOULD_NOT_APPEAR",data=portable(source)
 data.settings.user.email=secret
 assert.throws(()=>prepareConfigurationImport(JSON.stringify(data),state),(error:unknown)=>expectCode("INVALID_SCHEMA")(error)&&!(error as Error).message.includes(secret))
 source.settings.shortcuts.darwin={"ai.send":[]}
 const duplicated={darwin:{resolved:true,commands:[command("ai.send","Cmd+Enter"),command("ai.send","")]}}
 const plan=prepareConfigurationImport(exportConfiguration(source),state,duplicated)
 assert.equal(plan.catalogResolved.darwin,false)
 assert.ok(plan.issues.some(issue=>issue.code==="CATALOG_UNAVAILABLE"))
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/shortcuts/darwin/ai.send"]},duplicated),expectCode("CATALOG_UNAVAILABLE"))
 const excessive=portable(state);for(let i=0;i<=5000;i++)excessive.settings.shortcuts.darwin["command."+i]=[]
 assert.throws(()=>prepareConfigurationImport(JSON.stringify(excessive),state),expectCode("INVALID_SCHEMA"))
})

test("CFG04: input is bounded before JSON parsing and unsupported shortcut syntax rejects",()=>{
 const state=current()
 assert.throws(()=>prepareConfigurationImport(" ".repeat(4*1024*1024+1),state),expectCode("CONFIG_TOO_LARGE"))
 const file=portable(state);file.settings.shortcuts.darwin["ai.send"]=["Cmd+Cmd+Enter"]
 assert.throws(()=>prepareConfigurationImport(JSON.stringify(file),state),expectCode("INVALID_SCHEMA"))
})

test("CFG05: stale revision and a changed authorization snapshot invalidate reviewed plans",()=>{
 const state=current(),source=current();source.settings.appearance.theme="ink";const plan=prepareConfigurationImport(exportConfiguration(source),state)
 assert.throws(()=>resolveConfigurationImport(plan,{...state,revision:5},{selectedPaths:["/appearance/theme"]}),RevisionConflict)
 assert.throws(()=>resolveConfigurationImport(plan,{...state,models:[model()]},{selectedPaths:["/appearance/theme"]}),RevisionConflict)
})

test("CFG06: forged plans and unreviewed arbitrary paths cannot be applied",()=>{
 const state=current(),source=current();source.settings.appearance.theme="ink";const plan=prepareConfigurationImport(exportConfiguration(source),state)
 assert.throws(()=>resolveConfigurationImport(structuredClone(plan),state,{selectedPaths:["/appearance/theme"]}),expectCode("INVALID_PLAN"))
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/general/defaultParent"]}),expectCode("INVALID_SELECTION"))
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/appearance/theme","/appearance/theme"]}),expectCode("INVALID_SELECTION"))
 assert.equal(Object.isFrozen(plan),true);assert.equal(Object.isFrozen(plan.changes),true)
})

test("CFG07: foreign default-model UUIDs never silently fall back or create credentials",()=>{
 const state=current(),local=model(),source=current(),foreign=model();state.models=[local];source.models=[foreign];source.settings.agent.textModelId=foreign.id
 const plan=prepareConfigurationImport(exportConfiguration(source),state)
 assert.ok(plan.issues.some(row=>row.path==="/agent/textModelId"&&row.code==="MODEL_MAPPING_REQUIRED"))
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/agent/textModelId"]}),expectCode("MODEL_MAPPING_REQUIRED"))
 const next=resolveConfigurationImport(plan,state,{selectedPaths:["/agent/textModelId"],modelBindings:{"/agent/textModelId":local.id}})
 assert.equal(next.agent.textModelId,local.id);assert.equal(state.models.length,1);assert.equal(state.models[0].authRevision,3)
 const cleared=resolveConfigurationImport(plan,state,{selectedPaths:["/agent/textModelId"],modelBindings:{"/agent/textModelId":null}});assert.equal(cleared.agent.textModelId,null)
})

test("CFG08: explicit mappings reject unknown, disabled, wrong-kind and empty model identifiers",()=>{
 const state=current(),image=model("IMAGE"),disabled={...model(),enabled:false},source=current(),foreign=model();state.models=[image,disabled];source.models=[foreign];source.settings.agent.textModelId=foreign.id
 const plan=prepareConfigurationImport(exportConfiguration(source),state)
 for(const id of [randomUUID(),image.id,disabled.id,""])assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/agent/textModelId"],modelBindings:{"/agent/textModelId":id}}),expectCode("MODEL_UNAVAILABLE"))
})

test("CFG09: incompatible thinking needs an explicit reviewed reset instead of an invented model capacity",()=>{
 const state=current(),local={...model(),thinkingLevels:["low"]},source=current(),foreign=model();state.models=[local];source.models=[foreign];source.settings.agent.textModelId=foreign.id;source.settings.agent.thinking="high"
 const plan=prepareConfigurationImport(exportConfiguration(source),state),choices={selectedPaths:["/agent/textModelId","/agent/thinking"],modelBindings:{"/agent/textModelId":local.id}}
 assert.throws(()=>resolveConfigurationImport(plan,state,choices),expectCode("THINKING_UNAVAILABLE"))
 assert.equal(resolveConfigurationImport(plan,state,{...choices,thinkingOverride:"default"}).agent.thinking,"default")
})

test("CFG10: cross-platform partial imports merge explicit overrides and preserve absent local bindings",()=>{
 const state=current(),source=current();state.settings.shortcuts.darwin={"file.save":["Cmd+Alt+S"]};state.settings.shortcuts.win32={"file.open":["Ctrl+Alt+O"]};source.settings.shortcuts.darwin={"ai.send":["Cmd+Shift+Enter"]}
 const plan=prepareConfigurationImport(exportConfiguration(source),state,catalog)
 assert.equal(plan.changes.some(row=>row.path==="/shortcuts/darwin/file.save"),false)
 const next=resolveConfigurationImport(plan,state,{selectedPaths:["/shortcuts/darwin/ai.send"]},catalog)
 assert.deepEqual(next.shortcuts.darwin,{"file.save":["Cmd+Alt+S"],"ai.send":["Cmd+Shift+Enter"]});assert.deepEqual(next.shortcuts.win32,state.settings.shortcuts.win32)
})

test("CFG11: an explicit empty binding set disables the command and both platform namespaces round-trip",()=>{
 const state=current(),source=current();source.settings.shortcuts.darwin={"ai.send":[]};source.settings.shortcuts.win32={"ai.send":["Ctrl+Shift+Enter"]}
 const plan=prepareConfigurationImport(exportConfiguration(source),state,catalog),next=resolveConfigurationImport(plan,state,{selectedPaths:["/shortcuts/darwin/ai.send","/shortcuts/win32/ai.send"]},catalog)
 assert.deepEqual(next.shortcuts.darwin["ai.send"],[]);assert.deepEqual(next.shortcuts.win32["ai.send"],["Ctrl+Shift+Enter"])
 const roundTrip=JSON.parse(exportConfiguration({...state,settings:next}));assert.deepEqual(roundTrip.settings.shortcuts,next.shortcuts)
})

test("CFG12: missing trusted runtime command catalog blocks only the selected shortcut rows",()=>{
 const state=current(),source=current();source.settings.shortcuts.darwin={"monaco.example":[]};source.settings.appearance.theme="ink"
 const plan=prepareConfigurationImport(exportConfiguration(source),state)
 assert.ok(plan.issues.some(row=>row.path==="/shortcuts/darwin/monaco.example"&&row.code==="CATALOG_UNAVAILABLE"))
 assert.equal(resolveConfigurationImport(plan,state,{selectedPaths:["/appearance/theme"]}).appearance.theme,"ink")
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/shortcuts/darwin/monaco.example"]}),expectCode("CATALOG_UNAVAILABLE"))
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/shortcuts/darwin/monaco.example"]},catalog),expectCode("COMMAND_UNKNOWN"))
})

test("CFG13: selected aliases, chord prefixes, reserved keys and locked commands validate against full local defaults",()=>{
 const state=current()
 for(const bindings of [["Command+O"],["Cmd+O Cmd+P"],["Cmd+Tab"],["Cmd+Alt+S","Option+Command+S"]]){
  const source=current();source.settings.shortcuts.darwin={"file.save":bindings};const plan=prepareConfigurationImport(exportConfiguration(source),state,catalog)
  assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/shortcuts/darwin/file.save"]},catalog),expectCode("SHORTCUT_CONFLICT"))
 }
 const source=current();source.settings.shortcuts.darwin={"locked.command":[]};const locked={...catalog,darwin:{resolved:true,commands:[...catalog.darwin!.commands,command("locked.command","Cmd+Q","global",true)]}}
 const plan=prepareConfigurationImport(exportConfiguration(source),state,locked)
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/shortcuts/darwin/locked.command"]},locked),expectCode("SHORTCUT_CONFLICT"))
})

test("CFG14: atomic multi-row shortcut transfer requires all conflicting rows to be reviewed together",()=>{
 const state=current(),source=current();source.settings.shortcuts.darwin={"file.save":["Cmd+O"],"file.open":[]}
 const plan=prepareConfigurationImport(exportConfiguration(source),state,catalog)
 assert.throws(()=>resolveConfigurationImport(plan,state,{selectedPaths:["/shortcuts/darwin/file.save"]},catalog),expectCode("SHORTCUT_CONFLICT"))
 const next=resolveConfigurationImport(plan,state,{selectedPaths:["/shortcuts/darwin/file.save","/shortcuts/darwin/file.open"]},catalog)
 assert.deepEqual(next.shortcuts.darwin,{"file.save":["Cmd+O"],"file.open":[]})
})

test("CFG15: source reference duplicates and mismatched declared kinds reject instead of guessing capabilities",()=>{
 const state=current(),source=current(),image=model("IMAGE");source.models=[image];source.settings.agent.textModelId=image.id
 assert.throws(()=>prepareConfigurationImport(exportConfiguration(source),state),expectCode("INVALID_SCHEMA"))
 const file=portable(state),reference={id:randomUUID(),name:"reference",provider:"custom",protocol:"openai",modelId:"text",kind:"TEXT"};file.modelReferences=[reference,reference]
 assert.throws(()=>prepareConfigurationImport(JSON.stringify(file),state),expectCode("INVALID_SCHEMA"))
})

test("CFG16: resolved settings commit through the existing repository CAS without changing any model credential",async()=>{
 const root=await mkdtemp(join(tmpdir(),"xuanxiang-config-transfer-")),path=join(root,"state.json");let publishes=0
 const repo=new ModelRepository(path,{isEncryptionAvailable:()=>true,encryptString:key=>Buffer.from("CIPHER:"+key),decryptString:value=>value.toString().slice(7)},{replace(){publishes++},remove(){}})
 try{
  const local=model(),saved=await repo.saveModel(0,{name:local.name,provider:local.provider,protocol:local.protocol,modelId:local.modelId,endpoint:local.endpoint,kind:local.kind,contextWindow:0,enabled:true,thinkingLevels:local.thinkingLevels,defaultThinking:"default",apiKey:"secret-key-for-isolated-test"})
  const diskBefore=JSON.parse(await readFile(path,"utf8")),source=current();source.settings.appearance.theme="ink"
  const plan=prepareConfigurationImport(exportConfiguration(source),saved),next=resolveConfigurationImport(plan,saved,{selectedPaths:["/appearance/theme"]})
  const result=await repo.updateSettings(plan.baseRevision,next),diskAfter=JSON.parse(await readFile(path,"utf8"))
  assert.equal(result.settings.appearance.theme,"ink");assert.deepEqual(diskAfter.value.models,diskBefore.value.models);assert.equal(await repo.keyFor(saved.models[0].id,saved.models[0].authRevision),"secret-key-for-isolated-test")
  await assert.rejects(repo.updateSettings(plan.baseRevision,next),RevisionConflict);assert.equal(publishes,2)
 }finally{await rm(root,{recursive:true,force:true})}
})
