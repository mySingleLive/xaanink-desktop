import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
import {chromium,type Browser,type Page} from 'playwright-core'
import {ROOT_MIGRATION_LIMITS} from '../../desktop/core/root-inventory-limits'

// Actual React and original screen/Button in an isolated Chromium page. The
// restricted bridge is controlled; no source IO/native window is claimed.
const bundle=build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
import React from 'react';import {createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{RootMaintenanceScreen}from'./src/components/desktop/RootMaintenanceScreen';
window.mount=seed=>{let receive;const calls=[];window.desktopMaintenance={state:async()=>seed,subscribe:fn=>{receive=fn;return()=>{}},command:async name=>{calls.push(name)}};const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(React.createElement(RootMaintenanceScreen)));return{calls,emit:value=>flushSync(()=>receive(value)),close:()=>root.unmount()}};`},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json'}).then(result=>result.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,...(process.env.XAANINK_TEST_CHROMIUM?{executablePath:process.env.XAANINK_TEST_CHROMIUM}:{})})})
test.after(async()=>{await browser?.close()})
const state=(count:number,items:string[]|null=null)=>({version:1,revision:1,phase:'rollback-pending',theme:'ink',sourcePath:'/original',targetPath:'/candidate',copiedFiles:0,totalFiles:0,canCancel:false,canContinue:true,pendingCount:count,pendingItems:items})
async function scenario(seed:unknown,run:(page:Page)=>Promise<void>){const page=await browser.newPage(),errors:string[]=[];page.setDefaultTimeout(2000);page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());try{await page.setContent('<div id="app"></div>');await page.addScriptTag({content:await bundle});await page.evaluate(seed=>{(window as any).fixture=(window as any).mount(seed)},seed);await run(page);assert.deepEqual(errors,[])}finally{await page.close()}}

test('AM96-B01 real maintenance UI accepts history-sized and maximum truthful counts; overflow cannot replace the last authority',()=>scenario(state(30000),async page=>{
 await page.getByText('目标目录仍有 30000 项待处理，可返回原目录。',{exact:true}).waitFor()
 await page.evaluate(seed=>(window as any).fixture.emit(seed),{...state(ROOT_MIGRATION_LIMITS.pending),revision:2})
 await page.getByText(`目标目录仍有 ${ROOT_MIGRATION_LIMITS.pending} 项待处理，可返回原目录。`,{exact:true}).waitFor()
 await page.evaluate(seed=>(window as any).fixture.emit(seed),{...state(ROOT_MIGRATION_LIMITS.pending+1),revision:3})
 await page.getByRole('alert').waitFor();await page.getByText(`目标目录仍有 ${ROOT_MIGRATION_LIMITS.pending} 项待处理，可返回原目录。`,{exact:true}).waitFor()
 await page.getByRole('button',{name:'返回工作台',exact:true}).click();assert.deepEqual(await page.evaluate(()=>(window as any).fixture.calls),['continue'])
}))

test('AM96-B02 exact inert paths remain reachable after pagination and a malformed later list is never executed or shown',()=>{const paths=Array.from({length:21},(_,i)=>'backups/application/validation/'+i+'/unapproved.json');return scenario(state(paths.length,paths),async page=>{
 await page.getByText('查看 21 项待处理内容',{exact:true}).click();assert.equal(await page.getByRole('list',{name:'待处理明细'}).getByRole('listitem').count(),20)
 await page.getByRole('button',{name:'下一页',exact:true}).click();await page.getByText(paths[20],{exact:true}).waitFor()
 await page.evaluate(seed=>(window as any).fixture.emit(seed),{...state(2,['foreign-operation']),revision:2});await page.getByRole('alert').waitFor()
 await page.getByText(paths[20],{exact:true}).waitFor();assert.equal(await page.getByText('foreign-operation',{exact:true}).count(),0);assert.deepEqual(await page.evaluate(()=>(window as any).fixture.calls),[])
})})
