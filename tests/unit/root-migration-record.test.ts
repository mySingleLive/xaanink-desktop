import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DataRootManager,RootMigrationCrash,type RootOptions,type MigrationHost} from '../../desktop/core/data-root'
import {directoryIdentity} from '../../desktop/core/root-ownership'
async function fixture(options:RootOptions={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-record12-'))),source=join(base,'source'),target=join(base,'target'),bootstrap=join(base,'bootstrap')
 for(const p of [source,target,bootstrap,join(source,'inbox')])await mkdir(p)
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:false}));await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 const manager=new DataRootManager(bootstrap,source,options),original=await manager.adopt(await directoryIdentity(source)),proof=await directoryIdentity(target)
 const host:MigrationHost={async quiesce(pointer){return{source:pointer.root,ownedFiles:['xuanxiang-app.json','catalog.json'],ownedDirectories:['inbox'],assertClosed(){},release(){}}}}
 return{base,source,target,bootstrap,manager,original,proof,host,close:()=>rm(base,{recursive:true,force:true})}
}
test('trusted execution nonce correlates the durable terminal journal after recover returns null',async()=>{
 const id=randomUUID(),f=await fixture({migrationId:id});try{
  assert.equal(await f.manager.recordedMigration(id),null)
  const result=await f.manager.migrate(f.proof,f.host);assert.equal(result.migrationId,id)
  const cold=new DataRootManager(f.bootstrap,f.source);assert.equal(await cold.recover(f.host),null)
  const record=await cold.recordedMigration(id);assert.deepEqual(record,{migrationId:id,phase:'complete',source:f.original,target:f.proof,result})
  assert.equal(await cold.recordedMigration(randomUUID()),null);record!.source.root.path='mutated';assert.equal((await cold.recordedMigration(id))!.source.root.path,f.source)
 }finally{await f.close()}
})
test('copy crash has a matching nonterminal record; cancellation records the matching rollback',async()=>{
 for(const mode of ['crash','cancel']as const){const id=randomUUID(),abort=new AbortController(),f=await fixture({migrationId:id,hook:phase=>{if(phase==='copying'){if(mode==='crash')throw new RootMigrationCrash();abort.abort()}}});try{
  await assert.rejects(f.manager.migrate(f.proof,f.host,abort.signal));const cold=new DataRootManager(f.bootstrap,f.source),record=await cold.recordedMigration(id);assert.equal(record!.migrationId,id);assert.deepEqual(record!.source,f.original);assert.deepEqual(record!.target,f.proof)
  if(mode==='crash'){assert.equal(record!.phase,'copying');assert.equal(record!.result,null);assert.equal((await cold.recover(f.host))!.status,'rolled-back')}else assert.equal(record!.result!.status,'rolled-back')
 }finally{await f.close()}}
})
test('journal lookup does not hide corrupt metadata and rejects invalid execution IDs',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.manager.recordedMigration('bad'),/MIGRATION_ID_INVALID/)
  await writeFile(join(f.bootstrap,'root-migration.json'),'not json');await assert.rejects(f.manager.recordedMigration(randomUUID()),/METADATA_UNSAFE/)
 }finally{await f.close()}
})
test('a reused execution nonce cannot replace even a prior rolled-back journal',async()=>{
 const id=randomUUID(),abort=new AbortController(),f=await fixture({migrationId:id,hook:phase=>{if(phase==='copying')abort.abort()}});try{
  await assert.rejects(f.manager.migrate(f.proof,f.host,abort.signal),/MIGRATION_CANCELLED/);const old=await readFile(join(f.bootstrap,'root-migration.json'),'utf8')
  await assert.rejects(new DataRootManager(f.bootstrap,f.source,{migrationId:id}).migrate(f.proof,f.host),/MIGRATION_ID_REUSED/);assert.equal(await readFile(join(f.bootstrap,'root-migration.json'),'utf8'),old)
 }finally{await f.close()}
})
