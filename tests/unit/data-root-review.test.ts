import assert from "node:assert/strict"
import {test} from "node:test"
import {randomUUID} from "node:crypto"
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath,rename,symlink,link,stat} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {DataRootManager,RootMigrationCrash,RootMigrationError,type RootOptions,type MigrationHost} from "../../desktop/core/data-root"
import {directoryIdentity,allowedManagedFile} from "../../desktop/core/root-ownership"

const code=(value:string)=>(error:unknown)=>error instanceof RootMigrationError&&error.code===value
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return{promise,resolve}}
async function sandbox(options:RootOptions={}){
 const base=await realpath(await mkdtemp(join(tmpdir(),"xuanxiang-review59-"))),bootstrap=join(base,"bootstrap"),source=join(base,"custom-current"),target=join(base,"target")
 for(const path of [bootstrap,source,target])await mkdir(path)
 await mkdir(join(source,"inbox","database"),{recursive:true});await mkdir(join(source,"session"))
 const rootId=randomUUID(),root=await directoryIdentity(source),pointer={schemaVersion:1 as const,revision:3,rootId,migrationId:null,root}
 const entries:Record<string,string>={"xuanxiang-app.json":JSON.stringify({schemaVersion:1,app:"Xuanxiangxiezuo-Desktop",id:rootId,phase:"ready",inboxReady:true}),"catalog.json":JSON.stringify({schemaVersion:1,revision:2,value:[]}),"state.json":"settings remain opaque","drafts.json":"unsaved chinese 正文","inbox/database/PG_VERSION":"17","session/Preferences":"owned cache"}
 for(const [path,text] of Object.entries(entries))await writeFile(join(source,path),text)
 await writeFile(join(source,"unknown.txt"),"用户外部文件");await writeFile(join(bootstrap,"data-root.json"),JSON.stringify(pointer))
 const releases:string[]=[],host:MigrationHost={async quiesce(current){
  const ownedFiles=Object.keys(entries)
  for(const name of await readdir(current.root.path))if(name.startsWith(".xuanxiang-root-recovery-")&&allowedManagedFile(name))ownedFiles.push(name)
  return{source:current.root,ownedFiles,assertClosed(){},release(outcome){releases.push(outcome)}}
 }}
 return{base,bootstrap,source,target,pointer,entries,releases,host,manager:new DataRootManager(bootstrap,join(base,"absent-default"),options),cleanup:()=>rm(base,{recursive:true,force:true})}
}

test("DR59-01: a lost pointer after completed rollback cannot initialize an unrelated empty default",async()=>{
 const abort=new AbortController(),f=await sandbox({hook(phase){if(phase==="verified")abort.abort()}})
 try{
  await assert.rejects(f.manager.migrate(await directoryIdentity(f.target),f.host,abort.signal),code("MIGRATION_CANCELLED"))
  assert.equal(JSON.parse(await readFile(join(f.bootstrap,"root-migration.json"),"utf8")).journal.phase,"rolled-back")
  await rm(join(f.bootstrap,"data-root.json"))
  await assert.rejects(new DataRootManager(f.bootstrap,join(f.base,"brand-new-default")).resolve(),code("MIGRATION_RECOVERY_REQUIRED"))
  assert.equal(await readFile(join(f.source,"drafts.json"),"utf8"),f.entries["drafts.json"])
  assert.equal((await readdir(f.base)).includes("brand-new-default"),false)
 }finally{await f.cleanup()}
})

test("DR59-02: migration remains exclusive until the closed-root lease release has settled",async()=>{
 const entered=gate(),allow=gate(),f=await sandbox();let calls=0
 const host:MigrationHost={async quiesce(pointer){calls++;const lease=await f.host.quiesce(pointer);return{...lease,async release(outcome){if(calls===1){entered.resolve();await allow.promise}await lease.release(outcome)}}}}
 let first:Promise<unknown>|undefined
 try{
  first=f.manager.migrate(await directoryIdentity(f.target),host);await entered.promise
  const next=join(f.base,"second-target");await mkdir(next)
  await assert.rejects(f.manager.migrate(await directoryIdentity(next),host),code("MIGRATION_BUSY"))
  assert.equal(calls,1);assert.deepEqual(await readdir(next),[])
 }finally{allow.resolve();await first;await f.cleanup()}
})

