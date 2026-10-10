import {_electron as electron} from 'playwright'
import {expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,basename} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const temporary=await mkdtemp(join(tmpdir(),'xaanink-onboarding-'))
const evidence=resolve('docs/evidence/onboarding'),checks=[],errors=[]
const startedAt=new Date().toISOString()
assert.ok(process.argv.slice(2).every(arg=>arg==='--packaged')&&process.argv.length<=3)
const packaged=process.argv.includes('--packaged'),packageRoot=packaged?resolve('release/win-unpacked/resources/app'):resolve('.')
const capture=name=>join(evidence,(packaged?'package-':'')+name)
let app,page
const packageStartupListeners=[]
const guard=join(temporary,'offline-guard.cjs'),harness=join(temporary,'offline-main.cjs'),entry=join(temporary,'offline-entry.cjs'),networkReport=join(temporary,'offline-events.txt')
await writeFile(guard,`const fs=require('node:fs'),net=require('node:net');
const record=value=>fs.appendFileSync(process.env.XAANINK_OFFLINE_GUARD_REPORT,value+'\\n');record('guard-loaded');
const denied=()=>{record('network-denied');throw Error('Offline verification forbids network access')};
const originalFetch=globalThis.fetch;globalThis.fetch=function(input,...args){const url=typeof input==='string'||input instanceof URL?String(input):input?.url;if(/^https?:/i.test(url??''))return denied();return originalFetch.call(this,input,...args)};
for(const name of ['node:http','node:https']){const api=require(name);api.request=denied;api.get=denied}
for(const [prototype,name] of [[net.Server.prototype,'listen'],[net.Socket.prototype,'connect']]){const original=prototype[name];prototype[name]=function(...args){const normalized=Array.isArray(args[0])?args[0]:net._normalizeArgs(args);if(!normalized[0]?.path)return denied();return original.apply(this,args)}};
`)
const preflight=join(temporary,'offline-preflight.txt')
const localSocket=process.platform==='win32'?`\\\\.\\pipe\\${basename(temporary)}`:join(temporary,'allowed-local.sock')
execFileSync(process.execPath,['--require',guard,'-e',`const net=require('node:net'),assert=require('node:assert/strict');for(const args of [[443],['443','example.invalid'],[{port:443,host:'example.invalid'}]])assert.throws(()=>new net.Socket().connect(...args),/Offline verification/);for(const args of [[443],['443'],[{port:443}]])assert.throws(()=>net.createServer().listen(...args),/Offline verification/);const server=net.createServer();server.listen(${JSON.stringify(localSocket)},()=>server.close())`],{env:{...process.env,XAANINK_OFFLINE_GUARD_REPORT:preflight},timeout:10000})
assert.equal((await readFile(preflight,'utf8')).split('\n').filter(line=>line==='network-denied').length,6)
const beforeEntry=`require(${JSON.stringify(guard)});
const workers=require('node:worker_threads'),Worker=workers.Worker;workers.Worker=class extends Worker{constructor(file,options={}){super(file,{...options,execArgv:[...(options.execArgv??[]),'--require',${JSON.stringify(guard)}]})}};
const {app,session,net}=require('electron'),fs=require('node:fs');const denied=()=>{fs.appendFileSync(process.env.XAANINK_OFFLINE_GUARD_REPORT,'network-denied\\n');throw Error('Offline verification forbids network access')};net.fetch=denied;net.request=denied;
app.whenReady().then(()=>{const requests=session.defaultSession.webRequest,register=requests.onBeforeRequest.bind(requests);requests.onBeforeRequest=(filter,listener)=>{const callback=typeof filter==='function'?filter:listener,wrapped=(request,reply)=>{if(/^https?:/i.test(request.url)){fs.appendFileSync(process.env.XAANINK_OFFLINE_GUARD_REPORT,'network-denied\\n');reply({cancel:true});return}callback(request,reply)};return typeof filter==='function'?register(wrapped):register(filter,wrapped)};requests.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,reply)=>reply({cancel:true}))});
`
await writeFile(entry,beforeEntry)
await writeFile(harness,beforeEntry+`app.setAppPath(${JSON.stringify(resolve('.'))});require(${JSON.stringify(resolve('dist/main/index.cjs'))});`)
const dialog=name=>page.getByRole('dialog',{name,exact:true})
const button=(scope,name)=>scope.getByRole('button',{name,exact:true})
const state=()=>page.evaluate(()=>window.desktop.bootstrap())
async function launch(root){
 app=await electron.launch({...packaged?{executablePath:resolve('release/win-unpacked/玄印写作.exe'),args:[]}:{args:[harness]},env:{...process.env,XAANINK_TEST_ROOT:root,XAANINK_OFFLINE_GUARD_REPORT:networkReport},timeout:60000})
 page=await app.firstWindow({timeout:60000});page.setDefaultTimeout(10000)
 page.on('pageerror',error=>errors.push(error.message))
 try{await page.getByRole('button',{name:'账号菜单',includeHidden:true}).waitFor({timeout:60000})}
 catch(error){console.log(JSON.stringify({startupUrl:page.url(),alerts:await page.getByRole('alert').allTextContents(),status:await page.getByRole('status').allTextContents(),rendererErrors:errors}));if(checks.length===0)await page.screenshot({path:capture('startup-error.png')});throw error}
 assert.equal(page.url(),'xaanink://app/')
 if(packaged){
  assert.equal(await app.evaluate(({app})=>app.isPackaged),true);assert.equal(resolve(await app.evaluate(({app})=>app.getAppPath())),packageRoot)
  const listeners=await app.evaluate(()=>process._getActiveHandles().filter(handle=>handle.constructor.name==='Server'&&handle.listening).length);assert.equal(listeners,0);packageStartupListeners.push(listeners)
  // Packaged Electron ignores CLI -r. Instrument the owned main process only
  // after real startup; never describe this as a pre-entry or worker guard.
  await app.evaluate((_electron,entry)=>{process.mainModule.require(entry)},entry)
 }
}
async function close(){if(!app)return;const closed=app.waitForEvent('close',{timeout:30000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;app=undefined}
async function noNetwork(){const events=(await readFile(networkReport,'utf8')).trim().split('\n');assert.equal(events.filter(line=>line==='network-denied').length,0);assert.ok(events.filter(line=>line==='guard-loaded').length>=(packaged?1:2));return events.filter(line=>line==='guard-loaded').length}
async function trapped(scope){
 const controls=scope.locator('button:enabled,input:enabled:not([type="hidden"]),select:enabled,[tabindex="0"]')
 const first=controls.first(),last=controls.last();await last.focus();await page.keyboard.press('Tab');await expect(first).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(last).toBeFocused()
}
async function zoom(value){await page.evaluate(async value=>{const state=await window.desktop.bootstrap();await window.desktop.settings({type:'update',revision:state.revision,settings:{...state.settings,appearance:{...state.settings.appearance,zoom:value}}})},value);await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(value)}
async function customModel(kind,name){
 const current=dialog(kind==='TEXT'?'配置文本模型':'配置文生图模型')
 const radios=current.getByRole('radio',{name:'配置新模型',exact:true});if(await radios.count())await radios.check()
 await current.getByLabel('供应商',{exact:true}).click()
 await page.getByLabel('搜索供应商',{exact:true}).fill('')
 await expect(page.getByRole('option')).toHaveCount(kind==='TEXT'?13:9)
 const options=await page.getByRole('option').allTextContents()
 if(kind==='TEXT')assert.match(options[0],/DeepSeek|深度求索/)
 assert.ok(options.findIndex(text=>text.includes('OpenAI'))>options.findIndex(text=>text.includes('阿里')))
 await page.getByRole('option').filter({hasText:'自定义供应商'}).click()
 await current.getByLabel('供应商名称',{exact:true}).fill('专项本地夹具')
 await current.getByLabel('协议',{exact:true}).selectOption('openai')
 await current.getByLabel('展示名称',{exact:true}).fill(name)
 await current.getByLabel('Base URL',{exact:true}).fill('https://onboarding-fixture.invalid/v1')
 await current.getByLabel('模型 ID',{exact:true}).fill(kind==='TEXT'?'onboarding-text-fixture':'onboarding-image-fixture')
 await current.getByLabel('API Key',{exact:true}).fill('synthetic-onboarding-secret')
 // No screenshot/console/body capture while the password draft exists.
 await button(current,'继续').click()
}
async function openSettings(section){
 await page.getByRole('button',{name:'账号菜单'}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click()
 if(section)await page.getByRole('button',{name:section,exact:true}).click()
}
await mkdir(evidence,{recursive:true})
try{
 const root=join(temporary,'full')
 await launch(root)
 const theme=dialog('选择主题');await expect(theme).toBeVisible()
 assert.equal((await state()).models.length,0)
 assert.equal(await theme.getByRole('radio').count(),3)
 assert.equal(await theme.locator('[role="list"]').count(),0)
 await expect(theme.getByRole('heading',{name:'选择主题',exact:true})).toBeFocused()
 await trapped(theme)
 await page.screenshot({path:capture('01-theme-paper.png')})
 await page.getByRole('radio',{name:'宣纸',exact:true}).focus();await page.keyboard.press('ArrowRight')
 await expect.poll(async()=>(await state()).settings.appearance.theme).toBe('ink')
 await page.screenshot({path:capture('02-theme-ink.png')})
 await page.getByRole('radio',{name:'跟随系统',exact:true}).click();await expect.poll(async()=>(await state()).settings.appearance.theme).toBe('system');await expect(page.getByRole('radio',{name:'跟随系统',exact:true})).toBeChecked()
 await page.getByRole('radio',{name:'宣纸',exact:true}).click();await expect.poll(async()=>(await state()).settings.appearance.theme).toBe('paper');await expect(page.getByRole('radio',{name:'宣纸',exact:true})).toBeChecked()
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('desktop:settings',{detail:'models'})))
 await expect(dialog('设置')).not.toBeVisible();await expect(theme).toBeVisible()
 checks.push('ONB-01/02: fresh isolated Windows app opens full theme, default no models; three radios persist real settings; system value preserved; ordinary settings blocked')
 await button(theme,'继续').click()
 const profile=dialog('填写用户信息');await expect(profile).toBeVisible()
 await profile.getByLabel('笔名',{exact:true}).fill('')
 await button(profile,'继续').click();await expect(profile.getByRole('alert')).toBeVisible()
 await profile.getByLabel('笔名',{exact:true}).fill('专项作者 <欢迎>')
 await profile.getByLabel('邮件',{exact:true}).fill('onboarding@example.test')
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('desktop:recovery')))
 await expect(dialog('保留的草稿')).toBeVisible();await expect(profile).not.toBeVisible()
 await page.keyboard.press('Escape');await expect(dialog('保留的草稿')).not.toBeVisible();await expect(profile).toBeVisible()
 await expect(profile.getByLabel('笔名',{exact:true})).toHaveValue('专项作者 <欢迎>');await expect(profile.getByLabel('邮件',{exact:true})).toHaveValue('onboarding@example.test')
 await profile.getByLabel('笔名',{exact:true}).dispatchEvent('compositionstart')
 await profile.getByLabel('笔名',{exact:true}).dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true})
 await profile.getByLabel('笔名',{exact:true}).dispatchEvent('compositionend')
 await expect(profile).toBeVisible()
 await button(profile,'继续').click();await expect(dialog('配置文本模型')).toBeVisible()
 assert.equal((await state()).settings.user.penName,'专项作者 <欢迎>')
 checks.push('ONB-01b/03/10: validation stays on profile; actual recovery popup suspends and resumes exact unsaved fields; manual continue saves real profile and progress; synthetic composition Enter does not submit')
 // Native close and restart resumes text without persisting an unsubmitted Key.
 await dialog('配置文本模型').getByLabel('API Key',{exact:true}).fill('unsubmitted-fixture-secret')
 await close();await launch(root);await expect(dialog('配置文本模型')).toBeVisible()
 await expect(dialog('配置文本模型').getByLabel('API Key',{exact:true})).toHaveValue('')
 assert.equal((await state()).models.length,0)
 checks.push('ONB-07/11: native close/restart resumes text; unsubmitted password is discarded and never enters state')
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600))
 await expect(button(dialog('配置文本模型'),'继续')).toBeInViewport()
 await expect(button(dialog('配置文本模型'),'测试连接')).toBeInViewport()
 await zoom(1.5);await expect(button(dialog('配置文本模型'),'继续')).toBeInViewport();await expect(button(dialog('配置文本模型'),'测试连接')).toBeInViewport()
 await zoom(1)
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,940))
 await customModel('TEXT','专项文本模型')
 let choice=dialog('要配置文生图模型吗？');await expect(choice).toBeVisible()
 let saved=await state();assert.equal(saved.models.length,1)
 const textId=saved.models[0].id
 assert.equal(saved.settings.agent.textModelId,textId);assert.equal(saved.settings.agent.reviewModelId,textId);assert.equal(saved.onboarding.step,'image-choice')
 assert.equal(JSON.stringify(saved).includes('synthetic-onboarding-secret'),false)
 assert.equal((await readFile(join(root,'state.json'),'utf8')).includes('synthetic-onboarding-secret'),false)
 const art=choice.locator('.choice-art-trigger')
 await expect(art.locator('img')).toHaveJSProperty('naturalWidth',1774)
 assert.equal(await art.evaluate(element=>getComputedStyle(element).cursor),'pointer')
 assert.equal(await choice.locator('.choice-art-seam').count(),0)
 await art.hover();await expect.poll(()=>art.locator('.choice-art-caption').evaluate(element=>getComputedStyle(element).opacity)).toBe('1')
 await page.screenshot({path:capture('03-image-hover.png')})
 await page.emulateMedia({reducedMotion:'reduce'})
 await art.focus();assert.equal(await art.locator('img').evaluate(element=>getComputedStyle(element).transform),'none')
 await page.keyboard.press('Enter');await expect(dialog('配置文生图模型')).toBeVisible()
 await button(dialog('配置文生图模型'),'返回').click();await expect(choice).toBeVisible()
 await art.focus();await page.keyboard.press('Space');await expect(dialog('配置文生图模型')).toBeVisible()
 await dialog('配置文生图模型').getByLabel('API Key',{exact:true}).fill('discarded-image-fixture')
 await button(dialog('配置文生图模型'),'返回').click();await expect(choice).toBeVisible()
 await button(choice.locator('.desktop-onboarding-footer'),'配置文生图模型').click();await expect(dialog('配置文生图模型')).toBeVisible()
 await expect(dialog('配置文生图模型').getByLabel('API Key',{exact:true})).toHaveValue('')
 checks.push('ONB-04/05/11: real encrypted text commit sets text+review defaults and progress; image loads offline with pointer/hover/focus and no moving light; picture Enter and footer share configuration action')
 await customModel('IMAGE','专项图片模型')
 let welcome=dialog('欢迎使用');await expect(welcome).toBeVisible()
 saved=await state();assert.equal(saved.models.length,2);assert.equal(saved.onboarding.completed,true)
 assert.equal(saved.settings.agent.imageModelId,saved.models.find(model=>model.kind==='IMAGE').id)
 await expect(welcome).toContainText('专项作者 <欢迎>，你好。')
 await expect(button(welcome,'开始创作')).toBeVisible()
 await expect(welcome.getByRole('heading',{name:'欢迎使用',exact:true})).toBeFocused();await trapped(welcome)
 assert.equal(await welcome.locator('script').count(),0)
 await page.screenshot({path:capture('04-welcome.png')})
 await page.keyboard.press('Escape');await expect(welcome).not.toBeVisible()
 await expect(page.getByRole('button',{name:'账号菜单'})).toBeFocused()
 assert.deepEqual((await page.evaluate(async()=>await(await fetch('/api/novels')).json())).novels,[])
 await noNetwork()
 checks.push('ONB-05: image confirmation saves default+completion before welcome; real pen name is escaped, Escape enters real workbench and no work/model request is created')
 await close();await launch(root)
 await expect(dialog('选择主题')).not.toBeVisible();await expect(dialog('尚未配置文本模型')).not.toBeVisible()
 await openSettings('用户')
 await page.getByRole('button',{name:'编辑用户',exact:true}).click()
 await expect(button(dialog('编辑用户'),'保存')).toBeVisible();await button(dialog('编辑用户'),'取消').click()
 await page.getByRole('button',{name:'模型',exact:true}).click();await page.getByRole('button',{name:'编辑模型 专项文本模型',exact:true}).click()
 await expect(button(dialog('配置模型'),'保存模型')).toBeVisible();await button(dialog('配置模型'),'取消').click()
 // Delete only TEXT through the real application to test IMAGE-only startup.
 await page.getByRole('button',{name:'删除模型 专项文本模型',exact:true}).click();await button(dialog('删除模型'),'删除模型').click()
 await expect.poll(async()=>(await state()).models.filter(model=>model.kind==='TEXT').length).toBe(0)
 await page.getByRole('button',{name:'关闭设置',exact:true}).click()
 await close();await launch(root)
 choice=dialog('要配置文生图模型吗？');welcome=dialog('欢迎使用')
 const entry=dialog('尚未配置文本模型');await expect(entry).toBeVisible()
 await button(entry,'暂不配置').click();await expect(entry).not.toBeVisible()
 await openSettings('模型');await page.getByRole('button',{name:'开始模型引导',exact:true}).click()
 await expect(dialog('配置文本模型')).toBeVisible();await expect(dialog('填写用户信息')).not.toBeVisible()
 await expect(dialog('选择主题')).not.toBeVisible()
 saved=await state();assert.equal(saved.onboarding.completed,true);assert.equal(saved.onboarding.step,'text')
 const oldImage=saved.settings.agent.imageModelId
 await customModel('TEXT','短流程文本模型')
 const beforeSkip=(await state()).models.length
 await button(choice.locator('.desktop-onboarding-footer'),'配置文生图模型').click();await expect(dialog('配置文生图模型')).toBeVisible()
 await dialog('配置文生图模型').getByLabel('API Key',{exact:true}).fill('skipped-image-fixture')
 await button(dialog('配置文生图模型'),'跳过').click();await expect(welcome).toBeVisible()
 assert.equal((await state()).settings.agent.imageModelId,oldImage)
 assert.equal((await state()).models.length,beforeSkip);await expect(page.getByLabel('API Key',{exact:true})).toHaveCount(0)
 assert.equal(JSON.stringify(await state()).includes('skipped-image-fixture'),false);assert.equal((await readFile(join(root,'state.json'),'utf8')).includes('skipped-image-fixture'),false)
 await button(welcome,'开始创作').click();await expect(entry).not.toBeVisible()
 checks.push('ONB-06/09: completed restart is silent; ordinary profile/model save actions retained; IMAGE-only root prompts once; dismiss stays dismissed; model empty entry starts short text and skipping image preserves previous default')
 // Re-open confirmed text step: existing ID is edited, not duplicated.
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('desktop:onboarding',{detail:'models'})))
 const text=dialog('配置文本模型');await expect(text).toBeVisible()
 const before=(await state()).models.length
 await text.getByLabel('展示名称',{exact:true}).fill('短流程同ID改名')
 await button(text,'继续').click();await expect(choice).toBeVisible();assert.equal((await state()).models.length,before)
 await button(choice,'返回').click();await expect(text).toBeVisible()
 await expect(text.getByLabel('API Key',{exact:true})).toHaveValue('')
 await page.keyboard.press('Escape');await expect(text).not.toBeVisible()
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('desktop:onboarding',{detail:'models'})))
 await expect(text).toBeVisible();await button(text,'继续').click();await expect(choice).toBeVisible();await button(choice,'跳过').click();await expect(welcome).toBeVisible();await button(welcome,'开始创作').click()
 // Long real profile renders safely on welcome at small client size and zoom.
 await openSettings('用户');await page.getByRole('button',{name:'编辑用户',exact:true}).click()
 const longName='长笔名'.repeat(26)+'终章';assert.equal(longName.length,80)
 await dialog('编辑用户').getByLabel('笔名',{exact:true}).fill(longName);await button(dialog('编辑用户'),'保存').click();await page.getByRole('button',{name:'关闭设置',exact:true}).click()
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('desktop:onboarding',{detail:'models'})));await expect(text).toBeVisible();await button(text,'继续').click();await expect(choice).toBeVisible();await button(choice,'跳过').click();await expect(welcome).toBeVisible()
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600));await zoom(1.5)
 await expect(welcome).toContainText(longName+'，你好。');await expect(button(welcome,'开始创作')).toBeInViewport()
 assert.equal(await welcome.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true)
 await zoom(1);await button(welcome,'开始创作').click();await expect(page.getByRole('button',{name:'作品目录',exact:true})).toBeFocused()
 const guardLoads=await noNetwork()
 checks.push('ONB-07: deliberate short reentry and back edit confirmed ID without duplicate or exposing Key; short text Escape does not auto repeat')
 checks.push('ONB-10/11: real Tab/ShiftTab cycle, image Enter/Space, welcome title/exit focus, image back/skip draft cleanup, 800x600 window at 150% app zoom, 80-character welcome; '+(packaged?'actual packaged cold startup, zero observed Node main listeners, post-start main/renderer network audit with zero attempts':'pre-entry main/service HTTP/TCP/listener denial with zero attempts'))
 assert.deepEqual(errors,[])
 const compiledArtifacts=Object.fromEntries(await Promise.all(['dist/main/index.cjs','dist/preload/index.cjs','dist/service/index.cjs','out/onboarding/xianxia-character-scene-v2.png'].map(async file=>{const hash=createHash('sha256').update(await readFile(join(packageRoot,file))).digest('hex');if(packaged)assert.equal(hash,createHash('sha256').update(await readFile(file)).digest('hex'));return[file,hash]})))
 const reportName=packaged?'windows-package.json':'windows-electron.json'
 await writeFile(join(evidence,reportName),JSON.stringify({startedAt,endedAt:new Date().toISOString(),platform:process.platform,node:process.version,status:'passed',packaged,checks,rendererErrors:errors,compiledArtifacts,fullRegression:false,networkRequests:0,offlineGuard:{preflightTcpDenied:6,loads:guardLoads,preEntry:!packaged,serviceWorker:!packaged,attempts:0,packageStartupNodeMainListeners:packageStartupListeners,instrumentation:'Playwright Chromium/V8 debug ports excluded; package guard installed after real startup in owned main/renderer, compiled application separately guards main/worker before entry'},window:{width:800,height:600,appZoom:1.5},limitations:['Composition event was synthetic, not a physical IME session','Application short-window and zoom coverage is not system DPI change','Native avatar picker not driven; service decoding/persistence/cancellation covered separately','NSIS installation and macOS not run',...(packaged?['Package cold startup is observed; its service worker has no injected network guard, strict pre-entry main/worker evidence comes from matching compiled application']:[]) ]},null,2))
 console.log(JSON.stringify({passed:checks.length,platform:process.platform,packaged,evidence:`docs/evidence/onboarding/${reportName}`}))
}catch(error){
 await writeFile(join(evidence,packaged?'windows-package-failed.json':'windows-electron-failed.json'),JSON.stringify({startedAt,endedAt:new Date().toISOString(),platform:process.platform,status:'failed',checks,error:String(error),rendererErrors:errors},null,2))
 throw error
}finally{if(app)await app.close();await rm(temporary,{recursive:true,force:true})}
