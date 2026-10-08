import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp,rm,writeFile,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID,randomBytes} from 'node:crypto'
import sharp from 'sharp'
import {ModelRepository,type ModelDraft} from '../../desktop/main/model-repository'
import {ModelGateway} from '../../desktop/core/model-authorization'
import {ModelService} from '../../desktop/main/model-service'
import {generateMainImage} from '../../desktop/main/image-generation'
import type {PublicModel} from '../../desktop/core/settings'
import {configureModelTransport,generateLocalImage} from '../../desktop/service/models'

test('IG80-01: the total generation deadline also bounds an in-progress image decoder, releasing the service slot before late pixels',async t=>{
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-image80-deadline-'))
 const png=await sharp({create:{width:3,height:3,channels:3,background:'#789'}}).png().toBuffer()
 const entered=Promise.withResolvers<void>(),decode=Promise.withResolvers<sharp.Stats>()
 let repository!:ModelRepository
 const gateway=new ModelGateway({keyFor:(id,revision)=>repository.keyFor(id,revision),fetch:async()=>Response.json({data:[{b64_json:png.toString('base64')}]})})
 repository=new ModelRepository(join(root,'state.json'),{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},gateway)
 const draft:ModelDraft={name:'isolated decoder',provider:'custom',protocol:'openai',modelId:'image-fixture',endpoint:'https://image80.invalid/v1',kind:'IMAGE',enabled:true,contextWindow:0,apiKey:'isolated-not-a-real-key',thinkingLevels:[],defaultThinking:'default'}
 const state=await repository.saveModel(0,draft),model=state.models[0],service=new ModelService(repository,gateway),id=randomUUID()
 t.mock.method(sharp.prototype,'stats',async()=>{entered.resolve();return decode.promise})
 t.mock.timers.enable({apis:['setTimeout']})
 let outcome:Promise<string>|undefined
 try{
  outcome=service.startImage({id,modelId:model.id,authRevision:model.authRevision,prompt:'a single paper cover'}).then(()=>'accepted',(error:Error)=>error.message)
  await entered.promise
  t.mock.timers.tick(180000)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(await Promise.race([outcome,Promise.resolve('still-pending')]),'IMAGE_TIMEOUT')
  assert.equal(service.activeCount,0)
  await assert.rejects(service.read(id),/不可读取/)
 }finally{
  decode.resolve({} as sharp.Stats)
  await outcome
  t.mock.timers.reset();t.mock.restoreAll()
  await service.close();await rm(root,{recursive:true,force:true})
 }
})

test('IG80-05: both Tencent Seedream models reject the official 600-character prompt overflow before sending a generation POST',async()=>{
 const png=await sharp({create:{width:2,height:2,channels:3,background:'#bca'}}).png().toBuffer()
 for(const modelId of ['seedream-image-v5.0-pro','seedream-image-v5.0-lite']){
  let sends=0
  const model:PublicModel={id:randomUUID(),name:'length fixture',provider:'tencent',protocol:'openai',modelId,endpoint:'https://image80.invalid/v1',kind:'IMAGE',enabled:true,contextWindow:0,authRevision:1,keyMask:'••••••••',thinkingLevels:[],defaultThinking:'default'}
  const gateway=new ModelGateway({keyFor:async()=>'isolated-not-a-real-key',fetch:async()=>{sends++;return Response.json({data:[{b64_json:png.toString('base64')}]})}})
  gateway.replace(model);const lease=gateway.begin(model.id,'IMAGE')
  try{
   await assert.rejects(generateMainImage({model,gateway,lease,prompt:'香'.repeat(601)}),/IMAGE_PROMPT_TOO_LONG/)
   assert.equal(sends,0)
   const allowedPrompt='香'.repeat(600),requests:string[]=[]
   // The exact-limit boundary is exercised by a fresh request with unchanged original text.
   const allowedGateway=new ModelGateway({keyFor:async()=>'isolated-not-a-real-key',fetch:async(_url,init)=>{requests.push(JSON.parse(String(init?.body)).prompt);return Response.json({data:[{b64_json:png.toString('base64')}]})}})
   allowedGateway.replace(model);const allowedLease=allowedGateway.begin(model.id,'IMAGE')
   try{await generateMainImage({model,gateway:allowedGateway,lease:allowedLease,prompt:allowedPrompt});assert.deepEqual(requests,[allowedPrompt])}
   finally{allowedGateway.finish(allowedLease)}
  }finally{gateway.finish(lease)}
 }
})

