import {_electron as electron} from 'playwright'
import {expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {createHash} from 'node:crypto'
import {mkdtemp,rm,writeFile,readFile,readdir,realpath,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'

// Development-only, entirely isolated local model responses. The real original
// composer, chat handler, tools, main RPC, worker, schema and filesystem run.
const require=createRequire(import.meta.url),temporary=await realpath(await mkdtemp(join(tmpdir(),'xaanink-native-chat-transfer-'))),root=join(temporary,'data'),chosen=join(temporary,'chosen-work'),cancelled=join(temporary,'cancelled-work')
const base='docs/evidence/implementation-34',evidence=await mkdtemp(join(base,'native-attempt-')),startedAt=new Date().toISOString(),checks=[],errors=[],nativeLog=[],requests=[]
let app,page,passed=false,phase='cancel',step=0,port
const text='原生目录验收结束，会话和规划数据已核对。'
function reply(response,body,tool){
 const header={id:'chatcmpl-local-fixture',object:'chat.completion.chunk',created:1,model:'local-fixture-text'}
 if(body.stream){
  response.writeHead(200,{'content-type':'text/event-stream'})
  const chunk=(delta,finish_reason=null,usage)=>response.write('data: '+JSON.stringify({...header,choices:[{index:0,delta,finish_reason}],...(usage?{usage}:{})})+'\n\n')
  chunk({role:'assistant',content:''})
  if(tool)chunk({tool_calls:[{index:0,id:`native-${phase}-${step}`,type:'function',function:{name:tool.name,arguments:JSON.stringify(tool.input)}}]})
  else chunk({content:text})
  chunk({},tool?'tool_calls':'stop',{prompt_tokens:32,completion_tokens:16,total_tokens:48})
  response.end('data: [DONE]\n\n')
 }else{
  response.writeHead(200,{'content-type':'application/json'})
  response.end(JSON.stringify({...header,object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:'目录授权验收会话'},finish_reason:'stop'}],usage:{prompt_tokens:8,completion_tokens:4,total_tokens:12}}))
 }
}
const server=createServer(async(request,response)=>{
 try{
  const chunks=[];for await(const chunk of request)chunks.push(chunk)
  const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{}
  const tools=(body.tools??[]).map(tool=>tool.function?.name)
  requests.push({path:request.url,authorization:request.headers.authorization,phase,tools,stream:body.stream===true})
  assert.equal(request.url,'/v1/chat/completions')
  assert.equal(request.headers.authorization,'Bearer public-local-chat-fixture-key')
  let tool
  if(body.stream&&tools.length){
   if(step===0){assert.ok(tools.includes('startNovelFromChat'));tool={name:'startNovelFromChat',input:{title:phase==='cancel'?'取消目录验收作品':'原生目录验收作品',premise:'主角在故乡失踪后寻找真相'}}}
   else if(phase==='create'&&step===1){assert.ok(tools.includes('getNovelPlanning'));assert.equal(tools.includes('startNovelFromChat'),false);tool={name:'getNovelPlanning',input:{includeSchema:false}}}
   step++
  }
  reply(response,body,tool)
 }catch(error){errors.push(`local fixture: ${String(error)}`);response.writeHead(500,{'content-type':'application/json'});response.end(JSON.stringify({error:{message:'isolated fixture failure'}}))}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port
async function launch(){
 app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],env:{...process.env,XAANINK_TEST_ROOT:root},timeout:60000})
 app.process().stderr.on('data',chunk=>nativeLog.push(String(chunk)))
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message))
 await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:60000})
}
async function send(prompt){await page.getByRole('textbox',{name:'消息输入框',exact:true}).fill(prompt);await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByText(text,{exact:true})).toBeVisible({timeout:120000});await expect(page.getByRole('button',{name:'停止生成',exact:true})).not.toBeVisible({timeout:60000})}
async function selectModel(){await page.getByRole('button',{name:'选择模型与思考强度',exact:true}).click();await page.getByRole('menuitem').filter({hasText:'本机文本模型'}).click()}
async function list(){return page.evaluate(async()=>{const response=await fetch('/api/chat/conversations');assertResponse(response);return(await response.json()).conversations;function assertResponse(response){if(!response.ok)throw Error('conversation list failed')}})}
try{
 assert.equal(process.platform,'darwin');await mkdir(chosen);await mkdir(cancelled)
 const inputs=[]
 for(const path of ['dist/main/index.cjs','dist/service/index.cjs','dist/preload/index.cjs','out/index.html','desktop/main/index.ts','desktop/main/conversation-directory-authorizations.ts','desktop/service/conversation-runtime.ts','desktop/service/conversation-task-runtime.ts','desktop/service/conversation-transfer.ts','desktop/service/conversation-ledger.ts','desktop/service/workspaces.ts'])inputs.push({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})
 await writeFile(join(evidence,'build-inputs.json'),JSON.stringify({startedAt,inputs},null,2)+'\n')
 execFileSync(process.execPath,['--import','tsx','scripts/seed-electron-fixture.ts',temporary],{encoding:'utf8'})
 await launch()
 await page.getByRole('button',{name:'账号菜单'}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'模型',exact:true}).click();await page.getByRole('button',{name:'添加文本模型',exact:true}).click()
 const model=page.getByRole('dialog',{name:'配置模型',exact:true})
 await model.getByLabel('供应商',{exact:true}).click();await page.getByLabel('搜索供应商',{exact:true}).fill('自定义');await page.getByRole('option').filter({hasText:'自定义供应商'}).click()
 await model.getByRole('textbox',{name:'供应商名称',exact:true}).fill('本机文本夹具');await model.getByRole('combobox',{name:'协议',exact:true}).selectOption('openai');await model.getByRole('textbox',{name:'展示名称',exact:true}).fill('本机文本模型');await model.getByRole('textbox',{name:'Base URL',exact:true}).fill(`http://127.0.0.1:${port}/v1`);await model.getByRole('textbox',{name:'模型 ID',exact:true}).fill('local-fixture-text');await model.getByLabel('API Key',{exact:true}).fill('public-local-chat-fixture-key');await model.getByText('高级配置',{exact:true}).click();await model.getByRole('textbox',{name:'上下文上限',exact:true}).fill('1M');await model.getByRole('button',{name:'保存模型',exact:true}).click();await expect(model).not.toBeVisible();await page.getByRole('button',{name:'关闭设置',exact:true}).click()
 await page.getByRole('button',{name:'创建对话',exact:true}).click();await selectModel()
 await app.evaluate(({dialog},values)=>{
  globalThis.chatTransferSmoke={selections:[]}
  dialog.showOpenDialog=async(_window,options)=>{
   if(!options.title.startsWith('为《')||JSON.stringify(options.properties)!==JSON.stringify(['openDirectory','createDirectory']))throw Error('unexpected creation picker')
   globalThis.chatTransferSmoke.selections.push(options.title)
   return globalThis.chatTransferSmoke.selections.length===1?{canceled:true,filePaths:[]}:{canceled:false,filePaths:[values.chosen]}
  }
 },{chosen})
 const before=JSON.parse(await readFile(join(root,'catalog.json'),'utf8'))
 await send('原生目录验收：已确认故事核心、主角和书名「取消目录验收作品」，请创建作品。')
 assert.deepEqual(JSON.parse(await readFile(join(root,'catalog.json'),'utf8')),before);assert.deepEqual(await readdir(cancelled),[]);assert.deepEqual(await readdir(chosen),[])
 const cancelledConversation=(await list()).find(row=>row.novelId===null);assert.ok(cancelledConversation)
 const cancelledDetail=await page.evaluate(async id=>(await(await fetch(`/api/chat/conversations/${id}`)).json()),cancelledConversation.id)
 assert.ok(cancelledDetail.messages.some(message=>message.role==='USER'&&message.content.includes('取消目录验收作品')))
 checks.push('original composer and local model invoke the real original start tool; controlled native cancellation leaves catalog/selected empty directory unchanged and keeps the inbox conversation')
 await page.screenshot({path:join(evidence,'cancelled.png')})
 phase='create';step=0
 await page.getByRole('button',{name:'创建对话',exact:true}).click();await selectModel();await send('原生目录验收：已确认故事核心、主角和书名「原生目录验收作品」，请创建作品并核对规划。')
 const catalog=JSON.parse(await readFile(join(root,'catalog.json'),'utf8')).value,created=catalog.find(row=>row.path===chosen);assert.ok(created);assert.equal(catalog.length,before.value.length+1)
 const manifest=JSON.parse(await readFile(join(chosen,'xaanink-work.json'),'utf8'));assert.equal(manifest.phase,'ready');assert.equal(manifest.novelId,created.novelId)
 const conversations=await list(),moved=conversations.find(row=>row.novelId===created.novelId);assert.ok(moved);assert.ok(conversations.some(row=>row.id===cancelledConversation.id&&row.novelId===null))
 const detail=await page.evaluate(async id=>(await(await fetch(`/api/chat/conversations/${id}`)).json()),moved.id)
 assert.ok(detail.messages.some(message=>message.role==='USER'&&message.content.includes('原生目录验收作品')));assert.ok(detail.messages.some(message=>message.role==='ASSISTANT'&&message.content.includes(text)))
 const turn=detail.turnState;assert.ok(turn);assert.equal(turn.turn.status,'succeeded');assert.equal(turn.attempts.at(-1).status,'succeeded')
 const toolNames=detail.messages.flatMap(message=>(Array.isArray(message.toolCalls)?message.toolCalls:[]).map(tool=>tool.toolName??tool.name));assert.ok(toolNames.includes('startNovelFromChat'));assert.ok(toolNames.includes('getNovelPlanning'))
 assert.equal(await app.evaluate(()=>globalThis.chatTransferSmoke.selections.length),2)
 checks.push('real main/worker shared admission creates exactly one chosen original-schema work, transfers the live turn and audit, continues getNovelPlanning in the same attempt, and lists the cancelled inbox conversation separately')
 await page.screenshot({path:join(evidence,'created.png')})
 const requestCount=requests.length
 await page.getByRole('textbox',{name:'消息输入框',exact:true}).fill('冷启动保留的未提交输入')
 await app.close();app=null;await launch()
 const reopened=await list();assert.equal(reopened.filter(row=>row.id===moved.id&&row.novelId===created.novelId).length,1)
 const reread=await page.evaluate(async id=>(await(await fetch(`/api/chat/conversations/${id}`)).json()),moved.id)
 assert.deepEqual(reread.messages,detail.messages);assert.equal(requests.length,requestCount)
 assert.equal(JSON.parse(await readFile(join(root,'catalog.json'),'utf8')).value.filter(row=>row.requestId===created.requestId).length,1)
 assert.ok((await readFile(join(root,'drafts.json'),'utf8')).includes('冷启动保留的未提交输入'))
 checks.push('actual old Electron process exit and fresh launch preserve authority, exact messages, one idempotent work, and unsent composer draft without model/tool replay')
 await page.screenshot({path:join(evidence,'reopened.png')});assert.deepEqual(errors,[])
 await writeFile(join(evidence,'native-conversation-transfer.json'),JSON.stringify({scope:'development actual macOS arm64 Electron/original Web chat UI/main-worker/private admission/original schema/filesystem; local HTTP fixture model and controlled native picker, no real provider/physical picker/Windows/formal531 acceptance',startedAt,completedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,passed:true,checks,errors,requests:requests.map(({path,phase,tools,stream})=>({path,phase,tools,stream}))},null,2)+'\n');passed=true;console.log('Native conversation creation and transfer passed:',evidence)
}catch(error){await writeFile(join(evidence,'failure.json'),JSON.stringify({startedAt,checks,errors,nativeLog,error:String(error)},null,2)+'\n');try{await page?.screenshot({path:join(evidence,'failure.png')})}catch{};throw error}
finally{
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
 if(app){const timer=setTimeout(()=>app?.process().kill('SIGKILL'),5000);try{await app.close().catch(()=>{})}finally{clearTimeout(timer)}}
 if(passed){await rm(temporary,{recursive:true,force:true});await rm(root+'-bootstrap',{recursive:true,force:true})}else console.log('Retained isolated conversation fixture:',temporary)
}
