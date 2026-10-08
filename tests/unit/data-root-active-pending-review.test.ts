import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,readFile,readdir,realpath,rename,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DataRootManager,RootMigrationError,type MigrationHost} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import {VersionedStore} from '../../desktop/core/versioned-store'
import {defaultState,stateSchema} from '../../desktop/core/settings'

test('DR69-01: a committed cleanup-pending root remains authoritative after a legitimate VersionedStore save and cold recovery',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-active-root69-'))),source=join(base,'source'),target=join(base,'target'),bootstrap=join(base,'bootstrap')
 try{
  for(const path of [source,target,bootstrap,join(source,'inbox')])await mkdir(path)
  await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:false}));await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
  const oldStore=new VersionedStore(join(source,'state.json'),defaultState,stateSchema.parse),initial=await oldStore.update(0,defaultState);let oldChanged=false
  const manager=new DataRootManager(bootstrap,source,{async hook(phase){if(phase==='cleanup'&&!oldChanged){oldChanged=true;const value=structuredClone(initial.value);value.settings.user.penName='保留在旧根的最新资料';await oldStore.update(initial.revision,value)}}})
  const original=await manager.adopt(await directoryIdentity(source)),host:MigrationHost={async quiesce(pointer){return{source:pointer.root,ownedFiles:['xuanxiang-app.json','catalog.json','state.json'],ownedDirectories:['inbox'],assertClosed(){},release(){}}}}
  const migrated=await manager.migrate(await directoryIdentity(target),host);assert.equal(migrated.status,'cleanup-pending');assert.ok(migrated.pending.includes('state.json'));assert.equal(migrated.root.rootId,original.rootId)
  const oldBytes=await readFile(join(source,'state.json'),'utf8');assert.equal((await oldStore.read()).value.settings.user.penName,'保留在旧根的最新资料')
  const current=new VersionedStore(join(target,'state.json'),defaultState,stateSchema.parse),before=await current.read(),value=structuredClone(before.value);value.settings.appearance.theme='ink';const saved=await current.update(before.revision,value)
  assert.equal(saved.revision,before.revision+1);const activeBytes=await readFile(join(target,'state.json'),'utf8')
  for(let coldStart=0;coldStart<2;coldStart++){
   const restarted=new DataRootManager(bootstrap,source),recovered=await restarted.recover(host)
   assert.ok(recovered);assert.equal(recovered.status,'cleanup-pending');assert.ok(recovered.pending.includes('NEW_ROOT_CHANGED'));assert.equal(recovered.root.root.path,target);assert.equal(recovered.root.rootId,original.rootId)
   assert.deepEqual(await restarted.resolve(),{state:'existing',pointer:migrated.root});assert.equal(await readFile(join(target,'state.json'),'utf8'),activeBytes);assert.equal(await readFile(join(source,'state.json'),'utf8'),oldBytes)
   const reopened=new VersionedStore(join(target,'state.json'),defaultState,stateSchema.parse);assert.deepEqual(await reopened.read(),saved)
  }
  assert.equal((await readdir(source)).includes('state.json'),true);assert.equal(JSON.parse(await readFile(join(bootstrap,'data-root.json'),'utf8')).root.path,target)
 }finally{await rm(base,{recursive:true,force:true})}
})

test('DR69-02: permitting legitimate new-root writes never softens damaged pointer, invalid marker or replaced root identity',async()=>{
 const variants=[['pointer-json','METADATA_UNSAFE'],['pointer-id','POINTER_CHANGED'],['marker-id','ROOT_UNAVAILABLE'],['root-identity','ROOT_UNAVAILABLE']] as const
 for(const [variant,expected] of variants){
  const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-active-root69-guard-'))),source=join(base,'source'),target=join(base,'target'),bootstrap=join(base,'bootstrap')
  try{
   for(const path of [source,target,bootstrap,join(source,'inbox')])await mkdir(path)
   await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:false}));await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
   const oldStore=new VersionedStore(join(source,'state.json'),defaultState,stateSchema.parse),initial=await oldStore.update(0,defaultState)
   const manager=new DataRootManager(bootstrap,source,{async hook(phase){if(phase==='cleanup'){const value=structuredClone(initial.value);value.settings.user.penName='旧根待清理记录';await oldStore.update(initial.revision,value)}}})
   await manager.adopt(await directoryIdentity(source));const host:MigrationHost={async quiesce(pointer){return{source:pointer.root,ownedFiles:['xuanxiang-app.json','catalog.json','state.json'],ownedDirectories:['inbox'],assertClosed(){},release(){}}}}
   assert.equal((await manager.migrate(await directoryIdentity(target),host)).status,'cleanup-pending')
   const current=new VersionedStore(join(target,'state.json'),defaultState,stateSchema.parse),before=await current.read(),value=structuredClone(before.value);value.settings.appearance.theme='ink';await current.update(before.revision,value)
   const oldBytes=await readFile(join(source,'state.json'),'utf8'),activeBytes=await readFile(join(target,'state.json'),'utf8'),pointerPath=join(bootstrap,'data-root.json'),markerPath=join(target,'xuanxiang-app.json')
   if(variant==='pointer-json')await writeFile(pointerPath,'{broken pointer')
   if(variant==='pointer-id'){const pointer=JSON.parse(await readFile(pointerPath,'utf8'));pointer.rootId=randomUUID();await writeFile(pointerPath,JSON.stringify(pointer))}
   if(variant==='marker-id'){const marker=JSON.parse(await readFile(markerPath,'utf8'));marker.id=randomUUID();await writeFile(markerPath,JSON.stringify(marker))}
   if(variant==='root-identity'){const marker=await readFile(markerPath,'utf8');await rename(target,target+'-retained');await mkdir(target);await writeFile(markerPath,marker);await writeFile(join(target,'state.json'),activeBytes)}
   const pointerBytes=await readFile(pointerPath,'utf8'),journalBytes=await readFile(join(bootstrap,'root-migration.json'),'utf8'),restarted=new DataRootManager(bootstrap,join(base,'unused-default'))
   await assert.rejects(restarted.recover(host),(error:unknown)=>error instanceof RootMigrationError&&error.code===expected,variant)
   await assert.rejects(restarted.resolve(),(error:unknown)=>error instanceof RootMigrationError,variant)
   assert.equal(await readFile(join(source,'state.json'),'utf8'),oldBytes,variant);assert.equal(await readFile(join(target,'state.json'),'utf8'),activeBytes,variant);assert.equal(await readFile(pointerPath,'utf8'),pointerBytes,variant);assert.equal(await readFile(join(bootstrap,'root-migration.json'),'utf8'),journalBytes,variant);assert.equal((await readdir(base)).includes('unused-default'),false,variant)
  }finally{await rm(base,{recursive:true,force:true})}
 }
})