test("DR59-03: losing a verified target copy before cleanup must preserve the old last good bytes",async()=>{
 const f=await sandbox({async hook(phase){if(phase==="cleanup")await rm(join(f.target,"drafts.json"))}})
 try{
  const result=await f.manager.migrate(await directoryIdentity(f.target),f.host)
  const old=await readFile(join(f.source,"drafts.json"),"utf8").catch(error=>{if(error.code==="ENOENT")return null;throw error})
  const replacement=await readFile(join(f.target,"drafts.json"),"utf8").catch(error=>{if(error.code==="ENOENT")return null;throw error})
  assert.deepEqual({status:result.status,old,replacement},{status:"cleanup-pending",old:f.entries["drafts.json"],replacement:null})
  assert.equal(JSON.parse(await readFile(join(f.bootstrap,"data-root.json"),"utf8")).root.path,f.target)
 }finally{await f.cleanup()}
})

test("DR59-04: ready-root initialization cannot be implicitly adopted after a lost rollback pointer",async()=>{
 const abort=new AbortController(),f=await sandbox({hook(phase){if(phase==="verified")abort.abort()}})
 try{
  await assert.rejects(f.manager.migrate(await directoryIdentity(f.target),f.host,abort.signal),code("MIGRATION_CANCELLED"))
  await rm(join(f.bootstrap,"data-root.json"))
  await assert.rejects(f.manager.adopt(await directoryIdentity(f.source)),code("MIGRATION_RECOVERY_REQUIRED"))
  await assert.rejects(readFile(join(f.bootstrap,"data-root.json")),{code:"ENOENT"})
 }finally{await f.cleanup()}
})

test("DR59-05: a late per-file target change during cleanup cannot delete the corresponding remaining source",async()=>{
 let removed=false
 const f=await sandbox({async hook(phase,path){if(phase==="file-cleaned"&&path==="catalog.json"&&!removed){removed=true;await writeFile(join(f.target,"drafts.json"),"external new target draft")}}})
 try{
  const result=await f.manager.migrate(await directoryIdentity(f.target),f.host)
  const source=await readFile(join(f.source,"drafts.json"),"utf8").catch(error=>{if(error.code==="ENOENT")return null;throw error})
  assert.deepEqual({status:result.status,source},{status:"cleanup-pending",source:f.entries["drafts.json"]})
  assert.equal(await readFile(join(f.target,"drafts.json"),"utf8"),"external new target draft")
  assert.ok(result.pending.includes("drafts.json"))
 }finally{await f.cleanup()}
})

test("DR59-06: two migrations retain exact opaque data and previous recovery evidence while never moving unknown files",async()=>{
 const f=await sandbox()
 try{
  const first=await f.manager.migrate(await directoryIdentity(f.target),f.host)
  assert.equal(first.status,"complete");assert.equal(first.root.revision,4)
  const secondPath=join(f.base,"second");await mkdir(secondPath)
  const recovery=(await readdir(f.target)).filter(path=>path.startsWith(".xuanxiang-root-recovery-"))
  assert.equal(recovery.length,1)
  const firstEvidence=await readFile(join(f.target,recovery[0]))
  await writeFile(join(f.target,"foreign-user.txt"),"not app data")
  const second=await f.manager.migrate(await directoryIdentity(secondPath),f.host)
  assert.equal(second.status,"complete");assert.equal(second.root.revision,5);assert.equal(second.root.rootId,f.pointer.rootId)
  for(const [path,text] of Object.entries(f.entries))assert.equal(await readFile(join(secondPath,path),"utf8"),text)
  assert.deepEqual(await readFile(join(secondPath,recovery[0])),firstEvidence)
  assert.equal((await readdir(secondPath)).filter(path=>path.startsWith(".xuanxiang-root-recovery-")).length,2)
  assert.equal(await readFile(join(f.target,"foreign-user.txt"),"utf8"),"not app data")
  assert.equal(await readFile(join(f.source,"unknown.txt"),"utf8"),"用户外部文件")
  assert.deepEqual(f.releases,["new-root","new-root"])
  assert.equal(await f.manager.recover(f.host),null)
  assert.deepEqual(await f.manager.resolve(),{state:"existing",pointer:second.root})
 }finally{await f.cleanup()}
})

