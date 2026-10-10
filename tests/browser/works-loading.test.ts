import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'

const bundle = build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {SidebarTree} from './src/components/layout/SidebarTree';
import {ContentTabs} from './src/components/layout/ContentTabs';
import {useTabsStore} from './src/stores/tabs';
import {appendCreatedNovel} from './src/lib/novel-list';
window.mountWorksFixture=({healthy=false,reason='stale-lease',bridge=true,empty=false,globalError=false}={})=>{
 const workId='b3bd663e-0b87-480c-b6ad-6eaa1488d6cb';
 const summary={id:'healthy',title:'可用作品',coverUrl:null,status:'DRAFT',currentStage:'PLANNING',createdAt:'2026-01-01',updatedAt:'2026-01-01'};
 let body={novels:healthy?[summary]:[],unavailableWorks:empty?[]:[{workId,novelId:'unavailable',title:'待恢复作品',reason}]};
 const calls=[],repairs=[],errors=[];let reads=0;
 window.fetch=async input=>{const path=String(input);if(path==='/api/novels'){reads++;if(globalError)throw Error('private-native-path-key');return Response.json(body)}
 if(path.includes('/conversations'))return Response.json({conversations:[]});
 if(path.includes('/worlds'))return Response.json({worlds:[]});
 return Response.json({novel:{...summary,volumes:[]},characters:[],scenarios:[],scenes:[],settings:[]})};
 window.desktop=bridge?{repairWorkLease:action=>{calls.push(action);const p=Promise.withResolvers();repairs.push(p);return p.promise}}:undefined;
 const query=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
 useTabsStore.setState({tabs:[],activeTabId:null});const root=createRoot(document.getElementById('app'));
 flushSync(()=>root.render(<QueryClientProvider client={query}><div style={{width:280}}><SidebarTree user={{id:'local-author',name:'隔离作者',email:''}}/></div><ContentTabs fullscreen={false} onToggleFullscreen={()=>{}} onToggleContent={()=>{}}/></QueryClientProvider>));
 window.worksFixture={calls,repairs,workId,reads:()=>reads,query,healthy:summary,append:()=>query.setQueryData(['novels'],current=>appendCreatedNovel(current,{...summary,id:'created',title:'新建作品'})),setBody:value=>body=value,setError:value=>globalError=value,resolve:value=>repairs.at(-1).resolve(value),reject:()=>repairs.at(-1).reject(Error('private-native-path-key')),unmount:()=>root.unmount()};
};` }, bundle: true, platform: 'browser', format: 'iife', write: false, tsconfig: 'tsconfig.json', plugins: [{ name: 'unrelated-tab-bodies', setup(api) {
  api.onResolve({ filter: /^@\/components\/content\/(registry|StagedSaveSurface|StoryWorkflowPanel)$/ }, args => ({ path: args.path, namespace: 'works-fixture' }))
  api.onLoad({ filter: /.*/, namespace: 'works-fixture' }, () => ({ loader: 'tsx', contents: `export const renderTabContent=()=>null;export const StagedSaveSurface=({children})=>children;export const StagedInterceptionBootstrap=()=>null;export const StorySources=()=>null;export const StoryActivityBanner=()=>null;export const StoryLivePreview=()=>null;` }))
} }], loader: { '.css': 'empty' } }).then(result => result.outputFiles![0].text)

let browser: Browser
test.before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.XAANINK_TEST_CHROMIUM }) })
test.after(async () => { await browser?.close() })
async function scenario(options: Record<string, unknown>, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage(), errors: string[] = []
  page.setDefaultTimeout(5000)
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.route('**/*', route => route.abort()); await page.setContent('<div id="app"></div>')
    await page.addScriptTag({ content: await bundle })
    await page.evaluate(options => (window as any).mountWorksFixture(options), options)
    await page.getByText('作品阁', { exact: true }).waitFor()
    await run(page); assert.deepEqual(errors, [])
  } finally { await page.close() }
}
const repair = (page: Page) => page.getByRole('button', { name: '修复作品锁', exact: true })
const retry = (page: Page) => page.getByRole('button', { name: '重新加载作品', exact: true })

test('WL-06: all unavailable is explicit, has the recovery entry, and never displays an empty library', () => scenario({}, async page => {
  await repair(page).waitFor(); assert.equal(await page.getByText('待恢复作品', { exact: true }).count(), 1)
  assert.doesNotMatch(await page.locator('body').innerText(), /还没有小说|作品加载失败/)
  assert.equal(await page.evaluate(() => (window as any).worksFixture.reads()), 1)
}))
test('WL-05/06: real SidebarTree and ContentTabs share the list without dropping faults; healthy tree stays usable and retry recovers', () => scenario({ healthy: true }, async page => {
  await repair(page).waitFor(); await page.getByText('可用作品', { exact: true }).click()
  assert.equal(await page.getByRole('tab', { name: '可用作品', exact: true }).count(), 1)
  assert.equal(await page.getByText('待恢复作品', { exact: true }).count(), 1)
  await page.evaluate(() => { const f = (window as any).worksFixture; f.setBody({ novels: [f.healthy], unavailableWorks: [] }) })
  await retry(page).click(); await repair(page).waitFor({ state: 'detached' })
  assert.equal(await page.getByText('待恢复作品', { exact: true }).count(), 0)
}))
test('WL-05: creation cache update preserves unavailable entries for both real observers', () => scenario({ healthy: true }, async page => {
  await repair(page).waitFor(); await page.evaluate(() => (window as any).worksFixture.append())
  await page.getByText('新建作品', { exact: true }).waitFor()
  assert.equal(await repair(page).count(), 1)
  assert.equal(await page.evaluate(() => (window as any).worksFixture.query.getQueryData(['novels']).unavailableWorks.length), 1)
}))
test('WL-05: ordinary Web response without desktop metadata remains compatible', () => scenario({}, async page => {
  await repair(page).waitFor(); await page.evaluate(() => { const f = (window as any).worksFixture; f.setBody({ novels: [f.healthy] }) })
  await retry(page).click(); await page.getByText('可用作品', { exact: true }).waitFor()
  assert.equal(await repair(page).count(), 0)
}))
for (const options of [{ reason: 'unavailable' }, { bridge: false }]) test(`WL-06: no unsafe repair entry ${JSON.stringify(options)}`, () => scenario(options, async page => {
  await retry(page).waitFor(); assert.equal(await repair(page).count(), 0)
  assert.equal(await page.getByText('待恢复作品', { exact: true }).count(), 1)
}))
test('WL-07: repair is single-flight, sends only start/workId, cancellation and safe rejection allow deliberate retry', () => scenario({}, async page => {
  await repair(page).waitFor()
  await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(el => el.textContent === '修复作品锁')!; button.click(); button.click() })
  assert.deepEqual(await page.evaluate(() => (window as any).worksFixture.calls), [{ type: 'start', workId: 'b3bd663e-0b87-480c-b6ad-6eaa1488d6cb' }])
  await page.evaluate(() => (window as any).worksFixture.resolve('cancelled')); await repair(page).waitFor(); await repair(page).click()
  await page.evaluate(() => (window as any).worksFixture.reject()); await page.getByRole('alert').waitFor()
  assert.doesNotMatch(await page.locator('body').innerText(), /private-native-path-key|修复成功/)
  await repair(page).click(); assert.equal(await page.evaluate(() => (window as any).worksFixture.calls.length), 3)
  await page.evaluate(() => (window as any).worksFixture.resolve('cancelled'))
}))
for (const result of ['pending', 'restarting']) test(`WL-07: ${result} never offers a second start or claims success`, () => scenario({}, async page => {
  await repair(page).click(); await page.evaluate(result => (window as any).worksFixture.resolve(result), result)
  assert.equal(await repair(page).count(), 0)
  assert.doesNotMatch(await page.locator('body').innerText(), /修复成功|修复完成/)
}))
test('WL-04/06: global request failure stays an error and cannot expose stale previous repair metadata', () => scenario({ globalError: true }, async page => {
  await page.getByText('作品加载失败', { exact: true }).waitFor()
  assert.equal(await repair(page).count(), 0); assert.doesNotMatch(await page.locator('body').innerText(), /private-native-path-key|还没有小说/)
}))
test('WL-04/06: global failure after a partial list hides the previous repair entry', () => scenario({}, async page => {
  await repair(page).waitFor(); await page.evaluate(() => (window as any).worksFixture.setError(true))
  await retry(page).click(); await page.getByText('作品加载失败', { exact: true }).waitFor()
  assert.equal(await repair(page).count(), 0)
  assert.equal(await page.getByText('待恢复作品', { exact: true }).count(), 0)
  assert.doesNotMatch(await page.locator('body').innerText(), /private-native-path-key|还没有小说/)
}))
