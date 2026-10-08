import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
import {readFileSync,readdirSync} from 'node:fs'
import {writeFile} from 'node:fs/promises'
import {chromium,type Browser} from 'playwright-core'

const css=readdirSync('.next/static/chunks').filter(file=>file.endsWith('.css')).sort().map(file=>readFileSync('.next/static/chunks/'+file,'utf8')).join('\n')
const bundle=build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{RecoveryDialog}from'./src/components/desktop/RecoveryDialog';import{desktopRecoveryStore,installRecoveryDraftSource}from'./src/lib/desktop/draft-recovery';import{desktopSaveCoordinator}from'./src/lib/desktop/save-coordinator';globalThis.mount=(items,sessionId)=>{const copied=[],exports=[],businessCalls=[];desktopRecoveryStore.retain(items);installRecoveryDraftSource(desktopSaveCoordinator);window.desktop={applicationBackups:async()=>{businessCalls.push('application');throw Error('protected')},workBackup:async()=>{businessCalls.push('work');throw Error('protected')},writeClipboardText:async text=>{copied.push(text)},exportDraft:async(id,value)=>{exports.push({id,value});return true}};const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(React.createElement(RecoveryDialog,{open:true,onOpenChange:()=>{},protectedSessionId:sessionId})));return{copied,exports,businessCalls,read:()=>desktopRecoveryStore.read()}}`},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json'}).then(r=>r.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,...(process.env.XAANINK_TEST_CHROMIUM?{executablePath:process.env.XAANINK_TEST_CHROMIUM}:{})})})
test.after(async()=>{await browser?.close()})

test('protected real recovery component displays complete application prose, copies it and exports every original item without starting backup/business calls',async()=>{
 const page=await browser.newPage(),errors:string[]=[],sessionId='8ae8c1fd-2a0f-43ee-a391-a5720d6b46b0'
 const items=[{id:'application:latest',source:'application',path:'operation/candidate/current/original',reason:'APPLICATION_RESTORED',createdAt:'2026-10-08T00:00:00.000Z',value:{version:1,revision:7,createdAt:'2026-10-08T00:00:00.000Z',autosaves:[],sources:{chat:{draft:'临窗读到一半的段落，还没有发送。',pendingRequest:{operationId:'do-not-show',prompt:'never execute',approved:true}}},issues:[]}}]
 page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message))
 try{
  await page.route('http://localhost/**',route=>route.fulfill({contentType:'text/html',body:'<div id="app"></div>'}));await page.goto('http://localhost/');await page.addStyleTag({content:css});await page.addScriptTag({content:await bundle});await page.evaluate(({items,sessionId})=>{(window as any).f=(window as any).mount(items,sessionId)},{items,sessionId})
  await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('heading',{name:'保留的恢复草稿',exact:true}).count(),1)
  assert.equal(await page.getByLabel('保留的草稿内容').inputValue(),'对话草稿\n临窗读到一半的段落，还没有发送。')
  assert.equal(await page.getByText('应用备份',{exact:true}).count(),0);assert.equal(await page.getByText('作品备份',{exact:true}).count(),0)
  await page.getByRole('button',{name:'复制内容',exact:true}).click();await page.getByRole('button',{name:'导出恢复草稿'}).click();await page.waitForFunction(()=>(window as any).f.exports.length===1)
  const result=await page.evaluate(()=>(window as any).f)
  assert.deepEqual(result.businessCalls,[]);assert.deepEqual(result.copied,['对话草稿\n临窗读到一半的段落，还没有发送。']);assert.equal(result.exports[0].id,sessionId);assert.deepEqual(result.exports[0].value.sources.recovery.items,items);assert.deepEqual(errors,[])
  await page.screenshot({path:'docs/evidence/implementation-36/protected-recovery-dialog.png'})
  await writeFile('docs/evidence/implementation-36/protected-recovery-dialog.json',JSON.stringify({scope:'Mounted real React component in Chromium; mocked bridge, not native or formal acceptance',checks:3,businessCalls:result.businessCalls,pageErrors:errors,originalItemsPreserved:true},null,2)+'\n')
 }finally{await page.close()}
})