test("DR59-07: metadata symlinks, hardlinks and malformed pointers never fall back to a default root",async()=>{
 for(const kind of ["bad-json","symlink","hardlink"]){
  const f=await sandbox()
  try{
   const path=join(f.bootstrap,"data-root.json"),foreign=join(f.base,"foreign.json"),bytes=JSON.stringify(f.pointer)
   await rm(path);await writeFile(foreign,bytes)
   if(kind==="bad-json")await writeFile(path,"{broken")
   if(kind==="symlink")await symlink(foreign,path)
   if(kind==="hardlink")await link(foreign,path)
   await assert.rejects(f.manager.resolve(),code("METADATA_UNSAFE"))
   assert.equal(await readFile(foreign,"utf8"),bytes)
   assert.equal((await readdir(f.base)).includes("absent-default"),false)
  }finally{await f.cleanup()}
 }
})

test("DR59-08: a replaced canonical target rejects before quiescing and keeps all source bytes",async()=>{
 const f=await sandbox();let calls=0
 try{
  const original=await directoryIdentity(f.target);await rename(f.target,f.target+"-original");await mkdir(f.target)
  const host:MigrationHost={async quiesce(pointer){calls++;return f.host.quiesce(pointer)}}
  await assert.rejects(f.manager.migrate(original,host),code("TARGET_UNAVAILABLE"))
  assert.equal(calls,0)
  for(const [path,text] of Object.entries(f.entries))assert.equal(await readFile(join(f.source,path),"utf8"),text)
  assert.deepEqual(await readdir(f.target),[])
  assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap,"data-root.json"),"utf8")),f.pointer)
 }finally{await f.cleanup()}
})

test("DR59-09: aborting before target validation takes no lease and writes no migration journal",async()=>{
 const f=await sandbox(),controller=new AbortController();controller.abort();let calls=0
 try{
  await assert.rejects(f.manager.migrate(await directoryIdentity(f.target),{async quiesce(pointer){calls++;return f.host.quiesce(pointer)}},controller.signal),code("MIGRATION_CANCELLED"))
  assert.equal(calls,0);assert.deepEqual(await readdir(f.target),[])
  assert.deepEqual(await readdir(f.bootstrap),["data-root.json"])
 }finally{await f.cleanup()}
})

test("DR59-10: promotion crash recovery preserves foreign targets, and repeated recovery is conservative",async()=>{
 const f=await sandbox({hook(phase){if(phase==="file-promoted")throw new RootMigrationCrash("process lost")}})
 try{
  await assert.rejects(f.manager.migrate(await directoryIdentity(f.target),f.host),RootMigrationCrash)
  await writeFile(join(f.target,"foreign.txt"),"target user data")
  const manager=new DataRootManager(f.bootstrap,join(f.base,"unrelated")),first=await manager.recover(f.host),second=await manager.recover(f.host)
  assert.equal(first?.status,"rollback-pending");assert.equal(second?.status,"rollback-pending")
  assert.deepEqual(first?.root,f.pointer);assert.deepEqual(second?.root,f.pointer)
  assert.equal(await readFile(join(f.target,"foreign.txt"),"utf8"),"target user data")
  for(const [path,text] of Object.entries(f.entries))assert.equal(await readFile(join(f.source,path),"utf8"),text)
  assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap,"data-root.json"),"utf8")),f.pointer)
 }finally{await f.cleanup()}
})

test("DR59-11: a committed crash always recovers new authority even if the old source has intact unknown files",async()=>{
 const f=await sandbox({hook(phase){if(phase==="pointer-written")throw new RootMigrationCrash("process lost after pointer")}})
 try{
  await assert.rejects(f.manager.migrate(await directoryIdentity(f.target),f.host),RootMigrationCrash)
  const committed=JSON.parse(await readFile(join(f.bootstrap,"data-root.json"),"utf8"))
  assert.equal(committed.root.path,f.target)
  const manager=new DataRootManager(f.bootstrap,join(f.base,"unrelated")),result=await manager.recover(f.host)
  assert.equal(result?.status,"complete");assert.deepEqual(result?.root,committed)
  assert.deepEqual(await manager.resolve(),{state:"existing",pointer:committed})
  assert.equal(await readFile(join(f.source,"unknown.txt"),"utf8"),"用户外部文件")
  for(const [path,text] of Object.entries(f.entries))assert.equal(await readFile(join(f.target,path),"utf8"),text)
  assert.equal(await manager.recover(f.host),null)
 }finally{await f.cleanup()}
})

