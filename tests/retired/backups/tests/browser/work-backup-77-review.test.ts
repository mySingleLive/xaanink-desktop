import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
import {chromium,type Browser,type Page} from 'playwright-core'
const bundle=build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{WorkBackupButton}from'./src/components/desktop/WorkBackupButton';
 const calls=[],pending=[];let root;window.desktop={workBackup:action=>{calls.push(action);return new Promise((resolve,reject)=>pending.push({resolve,reject}))}};
 window.fixture={calls,mount(){root=createRoot(document.getElementById('app'));flushSync(()=>root.render(React.createElement(WorkBackupButton)))},unmount(){flushSync(()=>root.unmount())},resolve(index,result){pending[index].resolve(result)},reject(index,message){pending[index].reject(Error(message))}};
 `},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json'}).then(result=>result.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,...(process.env.XAANINK_TEST_CHROMIUM?{executablePath:process.env.XAANINK_TEST_CHROMIUM}:{})})});test.after(async()=>{await browser?.close()})
async function scenario(run:(page:Page)=>Promise<void>){const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());try{await page.setContent('<div id="app"></div>');await page.addScriptTag({content:await bundle});await page.evaluate(()=>(window as any).fixture.mount());await run(page);assert.deepEqual(errors,[])}finally{await page.close()}}
test('BU77-01 a partial batch cannot display complete success and an explicit retry replaces its error',()=>scenario(async page=>{
 await page.getByRole('button',{name:'立即备份'}).click();await page.evaluate(()=>(window as any).fixture.resolve(0,{type:'now',saved:[{id:'saved'}],failed:[{title:'离线作品',message:'目录暂不可读'}]}))
 await page.getByRole('alert').filter({hasText:'离线作品：目录暂不可读'}).waitFor();assert.equal(await page.getByRole('status').count(),0);assert.equal(await page.getByRole('button',{name:'立即备份'}).isEnabled(),true)
 await page.getByRole('button',{name:'立即备份'}).click();assert.equal(await page.getByRole('alert').count(),0);await page.evaluate(()=>(window as any).fixture.resolve(1,{type:'now',saved:[{id:'one'}],failed:[]}));await page.getByRole('status').filter({hasText:'已完成 1 部作品备份'}).waitFor();assert.deepEqual(await page.evaluate(()=>(window as any).fixture.calls),[{type:'now'},{type:'now'}])
}))
test('BU77-02 a previous settings instance reply cannot clear a reopened instance busy state or replace its new result',()=>scenario(async page=>{
 await page.getByRole('button',{name:'立即备份'}).click();await page.evaluate(()=>{(window as any).fixture.unmount();(window as any).fixture.mount()});await page.getByRole('button',{name:'立即备份'}).click()
 await page.evaluate(()=>(window as any).fixture.resolve(0,{type:'now',saved:[{id:'old'}],failed:[]}));assert.equal(await page.getByRole('button',{name:'正在备份…'}).isDisabled(),true);assert.equal(await page.getByRole('status').count(),0)
 await page.evaluate(()=>(window as any).fixture.reject(1,'新窗口此次备份失败'));await page.getByRole('alert').filter({hasText:'新窗口此次备份失败'}).waitFor();await page.getByRole('button',{name:'立即备份'}).click();await page.evaluate(()=>(window as any).fixture.resolve(2,{type:'now',saved:[],failed:[]}));await page.getByRole('status').filter({hasText:'尚无作品可备份'}).waitFor();assert.equal(await page.evaluate(()=>(window as any).fixture.calls.length),3)
}))
