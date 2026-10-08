import assert from "node:assert/strict"
import {test} from "node:test"
import {randomUUID} from "node:crypto"
import {requestSchema,type DesktopBridge,type LocalRequest} from "../../desktop/shared/ipc"
import {localImageRequest} from "../../desktop/shared/local-images"
import {installDesktopTransport} from "../../src/lib/desktop/transport"

test("local images accept only immutable work or owned scene addresses",()=>{
 const work=randomUUID(),file=randomUUID(),url=`/_desktop/assets/${work}/${file}.png`
 assert.deepEqual(localImageRequest(url),{kind:"work",workspaceId:work,filename:`${file}.png`})
 const scene=`/api/novels/novel_1/scenes/scene-2/images/${file}/asset`
 assert.deepEqual(localImageRequest(scene),{kind:"scene",path:scene})
 for(const path of [url+"?x=1",url+"#hash",url.replace(".png",".svg"),url.replace(file,".."),url.replace(work,"inbox"),url.replace(file,"%2e%2e"),"/api/novels/x/cover/images","file:///tmp/photo.png","/_desktop/assets/../../state.json",scene.replace("scene-2","..")])assert.equal(localImageRequest(path),null,path)
})

test("IPC permits original 10MiB image uploads with bounded multipart overhead, while ordinary requests remain limited",()=>{
 const base={version:1,id:randomUUID(),path:"/api/novels/local-book/cover/images",method:"POST",headers:{"Content-Type":"multipart/form-data; boundary=fixture"}}
 const imageBody=new Uint8Array(10*1024*1024+1024)
 assert.equal(requestSchema.safeParse({...base,body:imageBody}).success,true)
 for(const change of [{path:"/api/chat"},{path:base.path+"/unknown"},{method:"PUT"},{headers:{"content-type":"application/json"}},{body:new Uint8Array(10*1024*1024+128*1024+1)}])assert.equal(requestSchema.safeParse({...base,body:imageBody,...change}).success,false)
 for(const suffix of ["characters/person/images","items/item/images","scenes/scene/images"])assert.equal(requestSchema.safeParse({...base,path:`/api/novels/book/${suffix}`,body:imageBody}).success,true)
 assert.equal(requestSchema.safeParse({...base,path:"/api/chat",headers:{},body:new Uint8Array(8*1024*1024)}).success,true)
 assert.equal(requestSchema.safeParse({...base,body:[-1,256]}).success,false)
})

test("actual renderer transport preserves a large image as binary and rejects oversized ordinary requests before IPC",async()=>{
 let forwarded:LocalRequest|undefined
 const fakeWindow={fetch:globalThis.fetch,addEventListener(){}}
 Object.assign(globalThis,{window:fakeWindow,location:new URL("https://local.invalid/")})
 const bridge={subscribe:()=>()=>{},request:async(input:LocalRequest)=>{forwarded=input;throw Error("fixture IPC reached")},cancelRequest:async()=>{}} as unknown as DesktopBridge
 installDesktopTransport(bridge)
 const payload=new Uint8Array(9*1024*1024);payload[0]=23;payload[payload.length-1]=41
 const form=new FormData();form.append("file",new File([payload],"picture.png",{type:"image/png"}))
 await assert.rejects(fakeWindow.fetch("https://local.invalid/api/novels/book/cover/images",{method:"POST",body:form}),/fixture IPC reached/)
 assert.ok(forwarded);assert.ok(forwarded.body instanceof Uint8Array);assert.ok(forwarded.body.length>payload.length)
 const decoded=await new Request("https://local.invalid/",{method:"POST",headers:forwarded.headers,body:forwarded.body}).formData()
 assert.deepEqual(new Uint8Array(await (decoded.get("file") as File).arrayBuffer()),payload)
 forwarded=undefined
 await assert.rejects(fakeWindow.fetch("https://local.invalid/api/chat",{method:"POST",body:payload}),/正文过大/)
 assert.equal(forwarded,undefined)
})
