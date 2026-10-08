import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdtemp,mkdir,writeFile,rm,realpath,symlink,link,readFile,readdir} from "node:fs/promises"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {randomUUID} from "node:crypto"
import {collectClosedRootFiles} from "../../desktop/main/owned-root-files"
import {directoryIdentity} from "../../desktop/core/root-ownership"

async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),"xuanxiang-owned-root-")))
 const put=async(path:string,value="owned")=>{await mkdir(join(root,path,".."),{recursive:true});await writeFile(join(root,path),value)}
 await put("xuanxiang-app.json",JSON.stringify({schemaVersion:1,app:"Xuanxiangxiezuo-Desktop",id:randomUUID(),phase:"ready",inboxReady:false}))
 await put("catalog.json",JSON.stringify({schemaVersion:1,revision:0,value:[]}))
 return{root,put,identity:await directoryIdentity(root),close:()=>rm(root,{recursive:true,force:true})}
}
test("inventory enumerates only recognized owned files and preserves unknown content in managed directories",async()=>{
 const f=await fixture();try{
  const owned=["state.json","drafts.json",`assets/global/${randomUUID()}.png`,"session/Preferences","session/Local Storage/leveldb/000003.log","session/Code Cache/js/0123456789abcdef_0","inbox/database/PG_VERSION","inbox/database/base/5/12345_fsm.1","inbox/database/global/pg_control"]
  const foreign=["author.md","session/author.md","session/Local Storage/leveldb/notes.txt","inbox/database/notes.txt","assets/global/portrait.png"]
  for(const name of [...owned,...foreign])await f.put(name)
  let guards=0;const result=await collectClosedRootFiles(f.identity,()=>{guards++})
  assert.deepEqual(result.files,["xuanxiang-app.json","catalog.json",...owned].sort());assert(guards>2)
  assert(result.bytes>0);for(const name of foreign){assert(!result.files.includes(name));assert.equal(await readFile(join(f.root,name),"utf8"),"owned")}
 }finally{await f.close()}
})
test("inventory excludes a catalogued work even when it sits inside a recognized session subtree",async()=>{
 const f=await fixture();try{
  await f.put("session/Local Storage/leveldb/000003.log","author-work")
  await f.put("catalog.json",JSON.stringify({schemaVersion:1,revision:1,value:[{path:join(f.root,"session/Local Storage")}]}))
  const result=await collectClosedRootFiles(f.identity,()=>{})
  assert(!result.files.includes("session/Local Storage/leveldb/000003.log"));assert(result.preserved.includes("session/Local Storage"))
 }finally{await f.close()}
})
test("recognized symlinks and hardlinks reject without following, while an unrelated symlink is preserved",async()=>{
 for(const variant of ["symlink","hardlink","unrelated"]){const f=await fixture();try{
  await f.put("author.md","outside");await mkdir(join(f.root,"session"))
  const target=join(f.root,"session",variant==="unrelated"?"unknown":"Preferences")
  if(variant==="hardlink")await link(join(f.root,"author.md"),target);else await symlink(join(f.root,"author.md"),target)
  if(variant==="unrelated")assert(!(await collectClosedRootFiles(f.identity,()=>{})).files.includes("session/unknown"))
  else await assert.rejects(collectClosedRootFiles(f.identity,()=>{}),/unsafe|SOURCE_UNSAFE/)
  assert.equal(await readFile(join(f.root,"author.md"),"utf8"),"outside")
 }finally{await f.close()}}
})
test("a live write lease or uncleared application inbox lock blocks inventory",async()=>{
 const f=await fixture();try{
  await assert.rejects(collectClosedRootFiles(f.identity,()=>{throw Error("SOURCE_NOT_CLOSED")}),/SOURCE_NOT_CLOSED/)
  await f.put("inbox/.xuanxiang-lock","locked")
  await assert.rejects(collectClosedRootFiles(f.identity,()=>{}),/SOURCE_NOT_CLOSED/)
  assert.equal(await readFile(join(f.root,"inbox/.xuanxiang-lock"),"utf8"),"locked")
 }finally{await f.close()}
})
test("missing required marker/catalog and invalid catalog paths never become a migration inventory",async()=>{
 for(const variant of ["missing","relative"]){const f=await fixture();try{
  if(variant==="missing")await rm(join(f.root,"catalog.json"));else await f.put("catalog.json",JSON.stringify({schemaVersion:1,revision:1,value:[{path:"relative/author"}]}))
  await assert.rejects(collectClosedRootFiles(f.identity,()=>{}))
  assert((await readdir(f.root)).includes("xuanxiang-app.json"))
 }finally{await f.close()}}
})
test("completed local inbox upgrade snapshots are included while unrelated backup files remain",async()=>{
 const f=await fixture();try{
  const snapshot=`inbox/snapshots/before-upgrade-1791412345678-${randomUUID()}.tar.gz`
  await f.put(snapshot,"archive");await f.put(snapshot+".json",JSON.stringify({pglite:"0.5.8",migrations:[]}));await f.put("inbox/snapshots/author-backup.tar.gz","author")
  const result=await collectClosedRootFiles(f.identity,()=>{})
  assert(result.files.includes(snapshot));assert(result.files.includes(snapshot+".json"));assert(!result.files.includes("inbox/snapshots/author-backup.tar.gz"))
 }finally{await f.close()}
})
test("Electron 44 No_Vary_Search is a managed cache directory, not a regular file",async()=>{
 const f=await fixture();try{
  await mkdir(join(f.root,"session/Cache/No_Vary_Search"),{recursive:true})
  const result=await collectClosedRootFiles(f.identity,()=>{})
  assert(result.directories.includes("session/Cache/No_Vary_Search"));assert(!result.files.includes("session/Cache/No_Vary_Search"))
 }finally{await f.close()}
})
