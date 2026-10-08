import assert from "node:assert/strict"
import { test } from "node:test"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { build } from "esbuild"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { chromium, type Browser, type Page } from "playwright-core"

const stylesheet=(async()=>{const path=resolve("src/app/globals.css");return(await postcss([tailwindcss()]).process(await readFile(path,"utf8"),{from:path})).css})()
const bundle=build({stdin:{loader:"tsx",resolveDir:process.cwd(),contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {CreateNovelDialog} from './src/components/layout/CreateNovelDialog';import {WizardTemplatesClient} from './src/components/desktop/WizardTemplatesClient';import {useChatStore} from './src/stores/chat';
globalThis.mountWizard=(manager=false,options={})=>{
 window.desktop={};useChatStore.setState({draft:'',accountId:'local-author',recoveryStatus:'ready',newConversationRequested:false,newConversationPayload:null});
 const calls=[],rows=[{template:{id:'user-theme',cat:'theme',title:'作者本地主题',summary:'本地卡片摘要',channels:['男频'],genres:['玄幻'],tags:['热血'],prompt:'本地向导草稿'},version:1,enabled:true,source:'user'}, {template:{id:'other-theme',cat:'theme',title:'其他主题',summary:'另一张卡片',channels:[],genres:[],tags:[],prompt:'另一段草稿'},version:1,enabled:true,source:'builtin'}, {template:{id:'disabled-theme',cat:'theme',title:'已停用卡片',summary:'不会进入向导',channels:[],genres:[],tags:[],prompt:'停用内容'},version:2,enabled:false,source:'user'}];
 let hold=!!options.hold,loadError=!!options.loadError,resolveLoad,holdSave=false,resolveSave,closed=0;
 window.fetch=async(input,init={})=>{const path=String(input),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({path,method,body});const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
  if(path.startsWith('/api/templates/wizard')&&method==='GET'){if(hold)await new Promise(yes=>resolveLoad=yes);if(loadError)return response({error:'本地模板暂不可用'},500);return response({templates:path.includes('enabled=true')?rows.filter(p=>p.enabled):rows,revision:1})}
  if(path==='/api/templates/wizard'&&method==='POST'){const row={...body,version:1,source:'user'};rows.push(row);return response({template:row},201)}
  if(path.startsWith('/api/templates/wizard/')&&method==='PATCH'){if(holdSave)await new Promise(yes=>resolveSave=yes);const row=rows.find(p=>p.template.id===path.split('/').at(-1));Object.assign(row,body,{version:row.version+1});return response({template:row})}
  throw Error('unexpected local wizard call '+path)
 };
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}),root=createRoot(document.getElementById('app'));
 flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},manager?React.createElement(WizardTemplatesClient):React.createElement(CreateNovelDialog,{open:true,onOpenChange:value=>{if(!value)closed++},novels:[]}))));
 return{rows,calls,closed:()=>closed,chat:()=>useChatStore.getState().newConversationPayload,resolveLoad:()=>{hold=false;resolveLoad()},retryLoad:()=>loadError=false,holdSave:()=>holdSave=true,resolveSave:()=>{holdSave=false;resolveSave()},disableSelected:()=>{rows[0].enabled=false;return client.invalidateQueries({queryKey:['desktop','wizard-templates']})}};
};`},bundle:true,platform:"browser",format:"iife",write:false,tsconfig:"tsconfig.json"}).then(r=>r.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,...(process.env.XAANINK_TEST_CHROMIUM?{executablePath:process.env.XAANINK_TEST_CHROMIUM}:{})})})
test.after(async()=>{await browser?.close()})
async function scenario(manager:boolean,options:Record<string,unknown>,run:(page:Page)=>Promise<void>){const page=await browser.newPage(),errors:string[]=[];page.setDefaultTimeout(1800);page.on("pageerror",e=>errors.push(e.message));try{await page.route("**/*",route=>route.request().isNavigationRequest()?route.fulfill({contentType:"text/html",body:'<div id="app"></div>'}):route.abort());await page.goto("http://127.0.0.1:1/local-wizard");await page.addStyleTag({content:await stylesheet});await page.addScriptTag({content:await bundle});await page.evaluate(({manager,options})=>{(window as any).f=(window as any).mountWizard(manager,options)},{manager,options});await run(page);assert.deepEqual(errors,[])}finally{await page.close()}}

test("WZU15-01 original creation wizard displays local cards, details and composes the selected real local prompt without sending",async()=>scenario(false,{},async page=>{
 await page.getByRole("button",{name:/作者本地主题/}).dblclick();await page.getByText("本地向导草稿",{exact:true}).waitFor();await page.getByRole("button",{name:"使用此模板",exact:true}).click();await page.getByRole("button",{name:"确定",exact:true}).click()
 const payload=await page.evaluate(()=>(window as any).f.chat());assert.match(payload.draft,/本地向导草稿/);assert.equal(payload.novelId,null);assert.ok(!payload.autoSend);assert.equal(await page.evaluate(()=>(window as any).f.closed()),1);assert.ok((await page.evaluate(()=>(window as any).f.calls)).every((c:any)=>c.path==="/api/templates/wizard?enabled=true"))
}))
test("WZU15-02 original filters consume local channel/genre metadata and disabled cards stay outside the wizard",async()=>scenario(false,{},async page=>{
 await page.getByRole("button",{name:/作者本地主题/}).waitFor();assert.equal(await page.getByRole("button",{name:/已停用卡片/}).count(),0)
 await page.getByRole("button",{name:"女频",exact:true}).click();assert.equal(await page.getByRole("button",{name:/作者本地主题/}).count(),0);await page.getByRole("button",{name:"男频",exact:true}).click();await page.getByRole("button",{name:/作者本地主题/}).waitFor()
}))
test("WZU15-03 local catalog read failure cannot silently fall back to bundled cards or accept a new wizard draft; explicit retry restores original UI",async()=>scenario(false,{loadError:true},async page=>{
 await page.getByRole("alert").filter({hasText:"本地模板暂不可用"}).waitFor();assert.equal(await page.getByRole("button",{name:"确定",exact:true}).isDisabled(),true);assert.equal(await page.getByRole("button",{name:/废柴觉醒噬神血/}).count(),0);assert.equal(await page.evaluate(()=>(window as any).f.chat()),null)
 await page.evaluate(()=>(window as any).f.retryLoad());await page.getByRole("button",{name:"重新加载模板",exact:true}).click();await page.getByRole("button",{name:/作者本地主题/}).waitFor();assert.equal(await page.getByRole("button",{name:"确定",exact:true}).isDisabled(),false)
}))
test("WZU15-04 pending local catalog never authorizes a bundled fallback choice or confirm before actual local data",async()=>scenario(false,{hold:true},async page=>{
 await page.waitForFunction(()=>(window as any).f.calls.length===1);assert.equal(await page.getByRole("button",{name:"确定",exact:true}).isDisabled(),true);assert.equal(await page.getByRole("button",{name:/废柴觉醒噬神血/}).count(),0);await page.evaluate(()=>(window as any).f.resolveLoad());await page.getByRole("button",{name:/作者本地主题/}).waitFor();assert.equal(await page.getByRole("button",{name:"确定",exact:true}).isDisabled(),false)
}))
test("WZU15-05 management save-as persists a complete user WizardTemplate and keeps the original builtin metadata intact",async()=>scenario(true,{},async page=>{
 await page.getByRole("button",{name:/其他主题/}).click();assert.equal(await page.getByRole("button",{name:"删除",exact:true}).isDisabled(),true);await page.getByRole("button",{name:"另存为",exact:true}).click();await page.getByRole("textbox",{name:"创作模板标识",exact:true}).fill("user.copy-theme");await page.getByRole("textbox",{name:"创作模板名称",exact:true}).fill("本地副本名称");await page.getByRole("textbox",{name:"创作模板拼贴内容",exact:true}).fill("作者自己的拼贴草稿");await page.getByRole("button",{name:"保存",exact:true}).click();await page.waitForFunction(()=>(window as any).f.rows.length===4)
 const rows=await page.evaluate(()=>(window as any).f.rows);assert.equal(rows[1].template.prompt,"另一段草稿");assert.equal(rows[3].template.prompt,"作者自己的拼贴草稿");assert.equal(rows[3].source,"user");assert.equal(rows[3].version,1)
}))
test("WZU15-06 late save of A never changes the active list selection or newer editing draft for B",async()=>scenario(true,{},async page=>{
 await page.getByRole("button",{name:/作者本地主题/}).click();await page.getByRole("textbox",{name:"创作模板名称",exact:true}).fill("A已提交");await page.evaluate(()=>(window as any).f.holdSave());await page.getByRole("button",{name:"保存",exact:true}).click();await page.getByRole("button",{name:/其他主题/}).click();await page.getByRole("textbox",{name:"创作模板名称",exact:true}).fill("B新输入")
 const selected=page.getByRole("button",{name:/其他主题/});assert.match(await selected.getAttribute("class")??"",/bg-primary/);await page.evaluate(()=>(window as any).f.resolveSave());await page.waitForFunction(()=>(window as any).f.rows[0].version===2)
 assert.match(await selected.getAttribute("class")??"",/bg-primary/);assert.equal(await page.getByRole("textbox",{name:"创作模板名称",exact:true}).inputValue(),"B新输入")
}))
test("WZU15-07 disabling a selected local card during catalog refresh clears its selection and detail, never composing stale disabled content",async()=>scenario(false,{},async page=>{
 await page.getByRole("button",{name:/作者本地主题/}).dblclick();await page.getByText("本地向导草稿",{exact:true}).waitFor();await page.evaluate(()=>(window as any).f.disableSelected());await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button[aria-pressed]')).some(button=>button.textContent?.includes('作者本地主题')))
 assert.equal(await page.getByText("本地向导草稿",{exact:true}).count(),0);assert.equal(await page.getByText("《?》",{exact:true}).count(),0)
 await page.getByRole("button",{name:"确定",exact:true}).click();assert.doesNotMatch((await page.evaluate(()=>(window as any).f.chat())).draft,/本地向导草稿/)
}))
test("WZU15-08 discarded delimiter field drafts never appear in a reselected saved template or a fresh creation form",async()=>scenario(true,{},async page=>{
 await page.getByRole("button",{name:/作者本地主题/}).click();const channels=page.getByRole("textbox",{name:"频道（逗号分隔）",exact:true});await channels.fill("男频，女频")
 await page.getByRole("button",{name:/其他主题/}).click();await page.getByRole("button",{name:/作者本地主题/}).click();assert.equal(await channels.inputValue(),"男频")
 await page.getByRole("button",{name:"新建",exact:true}).click();const tags=page.getByRole("textbox",{name:"标签（逗号分隔）",exact:true});await tags.fill("热血，")
 await page.getByRole("button",{name:"新建",exact:true}).click();assert.equal(await tags.inputValue(),"");assert.equal(await page.evaluate(()=>(window as any).f.rows[0].template.channels.join("，")),"男频")
}))
