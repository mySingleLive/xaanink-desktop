import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
import {readFileSync,readdirSync} from 'node:fs'
import {chromium,type Browser,type Page} from 'playwright-core'
import type {RecoveryItem} from '../../src/lib/desktop/draft-recovery'
import type {DraftSnapshot} from '../../desktop/shared/drafts'

declare global {interface Window {review82:{copied:string[];exports:DraftSnapshot[];requests:number;retained():RecoveryItem[];add(items:RecoveryItem[]):void};mountReview82(items:RecoveryItem[]):void}}
const css=readdirSync('.next/static/chunks').filter(name=>name.endsWith('.css')).sort().map(name=>readFileSync('.next/static/chunks/'+name,'utf8')).join('\n')
const bundle=build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
import{RecoveryDialog}from'./src/components/desktop/RecoveryDialog';
import{desktopRecoveryStore,installRecoveryDraftSource}from'./src/lib/desktop/draft-recovery';
import{desktopSaveCoordinator}from'./src/lib/desktop/save-coordinator';import{useDesktopStore}from'./src/stores/desktop';
window.mountReview82=items=>{desktopRecoveryStore.retain(items);installRecoveryDraftSource(desktopSaveCoordinator);
 const review={copied:[],exports:[],requests:0,retained:()=>desktopRecoveryStore.read().items,add:rows=>desktopRecoveryStore.retain(rows)};window.review82=review;
 window.fetch=()=>{review.requests++;throw new Error('No recovery replay may execute')};
 window.desktop={writeClipboardText:async text=>{review.copied.push(text)},exportDraft:async(session,snapshot)=>{review.exports.push(snapshot);return true}};
 useDesktopStore.setState({bootstrap:{draftSessionId:crypto.randomUUID()}});
 const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(React.createElement(RecoveryDialog,{open:true,onOpenChange:()=>{}})));};
`},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json'}).then(result=>result.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,...(process.env.XAANINK_TEST_CHROMIUM?{executablePath:process.env.XAANINK_TEST_CHROMIUM}:{})})})
test.after(async()=>{await browser?.close()})
function item(id:string,source:string,value:unknown,reason:RecoveryItem['reason']='WORK_RESTORED'):RecoveryItem{return{id,source,path:'source',reason,createdAt:'2026-10-08T00:00:00.000Z',value}}
async function scenario(items:RecoveryItem[],run:(page:Page)=>Promise<void>){const page=await browser.newPage(),errors:string[]=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));try{await page.route('http://localhost/**',route=>route.fulfill({contentType:'text/html',body:'<div id="app"></div>'}));await page.goto('http://localhost/');await page.addStyleTag({content:css});await page.addScriptTag({content:await bundle});await page.evaluate(records=>window.mountReview82(records),items);await page.getByRole('dialog').waitFor();await run(page);assert.equal(await page.evaluate(()=>window.review82.requests),0);assert.deepEqual(errors,[])}finally{await page.close()}}

test('RP82-UI01 actual React setting preview/copy keeps full hidden and execution records in export',()=>{
 const value={name:'潮汐体系',content:{text:'潮汐正文完整保留'},operationId:'hidden-operation'},attempt={value,revision:2,operationId:'hidden-operation'}
 const records=[item('metadata','extension',{request:{url:'/never/replay',operationId:'hidden-operation',body:'not-body'},privatePath:'/Users/private/data'}),item('idle','autosaves',{revision:0,status:'saved',paused:false,pending:null,failed:null,inFlight:null,latest:null}),item('setting','autosaves',{revision:2,status:'pending',paused:false,pending:attempt,failed:null,inFlight:null,latest:attempt})]
 return scenario(records,async page=>{
  assert.equal(await page.getByRole('navigation',{name:'保留的草稿列表'}).getByRole('button').count(),2)
  const text=await page.getByLabel('保留的草稿内容').inputValue();assert.match(text,/潮汐正文完整保留/);assert.doesNotMatch(text,/operation|\/Users|never\/replay/);assert.equal(await page.getByLabel('保留的草稿内容').getAttribute('readonly'),'')
  await page.getByRole('button',{name:'复制内容',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.review82.copied),[text])
  await page.getByRole('button',{name:'导出草稿',exact:true}).click();await page.waitForFunction(()=>window.review82.exports.length===1)
  assert.deepEqual(await page.evaluate(()=>window.review82.exports[0].sources.recovery),{version:1,items:records});assert.deepEqual(await page.evaluate(()=>window.review82.retained()),records)
  const unknown=page.getByRole('navigation',{name:'保留的草稿列表'}).getByRole('button').nth(1);await unknown.click();assert.equal(await page.getByRole('button',{name:'复制内容',exact:true}).isDisabled(),true);assert.match(await page.getByLabel('保留的草稿内容').inputValue(),/完整内容已保留/)
 })
})

test('RP82-UI02 all-empty presentation still offers full export and never reports unknown data as empty',()=>{
 const idle=item('idle','autosaves',{revision:0,status:'idle',pending:null,failed:null,inFlight:null,latest:null})
 return scenario([idle],async page=>{
  await page.getByText('没有需要核对的保留草稿。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'复制内容',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'导出草稿',exact:true}).click();await page.waitForFunction(()=>window.review82.exports.length===1);assert.deepEqual(await page.evaluate(()=>window.review82.exports[0].sources.recovery),{version:1,items:[idle]})
  const unknown=item('unknown','extension',{status:'idle',content:'not trusted prose'});await page.evaluate(row=>window.review82.add([row]),unknown)
  await page.getByLabel('保留的草稿内容').waitFor();assert.match(await page.getByLabel('保留的草稿内容').inputValue(),/完整内容已保留/);assert.equal(await page.getByRole('navigation',{name:'保留的草稿列表'}).getByRole('button').count(),1)
 })
})

test('RP82-UI03 barrier reason does not relabel historic opt-out and selected unknown item stays selected after sorting',()=>{
 const literal='<script>window.review82.requests++</script>\n  作者原文  ',records=[item('unknown','extension',{request:{body:literal}}),item('old','chat',literal,'RESTORE_DISABLED')]
 return scenario(records,async page=>{
  await page.getByText('已关闭自动恢复',{exact:true}).waitFor();await page.getByText('作品保留的草稿',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('保留的草稿内容').inputValue(),literal)
  await page.getByRole('button',{name:'复制内容',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.review82.copied),[literal])
  await page.getByRole('navigation',{name:'保留的草稿列表'}).getByRole('button').nth(1).click()
  const addition=item('new','comments',{content:'新评论正文',anchor:{quote:'原文'}});await page.evaluate(row=>window.review82.add([row]),addition);await page.waitForFunction(()=>window.review82.retained().length===3)
  assert.match(await page.getByLabel('保留的草稿内容').inputValue(),/完整内容已保留/);assert.equal(await page.getByRole('button',{name:'复制内容',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'导出草稿',exact:true}).click();await page.waitForFunction(()=>window.review82.exports.length===1);assert.deepEqual(await page.evaluate(()=>window.review82.exports[0].sources.recovery),{version:1,items:[...records,addition]})
 })
})
