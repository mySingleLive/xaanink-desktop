import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,mkdir,readdir,readFile,writeFile,realpath,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {captureApplicationRoot,type ApplicationSnapshotHost} from '../../desktop/service/database/application-snapshot'
import {directoryIdentity} from '../../desktop/core/root-ownership'

async function fixture(run:(f:{source:string;parent:string;engine:PGlite})=>Promise<void>){
 const base=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-snapshot-review88-'))),source=join(base,'source'),parent=join(base,'staging')
 await mkdir(source);await mkdir(parent);await mkdir(join(source,'inbox'))
 await writeFile(join(source,'xuanxiang-app.json'),JSON.stringify({schemaVersion:1,app:'Xuanxiangxiezuo-Desktop',id:randomUUID(),phase:'ready',inboxReady:true}))
 await writeFile(join(source,'catalog.json'),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 await writeFile(join(source,'state.json'),'unchanged opaque source state')
 const engine=await PGlite.create({dataDir:join(source,'inbox/database'),relaxedDurability:false})
 try{await engine.exec("CREATE TABLE original_data(body text); INSERT INTO original_data VALUES ('original')");await run({source,parent,engine})}
 finally{await engine.close();await rm(base,{recursive:true,force:true})}
}

test('AS88-01: the final asynchronous ownership check cannot return an obsolete sealed candidate tree', {timeout:120000},()=>fixture(async f=>{
 const source=await directoryIdentity(f.source),parent=await directoryIdentity(f.parent)
 let sealing=false,calls=0,mutateAt=0,changed=false,currentCandidate=''
 const host:ApplicationSnapshotHost={assertOwner:async()=>{},assertLiveInbox:async engine=>{
  assert.equal(engine,f.engine);assert.equal(engine.closed,false)
  if(sealing&&++calls===mutateAt){await writeFile(join(currentCandidate,'state.json'),'external change after final hash');changed=true}
 }}
 // Observe the public callback sequence of one successful capture. Repeat the
 // same unchanged live engine, then alter actual candidate bytes during its
 // last awaited host boundary; no filesystem or PGlite method is replaced.
 const first=await captureApplicationRoot(source,parent,f.engine,host,undefined,{hook:async phase=>{if(phase==='before-seal'){sealing=true;calls=0}}})
 assert.ok(calls>0);mutateAt=calls;sealing=false;calls=0
 const existing=new Set(await readdir(f.parent))
 const attempt=captureApplicationRoot(source,parent,f.engine,host,undefined,{hook:async phase=>{if(phase==='before-seal'){
  const created=(await readdir(f.parent)).filter(name=>!existing.has(name));assert.equal(created.length,1);currentCandidate=join(f.parent,created[0]);sealing=true;calls=0
 }}})
 const settled=await attempt.then(value=>({value,error:undefined}),error=>({value:undefined,error}))
 assert.equal(changed,true,'the injection must reach the terminal awaited host check')
 assert.equal(await readFile(join(currentCandidate,'state.json'),'utf8'),'external change after final hash')
 assert.equal(await readFile(join(first.directory.path,'state.json'),'utf8'),'unchanged opaque source state')
 assert.equal(await readFile(join(f.source,'state.json'),'utf8'),'unchanged opaque source state')
 assert.equal(f.engine.closed,false)
 await assert.rejects(settled.error?Promise.reject(settled.error):Promise.resolve(settled.value),/CHANGED|UNSAFE/)
}))

test('AS88-02: late staging neighbors cannot turn a capture into a successful over-capacity result', {timeout:120000},()=>fixture(async f=>{
 const source=await directoryIdentity(f.source),parent=await directoryIdentity(f.parent)
 const host:ApplicationSnapshotHost={assertOwner:async()=>{},assertLiveInbox:async engine=>{assert.equal(engine,f.engine);assert.equal(engine.closed,false)}}
 let injected=false
 const settled=await captureApplicationRoot(source,parent,f.engine,host,undefined,{hook:async phase=>{if(phase==='before-seal'){
  for(let batch=0;batch<1000;batch+=40)await Promise.all(Array.from({length:40},(_,offset)=>writeFile(join(f.parent,'foreign-'+(batch+offset)),'foreign bytes')))
  injected=true
 }}}).then(value=>({value,error:undefined}),error=>({value:undefined,error}))
 assert.equal(injected,true)
 assert.equal((await readdir(f.parent)).filter(name=>name.startsWith('foreign-')).length,1000)
 assert.equal(await readFile(join(f.parent,'foreign-999'),'utf8'),'foreign bytes')
 assert.equal(await readFile(join(f.source,'state.json'),'utf8'),'unchanged opaque source state')
 assert.equal(f.engine.closed,false)
 await assert.rejects(settled.error?Promise.reject(settled.error):Promise.resolve(settled.value),/LIMIT/)
}))

test('AS88-03: cancellation and revoked ownership after export preserve source and unready captured bytes', {timeout:120000},()=>fixture(async f=>{
 const source=await directoryIdentity(f.source),parent=await directoryIdentity(f.parent)
 const controller=new AbortController();let revoked=false
 const host:ApplicationSnapshotHost={assertOwner:async()=>{if(revoked)throw Error('OWNER_REVOKED')},assertLiveInbox:async engine=>{assert.equal(engine,f.engine);assert.equal(engine.closed,false)}}
 await assert.rejects(captureApplicationRoot(source,parent,f.engine,host,controller.signal,{hook:phase=>{if(phase==='before-import')controller.abort()}}),/aborted/i)
 await assert.rejects(captureApplicationRoot(source,parent,f.engine,host,undefined,{hook:phase=>{if(phase==='after-dump')revoked=true}}),/OWNER_REVOKED/)
 const candidates=await readdir(f.parent);assert.equal(candidates.length,2)
 for(const name of candidates){
  assert.equal(await readFile(join(f.parent,name,'state.json'),'utf8'),'unchanged opaque source state')
  assert.deepEqual((await readdir(join(f.parent,name))).sort(),['catalog.json','state.json','xuanxiang-app.json'])
 }
 assert.equal(await readFile(join(f.source,'state.json'),'utf8'),'unchanged opaque source state')
 assert.equal(f.engine.closed,false)
 assert.equal((await f.engine.query<{body:string}>('SELECT body FROM original_data')).rows[0].body,'original')
}))
