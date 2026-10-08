import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {build} from 'esbuild'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import {chromium,type Browser,type Page} from 'playwright-core'
import type {RootMaintenanceState} from '../../desktop/shared/root-maintenance'
const css=(async()=>{const path=resolve('src/app/globals.css');return (await postcss([tailwindcss()]).process(await readFile(path,'utf8'),{from:path})).css+'\n'+await readFile('src/app/desktop.css','utf8')})()
const bundle=build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{RootMaintenanceScreen}from'./src/components/desktop/RootMaintenanceScreen';
globalThis.openHistory=state=>{const listeners=new Set(),calls=[];window.desktopMaintenance={state:async()=>state,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},command:async command=>{calls.push(command)}};const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(React.createElement(RootMaintenanceScreen)));return{calls,emit:state=>flushSync(()=>listeners.forEach(listener=>listener(state)))}};`},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json'}).then(result=>result.outputFiles[0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,...process.env.XAANINK_TEST_CHROMIUM?{executablePath:process.env.XAANINK_TEST_CHROMIUM}:{}})})
test.after(async()=>{await browser?.close()})
const initial:RootMaintenanceState={version:1,revision:1,phase:'cleanup-pending',theme:'paper',sourcePath:'/迁移时/旧源',targetPath:'/迁移时/旧目标',currentRootPath:'/重新定位/当前原目录',copiedFiles:0,totalFiles:null,canCancel:false,canContinue:true,pendingCount:1,pendingItems:['unknown-note.txt']}
async function scenario(run:(page:Page)=>Promise<void>){const page=await browser.newPage({viewport:{width:680,height:660}}),errors:string[]=[];page.setDefaultTimeout(1600);page.on('pageerror',e=>errors.push(e.message));try{await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:'<div id="app"></div>'}):route.abort());await page.goto('http://127.0.0.1:1/history');await page.addStyleTag({content:await css});await page.addScriptTag({content:await bundle});await run(page);assert.deepEqual(errors,[])}finally{await page.close()}}
async function mount(page:Page,state=initial){await page.evaluate(state=>{(window as any).h=(window as any).openHistory(state)},state)}
test('HR33-01 fresh current root is distinct from immutable migration source/target, pending files and explicit continue remain intact',async()=>scenario(async page=>{
 await mount(page);await page.getByText('当前数据目录',{exact:true}).waitFor();await page.getByText(initial.currentRootPath!,{exact:true}).waitFor();await page.getByText(initial.sourcePath!,{exact:true}).waitFor();await page.getByText(initial.targetPath!,{exact:true}).waitFor();await page.getByText('查看 1 项待处理内容',{exact:true}).click();await page.getByText('unknown-note.txt',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>(window as any).h.calls),[]);await page.getByRole('button',{name:'返回工作台',exact:true}).click();assert.deepEqual(await page.evaluate(()=>(window as any).h.calls),['continue'])
}))
test('HR33-02 ordinary migration with no fresh relocation witness does not invent a current-directory field',async()=>scenario(async page=>{
 await mount(page,{...initial,currentRootPath:undefined});await page.getByText(initial.targetPath!,{exact:true}).waitFor();assert.equal(await page.getByText('当前数据目录',{exact:true}).count(),0);assert.deepEqual(await page.evaluate(()=>(window as any).h.calls),[])
}))
test('HR33-03 malformed current root cannot overwrite last valid history or give new action authority',async()=>scenario(async page=>{
 await mount(page);await page.getByText(initial.currentRootPath!,{exact:true}).waitFor();for(const bad of[7,'private\u0000file','x'.repeat(8193)])await page.evaluate(state=>(window as any).h.emit(state),{...initial,revision:10,currentRootPath:bad}as unknown as RootMaintenanceState);await page.getByRole('alert').waitFor();await page.getByText(initial.currentRootPath!,{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>(window as any).h.calls),[])
}))
test('HR33-04 both real themes wrap a narrow long current path without parsing markup or horizontal overflow',async()=>scenario(async page=>{
 await page.setViewportSize({width:360,height:680});await mount(page,{...initial,currentRootPath:'<img onerror=alert(1)>/'+ '当前目录/'.repeat(70)});await page.getByText('当前数据目录',{exact:true}).waitFor();for(const[index,theme]of(['paper','ink']as const).entries()){await page.evaluate(state=>(window as any).h.emit(state),{...initial,revision:index+2,theme,currentRootPath:'<img onerror=alert(1)>/'+ '当前目录/'.repeat(70)});assert.equal(await page.locator('img').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('main').evaluate((el,theme)=>el.classList.contains(theme),theme),true)}
}))
