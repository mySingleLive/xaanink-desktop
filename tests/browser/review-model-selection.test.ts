import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
const bundle = build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ModelRequiredDialog} from './src/components/desktop/ModelRequiredDialog';
import {useChatStore} from './src/stores/chat';import {useDesktopStore} from './src/stores/desktop';
window.mountReviewFixture=({origin=true,defaultModel=true,running=false}={})=>{
 const task={conversationId:'chat-fixture',turnId:'turn-fixture',attemptId:'attempt-fixture'};
 let record={conversation:{id:task.conversationId,activeAttemptId:running?task.attemptId:null,reviewModelId:null},turnState:{turn:{id:task.turnId,latestAttemptId:task.attemptId,defaultsSnapshot:{reviewModelId:null}},attempts:[{id:task.attemptId,status:running?'running':'failed',defaultsSnapshot:{reviewModelId:null}}]}};
 const calls=[],patches=[];let configured=0,closed=0;
 window.fetch=async(input,init)=>{calls.push({path:String(input),method:init?.method??'GET',body:init?.body});if(init?.method==='PATCH'){const pending=Promise.withResolvers();patches.push(pending);return pending.promise}return Response.json(record)};
 useChatStore.setState({conversationId:task.conversationId,isGenerating:false,pendingRequest:null});
 useDesktopStore.setState({bootstrap:{settings:{agent:{reviewModelId:defaultModel?'review-fixture':null}},models:defaultModel?[{id:'review-fixture',name:'专项审核模型',enabled:true,kind:'TEXT'}]:[]}});
 const query=new QueryClient({defaultOptions:{queries:{retry:false}}}),root=createRoot(document.getElementById('app'));
 const notice={type:'model-required',role:'review',code:'MODEL_NOT_SELECTED',...(origin?{task}:{})};
 flushSync(()=>root.render(<QueryClientProvider client={query}><ModelRequiredDialog notice={notice} onClose={()=>closed++} onConfigure={()=>configured++}/></QueryClientProvider>));
 window.reviewFixture={calls,patches,query,configured:()=>configured,closed:()=>closed,switch:()=>useChatStore.setState({conversationId:'another-chat'}),changeDefault:()=>useDesktopStore.setState({bootstrap:{settings:{agent:{reviewModelId:'other-model'}},models:[{id:'other-model',name:'后来选择的模型',enabled:true,kind:'TEXT'}]}}),finish:()=>{record={...record,conversation:{...record.conversation,activeAttemptId:null},turnState:{...record.turnState,attempts:[{...record.turnState.attempts[0],status:'failed'}]}};query.invalidateQueries()},resolve:()=>patches.at(-1).resolve(Response.json({conversation:{reviewModelId:'review-fixture'}})),reject:()=>patches.at(-1).resolve(Response.json({error:'secret-native-diagnostic'},{status:409})),unmount:()=>root.unmount()};
};` }, bundle: true, format: 'iife', platform: 'browser', write: false, tsconfig: 'tsconfig.json', loader: { '.css': 'empty' } }).then(result => result.outputFiles![0].text)
let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.XAANINK_TEST_CHROMIUM }) })
test.after(async () => { await browser?.close() })
async function scenario(options: object, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage(), errors: string[] = []; page.setDefaultTimeout(5000)
  try {
    page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', route => route.abort())
    await page.setContent('<style>[data-slot="dialog-overlay"]{position:fixed;inset:0;z-index:50}[data-slot="dialog-content"]{position:fixed;left:25%;top:10%;z-index:51;width:50%;background:white;padding:16px}button{margin:4px}svg{width:20px;height:20px}</style><div id="app"></div>'); await page.addScriptTag({ content: await bundle })
    await page.evaluate(options => (window as any).mountReviewFixture(options), options)
    await page.getByRole('dialog').waitFor(); await run(page); assert.deepEqual(errors, [])
  } finally { await page.close() }
}
const apply = (page: Page) => page.getByRole('button', { name: '应用到当前任务', exact: true })
test('RMS-06/07: real dialog uses explicit default, single-flight PATCH, manual execution and safe failure retry', () => scenario({}, async page => {
  await page.getByText('专项审核模型', { exact: false }).waitFor(); await apply(page).waitFor()
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === '应用到当前任务')!; b.click(); b.click() })
  assert.equal(await page.evaluate(() => (window as any).reviewFixture.patches.length), 1)
  assert.equal(await page.getByRole('button', { name: '取消', exact: true }).isEnabled(), false)
  await page.evaluate(() => (window as any).reviewFixture.reject()); await apply(page).waitFor()
  assert.doesNotMatch(await page.locator('body').innerText(), /secret-native-diagnostic/)
  await apply(page).click(); await page.evaluate(() => (window as any).reviewFixture.resolve())
  await page.getByText('审核模型已应用，请手动重新执行任务。', { exact: true }).waitFor()
  await page.getByRole('heading', { name: '审核模型已应用', exact: true }).waitFor()
  assert.equal(await page.getByText('当前任务没有可用模型', { exact: true }).count(), 0)
  const calls = await page.evaluate(() => (window as any).reviewFixture.calls)
  const writes = calls.filter((c: any) => c.method !== 'GET')
  assert.equal(writes.length, 2)
  assert.deepEqual(JSON.parse(writes[0].body), { type: 'review-selection', modelId: 'review-fixture', turnId: 'turn-fixture', attemptId: 'attempt-fixture' })
  assert.ok(writes.every((c: any) => c.path === '/api/chat/conversations/chat-fixture' && c.method === 'PATCH'))
}))
for (const option of [{ origin: false }, { defaultModel: false }]) test(`RMS-06/10: no unsafe apply ${JSON.stringify(option)}`, () => scenario(option, async page => {
  assert.equal(await apply(page).count(), 0); await page.getByRole('button', { name: '去配置模型', exact: true }).click()
  assert.equal(await page.evaluate(() => (window as any).reviewFixture.configured()), 1)
  assert.equal(await page.evaluate(() => (window as any).reviewFixture.patches.length), 0)
}))
test('RMS-07/10: running task cannot apply; terminal refresh enables deliberate selection', () => scenario({ running: true }, async page => {
  await apply(page).waitFor(); assert.equal(await apply(page).isEnabled(), false)
  await page.evaluate(() => (window as any).reviewFixture.finish()); await apply(page).waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '应用到当前任务' && !b.disabled))
  await apply(page).click(); await page.evaluate(() => (window as any).reviewFixture.resolve())
  await page.getByText('审核模型已应用，请手动重新执行任务。', { exact: true }).waitFor()
}))
test('RMS-07/10: switching conversation blocks the fixed target and a late response cannot announce success', () => scenario({}, async page => {
  await apply(page).waitFor(); await apply(page).click()
  await page.evaluate(() => (window as any).reviewFixture.switch())
  await page.evaluate(() => (window as any).reviewFixture.resolve())
  assert.equal(await page.getByText('审核模型已应用，请手动重新执行任务。', { exact: true }).count(), 0)
  assert.equal(await apply(page).count(), 0)
}))
test('RMS-07: a default change while saving never mislabels the model actually submitted', () => scenario({}, async page => {
  await apply(page).waitFor(); await apply(page).click()
  await page.evaluate(() => (window as any).reviewFixture.changeDefault())
  assert.equal(await page.getByText('后来选择的模型', { exact: true }).count(), 0)
  await page.getByText('专项审核模型', { exact: true }).waitFor()
  await page.evaluate(() => (window as any).reviewFixture.resolve())
  await page.getByText('审核模型已应用，请手动重新执行任务。', { exact: true }).waitFor()
  await page.getByText('专项审核模型', { exact: true }).waitFor()
}))
