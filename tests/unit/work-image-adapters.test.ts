import assert from "node:assert/strict"
import {test} from "node:test"
import {mkdtemp,mkdir,rm,readdir} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {randomUUID} from "node:crypto"
import sharp from "sharp"
import {runInDatabaseContext} from "../../desktop/service/context"
import {WorkspaceAssets} from "../../desktop/service/workspace-assets"
import {saveCharacterImage,saveNovelCoverImage} from "../../src/lib/ai/image"
import {saveItemImage} from "../../src/lib/services/item-image"
import type {PrismaClient} from "../../src/generated/prisma/client"
test("original character, cover and item entry points store assets under the active work rather than application cwd",async()=>{
 const root=await mkdtemp(join(tmpdir(),"xuanxiang-image-adapters-")),before=process.cwd(),work=join(root,"work"),installation=join(root,"installation"),workspaceId=randomUUID()
 await mkdir(work);await mkdir(installation);process.chdir(installation)
 try{
  const assets=new WorkspaceAssets(work),bytes=await sharp({create:{width:2,height:2,channels:3,background:"#fbf5e8"}}).png().toBuffer()
  await runInDatabaseContext({workspaceId,database:{} as PrismaClient,assets},async()=>{
   for(const write of [()=>saveCharacterImage("character-1","avatar",bytes),()=>saveNovelCoverImage("novel-1",bytes),()=>saveItemImage("item-1",bytes)]){
    const url=await write();assert.match(url,new RegExp(`^/_desktop/assets/${workspaceId}/[a-f0-9-]{36}\\.png$`));assert.deepEqual((await assets.read(url.split("/").at(-1)!)).bytes,bytes)
   }
  })
  assert.deepEqual(await readdir(installation),[]);assert.equal((await readdir(join(work,"assets"))).length,3)
 }finally{process.chdir(before);await rm(root,{recursive:true,force:true})}
})
