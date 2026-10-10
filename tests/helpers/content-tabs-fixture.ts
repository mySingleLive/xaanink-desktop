import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { build } from "esbuild"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import type { Browser, Page } from "playwright-core"

const cssPath = resolve("src/app/globals.css")
const stylesheet = postcss([tailwindcss()]).process(readFileSync(cssPath, "utf8"), { from: cssPath }).then(r => r.css + "\n" + readFileSync("src/app/desktop.css", "utf8"))
const bundle = build({ stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ContentTabs} from './src/components/layout/ContentTabs';
import {DesktopCommandController} from './src/components/desktop/DesktopCommandController';
import {DesktopNavigation} from './src/components/desktop/DesktopNavigation';
import {navigateDesktopHistory,desktopNavigationSnapshot} from './src/lib/desktop/navigation-runtime';
import {useDesktopCommands} from './src/lib/desktop/use-command-target';
import {useTabsStore} from './src/stores/tabs';import {useDesktopStore} from './src/stores/desktop';
window.mountContentTabsFixture=({width=1000,count=3,theme='paper',zoom=1,font=14,commands=false})=>{
 const calls=[],navigationCalls=[],stopCalls=[],titles=['用于测试文字渐隐的中文长标题，包含更多章节内容而不会进入正式产品','短名','A very long English content title with many words for overflow verification','未命名作品·隔离样本','大纲标题','候选标题'];
 const records=n=>Array.from({length:n},(_,i)=>({id:'t'+i,title:titles[i]??('隔离标题 '+i),type:i===0?'chapter-content':i===3?'novel':i===4?'chapter-outline':i===5?'chapter-candidate':'theme',novelId:'isolated-tabs',refId:i===0||i===4||i===5?'isolated-ref-'+i:undefined}));
 const appearance=(z,f,t)=>{document.documentElement.className=t;document.documentElement.style.fontSize=(16*f/14)+'px';document.documentElement.style.setProperty('--desktop-caption-zoom',String(z));document.body.dataset.platform='win32';useDesktopStore.setState({bootstrap:{platform:'win32',settings:{appearance:{zoom:z},shortcuts:{win32:{},darwin:{}}}}})};
 appearance(zoom,font,theme);useTabsStore.setState({tabs:records(count),activeTabId:count?'t0':null,activationNonce:3,subTabs:{t0:'draft'},panelFocus:{tabId:'t0',settingId:'isolated-setting'}});
 if(commands){const original=useTabsStore.getState().activateTabForNavigation;useTabsStore.setState({activateTabForNavigation:(id,signal)=>{navigationCalls.push(id);return original(id,signal)}})}
 const query=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});query.setQueryData(['novels'],{novels:[{id:'isolated-tabs',coverUrl:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="14" height="20"%3E%3Crect width="14" height="20" fill="%23888"/%3E%3C/svg%3E'}],unavailableWorks:[]});
 function StopTarget(){useDesktopCommands({'ai.stop':()=>{stopCalls.push('stop')}});return null}
 function App(){const[visible,setVisible]=useState(true),[paneWidth,setWidth]=useState(width),[fullscreen,setFullscreen]=useState(false);window.fixtureSetWidth=setWidth;window.fixtureSetVisible=setVisible;return <QueryClientProvider client={query}>
 {commands&&<><DesktopCommandController/><DesktopNavigation/><StopTarget/></>}
 <button id='fixture-restore' style={{position:'fixed',bottom:0}} onClick={()=>setVisible(true)}>恢复夹具</button>
 <div id='outer-fixture' style={{height:500,overflow:'auto'}}>{visible&&<div id='fixture-pane' className='workspace-content' style={{marginLeft:'auto',width:paneWidth,height:440}}><ContentTabs fullscreen={fullscreen} onToggleFullscreen={()=>{calls.push('fullscreen');setFullscreen(v=>!v)}} onToggleContent={()=>{calls.push('hide');setVisible(false)}}/></div>}</div>
 </QueryClientProvider>}
 const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(<App/>));
 window.tabsFixture={calls,navigationCalls,stopCalls,navigationSnapshot:desktopNavigationSnapshot,seedHistory:async()=>{flushSync(()=>useTabsStore.getState().activateTab('t1'));flushSync(()=>useTabsStore.getState().activateTab('t2'));await navigateDesktopHistory(-1);navigationCalls.length=0},state:()=>useTabsStore.getState(),order:()=>useTabsStore.getState().tabs.map(t=>t.id),reset:n=>flushSync(()=>useTabsStore.setState({tabs:records(n),activeTabId:n?'t0':null})),activate:id=>flushSync(()=>useTabsStore.getState().activateTab(id)),close:id=>flushSync(()=>useTabsStore.getState().closeTab(id)),rename:(id,title)=>flushSync(()=>useTabsStore.setState(s=>({tabs:s.tabs.map(t=>t.id===id?{...t,title}:t)}))),resize:w=>flushSync(()=>window.fixtureSetWidth(w)),appearance:(z,f,t)=>flushSync(()=>appearance(z,f,t)),hide:()=>flushSync(()=>window.fixtureSetVisible(false)),unmount:()=>flushSync(()=>root.unmount())};
};` }, bundle: true, platform: "browser", format: "iife", write: false, tsconfig: "tsconfig.json", plugins: [{ name: "only-unrelated-content", setup(api) {
  api.onResolve({ filter: /^@\/components\/content\/(registry|StagedSaveSurface|StoryWorkflowPanel)$/ }, args => ({ path: args.path, namespace: "content-tabs-panel-fixture" }))
  api.onLoad({ filter: /.*/, namespace: "content-tabs-panel-fixture" }, () => ({ loader: "tsx", resolveDir: process.cwd(), contents: `import React,{useRef,useState} from 'react';let serial=0;function Panel({tab}){const instance=useRef(++serial),[draft,setDraft]=useState('');return <section data-panel-id={tab.id} data-instance={instance.current}><input aria-label={'草稿 '+tab.id} value={draft} onChange={e=>setDraft(e.target.value)}/></section>}export const renderTabContent=tab=><Panel tab={tab}/>;export const StagedSaveSurface=({children})=>children;export const StagedInterceptionBootstrap=()=>null;export const StorySources=()=>null;export const StoryActivityBanner=()=>null;export const StoryLivePreview=()=>null;` }))
} }] }).then(r => r.outputFiles![0].text)

export interface FixtureOptions { width?: number; count?: number; theme?: "paper" | "ink"; zoom?: number; font?: number; commands?: boolean }
export async function frames(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }
export async function withContentTabs(browser: Browser, options: FixtureOptions, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 640 } }), errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    await page.route("**/*", route => route.abort()); await page.setContent('<div id="app"></div>')
    await page.addStyleTag({ content: await stylesheet }); await page.addScriptTag({ content: await bundle })
    await page.evaluate(args => (window as any).mountContentTabsFixture(args), options); await frames(page)
    await run(page); assert.deepEqual(errors, [], "Actual ContentTabs should not throw page errors")
  } finally { await page.close() }
}
