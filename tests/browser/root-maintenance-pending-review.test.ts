import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {build} from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import {chromium,type Browser,type Page} from 'playwright-core'
import type {RootMaintenanceState} from '../../desktop/shared/root-maintenance'

const css=(async()=>{const path=resolve('src/app/globals.css');return(await postcss([tailwind()]).process(await readFile(path,'utf8'),{from:path})).css+'\n'+await readFile('src/app/desktop.css','utf8')})()
const script=build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {RootMaintenanceScreen} from './src/components/desktop/RootMaintenanceScreen';
 globalThis.mountReview=seed=>{let receive;const commands=[],alerts=[];window.alert=value=>alerts.push(value);window.desktopMaintenance={state:async()=>seed,subscribe:listener=>{receive=listener;return()=>{}},command:async command=>commands.push(command)};
 const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(React.createElement(RootMaintenanceScreen)));
 globalThis.review={commands,alerts,emit:state=>flushSync(()=>receive(state)),mutate:()=>{seed.pendingItems[0]='mutated original array'},unmount:()=>flushSync(()=>root.unmount())};
 };`},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json'}).then(result=>result.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.XAANINK_TEST_CHROMIUM})})
test.after(async()=>{await browser?.close()})
function seed(items:string[]|null):RootMaintenanceState{return{version:1,revision:1,phase:'cleanup-pending',theme:'paper',sourcePath:'/本地/旧目录',targetPath:'/本地/新目录',copiedFiles:4,totalFiles:4,canCancel:false,canContinue:true,pendingCount:items?.length??3,pendingItems:items}}
async function isolated(state:RootMaintenanceState,run:(page:Page)=>Promise<void>){
 const page=await browser.newPage({viewport:{width:760,height:560}}),errors:string[]=[],requests:string[]=[];page.setDefaultTimeout(2200);page.on('pageerror',error=>errors.push(error.message))
 try{
  await page.route('**/*',route=>{if(route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh-CN"><body><div id="app"></div></body></html>'});requests.push(route.request().url());return route.abort()})
  await page.goto('http://127.0.0.1:1/review85-isolated');await page.addStyleTag({content:await css});await page.addScriptTag({content:await script})
  await page.evaluate(state=>(window as any).mountReview(state),state);await page.getByText('迁移完成，清理待处理',{exact:true}).waitFor();await run(page)
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);assert.deepEqual(await page.evaluate(()=>(window as any).review.alerts),[])
 }finally{await page.close()}
}

test('PEND85-U01: all 45 labels remain reachable across three actual BaseUI pages; paths remain inert and paging never issues migration commands',()=>{
 const items=Array.from({length:43},(_,index)=>`session/剩余-${index}.txt`);items.push('session/<img onerror=alert(1)>','NEW_ROOT_CHANGED')
 return isolated(seed(items),async page=>{
  await page.getByText('查看 45 项待处理内容',{exact:true}).click();const list=page.getByRole('list',{name:'待处理明细'})
  assert.equal(await list.getByRole('listitem').count(),20);assert.equal(await page.getByRole('button',{name:'上一页',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'下一页',exact:true}).click();assert.deepEqual(await list.getByRole('listitem').allTextContents(),items.slice(20,40))
  await page.getByRole('button',{name:'下一页',exact:true}).click();assert.deepEqual(await list.getByRole('listitem').allTextContents(),[...items.slice(40,44),'新目录已有后续修改，旧副本已保留。'])
  assert.equal(await page.getByRole('button',{name:'下一页',exact:true}).isDisabled(),true);assert.equal(await list.locator('img,a,iframe,script').count(),0)
  await page.getByRole('button',{name:'上一页',exact:true}).click();await page.getByRole('button',{name:'上一页',exact:true}).click();assert.deepEqual(await list.getByRole('listitem').allTextContents(),items.slice(0,20))
  assert.deepEqual(await page.evaluate(()=>(window as any).review.commands),[]);await page.getByRole('button',{name:'返回工作台'}).click();assert.deepEqual(await page.evaluate(()=>(window as any).review.commands),['continue'])
 })
})

test('PEND85-U02: copied pending arrays, stale events and unsafe/count-mismatched events preserve the latest legitimate visible list and authority',()=>isolated(seed(['state.json']),async page=>{
 await page.getByText('查看 1 项待处理内容',{exact:true}).click();await page.evaluate(()=>(window as any).review.mutate())
 for(const event of [{...seed(['forged']),revision:2,pendingCount:2},{...seed(['../private']),revision:3},{...seed(['state.json']),revision:4,pendingItems:['a'.repeat(4097)]}]){
  await page.evaluate(event=>(window as any).review.emit(event),event);await page.getByRole('alert').waitFor();await page.getByText('state.json',{exact:true}).waitFor();assert.equal(await page.getByText('mutated original array',{exact:true}).count(),0)
 }
 await page.evaluate(event=>(window as any).review.emit(event),{...seed(['newest.json']),revision:5});await page.getByText('newest.json',{exact:true}).waitFor()
 await page.evaluate(event=>(window as any).review.emit(event),{...seed(['stale.json']),revision:4});await page.getByText('newest.json',{exact:true}).waitFor();assert.equal(await page.getByText('stale.json',{exact:true}).count(),0)
 assert.equal(await page.getByRole('button',{name:'返回工作台'}).isEnabled(),true);assert.deepEqual(await page.evaluate(()=>(window as any).review.commands),[])
}))

test('PEND85-U03: a legal 4096-character label wraps at 320×240, all pages and continuation remain physically reachable',()=>{
 const longest='session/'+'稿'.repeat(4088);assert.equal(longest.length,4096)
 const items=[longest,...Array.from({length:20},(_,index)=>`session/稿-${index}.txt`)]
 return isolated(seed(items),async page=>{
  await page.setViewportSize({width:320,height:240});await page.getByText('查看 21 项待处理内容',{exact:true}).click();await page.getByText(longest,{exact:true}).waitFor()
  const dimensions=await page.locator('main').evaluate(element=>({width:element.clientWidth,scrollWidth:element.scrollWidth,height:element.clientHeight,scrollHeight:element.scrollHeight}));assert.ok(dimensions.scrollWidth<=dimensions.width);assert.ok(dimensions.scrollHeight>dimensions.height)
  const next=page.getByRole('button',{name:'下一页',exact:true});await next.scrollIntoViewIfNeeded();await next.click();await page.getByText(items.at(-1)!,{exact:true}).waitFor();assert.equal(await page.getByRole('list',{name:'待处理明细'}).getByRole('listitem').count(),1)
  const continuation=page.getByRole('button',{name:'返回工作台'});await continuation.scrollIntoViewIfNeeded();const box=await continuation.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=241);await continuation.click();assert.deepEqual(await page.evaluate(()=>(window as any).review.commands),['continue'])
 })
})

test('PEND85-U04: unknown detail availability never shows an empty all-clean list; shorter rollback lists clamp the current page without changing permission',()=>isolated(seed(null),async page=>{
 await page.getByText('待处理明细暂不可用，原文件仍保留。',{exact:true}).waitFor();assert.equal(await page.getByRole('list',{name:'待处理明细'}).count(),0)
 const longer=seed(Array.from({length:41},(_,index)=>`session/${index}.txt`));await page.evaluate(event=>(window as any).review.emit(event),{...longer,revision:2})
 await page.getByText('查看 41 项待处理内容',{exact:true}).click();await page.getByRole('button',{name:'下一页',exact:true}).click();await page.getByRole('button',{name:'下一页',exact:true}).click()
 await page.evaluate(event=>(window as any).review.emit(event),{...seed(['UNOWNED_TARGET_REMAINS']),revision:3,phase:'rollback-pending'});await page.getByText('目标目录仍有 1 项待处理，可返回原目录。',{exact:true}).waitFor();await page.getByText('目标目录中有非本次迁移创建的内容，已保留。',{exact:true}).waitFor()
 assert.equal(await page.getByRole('list',{name:'待处理明细'}).getByRole('listitem').count(),1);assert.equal(await page.getByRole('navigation',{name:'待处理明细分页'}).count(),0)
 await page.getByRole('button',{name:'返回工作台'}).click();assert.deepEqual(await page.evaluate(()=>(window as any).review.commands),['continue'])
}))
