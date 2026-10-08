import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { chromium, type Browser, type Page } from 'playwright-core'

// Actual React/Query/BaseUI and original manager. API is an isolated gate,
// not a real Electron picker, user database or native end-to-end proof.
const stylesheet=(async()=>{const path=resolve('src/app/globals.css');return(await postcss([tailwindcss()]).process(await readFile(path,'utf8'),{from:path})).css})()
const bundle=build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{TemplateManagementDialog}from'./src/components/desktop/TemplateManagementDialog';
window.mountReview=()=>{
 const rows=[{id:'p-b',key:'user.b',name:'现有B模板',content:'B正文',variables:[],version:1,enabled:true,source:'user',updatedAt:'2026-10-08T00:00:00.000Z'}],calls=[];
 let acceptCreate,createEntered=false;
 window.fetch=async(input,init={})=>{
  const path=String(input),method=init.method||'GET',body=init.body?JSON.parse(init.body):null;calls.push({path,method,body});
  if(path==='/api/admin/prompts'&&method==='GET')return Response.json({prompts:rows,revision:1});
  if(path==='/api/admin/prompts'&&method==='POST'){createEntered=true;await new Promise(yes=>acceptCreate=yes);const prompt={...body,id:'p-a',version:1,enabled:true,source:'user',updatedAt:'2026-10-08T00:00:01.000Z'};rows.push(prompt);return Response.json({prompt},{status:201})}
  if(path==='/api/templates/wizard')return Response.json({templates:[],revision:1});
  throw Error('Unexpected isolated API '+method+' '+path)
 };
 const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}}),root=createRoot(document.getElementById('app'));
 flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(TemplateManagementDialog,{open:true,onOpenChange:()=>{}}))));
 return{calls,rows,entered:()=>createEntered,finish:()=>acceptCreate(),unmount:()=>{root.unmount();client.clear()}};
};`},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json'}).then(result=>result.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.XAANINK_TEST_CHROMIUM})})
test.after(async()=>{await browser?.close()})
async function scenario(run:(page:Page)=>Promise<void>){
  const page=await browser.newPage(),errors:string[]=[];page.setDefaultTimeout(2400);page.on('pageerror',cause=>errors.push(cause.message))
  try{
    await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):route.abort())
    await page.goto('http://127.0.0.1:1/template-review');await page.addStyleTag({content:await stylesheet});await page.addScriptTag({content:await bundle});await page.evaluate(()=>{(window as any).review=(window as any).mountReview()})
    await run(page);assert.deepEqual(errors,[])
  }finally{await page.close()}
}
async function createPending(page:Page){
  await page.getByRole('button',{name:'新建',exact:true}).click()
  await page.getByRole('textbox',{name:'提示词Key',exact:true}).fill('user.a')
  await page.getByRole('textbox',{name:'新提示词名称',exact:true}).fill('已提交A')
  await page.getByRole('textbox',{name:'新提示词内容',exact:true}).fill('A正文')
  await page.getByRole('button',{name:'创建',exact:true}).click();await page.waitForFunction(()=>(window as any).review.entered())
}

test('TPL79-U01: a late successful create cannot retarget the original manager away from an actively edited B after the create dialog was dismissed',async()=>scenario(async page=>{
  await createPending(page)
  await page.getByRole('dialog',{name:'新建提示词模板',exact:true}).getByRole('button',{name:'取消',exact:true}).click()
  await page.getByRole('button',{name:/现有B模板/}).click()
  const name=page.getByRole('textbox',{name:'提示词名称',exact:true});await name.fill('B尚未保存的新稿')
  await page.evaluate(()=>(window as any).review.finish());await page.getByRole('button',{name:/已提交A/}).waitFor()
  assert.equal(await name.inputValue(),'B尚未保存的新稿')
  assert.match(await page.getByRole('button',{name:/现有B模板/}).getAttribute('class')??'',/bg-primary/)
}))

test('TPL79-U02: later text entered while create is pending remains visible after the submitted row is acknowledged',async()=>scenario(async page=>{
  await createPending(page)
  await page.getByRole('textbox',{name:'新提示词名称',exact:true}).fill('在途尚未提交的新名称')
  await page.getByRole('textbox',{name:'新提示词内容',exact:true}).fill('在途尚未提交的新正文')
  await page.evaluate(()=>(window as any).review.finish());await page.waitForFunction(()=>(window as any).review.rows.some((row:any)=>row.id==='p-a'))
  // Keeping the current creation draft or transferring it to the created row
  // are both valid. A retained BaseUI modal legitimately makes the list inert.
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))
  assert.ok((await page.locator('input').evaluateAll(elements=>elements.map(element=>(element as HTMLInputElement).value))).includes('在途尚未提交的新名称'))
  assert.ok((await page.locator('textarea').evaluateAll(elements=>elements.map(element=>(element as HTMLTextAreaElement).value))).includes('在途尚未提交的新正文'))
  assert.equal(await page.evaluate(()=>(window as any).review.rows.find((row:any)=>row.id==='p-a').content),'A正文')
}))