test('IG80-06: Wan T2I rejects each published prompt overflow before POST and preserves the exact permitted boundary',async()=>{
 const png=await sharp({create:{width:2,height:2,channels:3,background:'#cba'}}).png().toBuffer()
 const limits:[string,number][]=[['wan2.6-t2i',2100],['wan2.5-t2i-preview',2000],['wan2.2-t2i-flash',500],['wan2.2-t2i-plus',500],['wanx2.1-t2i-turbo',500],['wanx2.1-t2i-plus',500],['wanx2.0-t2i-turbo',800]]
 for(const [modelId,limit] of limits){
  const model:PublicModel={id:randomUUID(),name:'Wan length fixture',provider:'alibaba',protocol:'openai',modelId,endpoint:'https://image80.invalid/api/v1',kind:'IMAGE',enabled:true,contextWindow:0,authRevision:1,keyMask:'••••••••',thinkingLevels:[],defaultThinking:'default'}
  const prompts:string[]=[];let downloads=0
  const gateway=new ModelGateway({keyFor:async()=>'isolated-not-a-real-key',fetch:async(_url,init)=>{
   if(init?.method==='POST'){
    const body=JSON.parse(String(init.body));prompts.push(body.input.prompt??body.input.messages[0].content[0].text)
    if(modelId!=='wan2.6-t2i')return Response.json({output:{task_id:'isolated-wan-task',task_status:'PENDING'}})
   }
   const output=modelId==='wan2.6-t2i'?{choices:[{finish_reason:'stop',message:{role:'assistant',content:[{image:'https://image80-cdn.invalid/one.png'}]}}]}:{task_id:'isolated-wan-task',task_status:'SUCCEEDED',results:[{url:'https://image80-cdn.invalid/one.png'}],task_metrics:{TOTAL:1,SUCCEEDED:1,FAILED:0}}
   return Response.json({output,usage:{image_count:1}})
  },imageResource:{lookup:async()=>[{address:'8.8.8.8',family:4}],fetch:async()=>{downloads++;return new Response(Uint8Array.from(png),{headers:{'content-type':'image/png'}})}}})
  gateway.replace(model);const lease=gateway.begin(model.id,'IMAGE')
  try{
   await assert.rejects(generateMainImage({model,gateway,lease,prompt:'香'.repeat(limit+1),pollDelay:async()=>{}}),/IMAGE_PROMPT_TOO_LONG/,modelId)
   assert.deepEqual(prompts,[]);assert.equal(downloads,0)
   const allowed='香'.repeat(limit)
   await generateMainImage({model,gateway,lease,prompt:allowed,pollDelay:async()=>{}})
   assert.deepEqual(prompts,[allowed]);assert.equal(downloads,1)
  }finally{gateway.finish(lease)}
 }
})

test('IG80-04: a committed Key change between IPC image frames rejects the worker collection instead of saving a partial picture',async()=>{
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-image80-frame-'))
 const png=await sharp(randomBytes(160*200*3),{raw:{width:160,height:200,channels:3}}).png().toBuffer()
 assert.ok(png.byteLength>65536)
 let repository!:ModelRepository
 const gateway=new ModelGateway({keyFor:(id,revision)=>repository.keyFor(id,revision),fetch:async()=>Response.json({data:[{b64_json:png.toString('base64')}]})})
 repository=new ModelRepository(join(root,'state.json'),{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},gateway)
 const draft:ModelDraft={name:'frame fixture',provider:'custom',protocol:'openai',modelId:'image-fixture',endpoint:'https://image80.invalid/v1',kind:'IMAGE',enabled:true,contextWindow:0,apiKey:'isolated-first-key',thinkingLevels:[],defaultThinking:'default'}
 const state=await repository.saveModel(0,draft),model=state.models[0],service=new ModelService(repository,gateway)
 let reads=0,saved=false
 configureModelTransport(async<T>(method:string,value?:unknown):Promise<T>=>{
  let result:unknown
  if(method==='model.image.start')result=await service.startImage(value)
  else if(method==='model.read'){
   result=await service.read(value)
   if(++reads===1)await repository.saveModel(state.revision,{...draft,id:model.id,apiKey:'isolated-replacement-key'})
  }else if(method==='model.cancel')result=await service.cancel(value)
  else throw Error('Unexpected method '+method)
  return result as T
 })
 try{
  const target=join(root,'should-not-save.png')
  await assert.rejects(generateLocalImage(model,'one full prompt').then(async bytes=>{saved=true;await writeFile(target,bytes)}),/AUTHORIZATION_REVOKED/)
  assert.equal(saved,false);assert.equal(reads,1)
  await assert.rejects(access(target),{code:'ENOENT'})
  assert.equal(service.activeCount,0)
 }finally{
  await service.close();await rm(root,{recursive:true,force:true})
  configureModelTransport(async()=>{throw Error('No active image80 bridge')})
 }
})

