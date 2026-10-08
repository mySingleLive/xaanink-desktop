import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdtemp,mkdir,writeFile,readFile,realpath,readdir,rm,rename} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {randomUUID} from "node:crypto"
import {DataRootManager,type RootOptions,type MigrationHost} from "../../desktop/core/data-root"
import {directoryIdentity} from "../../desktop/core/root-ownership"
async function fixture(options:RootOptions={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),"xuanxiang-root-dirs-"))),source=join(base,"old"),target=join(base,"new"),boot=join(base,"boot")
 for(const p of [source,target,boot])await mkdir(p)
 const dirs=["inbox/database/pg_notify","inbox/database/pg_wal/archive_status","session/empty-cache"]
 for(const p of dirs)await mkdir(join(source,p),{recursive:true})
 await writeFile(join(source,"xuanxiang-app.json"),JSON.stringify({schemaVersion:1,app:"Xuanxiangxiezuo-Desktop",id:randomUUID(),phase:"ready",inboxReady:true}))
 await writeFile(join(source,"catalog.json"),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 const manager=new DataRootManager(boot,source,options),original=await manager.adopt(await directoryIdentity(source))
 const host:MigrationHost={quiesce:async()=>({source:original.root,ownedFiles:["xuanxiang-app.json","catalog.json"],ownedDirectories:dirs,assertClosed(){},release(){}})}
 return{base,source,target,boot,dirs,manager,host,original,proof:await directoryIdentity(target),close:()=>rm(base,{recursive:true,force:true})}
}
test("DR11D-01 explicit owned empty engine directories survive migration; unrelated directories stay at source",async()=>{
 const f=await fixture();try{
  await mkdir(join(f.source,"session","author-folder"))
  assert.equal((await f.manager.migrate(f.proof,f.host)).status,"complete")
  for(const p of f.dirs)assert.deepEqual(await readdir(join(f.target,p)),[])
  assert.deepEqual(await readdir(join(f.source,"session","author-folder")),[])
 }finally{await f.close()}
})
test("DR11D-02 precommit cancellation removes only recorded target directories and retains originals",async()=>{
 const abort=new AbortController(),f=await fixture({hook:phase=>{if(phase==="ready-to-commit")abort.abort()}})
 try{await assert.rejects(f.manager.migrate(f.proof,f.host,abort.signal),/MIGRATION_CANCELLED/);assert.deepEqual(await readdir(f.target),[]);for(const p of f.dirs)assert.deepEqual(await readdir(join(f.source,p)),[])}finally{await f.close()}
})
test("DR11D-03 a replaced target empty directory cannot be accepted at pointer commit",async()=>{
 let f:Awaited<ReturnType<typeof fixture>>;f=await fixture({hook:async phase=>{if(phase==="ready-to-commit"){const p=join(f.target,f.dirs[0]);await rename(p,p+"-external-original");await mkdir(p)}}})
 try{await assert.rejects(f.manager.migrate(f.proof,f.host));assert.deepEqual(JSON.parse(await readFile(join(f.boot,"data-root.json"),"utf8")),f.original);assert.deepEqual(await readdir(join(f.target,f.dirs[0])),[])}finally{await f.close()}
})
test("DR11D-04 ownership cannot claim an unrelated top-level directory or a nested catalogued work",async()=>{
 for(const kind of ["unknown","work"]){const f=await fixture();try{
  f.dirs.push(kind==="unknown"?"author-work":"session/author-work");await mkdir(join(f.source,f.dirs.at(-1)!))
  if(kind==="work")await writeFile(join(f.source,"catalog.json"),JSON.stringify({schemaVersion:1,revision:1,value:[{path:join(f.source,f.dirs.at(-1)!)}]}))
  await assert.rejects(f.manager.migrate(f.proof,f.host),/OWNERSHIP_INVALID|WORK_PATH_PROTECTED/)
  assert.deepEqual(await readdir(f.target),[])
 }finally{await f.close()}}
})