test("DR59-12: trusted owned files cannot be read through a replaced database ancestor symlink",async()=>{
 const f=await sandbox()
 try{
  const database=join(f.source,"inbox","database"),foreign=join(f.base,"foreign-database")
  await rename(database,foreign);await symlink(foreign,database)
  await assert.rejects(f.manager.migrate(await directoryIdentity(f.target),f.host),code("SOURCE_UNSAFE"))
  assert.equal(await readFile(join(foreign,"PG_VERSION"),"utf8"),"17")
  assert.deepEqual(await readdir(f.target),[]);assert.deepEqual(f.releases,["old-root"])
 }finally{await f.cleanup()}
})

test("DR59-13: same-inode source edits during the final replacement guard remain pending and are never unlinked",async()=>{
 let armed=false,checks=0,mutated=false
 const f=await sandbox({hook(phase,path){if(phase==="file-cleaned"&&path==="catalog.json")armed=true}})
 const host:MigrationHost={async quiesce(pointer){const lease=await f.host.quiesce(pointer);return{...lease,async assertClosed(){await lease.assertClosed();if(armed&&++checks===2){await writeFile(join(f.source,"drafts.json"),"late changed old-root draft");mutated=true}}}}}
 try{
  const inodeBefore=await stat(join(f.source,"drafts.json"),{bigint:true})
  const result=await f.manager.migrate(await directoryIdentity(f.target),host)
  assert.equal(mutated,true)
  const retained=await readFile(join(f.source,"drafts.json"),"utf8").catch(error=>{if(error.code==="ENOENT")return null;throw error})
  assert.deepEqual({status:result.status,retained},{status:"cleanup-pending",retained:"late changed old-root draft"})
  assert.equal((await stat(join(f.source,"drafts.json"),{bigint:true})).ino,inodeBefore.ino)
  assert.equal(await readFile(join(f.target,"drafts.json"),"utf8"),f.entries["drafts.json"])
 }finally{await f.cleanup()}
})

test("DR59-14: recovery remains exclusive until its closed-root lease release settles",async()=>{
 const f=await sandbox({hook(phase){if(phase==="pointer-written")throw new RootMigrationCrash("process lost")}}),entered=gate(),allow=gate()
 let recovery:Promise<unknown>|undefined
 try{
  await assert.rejects(f.manager.migrate(await directoryIdentity(f.target),f.host),RootMigrationCrash)
  const manager=new DataRootManager(f.bootstrap,f.source),host:MigrationHost={async quiesce(pointer){const lease=await f.host.quiesce(pointer);return{...lease,async release(outcome){entered.resolve();await allow.promise;await lease.release(outcome)}}}}
  recovery=manager.recover(host);await entered.promise
  await assert.rejects(manager.recover(host),code("MIGRATION_BUSY"))
  allow.resolve();await recovery;recovery=undefined
  assert.equal(await manager.recover(f.host),null)
 }finally{allow.resolve();await recovery;await f.cleanup()}
})

test("DR59-15: release failure cannot roll back a committed pointer or leave the manager permanently busy",async()=>{
 const f=await sandbox(),releaseError=new Error("isolated lease release failure")
 try{
  const host:MigrationHost={async quiesce(pointer){const lease=await f.host.quiesce(pointer);return{...lease,async release(){throw releaseError}}}}
  await assert.rejects(f.manager.migrate(await directoryIdentity(f.target),host),error=>error===releaseError)
  const pointer=JSON.parse(await readFile(join(f.bootstrap,"data-root.json"),"utf8"))
  assert.equal(pointer.root.path,f.target);assert.equal(pointer.revision,4)
  assert.equal(await f.manager.recover(f.host),null)
  assert.deepEqual(await f.manager.resolve(),{state:"existing",pointer})
  for(const [path,text] of Object.entries(f.entries))assert.equal(await readFile(join(f.target,path),"utf8"),text)
 }finally{await f.cleanup()}
})
