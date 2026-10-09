import test from "node:test"
import assert from "node:assert/strict"
import { build } from "esbuild"
import { chromium, type Browser, type Page } from "playwright-core"

// Real Controller, Input, React state, Chromium editing/undo; clipboard and
// menu bridge stay in memory. Actual OS/native menu is covered separately.
const bundle=build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {Input} from './src/components/ui/input';import {DesktopCommandController} from './src/components/desktop/DesktopCommandController';
import {useDesktopStore} from './src/stores/desktop';import {defaultState} from './desktop/core/settings';
globalThis.keyState='public-fixture';globalThis.clipboard='paste-fixture';globalThis.writes=[];globalThis.menus=[];globalThis.errors=[];
let writeGate=null,menuGate=null;
window.desktop={writeClipboardText:async text=>{globalThis.writes.push(text);await writeGate?.promise},readClipboardText:async()=>globalThis.clipboard,showInputContextMenu:async state=>{globalThis.menus.push(state);return await menuGate?.promise??null}};
useDesktopStore.setState({bootstrap:{...defaultState,platform:'darwin'}});
function App(){const [value,setValue]=useState('public-fixture');return <><DesktopCommandController/><Input aria-label='API Key' type='password' data-desktop-clipboard='api-key' value={value} onChange={e=>{globalThis.keyState=e.target.value;setValue(e.target.value)}}/><input id='outside'/><input id='ordinary' type='password' defaultValue='ordinary-fixture'/></>}
const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(<App/>));
globalThis.override=overrides=>useDesktopStore.setState(state=>({bootstrap:{...state.bootstrap,settings:{...state.bootstrap.settings,shortcuts:{...state.bootstrap.settings.shortcuts,darwin:overrides}}}}));
globalThis.gate=kind=>{let resolve;const promise=new Promise(yes=>resolve=yes);const gate={promise,resolve};if(kind==='write')writeGate=gate;else menuGate=gate;globalThis.release=resolve};
globalThis.dispose=()=>flushSync(()=>root.unmount());
`},bundle:true,write:false,platform:"browser",format:"iife",tsconfig:"tsconfig.json",plugins:[{name:"memory-errors",setup(build){build.onResolve({filter:/^sonner$/},args=>({path:args.path,namespace:"fixture"}));build.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export const toast={info:x=>globalThis.errors.push(x),error:x=>globalThis.errors.push(x)}"}))}}]})
let browser:Browser
test.before(async()=>{const executablePath=process.env.XAANINK_TEST_CHROMIUM;browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})})})
test.after(async()=>{await browser?.close()})
async function scenario(run:(page:Page)=>Promise<void>){
 const page=await browser.newPage();await page.route("**/*",route=>route.abort());await page.setContent('<div id="app"></div>');await page.evaluate("globalThis.__name = target => target");await page.addScriptTag({content:(await bundle).outputFiles[0].text})
 try{await page.getByLabel("API Key").focus();await run(page)}finally{await page.evaluate(()=>(window as any).dispose());await page.close()}
}
const select=(page:Page,start=0,end=6)=>page.getByLabel("API Key").evaluate((element:HTMLInputElement,[start,end])=>element.setSelectionRange(start,end),[start,end])
const settle=(page:Page)=>page.evaluate(async()=>{for(let n=0;n<8;n++)await Promise.resolve()})
test("K01/K04: default copy/cut routes a masked Key selection, native delete updates React and undo/redo",async()=>scenario(async page=>{
 await select(page);await page.keyboard.press("Meta+c");await settle(page);assert.deepEqual(await page.evaluate(()=>(window as any).writes),["public"])
 await page.keyboard.press("Meta+x");await settle(page);assert.equal(await page.getByLabel("API Key").inputValue(),"-fixture");assert.equal(await page.evaluate(()=>(window as any).keyState),"-fixture")
 await page.keyboard.press("Meta+z");assert.equal(await page.getByLabel("API Key").inputValue(),"public-fixture")
 await page.keyboard.press("Meta+Shift+z");assert.equal(await page.getByLabel("API Key").inputValue(),"-fixture")
 assert.equal(await page.getByLabel("API Key").getAttribute("type"),"password")
}))
test("K02: default paste replaces the selection as literal text, updates React and supports undo",async()=>scenario(async page=>{
 await page.evaluate(()=>{(window as any).clipboard='<img src=x>'});await select(page);await page.keyboard.press("Meta+v");await settle(page)
 assert.equal(await page.getByLabel("API Key").inputValue(),"<img src=x>-fixture");assert.equal(await page.evaluate(()=>(window as any).keyState),"<img src=x>-fixture")
 assert.equal(await page.locator("img").count(),0);await page.keyboard.press("Meta+z");assert.equal(await page.getByLabel("API Key").inputValue(),"public-fixture")
}))
for(const [id,key] of [["text.copy","c"],["text.cut","x"],["text.paste","v"]])test(`K05: removed/rebound ${id} default never bypasses confirmed shortcuts`,async()=>scenario(async page=>{
 await select(page);await page.evaluate(id=>(window as any).override({[id]:[]}),id);await page.keyboard.press(`Meta+${key}`);await settle(page)
 assert.equal(await page.getByLabel("API Key").inputValue(),"public-fixture");assert.deepEqual(await page.evaluate(()=>(window as any).writes),[])
 await page.evaluate(([id,key])=>(window as any).override({[id]:['Cmd+Alt+'+key.toUpperCase()]}),[id,key]);await page.keyboard.press(`Meta+${key}`);await settle(page)
 assert.equal(await page.getByLabel("API Key").inputValue(),"public-fixture");await page.keyboard.press(`Meta+Alt+${key}`);await settle(page)
 if(id==="text.copy")assert.deepEqual(await page.evaluate(()=>(window as any).writes),["public"])
 else assert.notEqual(await page.getByLabel("API Key").inputValue(),"public-fixture")
}))
test("K06: actual DOM focus A to B to A revokes a pending menu choice and a pending cut",async()=>scenario(async page=>{
 await select(page);await page.evaluate(()=>{(window as any).gate('menu');document.querySelector('[aria-label="API Key"]')!.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))})
 await page.locator("#outside").focus();await page.getByLabel("API Key").focus();await page.evaluate(()=>(window as any).release('text.cut'));await settle(page)
 assert.deepEqual(await page.evaluate(()=>(window as any).writes),[])
 await select(page);await page.evaluate(()=>(window as any).gate('write'));await page.keyboard.press("Meta+x");await settle(page)
 await page.locator("#outside").focus();await page.getByLabel("API Key").focus();await page.evaluate(()=>(window as any).release());await settle(page)
 assert.equal(await page.getByLabel("API Key").inputValue(),"public-fixture");assert.equal(await page.evaluate(()=>(window as any).keyState),"public-fixture")
}))
