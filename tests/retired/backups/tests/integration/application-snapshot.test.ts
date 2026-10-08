import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,rm,writeFile,readFile,readdir,realpath,symlink} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {captureApplicationRoot} from '../../desktop/service/database/application-snapshot'
import {directoryIdentity} from '../../desktop/core/root-ownership'
async function fixture(run:(f:{base:string;source:string;parent:string})=>Promise<void>){const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-app-snapshot-'))),source=join(base,'source'),parent=join(base,'staging');await mkdir(source);await mkdir(parent);await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}));await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:1,value:[]}));try{await run({base,source,parent})}finally{await rm(base,{recursive:true,force:true})}}
test('live inbox capture waits actual transaction, seals an independent closed database, preserves opaque settings and never includes session or old backups',()=>fixture(async f=>{
 await mkdir(join(f.source,'inbox'));const engine=await PGlite.create({dataDir:join(f.source,'inbox/database'),relaxedDurability:false});let copy:PGlite|undefined
 try{
  await engine.exec("CREATE TABLE draft(text TEXT); INSERT INTO draft VALUES ('before')")
  await writeFile(join(f.source,'state.json'),'opaque encrypted settings fixture');await writeFile(join(f.source,'drafts.json'),'inert recovery fixture');await writeFile(join(f.source,'author-private.txt'),'unknown neighbor');await mkdir(join(f.source,'session'));await writeFile(join(f.source,'session','author-session'),'no session snapshot');await mkdir(join(f.source,'backups'));await writeFile(join(f.source,'backups','old'),'do not recurse')
  const neighbor=join(f.parent,'zz-author-neighbor');await mkdir(neighbor);await writeFile(join(neighbor,'author.txt'),'keep neighbor');
  const root=await directoryIdentity(f.source),parent=await directoryIdentity(f.parent),host={assertOwner:async()=>{},assertLiveInbox:async(value:PGlite)=>{assert.equal(value,engine);assert.equal(engine.closed,false)}}
  const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),transaction=engine.transaction(async tx=>{await tx.query("UPDATE draft SET text='committed'");entered.resolve();await release.promise});await entered.promise
  let done=false;const flight=captureApplicationRoot(root,parent,engine,host).then(result=>{done=true;return result})
  await new Promise(r=>setTimeout(r,35));assert.equal(done,false);release.resolve();await transaction;const captured=await flight
  assert.notEqual(captured.directory.path,neighbor);assert.equal(await readFile(join(neighbor,'author.txt'),'utf8'),'keep neighbor');
  assert.equal(engine.closed,false);await engine.query("UPDATE draft SET text='after backup'")
  assert.equal(await readFile(join(captured.directory.path,'state.json'),'utf8'),'opaque encrypted settings fixture');assert.deepEqual((await readdir(captured.directory.path)).sort(),['catalog.json','drafts.json','inbox','state.json','xuanxiang-app.json'])
  copy=await PGlite.create({dataDir:join(captured.directory.path,'inbox/database'),relaxedDurability:false});assert.equal((await copy.query<{text:string}>('SELECT text FROM draft')).rows[0].text,'committed');assert.equal((await engine.query<{text:string}>('SELECT text FROM draft')).rows[0].text,'after backup');await copy.close();copy=undefined
  await assert.rejects(captureApplicationRoot(root,parent,engine,host,undefined,{hook:async phase=>{if(phase==='after-dump')await writeFile(join(f.source,'state.json'),'changed during capture')}}),/CHANGED/)
  assert.equal(await readFile(join(f.source,'author-private.txt'),'utf8'),'unknown neighbor');assert.equal(await readFile(join(f.source,'session','author-session'),'utf8'),'no session snapshot');assert.equal(await readFile(join(f.source,'backups','old'),'utf8'),'do not recurse')
 }finally{await copy?.close();await engine.close()}
}))
test('snapshot requires trusted live inbox ownership and a separate staging area before creating bytes',()=>fixture(async f=>{
 const root=await directoryIdentity(f.source),parent=await directoryIdentity(f.parent),engine={query:async()=>({rows:[{server_version:'17'}]}),_runExclusiveTransaction:async(run:()=>Promise<unknown>)=>run(),runExclusive:async(run:()=>Promise<unknown>)=>run()} as unknown as PGlite
 await assert.rejects(captureApplicationRoot(root,parent,engine,{assertOwner:async()=>{throw Error('OWNER_REVOKED')},assertLiveInbox:async()=>{}}),/OWNER_REVOKED/);assert.deepEqual(await readdir(f.parent),[])
 await assert.rejects(captureApplicationRoot(root,root,engine,{assertOwner:async()=>{},assertLiveInbox:async()=>{}}),/TARGET/)
 await mkdir(join(f.source,'inbox'));await assert.rejects(captureApplicationRoot(root,await directoryIdentity(join(f.source,'inbox')),engine,{assertOwner:async()=>{},assertLiveInbox:async()=>{}}),/TARGET/)
 await symlink(join(f.source,'catalog.json'),join(f.source,'state.json'));await assert.rejects(captureApplicationRoot(root,parent,engine,{assertOwner:async()=>{},assertLiveInbox:async()=>{}}),/UNSAFE/)
}))
