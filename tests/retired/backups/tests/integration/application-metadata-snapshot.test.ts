import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,writeFile,rm,readdir,readFile,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {captureApplicationRoot} from '../../desktop/service/database/application-snapshot'
import {ApplicationMetadataGate} from '../../desktop/main/application-metadata-gate'
import {DraftJournal} from '../../desktop/main/draft-journal'
import {directoryIdentity} from '../../desktop/core/root-ownership'
import type {DraftSnapshot} from '../../desktop/shared/drafts'
test('real online capture lets concurrent autosave wait only through export and completes a consistent closed snapshot',{timeout:120000},async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'xx-metadata-snapshot32-'))),source=join(base,'source'),parent=join(base,'staging');await mkdir(source);await mkdir(parent);await mkdir(join(source,'inbox'))
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}));await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 const gate=new ApplicationMetadataGate(),journal=new DraftJournal(source,{withWrite:run=>gate.write(run)});journal.activate('window');const engine=await PGlite.create({dataDir:join(source,'inbox/database'),relaxedDurability:false})
 let saved:Promise<unknown>|undefined,done=false,acquisitions=0,releases=0
 const draft:DraftSnapshot={version:1,revision:1,createdAt:new Date().toISOString(),autosaves:[],sources:{chat:{text:'备份期间仍在输入'}},issues:[]}
 try{
  await engine.exec("CREATE TABLE original_data(body text); INSERT INTO original_data VALUES ('consistent inbox')")
  const result=await captureApplicationRoot(await directoryIdentity(source),await directoryIdentity(parent),engine,{assertOwner(){},assertLiveInbox(value){assert.equal(value,engine)},async withMetadataSnapshot<T>(run:()=>Promise<T>){const id=await gate.acquire();acquisitions++;try{return await run()}finally{gate.release(id);releases++}}},undefined,{hook:async phase=>{
   if(phase==='after-dump'){saved=journal.persist('window',draft).then(()=>{done=true});await new Promise(resolve=>setTimeout(resolve,40));assert.equal(done,false,'autosave must wait at its physical write, not change the snapshot inventory')}
   if(phase==='before-import'){assert.equal(acquisitions,1);assert.equal(releases,1);await saved;assert.equal(done,true)}
  }})
  assert.equal(acquisitions,1);assert.equal(releases,1);assert.equal((await readdir(result.directory.path)).includes('drafts.json'),false);assert.equal(JSON.parse(await readFile(join(source,'drafts.json'),'utf8')).snapshot.sources.chat.text,'备份期间仍在输入');assert.equal(engine.closed,false)
 }finally{gate.revoke();await saved?.catch(()=>{});await engine.close();await rm(base,{recursive:true,force:true})}
})
