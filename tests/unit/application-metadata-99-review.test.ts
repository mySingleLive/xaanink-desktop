import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {mkdtemp,realpath,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import sharp from 'sharp'
import type {PGlite} from '@electric-sql/pglite'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {AvatarAssetService} from '../../desktop/main/avatar-assets'
import {ModelRepository} from '../../desktop/main/model-repository'
import {defaultState} from '../../desktop/core/settings'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import type {DraftSnapshot} from '../../desktop/shared/drafts'
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve))
async function fixture(run:(base:string)=>Promise<void>){const base=await realpath(await mkdtemp(join(tmpdir(),'xx-independent99-')));try{await run(base)}finally{await rm(base,{recursive:true,force:true})}}
const peerFor=(gate:ApplicationMetadataGate)=>({call:async<T>(method:string,value?:unknown):Promise<T>=>{if(method==='application.capture.acquire'){assert.equal(value,undefined);return await gate.acquire() as T}assert.equal(method,'application.capture.release');gate.release(value as string);return true as T}})

test('AG99-01 a queued physical writer does not cross a replacement capture after old-service revocation or accept its old token',()=>fixture(async base=>{
 const gate=new ApplicationMetadataGate(),path=join(base,'state.json'),old=await gate.acquire();let written=false
 const pending=gate.write(async()=>{await writeFile(path,'new physical state');written=true})
 gate.revoke();const fresh=await gate.acquire();await tick();assert.equal(written,false);assert.deepEqual(await readdir(base),[])
 assert.throws(()=>gate.release(old),/LEASE_INVALID/);await tick();assert.equal(written,false)
 gate.release(fresh);await pending;assert.equal(await readFile(path,'utf8'),'new physical state')
}))

test('AG99-02 real state, draft and avatar owners cancelled while awaiting metadata capture cannot publish old bytes when writes resume',()=>fixture(async base=>{
 for(const kind of ['state','draft','avatar'] as const){
  const root=join(base,kind);await mkdir(root);const gate=new ApplicationMetadataGate(),id=await gate.acquire(),waiting=Promise.withResolvers<void>()
  const options={withWrite:<T>(run:()=>Promise<T>)=>{waiting.resolve();return gate.write(run)}};let pending:Promise<unknown>|undefined
  try{
   if(kind==='state'){
    const original=JSON.stringify({schemaVersion:1,revision:0,value:defaultState})+'\n';await writeFile(join(root,'state.json'),original)
    const repository=new ModelRepository(join(root,'state.json'),{isEncryptionAvailable:()=>true,encryptString:Buffer.from,decryptString:bytes=>bytes.toString()},{replace(){},remove(){}},options)
    const settings=structuredClone(defaultState.settings);settings.appearance.theme='ink';let owner=true
    pending=repository.updateSettings(0,settings,()=>{if(!owner)throw Error('OWNER_EXPIRED')});const rejected=assert.rejects(pending,/OWNER_EXPIRED/)
    await waiting.promise;assert.equal(await readFile(join(root,'state.json'),'utf8'),original);owner=false;gate.release(id);await rejected
    assert.equal(await readFile(join(root,'state.json'),'utf8'),original)
   }else if(kind==='draft'){
    const journal=new DraftJournal(root,options),release=journal.activate('owner')
    const snapshot:DraftSnapshot={version:1,revision:1,createdAt:new Date().toISOString(),autosaves:[],sources:{chat:{text:'do not replay cancelled draft'}},issues:[]}
    pending=journal.persist('owner',snapshot);const rejected=assert.rejects(pending,/窗口已变化/);await waiting.promise;assert.deepEqual(await readdir(root),[]);release();gate.release(id);await rejected
   }else{
    const service=new AvatarAssetService({root,...options}),session=randomUUID(),selected=join(base,'selected.png');service.begin('owner',session)
    await writeFile(selected,await sharp({create:{width:4,height:4,channels:4,background:'#855b3b'}}).png().toBuffer())
    const draft=await service.stageSelected('owner',session,selected);pending=service.persistDraft('owner',session,draft.draftId);const rejected=assert.rejects(pending,/已取消/)
    await waiting.promise;assert.deepEqual(await readdir(root),[]);service.cancel('owner',session);gate.release(id);await rejected;service.close()
   }
   assert.deepEqual(await readdir(root),kind==='state'?['state.json']:[],'cancelled owner must preserve the old state and leave neither new metadata nor avatar assets')
  }finally{gate.revoke();await pending?.catch(()=>{})}
 }
}))
