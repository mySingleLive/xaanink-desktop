import assert from "node:assert/strict"
import {test} from "node:test"
import {Worker} from "node:worker_threads"
import {randomUUID,randomBytes} from "node:crypto"
import {mkdtemp,mkdir,rm,readdir,readFile} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import sharp from "sharp"
import {RpcPeer} from "../../desktop/service/rpc"
import {DirectoryAuthority} from "../../desktop/main/directory-authority"
import type {LocalResponse} from "../../desktop/shared/ipc"
import {defaultState} from "../../desktop/core/settings"
import {freezeTaskDefaults} from "../../desktop/shared/task-defaults"

test("built worker saves original cover/scene histories into a work and serves exact local bytes after reconnect",{timeout:60000},async()=>{
 await import("../../scripts/build-desktop.mjs")
 const root=await mkdtemp(join(tmpdir(),"xuanxiang-local-images-")),directory=join(root,"author-work")
 const worker=new Worker(join(process.cwd(),"dist/service/index.cjs"),{workerData:{root:join(root,"app"),migrations:join(process.cwd(),"prisma/migrations")}})
 const rpc=new RpcPeer(worker,async method=>{if(method==="model.defaults")return freezeTaskDefaults(defaultState.settings.agent,0);throw Error(`Unexpected external model request ${method}`)})
 worker.on("error",()=>rpc.dispose());worker.on("exit",()=>rpc.dispose())
 async function request(path:string,body?:FormData|Record<string,unknown>){
  const wire=new Request("https://local.invalid"+path,{method:body?"POST":"GET",body:body instanceof FormData?body:body?JSON.stringify(body):undefined,headers:body&&!(body instanceof FormData)?{"content-type":"application/json"}:undefined})
  const id=randomUUID(),response=await rpc.call<LocalResponse>("start",{version:1,id,path,method:wire.method,headers:Object.fromEntries(wire.headers),body:body?new Uint8Array(await wire.arrayBuffer()):undefined})
  const chunks:Uint8Array[]=[]
  for(;;){const frame=await rpc.call<{done:boolean;bytes?:Uint8Array}>("read",id);if(frame.done)break;chunks.push(frame.bytes!)}
  return{status:response.status,data:JSON.parse(Buffer.concat(chunks).toString("utf8"))}
 }
 function upload(bytes:Buffer,kind?:string){const form=new FormData();form.append("file",new File([new Uint8Array(bytes)],"local.png",{type:"image/png"}));if(kind)form.append("kind",kind);return form}
 try{
  await rpc.call("ready");await mkdir(directory)
  const grants=new DirectoryAuthority(),grant=await grants.issue(directory,"create-work","image-fixture")
  const created=await rpc.call<{novel:{id:string}}>("create-work",{selection:await grants.consume(grant.id,"create-work","image-fixture"),input:{title:"本地图片原组件",requestId:"create-image-fixture"}})
  const novel=created.novel.id,small=await sharp({create:{width:3,height:2,channels:3,background:"#cbbba3"}}).png().toBuffer()
  const cover=await request(`/api/novels/${novel}/cover/images`,upload(small));assert.equal(cover.status,200)
  const marker=JSON.parse(await readFile(join(directory,"xaanink-work.json"),"utf8"))
  assert.match(cover.data.url,new RegExp(`^/_desktop/assets/${marker.id}/[a-f0-9-]+\\.png$`))
  assert.deepEqual(Buffer.from((await rpc.call<{bytes:Uint8Array}>("image-asset",cover.data.url)).bytes),small)
  assert.equal((await request(`/api/novels/${novel}/cover/images`)).data.images.length,1)
  const scene=await request(`/api/novels/${novel}/scenes`,{name:"山间小屋"});assert.equal(scene.status,200)
  const scene2=await request(`/api/novels/${novel}/scenes`,{name:"另一场景"})
  const sceneImage=await request(`/api/novels/${novel}/scenes/${scene.data.scene.id}/images`,upload(small,"exterior"));assert.equal(sceneImage.status,200)
  assert.equal(sceneImage.data.applied,true)
  assert.deepEqual(Buffer.from((await rpc.call<{bytes:Uint8Array}>("image-asset",sceneImage.data.url)).bytes),small)
  await assert.rejects(rpc.call("image-asset",sceneImage.data.url.replace(scene.data.scene.id,scene2.data.scene.id)),/图片/)
  await assert.rejects(rpc.call("image-asset",cover.data.url.replace(marker.id,randomUUID())),/作品|目录/)
  for(const invalid of ["/api/admin/prompts",cover.data.url+"?anything",cover.data.url.replace(".png",".svg")])await assert.rejects(rpc.call("image-asset",invalid),/标识/)
  // A real decodable image above the old 8MiB IPC cap exercises the full wire and original upload handler.
  const large=await sharp(randomBytes(1800*1800*3),{raw:{width:1800,height:1800,channels:3}}).png({compressionLevel:0}).toBuffer()
  assert.ok(large.length>8*1024*1024&&large.length<10*1024*1024)
  const second=await request(`/api/novels/${novel}/cover/images`,upload(large));assert.equal(second.status,200)
  assert.deepEqual(Buffer.from((await rpc.call<{bytes:Uint8Array}>("image-asset",second.data.url)).bytes),large)
  assert.equal((await readdir(join(directory,"assets"))).length,3)
  await rpc.call("close")
  assert.deepEqual(Buffer.from((await rpc.call<{bytes:Uint8Array}>("image-asset",sceneImage.data.url)).bytes),small)
  assert.deepEqual((await request(`/api/novels/${novel}/cover/images`)).data.images.map((row:{url:string})=>row.url),[second.data.url,cover.data.url])
 }finally{await rpc.call("close").catch(()=>{});rpc.dispose();await worker.terminate();await rm(root,{recursive:true,force:true})}
})
