import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
import {chromium,type Browser} from 'playwright-core'
const children=new Map([
 ['./ShortcutSettings',['ShortcutSettings']],['./ModelSettings',['ModelSettings']],['./AgentSettings',['AgentSettings']],['./ProfileSettings',['ProfileSettings']],['./ConfigurationTransfer',['ConfigurationImportButton','ConfigurationExportButton']],['./DataRootMigrationButton',['DataRootMigrationButton']],
])
const store=`import{useSyncExternalStore}from'react';import{defaultState}from'@desktop/core/settings';
 let state={bootstrap:{settings:structuredClone(defaultState.settings),dataRoot:'/isolated-fixture',version:'0.1.0'},saving:0,error:null};const listeners=new Set(),writes=[];
 export function useDesktopStore(selector){return useSyncExternalStore(run=>{listeners.add(run);return()=>listeners.delete(run)},()=>selector(state))}
 export function updateDesktopSettings(updater){return new Promise((resolve,reject)=>writes.push({updater,resolve,reject}))}
 window.settingsFixture={writes,read:()=>state.bootstrap.settings,confirm(index){const write=writes[index];const settings=write.updater(state.bootstrap.settings);state={...state,bootstrap:{...state.bootstrap,settings}};for(const run of listeners)run();write.resolve(settings)}};
 `
const bundle=build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{createRoot}from'react-dom/client';import{SettingsDialog}from'./src/components/desktop/SettingsDialog';window.desktop={workBackup:async()=>({type:'now',saved:[],failed:[]})};const root=createRoot(document.getElementById('app'));root.render(<SettingsDialog open={true} onOpenChange={()=>{}}/>);`},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json',plugins:[{name:'controlled-confirmed-settings',setup(api){
 api.onResolve({filter:/^@\/stores\/desktop$/},()=>({path:'desktop-store',namespace:'review77'}))
 api.onResolve({filter:/^\.\/(ShortcutSettings|ModelSettings|AgentSettings|ProfileSettings|ConfigurationTransfer|DataRootMigrationButton)$/},args=>args.importer.endsWith('/SettingsDialog.tsx')?{path:args.path,namespace:'review77'}:undefined)
 api.onLoad({filter:/.*/,namespace:'review77'},args=>({loader:'tsx',resolveDir:process.cwd(),contents:args.path==='desktop-store'?store:children.get(args.path)!.map(name=>`export function ${name}(){return null}`).join(';')}))
 }}]}).then(result=>result.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,...(process.env.XAANINK_TEST_CHROMIUM?{executablePath:process.env.XAANINK_TEST_CHROMIUM}:{})})});test.after(async()=>{await browser?.close()})
test('BS77-01 the actual settings selects capture both chosen numbers before queued confirmation restores the controlled DOM',async()=>{
 const page=await browser.newPage({viewport:{width:900,height:900}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort())
 try{
  await page.setContent('<div id="app"></div><style>.desktop-settings{width:650px;max-height:800px;overflow:auto}.desktop-setting-row{display:flex;gap:8px;margin:8px}</style>');await page.addScriptTag({content:await bundle})
  await page.getByLabel('备份间隔',{exact:true}).selectOption('1');await page.getByLabel('保留备份份数',{exact:true}).selectOption('2');assert.equal(await page.evaluate(()=>(window as any).settingsFixture.writes.length),2)
  await page.evaluate(()=>{(window as any).settingsFixture.confirm(0);(window as any).settingsFixture.confirm(1)})
  assert.deepEqual(await page.evaluate(()=>{const general=(window as any).settingsFixture.read().general;return{interval:general.backupIntervalMinutes,retention:general.backupRetention}}),{interval:1,retention:2})
  assert.equal(await page.getByLabel('备份间隔',{exact:true}).inputValue(),'1');assert.equal(await page.getByLabel('保留备份份数',{exact:true}).inputValue(),'2');assert.deepEqual(errors,[])
 }finally{await page.close()}
})
