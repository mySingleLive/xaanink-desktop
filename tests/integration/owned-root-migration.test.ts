import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdtemp,mkdir,writeFile,realpath,readFile,rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {randomUUID} from "node:crypto"
import {PGlite} from "@electric-sql/pglite"
import {DataRootManager} from "../../desktop/core/data-root"
import {directoryIdentity} from "../../desktop/core/root-ownership"
import {collectClosedRootFiles} from "../../desktop/main/owned-root-files"
test("recognized closed PGlite files plus actual empty engine directories migrate and reopen without reconstructing layout",{timeout:60000},async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),"xuanxiang-owned-pglite-"))),root=join(base,"root"),target=join(base,"target"),boot=join(base,"boot")
 let engine:PGlite|undefined
 try{
  for(const p of [join(root,"inbox"),target,boot])await mkdir(p,{recursive:true})
  engine=await PGlite.create({dataDir:join(root,"inbox/database"),relaxedDurability:false})
  await engine.exec("CREATE TABLE migration_proof(id integer PRIMARY KEY, text_value text);INSERT INTO migration_proof VALUES(1,'未批准的本地稿');CHECKPOINT;")
  await engine.close();engine=undefined
  await writeFile(join(root,"xuanxiang-app.json"),JSON.stringify({schemaVersion:1,app:"Xuanxiangxiezuo-Desktop",id:randomUUID(),phase:"ready",inboxReady:true}))
  await writeFile(join(root,"catalog.json"),JSON.stringify({schemaVersion:1,revision:0,value:[]}))
  await writeFile(join(root,"inbox/database/author-notes.txt"),"保留在旧目录")
  const proof=await directoryIdentity(root),manager=new DataRootManager(boot,root);await manager.adopt(proof)
  const closed=()=>{assert.equal(engine,undefined,"the engine must really be closed before inventory/copy")}
  const inventory=await collectClosedRootFiles(proof,closed)
  assert.deepEqual(inventory.preserved,["inbox/database/author-notes.txt"])
  assert(inventory.directories.includes("inbox/database/pg_tblspc"));assert(inventory.directories.includes("inbox/database/pg_notify"))
  assert(inventory.files.length>500)
  const result=await manager.migrate(await directoryIdentity(target),{quiesce:async()=>({source:proof,ownedFiles:inventory.files,ownedDirectories:inventory.directories,assertClosed:closed,release(){}})})
  assert.equal(result.status,"complete");assert.equal(await readFile(join(root,"inbox/database/author-notes.txt"),"utf8"),"保留在旧目录")
  engine=await PGlite.create({dataDir:join(target,"inbox/database"),relaxedDurability:false})
  assert.deepEqual((await engine.query("SELECT * FROM migration_proof")).rows,[{id:1,text_value:"未批准的本地稿"}])
  await engine.exec("INSERT INTO migration_proof VALUES(2,'迁移后保存');");await engine.close();engine=undefined
  engine=await PGlite.create({dataDir:join(target,"inbox/database"),relaxedDurability:false});assert.equal((await engine.query<{n:number}>("SELECT count(*)::int AS n FROM migration_proof")).rows[0].n,2)
 }finally{await engine?.close();await rm(base,{recursive:true,force:true})}
})
