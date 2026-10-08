import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
import {chromium,type Browser,type Page} from 'playwright-core'

// Actual original React19 and Button/BaseUI code. A controlled bridge supplies
// local backup rows and handoff outcomes; no Electron/native prompt/DB claim.
const bundle=build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{WorkBackupsPanel}from'./src/components/desktop/WorkBackupsPanel';
window.mountReview=()=>{
 const workId='f2f45e59-1fc8-46e7-b233-a4118d4f2b45',backupId='6b2c549e-b5ce-4ff4-8bf5-b8b06c5a82a5',calls=[];let accept,reject;
 window.desktop={workBackup:async action=>{calls.push(action);return action.type==='works'?{type:'works',works:[{id:workId,title:'真实本地作品'}]}:{type:'list',backups:[{id:backupId,workId,title:'作者备份标题',createdAt:'2026-10-08T00:00:00.000Z',bytes:4096,assetCount:0,sha256:'a'.repeat(64)}]}},restoreWork:action=>{calls.push(action);return new Promise((yes,no)=>{accept=yes;reject=no})}};
 const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(React.createElement(WorkBackupsPanel)));
 return{calls,workId,backupId,reply:value=>accept(value),fail:()=>reject(Error('候选校验失败，原文件已保留')),unmount:()=>root.unmount()};
};`},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json'}).then(r=>r.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.XAANINK_TEST_CHROMIUM})})
test.after(async()=>{await browser?.close()})
async function scenario(run:(page:Page)=>Promise<void>){
 const page=await browser.newPage(),errors:string[]=[];page.setDefaultTimeout(2400);page.on('pageerror',error=>errors.push(error.message))
 try{await page.setContent('<div id="app"></div>');await page.addScriptTag({content:await bundle});await page.evaluate(()=>{(window as any).review=(window as any).mountReview()});await page.getByText('作者备份标题',{exact:true}).waitFor();await run(page);assert.deepEqual(errors,[])}finally{await page.close()}
}
test('WR81-U01 actual pending outcome is described as unfinished handoff, never successful restoration or cancelled work',()=>scenario(async page=>{
 await page.getByRole('button',{name:'校验并恢复',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:'正在校验备份…',exact:true}).isDisabled(),true)
 assert.equal(await page.getByLabel('备份所属作品').isDisabled(),true)
 await page.evaluate(()=>(window as any).review.reply('pending'))
 const status=page.getByRole('status');await status.waitFor()
 assert.match(await status.textContent()??'',/交接待完成/)
 assert.doesNotMatch(await status.textContent()??'',/已取消|恢复完成/)
 assert.equal(await page.getByText('作者备份标题',{exact:true}).count(),1)
 assert.deepEqual(await page.evaluate(()=>(window as any).review.calls.filter((row:any)=>row.type==='start')),[{type:'start',workId:'f2f45e59-1fc8-46e7-b233-a4118d4f2b45',backupId:'6b2c549e-b5ce-4ff4-8bf5-b8b06c5a82a5'}])
}))
test('WR81-U02 actual keyboard activation remains single-flight, and cancelled native confirmation preserves the selected backup and permits an explicit retry',()=>scenario(async page=>{
 const button=page.getByRole('button',{name:'校验并恢复',exact:true});await button.focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter')
 await page.getByRole('button',{name:'正在校验备份…',exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>(window as any).review.calls.filter((row:any)=>row.type==='start').length),1)
 await page.evaluate(()=>(window as any).review.reply('cancelled'))
 await page.getByRole('status').filter({hasText:'已取消恢复，当前作品保持原状'}).waitFor()
 assert.equal(await page.getByLabel('备份所属作品').inputValue(),'f2f45e59-1fc8-46e7-b233-a4118d4f2b45')
 await page.getByRole('button',{name:'校验并恢复',exact:true}).click()
 assert.equal(await page.evaluate(()=>(window as any).review.calls.filter((row:any)=>row.type==='start').length),2)
 await page.evaluate(()=>(window as any).review.fail())
 await page.getByRole('alert').filter({hasText:'原文件已保留'}).waitFor()
 assert.equal(await page.getByText('作者备份标题',{exact:true}).count(),1)
}))
