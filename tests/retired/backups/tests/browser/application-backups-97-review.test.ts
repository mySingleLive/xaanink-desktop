import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {build} from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import {chromium,type Browser,type Page} from 'playwright-core'
import type {ApplicationBackupSummary} from '../../desktop/shared/application-backup-control'

declare global{interface Window{review97:{mount(strict?:boolean):void;unmount():void;resolve(index:number,rows:unknown):void;reject(index:number,message:string):void;count():number;removeBridge():void;install():void;returned:unknown[][]}}}
const css=(async()=>{const path=resolve('src/app/globals.css');return(await postcss([tailwind()]).process(await readFile(path,'utf8'),{from:path})).css})()
const script=build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{ApplicationBackupsPanel}from'./src/components/desktop/ApplicationBackupsPanel';
const pending=[],returned=[];let root;const install=()=>{window.desktop={applicationBackups:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))}};install();
window.review97={returned,install,removeBridge(){window.desktop={}},count:()=>pending.length,mount(strict=false){root=createRoot(document.getElementById('app'));flushSync(()=>root.render(strict?<React.StrictMode><ApplicationBackupsPanel/></React.StrictMode>:<ApplicationBackupsPanel/>))},unmount(){flushSync(()=>root.unmount())},resolve(index,rows){returned.push(rows);pending[index].resolve(rows)},reject(index,message){pending[index].reject(Error(message))}};
`},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json'}).then(result=>result.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.XAANINK_TEST_CHROMIUM})})
test.after(async()=>{await browser?.close()})
async function isolated(run:(page:Page)=>Promise<void>){const page=await browser.newPage({viewport:{width:840,height:640}}),errors:string[]=[];page.setDefaultTimeout(2500);page.on('pageerror',error=>errors.push(error.message));try{await page.route('**/*',route=>route.abort());await page.setContent('<html lang="zh-CN"><body><div id="app"></div></body></html>');await page.addStyleTag({content:await css});await page.addScriptTag({content:await script});await run(page);assert.deepEqual(errors,[])}finally{await page.close()}}
const rows=(count:number):ApplicationBackupSummary[]=>Array.from({length:count},(_,index)=>({id:randomUUID(),appId:'2bfe8dfc-5a85-478b-95b3-754c89416912',createdAt:new Date(Date.UTC(2026,9,1,0,index)).toISOString(),bytes:index%2?1024:0}))

test('ABL97-UI01 StrictMode expired effects cannot install old rows, old errors or release the active request',()=>isolated(async page=>{
 await page.evaluate(()=>window.review97.mount(true));assert.equal(await page.evaluate(()=>window.review97.count()),2)
 await page.evaluate(()=>window.review97.reject(0,'old-effect-error'));await page.waitForTimeout(25);assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.getByRole('button',{name:'刷新应用备份'}).isDisabled(),true)
 const values=rows(1);await page.evaluate(values=>window.review97.resolve(1,values),values);await page.getByRole('listitem').waitFor();assert.equal(await page.getByRole('button',{name:'刷新应用备份'}).isEnabled(),true);assert.equal(await page.getByRole('alert').count(),0)
}))

test('ABL97-UI02 a retired mounted instance cannot replace or settle a reopened list request',()=>isolated(async page=>{
 await page.evaluate(()=>{window.review97.mount();window.review97.unmount();window.review97.mount()});await page.evaluate(values=>window.review97.resolve(0,values),rows(2));await page.waitForTimeout(25)
 assert.equal(await page.getByRole('listitem').count(),0);assert.equal(await page.getByRole('button',{name:'刷新应用备份'}).isDisabled(),true)
 await page.evaluate(()=>window.review97.reject(1,'本地读取失败'));await page.getByRole('alert').filter({hasText:'本地读取失败'}).waitFor();assert.equal(await page.getByText('暂无应用数据备份。',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'刷新应用备份'}).isEnabled(),true)
}))

test('ABL97-UI03 all 1000 truthful rows remain reachable once across 50 real BaseUI pagination clicks without mutating the receipt',{timeout:30000},()=>isolated(async page=>{
 await page.evaluate(()=>window.review97.mount());const values=rows(1000);await page.evaluate(values=>window.review97.resolve(0,values),values);await page.getByRole('list',{name:'应用数据备份列表'}).waitFor()
 const seen:string[]=[];for(let pageIndex=0;pageIndex<50;pageIndex++){const list=page.getByRole('list',{name:'应用数据备份列表'});assert.equal(await list.getByRole('listitem').count(),20);seen.push(...await list.locator('time').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('datetime')!)));if(pageIndex<49)await page.getByRole('button',{name:'下一页应用备份'}).click()}
 assert.deepEqual(seen,[...values].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(row=>row.createdAt));assert.equal(new Set(seen).size,1000);assert.equal(await page.getByRole('button',{name:'下一页应用备份'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'上一页应用备份'}).isEnabled(),true)
 assert.deepEqual(await page.evaluate(()=>window.review97.returned[0]),values);assert.equal(await page.getByText(values[0].appId,{exact:true}).count(),0)
}))

test('ABL97-UI04 refresh failures preserve current page and successful shorter receipts reset to the first valid page',()=>isolated(async page=>{
 await page.evaluate(()=>window.review97.mount());await page.evaluate(values=>window.review97.resolve(0,values),rows(41));await page.getByRole('listitem').first().waitFor();await page.getByRole('button',{name:'下一页应用备份'}).click();await page.getByRole('button',{name:'下一页应用备份'}).click();assert.equal(await page.getByRole('listitem').count(),1)
 const previous=await page.getByRole('list',{name:'应用数据备份列表'}).innerText();await page.getByRole('button',{name:'刷新应用备份'}).click();assert.equal(await page.getByRole('button',{name:'上一页应用备份'}).isDisabled(),true)
 await page.evaluate(()=>window.review97.reject(1,'目录暂时失联'));await page.getByRole('alert').filter({hasText:'目录暂时失联'}).waitFor();assert.equal(await page.getByRole('list',{name:'应用数据备份列表'}).innerText(),previous);await page.getByText('共 41 份 · 3 / 3',{exact:true}).waitFor()
 await page.getByRole('button',{name:'刷新应用备份'}).click();await page.evaluate(values=>window.review97.resolve(2,values),rows(2));await page.waitForFunction(()=>document.querySelectorAll('li').length===2);assert.equal(await page.getByRole('alert').count(),0);assert.equal(await page.getByRole('button',{name:'下一页应用备份'}).count(),0)
}))

test('ABL97-UI05 missing bridge and malformed summaries are failures, never false empty or data replacement; explicit retries can return true empty',()=>isolated(async page=>{
 await page.evaluate(()=>{window.review97.removeBridge();window.review97.mount()});await page.getByRole('alert').filter({hasText:'应用数据备份暂不可用'}).waitFor();assert.equal(await page.getByText('暂无应用数据备份。',{exact:true}).count(),0)
 await page.evaluate(()=>window.review97.install());await page.getByRole('button',{name:'刷新应用备份'}).click();const bad={...rows(1)[0],createdAt:'invalid-private-value',privatePath:'/private/do-not-display'};await page.evaluate(row=>window.review97.resolve(0,[row]),bad);await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('listitem').count(),0);assert.doesNotMatch(await page.getByRole('region',{name:'应用数据备份'}).innerText(),/do-not-display|invalid-private-value/)
 await page.getByRole('button',{name:'刷新应用备份'}).click();await page.evaluate(()=>window.review97.resolve(1,[]));await page.getByText('暂无应用数据备份。',{exact:true}).waitFor();assert.equal(await page.getByRole('alert').count(),0)
}))
