import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdtemp,mkdir,readFile,readdir,writeFile,rename,symlink,link,rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import sharp from "sharp"
import {WorkspaceAssets} from "../../desktop/service/workspace-assets"
const png=()=>sharp({create:{width:3,height:2,channels:3,background:"#675a42"}}).png().toBuffer()
async function rig(){const root=await mkdtemp(join(tmpdir(),"xuanxiang-assets-"));return{root,assets:new WorkspaceAssets(root),cleanup:()=>rm(root,{recursive:true,force:true})}}
test("real decoded images are durable immutable files in the owned work directory",async()=>{
 const r=await rig();try{const bytes=await png(),image=await r.assets.save(bytes,"image/png");assert.match(image.filename,/^[a-f0-9-]{36}\.png$/);assert.equal(image.mime,"image/png");assert.deepEqual(await readFile(join(r.root,"assets",image.filename)),bytes);assert.deepEqual(await r.assets.read(image.filename),{bytes,mime:"image/png"});assert.notEqual((await r.assets.save(bytes)).id,image.id)}finally{await r.cleanup()}
})
test("invalid, oversized and MIME-mismatched input cannot create an asset",async()=>{
 const r=await rig();try{for(const bytes of [Buffer.from('<svg onload="evil"/>'),Buffer.alloc(0),Buffer.alloc(10*1024*1024+1)])await assert.rejects(r.assets.save(bytes),/图片/);await assert.rejects(r.assets.save(await png(),"image/jpeg"),/图片/);assert.deepEqual(await readdir(r.root),[])}finally{await r.cleanup()}
})
test("only the current instance's unchanged newly-created file can be rolled back",async()=>{
 const r=await rig();try{const image=await r.assets.save(await png());await assert.rejects(new WorkspaceAssets(r.root).removeCreated(image.filename),/归属/);assert.equal((await r.assets.read(image.filename)).mime,"image/png");await r.assets.removeCreated(image.filename);assert.deepEqual(await readdir(join(r.root,"assets")),[])}finally{await r.cleanup()}
})
test("path traversal, symlinks and hardlinks are never read as work images",async()=>{
 const r=await rig();try{const image=await r.assets.save(await png()),target=join(r.root,"author.png");await writeFile(target,await png());for(const bad of ['../author.png','/private/image.png',image.filename+'?x','not-an-id.png'])await assert.rejects(r.assets.read(bad));await rm(join(r.root,"assets",image.filename));await symlink(target,join(r.root,"assets",image.filename));await assert.rejects(r.assets.read(image.filename));await rm(join(r.root,"assets",image.filename));await link(target,join(r.root,"assets",image.filename));await assert.rejects(r.assets.read(image.filename));assert.deepEqual(await readFile(target),await png())}finally{await r.cleanup()}
})
test("a replaced assets directory blocks a late write and never writes outside the work",async()=>{
 const r=await rig(),external=await mkdtemp(join(tmpdir(),"xuanxiang-assets-external-"));try{const assets=new WorkspaceAssets(r.root,{beforeWrite:async()=>{await rename(join(r.root,"assets"),join(r.root,"assets-old"));await symlink(external,join(r.root,"assets"))}});await assert.rejects(assets.save(await png()),/目录|图片/);assert.deepEqual(await readdir(external),[])}finally{await r.cleanup();await rm(external,{recursive:true,force:true})}
})
test("a failed directory sync cannot acknowledge a usable image receipt",async()=>{
 const r=await rig();try{const assets=new WorkspaceAssets(r.root,{beforeDirectorySync:async()=>{throw Error("isolated sync failure")}});await assert.rejects(assets.save(await png()),/sync/);const files=await readdir(join(r.root,"assets"));assert.equal(files.length,1,"uncertain new file is retained; never delete author data on uncertain durability");assert.deepEqual(await readFile(join(r.root,"assets",files[0])),await png())}finally{await r.cleanup()}
})
test("rollback refuses a file replaced by another author operation",async()=>{
 const r=await rig();try{const image=await r.assets.save(await png()),path=join(r.root,"assets",image.filename);await writeFile(path,"replacement author data");await assert.rejects(r.assets.removeCreated(image.filename),/变化|归属/);assert.equal(await readFile(path,"utf8"),"replacement author data")}finally{await r.cleanup()}
})
