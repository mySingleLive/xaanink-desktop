import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
import {chromium,type Browser,type Page} from 'playwright-core'
let browser:Browser,bundle:string
test.before(async()=>{
 const built=await build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{createRoot}from'react-dom/client';import{ApplicationBackupsPanel}from'./src/components/desktop/ApplicationBackupsPanel';const calls=[];let resolveSelect;window.desktop={applicationBackups:async()=>[{id:'694e9d2e-6b20-43d7-b118-7b03375797a2',appId:'5e6a14c4-e6f7-4a1a-8258-b78771111c56',createdAt:'2026-10-08T00:00:00.000Z',bytes:1024}],restoreApplication:async action=>{calls.push(action);if(action.type==='status')return{phase:'idle',operationId:null,backupId:null,targetPath:null};if(action.type==='select')return new Promise(r=>resolveSelect=r);if(action.type==='cancel')return{phase:'idle',operationId:null,backupId:null,targetPath:null};return{phase:'prepared',operationId:action.operationId,backupId:'694e9d2e-6b20-43d7-b118-7b03375797a2',targetPath:'/chosen/native/candidate'}}};window.fixture={calls,resolve(value){resolveSelect(value)}};createRoot(document.getElementById('app')).render(<ApplicationBackupsPanel/>);`},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json'});bundle=built.outputFiles![0].text
 browser=await chromium.launch({headless:true,...(process.env.XAANINK_TEST_CHROMIUM?{executablePath:process.env.XAANINK_TEST_CHROMIUM}:{})})
});test.after(async()=>{await browser?.close()})
async function scenario(run:(page:Page)=>Promise<void>){const page=await browser.newPage(),errors:string[]=[];page.setDefaultTimeout(2500);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());try{await page.setContent('<div id="app"></div>');await page.addScriptTag({content:bundle});await page.getByRole('listitem').waitFor();await run(page);assert.deepEqual(errors,[])}finally{await page.close()}}
const prepared={phase:'prepared',operationId:'22420f03-b9d5-4f8c-80be-27c555558489',backupId:'694e9d2e-6b20-43d7-b118-7b03375797a2',targetPath:'/chosen/native/candidate'}
test('actual backup panel selects only backup id, disables repeat during native choice, and requires explicit continue',{timeout:15000},()=>scenario(async page=>{
 const restore=page.getByRole('button',{name:'恢复此应用备份'});await restore.click();assert.equal(await restore.isDisabled(),true)
 assert.equal(await page.getByRole('button',{name:'继续恢复',exact:true}).count(),0)
 await page.evaluate(v=>(window as any).fixture.resolve(v),prepared);await page.getByRole('button',{name:'继续恢复',exact:true}).click()
 const calls=await page.evaluate(()=>(window as any).fixture.calls);assert.deepEqual(calls.filter((row:any)=>row.type!=='status'),[{type:'select',backupId:prepared.backupId},{type:'start',operationId:prepared.operationId}])
 assert.ok((await page.getByRole('status').last().textContent())?.includes('完整退出'))
}))
test('native cancellation leaves no prepared controls; cancelling a prepared intent sends only its operation id',{timeout:15000},()=>scenario(async page=>{
 await page.getByRole('button',{name:'恢复此应用备份'}).click();await page.evaluate(()=>(window as any).fixture.resolve({phase:'idle',operationId:null,backupId:null,targetPath:null}));await page.waitForFunction(()=>!(document.querySelector('button[aria-label="恢复此应用备份"]') as HTMLButtonElement)?.disabled)
 assert.equal(await page.getByRole('button',{name:'继续恢复',exact:true}).count(),0)
 await page.getByRole('button',{name:'恢复此应用备份'}).click();await page.evaluate(v=>(window as any).fixture.resolve(v),prepared);await page.getByRole('button',{name:'取消恢复',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:'继续恢复',exact:true}).count(),0);const calls=await page.evaluate(()=>(window as any).fixture.calls);assert.deepEqual(calls.at(-1),{type:'cancel',operationId:prepared.operationId})
}))
