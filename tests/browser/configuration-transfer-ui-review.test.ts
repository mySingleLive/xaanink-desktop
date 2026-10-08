import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync,readdirSync} from 'node:fs'
import {build} from 'esbuild'
import {chromium,type Browser,type Page} from 'playwright-core'
import {defaultState,type PublicModel} from '../../desktop/core/settings'
import {prepareConfigurationImport,exportConfiguration,resolveConfigurationImport} from '../../desktop/core/configuration-transfer'
import {platformCommands} from '../../desktop/shared/command-registry'

// Actual SettingsDialog/ConfigurationTransfer, store, transfer rules, BaseUI
// checkbox/combobox/focus. Native file IO/pickers are deferred memory IPC.
const css=readdirSync('.next/static/chunks').filter(file=>file.endsWith('.css')).sort().map(file=>readFileSync('.next/static/chunks/'+file,'utf8')).join('\n')+'\n'+readFileSync('src/app/desktop.css','utf8')
const ids={text:'00000000-0000-4000-8000-000000000001',image:'00000000-0000-4000-8000-000000000002',disabled:'00000000-0000-4000-8000-000000000003',custom:'00000000-0000-4000-8000-000000000004',source:'00000000-0000-4000-8000-000000000005',sourceImage:'00000000-0000-4000-8000-000000000006'};
const model=(id:string,name:string,provider:string,kind:'TEXT'|'IMAGE'='TEXT',enabled=true):PublicModel=>({id,name,provider,protocol:'openai',modelId:provider==='openai'?'gpt-local':provider==='kimi'?'kimi-image':provider==='custom'?'km-private':'disabled',endpoint:'https://local-model.invalid/v1',kind,enabled,authRevision:1,keyMask:'••••••••',contextWindow:0,thinkingLevels:['low'],defaultThinking:'default'});
let state={revision:3,settings:structuredClone(defaultState.settings),models:[model(ids.text,'本机 GPT','openai'),model(ids.image,'本机 Kimi 图片','kimi','IMAGE'),model(ids.disabled,'停用文本','deepseek','TEXT',false),model(ids.custom,'本机 KM','custom')]};
state.settings.user.penName='本机作者';state.settings.agent.textModelId=ids.text;
const incoming={...structuredClone(state),models:[model(ids.source,'来源文本','openai'),model(ids.sourceImage,'来源图片','kimi','IMAGE')]};incoming.settings.appearance.theme='ink';incoming.settings.user.penName='导入作者';incoming.settings.agent.textModelId=ids.source;incoming.settings.agent.imageModelId=ids.sourceImage;
incoming.settings.shortcuts.darwin['file.open']=['Cmd+S'];incoming.settings.shortcuts.win32['file.save']=[];
const catalogs={darwin:{resolved:true,commands:platformCommands('darwin')},win32:{resolved:true,commands:platformCommands('win32')}};
const plan=prepareConfigurationImport(exportConfiguration(incoming),state,catalogs);

