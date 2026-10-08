import assert from "node:assert/strict"
import { test } from "node:test"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { build } from "esbuild"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { chromium, type Browser, type Page } from "playwright-core"

// Actual original React/BaseUI/PromptsClient and semantic stylesheet. The local
// API is controlled; this is not native Electron or disk/paid-model acceptance.
const stylesheet=(async()=>{const path=resolve("src/app/globals.css");return(await postcss([tailwindcss()]).process(await readFile(path,"utf8"),{from:path})).css})()
const bundle=build({stdin:{loader:"tsx",resolveDir:process.cwd(),contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {TemplateManagementDialog} from './src/components/desktop/TemplateManagementDialog';
globalThis.mountTemplates=()=>{
 const calls=[],prompts=[{id:'p-user',key:'user.test',name:'作者模板',content:'写 {{subject}}',variables:['subject'],version:1,enabled:true,updatedAt:'2026-10-08T00:00:00.000Z',source:'user'},{id:'p-default',key:'chat.system',name:'创作参谋默认',content:'默认 {{subject}}',variables:['subject'],version:1,enabled:true,updatedAt:'2026-10-08T00:00:00.000Z',source:'builtin'}];
 const wizard=[{template:{id:'theme-local',cat:'theme',title:'原主题卡',summary:'原有摘要',channels:['男频'],genres:['玄幻'],tags:['热血'],prompt:'原有主题草稿'},version:1,enabled:true,source:'builtin'}];
 let revision=1,holdSave=false,resolveSave,failApply=false,holdPreview=false,resolvePreview,holdCreate=false,resolveCreate;
 window.fetch=async(input,init={})=>{
  const path=String(input),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({path,method,body});
  const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
  if(path==='/api/admin/prompts'&&method==='GET')return response({prompts,revision});
  if(path==='/api/admin/prompts'&&method==='POST'){if(holdCreate)await new Promise(yes=>resolveCreate=yes);const prompt={...body,id:'p-'+prompts.length,version:1,enabled:true,source:'user',updatedAt:'2026-10-08T00:00:01.000Z'};prompts.push(prompt);revision++;return response({prompt},201)}
  if(path.startsWith('/api/admin/prompts/')&&method==='PATCH'){if(holdSave)await new Promise(yes=>resolveSave=yes);const p=prompts.find(p=>p.id===path.split('/').at(-1));Object.assign(p,body,{version:p.version+1});revision++;return response({prompt:p})}
  if(path.startsWith('/api/admin/prompts/')&&method==='DELETE'){const i=prompts.findIndex(p=>p.id===path.split('/').at(-1));prompts.splice(i,1);revision++;return response({ok:true})}
  if(path==='/api/templates/wizard'&&method==='GET')return response({templates:wizard,revision});
  if(path==='/api/templates/wizard'&&method==='POST'){const row={...body,version:1,source:'user'};wizard.push(row);revision++;return response({template:row},201)}
  if(path.startsWith('/api/templates/wizard/')&&method==='PATCH'){const row=wizard.find(p=>p.template.id===path.split('/').at(-1));Object.assign(row,body,{version:row.version+1,source:row.source==='builtin'?'customized':row.source});revision++;return response({template:row})}
  if(path==='/api/templates/import'&&body.action==='preview'){if(holdPreview)await new Promise(yes=>resolvePreview=yes);const doc=body.document;return response({preview:{baseRevision:revision,document:doc,entries:[...doc.prompts.map(p=>{const old=prompts.find(x=>x.key===p.key);return{kind:'prompt',id:p.key,name:p.name,conflict:!!old,existingVersion:old?.version??null,incomingVersion:p.version}}),...doc.wizardTemplates.map(p=>({kind:'wizard',id:p.template.id,name:p.template.title,conflict:false,existingVersion:null,incomingVersion:p.version}))]}})}
  if(path==='/api/templates/import'&&body.action==='apply'){if(failApply)return response({error:'模板版本已变化，请重新预览。',code:'TEMPLATE_LIBRARY_CONFLICT'},409);for(const c of body.choices){if(c.action==='keep')continue;const p=body.preview.document.prompts.find(p=>p.key===c.id);if(c.kind==='prompt'){if(c.action==='replace'){const old=prompts.find(x=>x.key===c.id);Object.assign(old,p,{version:old.version+1,source:'user'})}else prompts.push({...p,key:c.copyId||p.key,id:'p-'+prompts.length,version:1,source:'user',updatedAt:'2026-10-08T00:00:00.000Z'})}}revision++;return response({revision,prompts,wizardTemplates:wizard})}
  if(path==='/api/templates/export')return response({document:{format:'xuanxiang-local-templates',schemaVersion:1,prompts:prompts.map(({id,updatedAt,...p})=>p),wizardTemplates:wizard}});
  throw Error('unexpected local-only call '+path);
 };
 const query=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}}),root=createRoot(document.getElementById('app'));let open=true;
 const render=()=>flushSync(()=>root.render(React.createElement(QueryClientProvider,{client:query},React.createElement(TemplateManagementDialog,{open,onOpenChange:value=>{open=value;render()}}))));render();
 return{calls,prompts,wizard,holdSave:()=>holdSave=true,resolveSave:()=>{holdSave=false;resolveSave()},holdCreate:()=>holdCreate=true,resolveCreate:()=>{holdCreate=false;resolveCreate()},failApply:value=>failApply=value,holdPreview:()=>holdPreview=true,resolvePreview:()=>{holdPreview=false;resolvePreview()},setOpen:value=>{open=value;render()},unmount:()=>{root.unmount();query.clear()}};
};`},bundle:true,platform:"browser",format:"iife",write:false,tsconfig:"tsconfig.json"}).then(r=>r.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,...(process.env.XAANINK_TEST_CHROMIUM?{executablePath:process.env.XAANINK_TEST_CHROMIUM}:{})})})
test.after(async()=>{await browser?.close()})
async function scenario(run:(page:Page)=>Promise<void>){const page=await browser.newPage(),errors:string[]=[];page.setDefaultTimeout(1800);page.on("pageerror",error=>errors.push(error.message));try{await page.route("**/*",route=>route.request().isNavigationRequest()?route.fulfill({contentType:"text/html",body:'<div id="app"></div>'}):route.abort());await page.goto("http://127.0.0.1:1/template-test");await page.addStyleTag({content:await stylesheet});await page.addScriptTag({content:await bundle});await page.evaluate(()=>{(window as any).f=(window as any).mountTemplates()});await run(page);assert.deepEqual(errors,[])}finally{await page.close()}}
const incoming={format:"xuanxiang-local-templates",schemaVersion:1,prompts:[{key:"user.test",name:"导入名称",content:"导入 {{subject}}",variables:["subject"],enabled:true,version:8,source:"user"}],wizardTemplates:[]}
async function importFile(page:Page){await page.locator('input[type="file"]').setInputFiles({name:"templates.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(incoming))});await page.getByRole("dialog",{name:"导入模板预览",exact:true}).waitFor()}
test("TPU15-01 management contains the original prompt list, editor, variable highlight and source/version metadata",async()=>scenario(async page=>{await page.getByRole("button",{name:/作者模板/}).click();await page.getByText("变量高亮预览",{exact:true}).waitFor();assert.equal(await page.locator("mark").innerText(),"{{subject}}");await page.getByText("用户模板",{exact:true}).first().waitFor();assert.equal(await page.getByRole("tab",{name:"创作模板",exact:true}).count(),1);if(process.env.XAANINK_TEMPLATE_SCREENSHOTS){await page.screenshot({path:"docs/evidence/implementation-15/templates-paper.png"});await page.evaluate(async()=>{document.documentElement.classList.add("ink");await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);for(const animation of document.getAnimations())if(animation.effect?.getComputedTiming().iterations!==Infinity)animation.finish()});await page.screenshot({path:"docs/evidence/implementation-15/templates-ink.png"});await page.setViewportSize({width:390,height:844});await page.screenshot({path:"docs/evidence/implementation-15/templates-narrow.png"})}}))
test("TPU15-02 saving an original editor uses client version and a newer draft typed during the save is retained",async()=>scenario(async page=>{await page.getByRole("button",{name:/作者模板/}).click();const field=page.getByRole("textbox",{name:"提示词名称",exact:true});await field.fill("提交名称");await page.evaluate(()=>(window as any).f.holdSave());await page.getByRole("button",{name:"保存",exact:true}).click();await field.fill("在途新草稿");await page.evaluate(()=>(window as any).f.resolveSave());await page.waitForFunction(()=>(window as any).f.calls.some((c:any)=>c.method==="PATCH"));assert.equal(await field.inputValue(),"在途新草稿");const saved=await page.evaluate(()=>(window as any).f.calls.find((c:any)=>c.method==="PATCH"));assert.equal(saved.body.expectedVersion,1);await page.getByRole("button",{name:"保存",exact:true}).click();await page.waitForFunction(()=>(window as any).f.prompts[0].version===3);assert.equal(await page.evaluate(()=>(window as any).f.prompts[0].name),"在途新草稿")}))
test("TPU15-03 builtin deletion is disabled and save-as creates a separate user key through the original creation Dialog",async()=>scenario(async page=>{await page.getByRole("button",{name:/创作参谋默认/}).click();assert.equal(await page.getByRole("button",{name:"删除",exact:true}).isDisabled(),true);await page.getByRole("button",{name:"另存为",exact:true}).click();await page.getByRole("textbox",{name:"提示词Key",exact:true}).fill("user.copy");await page.getByRole("button",{name:"创建",exact:true}).click();await page.waitForFunction(()=>(window as any).f.prompts.length===3);assert.equal(await page.evaluate(()=>(window as any).f.prompts[1].key),"chat.system")}))
test("TPU15-04 selecting a file only previews conflicts; cancelling never sends apply or changes persisted templates",async()=>scenario(async page=>{await importFile(page);await page.getByText("当前 v1 → 文件 v8",{exact:true}).waitFor();await page.getByRole("button",{name:"取消导入",exact:true}).click();assert.ok(!(await page.evaluate(()=>(window as any).f.calls)).some((c:any)=>c.body?.action==="apply"));assert.equal(await page.evaluate(()=>(window as any).f.prompts[0].name),"作者模板")}))
test("TPU15-05 explicit replacement commits only after save and invalidates the original prompt list",async()=>scenario(async page=>{await importFile(page);await page.getByRole("combobox",{name:"user.test 冲突处理",exact:true}).click();await page.getByRole("option",{name:"替换当前",exact:true}).click();assert.equal(await page.evaluate(()=>(window as any).f.prompts[0].name),"作者模板");await page.getByRole("button",{name:"保存导入",exact:true}).click();await page.getByRole("button",{name:/导入名称/}).waitFor();assert.equal(await page.evaluate(()=>(window as any).f.prompts[0].version),2)}))
test("TPU15-06 failed apply preserves preview and choices for an explicit retry without optimistic replacement",async()=>scenario(async page=>{await importFile(page);await page.getByRole("combobox",{name:"user.test 冲突处理",exact:true}).click();await page.getByRole("option",{name:"替换当前",exact:true}).click();await page.evaluate(()=>(window as any).f.failApply(true));await page.getByRole("button",{name:"保存导入",exact:true}).click();await page.getByRole("alert").filter({hasText:"模板版本已变化"}).waitFor();assert.equal(await page.evaluate(()=>(window as any).f.prompts[0].name),"作者模板");await page.evaluate(()=>(window as any).f.failApply(false));await page.getByRole("button",{name:"保存导入",exact:true}).click();await page.getByRole("button",{name:/导入名称/}).waitFor()}))
test("TPU15-07 late import preview from a closed management window cannot populate a new window",async()=>scenario(async page=>{await page.evaluate(()=>(window as any).f.holdPreview());await page.locator('input[type="file"]').setInputFiles({name:"templates.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(incoming))});await page.waitForFunction(()=>(window as any).f.calls.some((c:any)=>c.body?.action==="preview"));await page.evaluate(()=>{(window as any).f.setOpen(false);(window as any).f.setOpen(true);(window as any).f.resolvePreview()});await page.getByRole("button",{name:/作者模板/}).waitFor();assert.equal(await page.getByRole("dialog",{name:"导入模板预览",exact:true}).count(),0)}))
test("TPU15-08 export downloads a local template JSON, and only retained local API paths are called",async()=>scenario(async page=>{const button=page.getByRole("button",{name:"导出",exact:true});await button.waitFor();const downloadPromise=page.waitForEvent("download");await button.click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),"玄印写作模板与提示词.json");const contents=JSON.parse(await readFile((await download.path())!,"utf8"));assert.equal(contents.format,"xuanxiang-local-templates");assert.ok(contents.prompts.some((p:any)=>p.key==="user.test"));const calls=await page.evaluate(()=>(window as any).f.calls);assert.ok(calls.every((c:any)=>c.path.startsWith("/api/admin/prompts")||c.path.startsWith("/api/templates/")));assert.doesNotMatch(JSON.stringify(contents),/apiKey|endpoint|tokenQuota/)}))

test("TPU15-09 cancelling and reopening the same untouched creation form grants a new owner that an earlier receipt cannot close",async()=>scenario(async page=>{
  await page.getByRole("button",{name:"新建",exact:true}).click()
  await page.getByRole("textbox",{name:"提示词Key",exact:true}).fill("user.pending")
  await page.getByRole("textbox",{name:"新提示词名称",exact:true}).fill("提交的创建稿")
  await page.getByRole("textbox",{name:"新提示词内容",exact:true}).fill("提交的正文")
  await page.evaluate(()=>(window as any).f.holdCreate())
  await page.getByRole("button",{name:"创建",exact:true}).click()
  await page.waitForFunction(()=>(window as any).f.calls.some((c:any)=>c.method==="POST"&&c.path==="/api/admin/prompts"))
  await page.getByRole("dialog",{name:"新建提示词模板",exact:true}).getByRole("button",{name:"取消",exact:true}).click()
  await page.getByRole("button",{name:"新建",exact:true}).click()
  await page.evaluate(()=>(window as any).f.resolveCreate())
  await page.waitForFunction(()=>(window as any).f.prompts.length===3)
  await page.getByRole("button",{name:"创建",exact:true}).waitFor()
  assert.equal(await page.getByRole("textbox",{name:"新提示词名称",exact:true}).inputValue(),"提交的创建稿")
  assert.equal(await page.getByRole("textbox",{name:"新提示词内容",exact:true}).inputValue(),"提交的正文")
  assert.equal(await page.getByRole("dialog",{name:"新建提示词模板",exact:true}).count(),1)
}))

test("TPU15-10 text typed during creation becomes an unsaved editor draft using the created row version, and an explicit save persists it",async()=>scenario(async page=>{
  await page.getByRole("button",{name:"新建",exact:true}).click()
  await page.getByRole("textbox",{name:"提示词Key",exact:true}).fill("user.inflight")
  await page.getByRole("textbox",{name:"新提示词名称",exact:true}).fill("已提交的名称")
  await page.getByRole("textbox",{name:"新提示词内容",exact:true}).fill("已提交的正文")
  await page.evaluate(()=>(window as any).f.holdCreate())
  await page.getByRole("button",{name:"创建",exact:true}).click()
  await page.waitForFunction(()=>(window as any).f.calls.some((c:any)=>c.method==="POST"&&c.path==="/api/admin/prompts"))
  await page.getByRole("textbox",{name:"新提示词名称",exact:true}).fill("继续编辑的名称")
  await page.getByRole("textbox",{name:"新提示词内容",exact:true}).fill("继续编辑的 {{subject}} 正文")
  await page.evaluate(()=>(window as any).f.resolveCreate())
  const name=page.getByRole("textbox",{name:"提示词名称",exact:true})
  await name.waitFor()
  assert.equal(await name.inputValue(),"继续编辑的名称")
  assert.equal(await page.getByRole("textbox",{name:"提示词内容",exact:true}).inputValue(),"继续编辑的 {{subject}} 正文")
  assert.equal(await page.evaluate(()=>(window as any).f.prompts.find((p:any)=>p.key==="user.inflight").content),"已提交的正文")
  await page.getByRole("button",{name:"保存",exact:true}).click()
  await page.waitForFunction(()=>(window as any).f.prompts.find((p:any)=>p.key==="user.inflight").version===2)
  assert.equal(await page.evaluate(()=>(window as any).f.calls.find((c:any)=>c.method==="PATCH").body.expectedVersion),1)
  assert.equal(await page.evaluate(()=>(window as any).f.prompts.find((p:any)=>p.key==="user.inflight").content),"继续编辑的 {{subject}} 正文")
}))
