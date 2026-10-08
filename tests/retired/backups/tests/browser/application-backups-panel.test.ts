import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'
import {build} from 'esbuild'
import {chromium,type Browser,type Page} from 'playwright-core'
let browser:Browser,bundle:string
test.before(async()=>{
 const result=await build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{ApplicationBackupsPanel}from'./src/components/desktop/ApplicationBackupsPanel';const pending=[];window.desktop={applicationBackups:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))};let root;window.fixture={pending,mount(){root=createRoot(document.getElementById('app'));flushSync(()=>root.render(<ApplicationBackupsPanel/>))},unmount(){flushSync(()=>root.unmount())},resolve(index,rows){pending[index].resolve(rows)},reject(index){pending[index].reject(Error('备份目录暂不可用'))}};`},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json'});bundle=result.outputFiles![0].text
 browser=await chromium.launch({headless:true,...(process.env.XAANINK_TEST_CHROMIUM?{executablePath:process.env.XAANINK_TEST_CHROMIUM}:{})})
});test.after(async()=>{await browser?.close()})
async function scenario(run:(page:Page)=>Promise<void>){const page=await browser.newPage({viewport:{width:900,height:760}}),errors:string[]=[];page.setDefaultTimeout(2500);page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());try{await page.setContent('<div id="app"></div>');await page.addScriptTag({content:bundle});await page.evaluate(()=>(window as any).fixture.mount());await run(page);assert.deepEqual(errors,[])}finally{await page.close()}}
const rows=(count:number)=>Array.from({length:count},(_,index)=>({id:randomUUID(),appId:'74868b9b-97af-46ef-996b-15e953d04f48',createdAt:new Date(Date.UTC(2026,9,1,12,index)).toISOString(),bytes:1024*(index+1)}))
test('real application backup list waits for receipts and paginates every verified backup',()=>scenario(async page=>{
 await page.getByText('正在读取应用备份…',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'刷新应用备份'}).isDisabled(),true)
 const values=rows(23);await page.evaluate(value=>(window as any).fixture.resolve(0,value),values)
 assert.equal(await page.getByRole('list',{name:'应用数据备份列表'}).getByRole('listitem').count(),20);await page.getByRole('button',{name:'下一页应用备份'}).click();assert.equal(await page.getByRole('list',{name:'应用数据备份列表'}).getByRole('listitem').count(),3)
 assert.ok((await page.getByRole('list',{name:'应用数据备份列表'}).textContent())?.includes('1.0 KB'));assert.equal(await page.getByText(values[0].appId).count(),0)
}))
test('empty and failed lists stay distinct; refreshing fails without erasing the previous verified list',()=>scenario(async page=>{
 await page.evaluate(()=>(window as any).fixture.resolve(0,[]));await page.getByText('暂无应用数据备份。',{exact:true}).waitFor();await page.getByRole('button',{name:'刷新应用备份'}).click();await page.evaluate(value=>(window as any).fixture.resolve(1,value),rows(1));await page.getByRole('list',{name:'应用数据备份列表'}).waitFor()
 await page.getByRole('button',{name:'刷新应用备份'}).click();await page.evaluate(()=>(window as any).fixture.reject(2));await page.getByRole('alert').filter({hasText:'备份目录暂不可用'}).waitFor();assert.equal(await page.getByRole('listitem').count(),1);assert.equal(await page.getByText('暂无应用数据备份。',{exact:true}).count(),0)
}))
test('a previous panel reply cannot replace a reopened panel or release its pending refresh',()=>scenario(async page=>{
 await page.evaluate(()=>{(window as any).fixture.unmount();(window as any).fixture.mount()});await page.evaluate(value=>(window as any).fixture.resolve(0,value),rows(1));assert.equal(await page.getByRole('button',{name:'刷新应用备份'}).isDisabled(),true);assert.equal(await page.getByRole('listitem').count(),0)
 await page.evaluate(()=>(window as any).fixture.resolve(1,[]));await page.getByText('暂无应用数据备份。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'刷新应用备份'}).isEnabled(),true)
}))
