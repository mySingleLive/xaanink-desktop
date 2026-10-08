import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,rm,readdir,readFile,writeFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import sharp from 'sharp'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
import {ModelRepository} from '../../desktop/main/model-repository'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {AvatarAssetService} from '../../desktop/main/avatar-assets'
import {defaultState} from '../../desktop/core/settings'
import type {DraftSnapshot} from '../../desktop/shared/drafts'
const options=(gate:ApplicationMetadataGate)=>({withWrite:<T>(run:()=>Promise<T>)=>gate.write(run)})
const snapshot:DraftSnapshot={version:1,revision:1,createdAt:new Date().toISOString(),autosaves:[],sources:{chat:{text:'尚未发送的草稿'}},issues:[]}
for(const kind of ['state','drafts','avatar'] as const)test(`physical ${kind} writer waits the capture lease, then writes real acknowledged bytes`,async()=>{
 const base=await mkdtemp(join(tmpdir(),'xx-metadata-writer32-')),root=join(base,'data');await mkdir(root)
 const gate=new ApplicationMetadataGate(),lease=await gate.acquire();let pending:Promise<unknown>|undefined,done=false
 try{
  if(kind==='state'){
   const repo=new ModelRepository(join(root,'state.json'),{isEncryptionAvailable:()=>true,encryptString:Buffer.from,decryptString:b=>b.toString()},{replace(){},remove(){}},options(gate));pending=repo.updateSettings(0,structuredClone(defaultState.settings))
  }else if(kind==='drafts'){
   const journal=new DraftJournal(root,options(gate));journal.activate('window');pending=journal.persist('window',snapshot)
  }else{
   const service=new AvatarAssetService({root,...options(gate)}),session=randomUUID(),path=join(base,'selected.png');service.begin('window',session);await writeFile(path,await sharp({create:{width:8,height:8,channels:4,background:'#cb8c50'}}).png().toBuffer());const draft=await service.stageSelected('window',session,path);pending=service.persistDraft('window',session,draft.draftId)
  }
  void pending.then(()=>{done=true},()=>{});await new Promise(resolve=>setTimeout(resolve,40));assert.equal(done,false);assert.deepEqual(await readdir(root),[])
  gate.release(lease);await pending
  if(kind==='state')assert.equal(JSON.parse(await readFile(join(root,'state.json'),'utf8')).revision,1)
  else if(kind==='drafts')assert.equal(JSON.parse(await readFile(join(root,'drafts.json'),'utf8')).snapshot.sources.chat.text,'尚未发送的草稿')
  else assert.equal((await readdir(join(root,'assets/global'))).filter(name=>name.endsWith('.png')).length,1)
 }finally{gate.revoke();await pending?.catch(()=>{});await rm(base,{recursive:true,force:true})}
})
