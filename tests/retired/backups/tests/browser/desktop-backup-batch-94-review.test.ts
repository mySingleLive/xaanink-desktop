import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {build} from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import {chromium,type Browser,type Page} from 'playwright-core'

const css=(async()=>{const from=resolve('src/app/globals.css');return(await postcss([tailwind()]).process(await readFile(from,'utf8'),{from})).css+'\n'+await readFile('src/app/desktop.css','utf8')})()
const script=build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{WorkBackupButton}from'./src/components/desktop/WorkBackupButton';
globalThis.reviewMount=()=>{
 const calls=[];let key=0;const root=createRoot(document.getElementById('app'));
 window.desktop={workBackup:action=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});calls.push({action,resolve,reject});return promise}};
 const render=()=>flushSync(()=>root.render(React.createElement(WorkBackupButton,{key})));
 render();globalThis.review={calls,remount:()=>{key++;render()},resolve:(index,value)=>calls[index].resolve(value),reject:(index,message)=>calls[index].reject(Error(message)),unmount:()=>flushSync(()=>root.unmount())};
};`},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json'}).then(result=>result.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.XAANINK_TEST_CHROMIUM})})
test.after(async()=>{await browser?.close()})
async function scenario(run:(page:Page)=>Promise<void>){
 const page=await browser.newPage({viewport:{width:400,height:300}}),errors:string[]=[];page.setDefaultTimeout(2000);page.on('pageerror',error=>errors.push(error.message))
 try{
  await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><body><div id="app"></div></body></html>'}):route.abort())
  await page.goto('http://127.0.0.1:1/review94-isolated');await page.addStyleTag({content:await css});await page.addScriptTag({content:await script});await page.evaluate(()=>(window as any).reviewMount())
  await run(page);assert.deepEqual(errors,[])
 }finally{await page.close()}
}
function saved(cleanupPending:number){return{status:'saved',backup:{id:'86f52ed4-aa48-4090-93c4-794dd90fdf6d',appId:'229c8886-c14e-4e09-a48f-e3468f16d0cf',createdAt:'2026-10-08T00:00:00.000Z',bytes:3,retained:[],cleanupPending}}}
async function reply(page:Page,index:number,result:unknown){await page.evaluate(({index,result})=>(window as any).review.resolve(index,result),{index,result})}

test('DB94-05: actual original Button reports both saved application cleanup and partial work failure without a success role',()=>scenario(async page=>{
 await page.getByRole('button',{name:'立即备份'}).click()
 await reply(page,0,{type:'now',saved:[],failed:[],application:saved(3),workError:'作品目录暂不可读'})
 const alert=page.getByRole('alert');await alert.waitFor();assert.match(await alert.innerText(),/已完成应用数据备份/);assert.match(await alert.innerText(),/3 项临时数据待清理/);assert.match(await alert.innerText(),/作品目录暂不可读/)
 assert.equal(await page.getByRole('status').count(),0);assert.equal(await page.getByRole('button',{name:'立即备份'}).isEnabled(),true)
}))

test('DB94-06: actual UI treats an explicitly present empty work error as failure and keeps the verified cleanup warning',()=>scenario(async page=>{
 await page.getByRole('button',{name:'立即备份'}).click();await reply(page,0,{type:'now',saved:[],failed:[],application:saved(2),workError:''})
 await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/作品备份未完成/);assert.match(await page.getByRole('alert').innerText(),/2 项临时数据待清理/)
 assert.equal(await page.getByRole('status').count(),0)
}))

test('DB94-07: a retired instance late rejection cannot settle a new pending backup or replace its no-work application receipt',()=>scenario(async page=>{
 await page.getByRole('button',{name:'立即备份'}).click();await page.evaluate(()=>(window as any).review.remount())
 await page.getByRole('button',{name:'立即备份'}).click();await page.evaluate(()=>(window as any).review.reject(0,'旧实例的迟到失败'))
 await page.waitForTimeout(20);assert.equal(await page.getByRole('button',{name:'正在备份…'}).isDisabled(),true);assert.equal(await page.getByRole('alert').count(),0)
 assert.deepEqual(await page.evaluate(()=>(window as any).review.calls.map((item:{action:unknown})=>item.action)),[{type:'now'},{type:'now'}])
 await reply(page,1,{type:'now',saved:[],failed:[],application:saved(1)});await page.getByRole('status').waitFor()
 assert.match(await page.getByRole('status').innerText(),/已完成应用数据备份/);assert.match(await page.getByRole('status').innerText(),/1 项临时数据待清理/);assert.equal(await page.getByText('尚无作品可备份').count(),0)
 assert.equal(await page.getByRole('button',{name:'立即备份'}).isEnabled(),true);assert.equal(await page.locator('[data-slot="button"]').count(),1)
}))