const bundle=build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {SettingsDialog} from './src/components/desktop/SettingsDialog';
import {useDesktopStore,receiveDesktopState} from './src/stores/desktop';
import {defaultState} from './desktop/core/settings';
const state=globalThis.fixture.state,plan=globalThis.fixture.plan,ids=globalThis.fixture.ids;
const pending=new Map();globalThis.calls=[];globalThis.notifications=[];globalThis.applied=[];globalThis.ids=ids;
window.desktop={configuration:async action=>{globalThis.calls.push(structuredClone(action));if(action.type==='cancel')return;return new Promise((resolve,reject)=>pending.set(action.sessionId+':'+action.type,{resolve,reject,action}))},settings:async()=>{throw Error('unexpected ordinary setting write')},chooseDirectory:async()=>null};
useDesktopStore.setState({bootstrap:{...state,platform:'darwin',version:'0.1.0',dataRoot:'/isolated/.xuanxiang',draftSessionId:crypto.randomUUID(),systemDark:false}});
globalThis.resolvePreview=()=>{const row=[...pending.values()].find(row=>row.action.type==='preview');if(!row)throw Error('no pending preview');pending.delete(row.action.sessionId+':preview');row.resolve({token:'review-token',plan:structuredClone(plan)})};
globalThis.resolveApply=result=>{const row=[...pending.values()].find(row=>row.action.type==='apply');if(!row)throw Error('no pending apply');pending.delete(row.action.sessionId+':apply');row.resolve(result)};
globalThis.rejectApply=message=>{const row=[...pending.values()].find(row=>row.action.type==='apply');pending.delete(row.action.sessionId+':apply');row.reject(Error(message))};
globalThis.finishExport=()=>{const row=[...pending.values()].find(row=>row.action.type==='export');pending.delete(row.action.sessionId+':export');row.resolve(true)};globalThis.rejectExport=()=>{const row=[...pending.values()].find(row=>row.action.type==='export');pending.delete(row.action.sessionId+':export');row.reject(Error('导出目录不可写'))};
globalThis.snapshot=()=>structuredClone(useDesktopStore.getState().bootstrap);
let setVisible;function App(){const[open,setOpen]=useState(false);setVisible=setOpen;return <><button onClick={()=>setOpen(true)}>打开设置</button><button id='outside'>背景按钮</button><SettingsDialog open={open} onOpenChange={setOpen}/></>};
const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(<App/>));globalThis.closeSettings=()=>flushSync(()=>setVisible(false));globalThis.dispose=()=>flushSync(()=>root.unmount());
`},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json',plugins:[{name:'controlled-file-boundaries',setup(builder){
 builder.onResolve({filter:/^(sonner|\.\/(ShortcutSettings|ModelSettings|AgentSettings|ProfileSettings))$/},args=>({path:args.path,namespace:'controlled'}))
 builder.onLoad({filter:/.*/,namespace:'controlled'},args=>({contents:args.path==='sonner'?`export const toast={success:x=>globalThis.notifications.push(x),error:x=>globalThis.notifications.push(x),info:x=>globalThis.notifications.push(x)}`:`export function ${args.path.slice(2)}(){return null}`,loader:'js'}))
}}]}).then(result=>result.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,...(process.env.XAANINK_TEST_CHROMIUM?{executablePath:process.env.XAANINK_TEST_CHROMIUM}:{})})})
test.after(async()=>{await browser?.close()})
async function scenario(run:(page:Page)=>Promise<void>,width=1000,height=800){const page=await browser.newPage({viewport:{width,height}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));try{await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):route.abort());await page.goto('http://127.0.0.1:1/configuration-review');await page.addStyleTag({content:css});await page.evaluate(fixture=>{(window as any).fixture=fixture},{state,plan,ids});await page.addScriptTag({content:await bundle});await page.getByRole('button',{name:'打开设置'}).click();await page.getByRole('button',{name:'导入配置',exact:true}).waitFor();await run(page);assert.deepEqual(errors,[])}finally{await page.close()}}
async function settle(page:Page){await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))}
async function preview(page:Page){await page.getByRole('button',{name:'导入配置',exact:true}).click();await page.waitForFunction(()=>(window as any).calls.some((row:any)=>row.type==='preview'));await page.evaluate(()=>(window as any).resolvePreview());await page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'导入配置',exact:true})}).waitFor();await settle(page)}
async function unselect(page:Page,name:string){const row=page.getByRole('checkbox',{name});if(await row.isChecked())await row.uncheck()}

test('CFG62-U01: original General rows open an inert per-field preview; selected appearance applies but deselected name/shortcuts/models stay confirmed',async()=>scenario(async page=>{
 assert.equal(await page.locator('.desktop-setting-row').filter({has:page.getByRole('button',{name:'导出配置',exact:true})}).count(),1)
 await preview(page);const before=await page.evaluate(()=>(window as any).snapshot());assert.equal(before.revision,3);assert.equal(before.settings.appearance.theme,'paper');assert.equal((await page.evaluate(()=>(window as any).calls)).filter((row:any)=>row.type==='apply').length,0)
 for(const name of ['导入 笔名','导入 macOS · 打开作品','导入 Windows · 保存当前稿'])await unselect(page,name)
 assert.equal(await page.getByRole('checkbox',{name:'导入 默认模型',exact:true}).isChecked(),false)
 await page.getByRole('button',{name:'应用所选配置'}).click();await page.waitForFunction(()=>(window as any).calls.some((row:any)=>row.type==='apply'));const action=await page.evaluate(()=>(window as any).calls.find((row:any)=>row.type==='apply'));await page.evaluate(result=>(window as any).resolveApply(result),{...state,revision:state.revision+1,settings:resolveConfigurationImport(plan,state,action.choices,catalogs)});await page.getByRole('heading',{name:'导入配置',exact:true}).waitFor({state:'hidden'})
 const after=await page.evaluate(()=>(window as any).snapshot());assert.equal(after.settings.appearance.theme,'ink');assert.equal(after.settings.user.penName,before.settings.user.penName);assert.deepEqual(after.settings.shortcuts,before.settings.shortcuts);assert.deepEqual(after.models,before.models)
}))

test('CFG62-U02: explicit model mapping shows family logos, excludes disabled/wrong-kind records, and sends reviewed IDs only',async()=>scenario(async page=>{
 await preview(page);await page.getByRole('checkbox',{name:'导入 默认模型',exact:true}).check();await page.getByRole('combobox',{name:'映射默认模型',exact:true}).click()
 const popup=page.getByRole('listbox',{name:'映射默认模型',exact:true});await popup.waitFor();assert.equal(await popup.getByRole('option',{name:/本机 Kimi/}).count(),0);assert.equal(await popup.getByRole('option',{name:/停用/}).count(),0)
 assert.equal(await popup.locator('[data-provider-logo=openai]').getAttribute('src'),'/brands/models/openai.svg');assert.equal(await popup.locator('[data-provider-logo=custom]').count(),1)
 await popup.getByRole('option',{name:/本机 GPT/}).click();assert.equal(await page.getByRole('combobox',{name:'映射默认模型',exact:true}).locator('[data-provider-logo=openai]').getAttribute('src'),'/brands/models/openai.svg')
 await page.getByRole('checkbox',{name:'导入 默认文生图模型',exact:true}).check();await page.getByRole('combobox',{name:'映射默认文生图模型',exact:true}).click();const images=page.getByRole('listbox',{name:'映射默认文生图模型',exact:true});await images.waitFor();assert.equal(await images.getByRole('option',{name:/本机 GPT/}).count(),0);assert.equal(await images.locator('[data-provider-logo=kimi]').getAttribute('src'),'/brands/models/kimi.svg');await images.getByRole('option',{name:/本机 Kimi/}).click()
 for(const name of ['导入 macOS · 打开作品','导入 Windows · 保存当前稿'])await unselect(page,name)
 await page.getByRole('button',{name:'应用所选配置'}).click();await page.waitForFunction(()=>(window as any).calls.some((row:any)=>row.type==='apply'));const payload=await page.evaluate(()=>(window as any).calls.find((row:any)=>row.type==='apply'));assert.deepEqual(payload.choices.modelBindings,{'/agent/textModelId':'00000000-0000-4000-8000-000000000001','/agent/imageModelId':'00000000-0000-4000-8000-000000000002'});assert.equal('plan' in payload,false)
}))

test('CFG62-U03: apply conflicts preserve selected rows/mappings and confirmed state, allowing an explicit retry',async()=>scenario(async page=>{
 await preview(page);await page.getByRole('button',{name:'应用所选配置'}).click();await page.waitForFunction(()=>(window as any).calls.some((row:any)=>row.type==='apply'));const action=await page.evaluate(()=>(window as any).calls.find((row:any)=>row.type==='apply'));let failure='';try{resolveConfigurationImport(plan,state,action.choices,catalogs)}catch(error){failure=error instanceof Error?error.message:''}assert.match(failure,/冲突/);await page.evaluate(message=>(window as any).rejectApply(message),failure);await page.getByRole('alert').filter({hasText:/冲突/}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'导入 macOS · 打开作品'}).isChecked(),true);assert.equal((await page.evaluate(()=>(window as any).snapshot())).revision,3);assert.equal(await page.getByRole('button',{name:'应用所选配置'}).isEnabled(),true)
 await unselect(page,'导入 macOS · 打开作品');await page.getByRole('button',{name:'应用所选配置'}).click();await page.waitForFunction(()=>(window as any).calls.filter((row:any)=>row.type==='apply').length===2);const retry=await page.evaluate(()=>(window as any).calls.filter((row:any)=>row.type==='apply')[1]);await page.evaluate(result=>(window as any).resolveApply(result),{...state,revision:state.revision+1,settings:resolveConfigurationImport(plan,state,retry.choices,catalogs)});await page.getByRole('heading',{name:'导入配置',exact:true}).waitFor({state:'hidden'});assert.equal((await page.evaluate(()=>(window as any).snapshot())).settings.appearance.theme,'ink')
}))

for(const dismiss of ['取消','Escape','outside'] as const)test('CFG62-U04-'+dismiss+': dismissal cancels the preview owner and never applies unchecked draft data',async()=>scenario(async page=>{
 await preview(page);if(dismiss==='取消')await page.getByRole('button',{name:'取消',exact:true}).click();else if(dismiss==='Escape')await page.keyboard.press('Escape');else await page.mouse.click(4,4)
 await page.getByRole('heading',{name:'导入配置',exact:true}).waitFor({state:'hidden'});await settle(page);const calls=await page.evaluate(()=>(window as any).calls);assert.equal(calls.filter((row:any)=>row.type==='cancel').length,1);assert.equal(calls.some((row:any)=>row.type==='apply'),false);assert.equal((await page.evaluate(()=>(window as any).snapshot())).revision,3)
 if(dismiss!=='outside')assert.equal(await page.getByRole('button',{name:'导入配置',exact:true}).evaluate(element=>element===document.activeElement),true)
}))

test('CFG62-U05: leaving General during native preview/export selection cancels owners and ignores late responses',async()=>scenario(async page=>{
 await page.getByRole('button',{name:'导入配置',exact:true}).click();await page.waitForFunction(()=>(window as any).calls.some((row:any)=>row.type==='preview'));await page.getByRole('button',{name:'用户',exact:true}).click();await page.evaluate(()=>(window as any).resolvePreview());await settle(page);assert.equal(await page.getByRole('heading',{name:'导入配置',exact:true}).count(),0)
 await page.getByRole('button',{name:'通用',exact:true}).click();await page.getByRole('button',{name:'导出配置',exact:true}).click();await page.waitForFunction(()=>(window as any).calls.some((row:any)=>row.type==='export'));await page.getByRole('button',{name:'用户',exact:true}).click();await page.evaluate(()=>(window as any).finishExport());await settle(page);assert.deepEqual(await page.evaluate(()=>(window as any).notifications),[]);assert.equal((await page.evaluate(()=>(window as any).calls)).filter((row:any)=>row.type==='cancel').length,2)
}))

test('CFG62-U06: externally closed apply cannot publish a late owner response into the current confirmed store',async()=>scenario(async page=>{
 await preview(page);await unselect(page,'导入 macOS · 打开作品');await page.getByRole('button',{name:'应用所选配置'}).click();await page.waitForFunction(()=>(window as any).calls.some((row:any)=>row.type==='apply'));await page.mouse.click(4,4);await page.getByRole('dialog').waitFor({state:'hidden'});await page.evaluate(result=>(window as any).resolveApply(result),{...state,revision:state.revision+1,settings:{...state.settings,user:{...state.settings.user,penName:'迟到取消结果'}}});await settle(page);assert.equal((await page.evaluate(()=>(window as any).snapshot())).revision,3);assert.deepEqual(await page.evaluate(()=>(window as any).notifications),[])
}))

test('CFG62-U07: narrow real popup keeps scrolling differences and footer reachable, while combobox Escape returns to the mapping trigger',async()=>scenario(async page=>{
 await preview(page);const dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'导入配置',exact:true})});const rect=await dialog.boundingBox();assert.ok(rect&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=641&&rect.y+rect.height<=561)
 await page.getByRole('checkbox',{name:'导入 默认模型',exact:true}).check();await page.getByRole('combobox',{name:'映射默认模型',exact:true}).click();await page.getByLabel('搜索映射默认模型',{exact:true}).fill('本机');await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');assert.equal(await page.getByRole('listbox',{name:'映射默认模型'}).count(),0);assert.equal(await page.getByRole('combobox',{name:'映射默认模型',exact:true}).evaluate(element=>element===document.activeElement),true)
 for(const name of ['重新选择文件','取消','应用所选配置']){const button=page.getByRole('button',{name,exact:true});const box=await button.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=561,name+' footer reachable')}
},640,560))


test('CFG62-U08: no selected rows disables apply; explicitly clearing a model sends null and never enables/creates a model',async()=>scenario(async page=>{
 await preview(page);const checked=page.getByRole('checkbox');for(let i=0;i<await checked.count();i++){const item=checked.nth(i);if(await item.isChecked())await item.uncheck()}assert.equal(await page.getByRole('button',{name:'应用所选配置'}).isDisabled(),true)
 await page.getByRole('checkbox',{name:'导入 默认模型',exact:true}).check();await page.getByRole('combobox',{name:'映射默认模型',exact:true}).click();await page.getByRole('listbox',{name:'映射默认模型',exact:true}).getByRole('option',{name:'清除此默认模型',exact:true}).click();await page.getByRole('button',{name:'应用所选配置'}).click();await page.waitForFunction(()=>(window as any).calls.some((row:any)=>row.type==='apply'));const action=await page.evaluate(()=>(window as any).calls.find((row:any)=>row.type==='apply'));assert.deepEqual(action.choices.selectedPaths,['/agent/textModelId']);assert.deepEqual(action.choices.modelBindings,{'/agent/textModelId':null});const result={...state,revision:4,settings:resolveConfigurationImport(plan,state,action.choices,catalogs)};await page.evaluate(result=>(window as any).resolveApply(result),result);await settle(page);const final=await page.evaluate(()=>(window as any).snapshot());assert.equal(final.settings.agent.textModelId,null);assert.deepEqual(final.models,state.models)
}))

test('CFG62-U09: busy apply freezes all draft controls and repeated activation, but Escape cancels the owner with no late toast',async()=>scenario(async page=>{
 await preview(page);await page.getByRole('checkbox',{name:'导入 默认模型',exact:true}).check();await page.getByRole('combobox',{name:'映射默认模型',exact:true}).click();await page.getByRole('listbox',{name:'映射默认模型',exact:true}).getByRole('option',{name:/本机 GPT/}).click();await unselect(page,'导入 macOS · 打开作品');await page.getByRole('button',{name:'应用所选配置'}).click();await page.waitForFunction(()=>(window as any).calls.some((row:any)=>row.type==='apply'));assert.equal(await page.getByRole('button',{name:'应用所选配置'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'取消',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('combobox',{name:'映射默认模型',exact:true}).isDisabled(),true);assert.equal(await page.getByLabel('导入后的思考强度',{exact:true}).isDisabled(),true);for(const row of await page.getByRole('checkbox').all())assert.equal(await row.isDisabled(),true);assert.equal(await page.locator('.animate-spin').count(),1)
 await page.getByRole('button',{name:'应用所选配置'}).evaluate((element:HTMLButtonElement)=>element.click());assert.equal((await page.evaluate(()=>(window as any).calls)).filter((row:any)=>row.type==='apply').length,1);await page.keyboard.press('Escape');await page.getByRole('heading',{name:'导入配置',exact:true}).waitFor({state:'hidden'});const action=await page.evaluate(()=>(window as any).calls.find((row:any)=>row.type==='apply'));await page.evaluate(result=>(window as any).resolveApply(result),{...state,revision:4,settings:resolveConfigurationImport(plan,state,action.choices,catalogs)});await settle(page);assert.deepEqual(await page.evaluate(()=>(window as any).notifications),[]);assert.equal((await page.evaluate(()=>(window as any).snapshot())).revision,3)
}))

test('CFG62-U10: real export button reports failure without mutating state, permits an explicit retry, and announces only current owner success',async()=>scenario(async page=>{
 await page.getByRole('button',{name:'导出配置',exact:true}).click();await page.waitForFunction(()=>(window as any).calls.some((row:any)=>row.type==='export'));assert.equal(await page.getByRole('button',{name:'导出配置',exact:true}).isDisabled(),true);await page.evaluate(()=>(window as any).rejectExport());await page.getByRole('alert').filter({hasText:'导出目录不可写'}).waitFor();assert.equal((await page.evaluate(()=>(window as any).snapshot())).revision,3);await page.getByRole('button',{name:'导出配置',exact:true}).click();await page.waitForFunction(()=>(window as any).calls.filter((row:any)=>row.type==='export').length===2);await page.evaluate(()=>(window as any).finishExport());await settle(page);assert.deepEqual(await page.evaluate(()=>(window as any).notifications),['配置已导出']);assert.equal(await page.getByRole('alert').count(),0)
}))