test('IG80-02: cancelling while a valid image decoder is pending does not keep close waiting or expose late image bytes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'xuanxiang-image80-cancel-'))
 const png=await sharp({create:{width:2,height:3,channels:3,background:'#abc'}}).png().toBuffer()
 const entered=Promise.withResolvers<void>(),decode=Promise.withResolvers<sharp.Stats>()
 let repository!:ModelRepository
 const gateway=new ModelGateway({keyFor:(id,revision)=>repository.keyFor(id,revision),fetch:async()=>Response.json({data:[{b64_json:png.toString('base64')}]})})
 repository=new ModelRepository(join(root,'state.json'),{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},gateway)
 const draft:ModelDraft={name:'cancel fixture',provider:'custom',protocol:'openai',modelId:'image-fixture',endpoint:'https://image80.invalid/v1',kind:'IMAGE',enabled:true,contextWindow:0,apiKey:'isolated-not-a-real-key',thinkingLevels:[],defaultThinking:'default'}
 const state=await repository.saveModel(0,draft),model=state.models[0],service=new ModelService(repository,gateway),id=randomUUID()
 t.mock.method(sharp.prototype,'stats',async()=>{entered.resolve();return decode.promise})
 let work:Promise<string>|undefined,closing:Promise<string>|undefined
 try{
  work=service.startImage({id,modelId:model.id,authRevision:model.authRevision,prompt:'one complete story-specific prompt'}).then(()=>'accepted',(error:Error)=>error.message)
  await entered.promise
  closing=service.close().then(()=>'closed')
  await new Promise(resolve=>setImmediate(resolve))
  assert.match(await Promise.race([work,Promise.resolve('still-pending')]),/AUTHORIZATION_REVOKED|IMAGE_CANCELLED/)
  assert.equal(await Promise.race([closing,Promise.resolve('still-closing')]),'closed')
  assert.equal(service.activeCount,0)
  decode.resolve({} as sharp.Stats);await new Promise(resolve=>setImmediate(resolve))
  await assert.rejects(service.read(id),/不可读取/)
 }finally{
  decode.resolve({} as sharp.Stats);await work;await closing
  t.mock.restoreAll();await service.close();await rm(root,{recursive:true,force:true})
 }
})

test('IG80-03: cancellation during a one-time async task POST forbids polling or resource reads when its headers arrive late',async()=>{
 const response=Promise.withResolvers<Response>(),entered=Promise.withResolvers<void>(),abort=new AbortController()
 let posts=0,gets=0,downloads=0
 const model:PublicModel={id:randomUUID(),name:'async fixture',provider:'alibaba',protocol:'openai',modelId:'wan2.7-image',endpoint:'https://image80.invalid/api/v1',kind:'IMAGE',enabled:true,contextWindow:0,authRevision:1,keyMask:'••••••••',thinkingLevels:[],defaultThinking:'default'}
 const gateway=new ModelGateway({keyFor:async()=>'isolated-not-a-real-key',fetch:async(_url,init)=>{
  if(init?.method==='POST'){posts++;entered.resolve();return response.promise}
  gets++;throw Error('No late polling permitted')
 },imageResource:{lookup:async()=>[{address:'8.8.8.8',family:4}],fetch:async()=>{downloads++;throw Error('No late asset read permitted')}}})
 gateway.replace(model);const lease=gateway.begin(model.id,'IMAGE')
 try{
  const work=generateMainImage({model,gateway,lease,prompt:'unchanged original prompt',signal:abort.signal,pollDelay:async()=>{}})
  await entered.promise;abort.abort()
  await assert.rejects(work,/IMAGE_CANCELLED/)
  response.resolve(Response.json({output:{task_id:'never-polled',task_status:'PENDING'}}));await new Promise(resolve=>setImmediate(resolve))
  assert.equal(posts,1);assert.equal(gets,0);assert.equal(downloads,0)
 }finally{response.resolve(Response.json({}));gateway.finish(lease)}
})
