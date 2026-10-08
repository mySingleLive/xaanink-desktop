import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
import {readFileSync,readdirSync} from 'node:fs'
import {chromium,type Browser,type Page} from 'playwright-core'
const css=readdirSync('.next/static/chunks').filter(name=>name.endsWith('.css')).sort().map(name=>readFileSync('.next/static/chunks/'+name,'utf8')).join('\n')

const children=new Map([
 ['./ShortcutSettings',['ShortcutSettings']],['./ModelSettings',['ModelSettings']],['./AgentSettings',['AgentSettings']],['./ProfileSettings',['ProfileSettings']],['./ConfigurationTransfer',['ConfigurationImportButton','ConfigurationExportButton']],
])
const bundle=build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
 import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
 import{SettingsDialog}from'./src/components/desktop/SettingsDialog';import{RecoveryDialog}from'./src/components/desktop/RecoveryDialog';
 import{defaultState}from'@desktop/core/settings';import{useDesktopStore}from'./src/stores/desktop';
 import{desktopRecoveryStore,installRecoveryDraftSource}from'./src/lib/desktop/draft-recovery';import{desktopSaveCoordinator}from'./src/lib/desktop/save-coordinator';
 window.mountDraftView=mode=>{
  const copied=[],exports=[],migrations=[],blocked=[];let views=0;
  const records=[{id:'retained-chat',source:'chat',path:'source',reason:'AUTOSAVE_UNMATCHED',createdAt:'2026-10-08T00:00:00Z',value:{draft:'保留的正文'+(mode==='long'?'字'.repeat(120000):''),pendingRequest:{url:'/never-send',body:'inert metadata'}}}];
  desktopRecoveryStore.retain(records);installRecoveryDraftSource(desktopSaveCoordinator);
  useDesktopStore.setState({bootstrap:{version:'test',platform:'win32',dataRoot:'/isolated/current',draftSessionId:'ordinary-session',settings:structuredClone(defaultState.settings),models:[]}});
  window.desktop=new Proxy({writeClipboardText:async text=>{copied.push(text)},exportDraft:async(sessionId,snapshot)=>{exports.push({sessionId,snapshot});return true},migrateRoot:async action=>{migrations.push(action)}},{get(target,key){if(/backup|restoreWork|restoreApplication|confirmApplicationRestoreDraft|acknowledgeWorkRestore/i.test(String(key))){blocked.push(String(key));throw Error('retired bridge accessed '+String(key))}return target[key]}});
  window.addEventListener('desktop:recovery',()=>{views++});
  const root=createRoot(document.getElementById('app'));flushSync(()=>root.render(mode==='settings'?<SettingsDialog open={true} onOpenChange={()=>{}}/>:<RecoveryDialog open={true} onOpenChange={()=>{}}/>));
  return{records,copied,exports,migrations,blocked,views:()=>views,read:()=>desktopRecoveryStore.read()};
 };
 `},bundle:true,platform:'browser',format:'iife',write:false,tsconfig:'tsconfig.json',plugins:[{name:'unrelated-settings-children',setup(api){
 api.onResolve({filter:/^\.\/(ShortcutSettings|ModelSettings|AgentSettings|ProfileSettings|ConfigurationTransfer)$/},args=>args.importer.endsWith('/SettingsDialog.tsx')?{path:args.path,namespace:'removed-backup-ui'}:undefined)
 api.onLoad({filter:/.*/,namespace:'removed-backup-ui'},args=>({loader:'tsx',resolveDir:process.cwd(),contents:children.get(args.path)!.map(name=>`export function ${name}(){return null}`).join(';')}))
 }}]}).then(result=>result.outputFiles![0].text)
let browser:Browser
test.before(async()=>{browser=await chromium.launch({headless:true,...(process.env.XAANINK_TEST_CHROMIUM?{executablePath:process.env.XAANINK_TEST_CHROMIUM}:{})})})
test.after(async()=>{await browser?.close()})
async function scenario(mode:'settings'|'drafts'|'long',run:(page:Page)=>Promise<void>){
 const page=await browser.newPage({viewport:{width:1100,height:900}}),errors:string[]=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort())
 try{await page.setContent('<div id="app"></div>');await page.addStyleTag({content:css});await page.addScriptTag({content:await bundle});await page.evaluate(mode=>{(window as any).f=(window as any).mountDraftView(mode)},mode);await page.getByRole('dialog').waitFor();await run(page);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>(window as any).f.blocked),[])}finally{await page.close()}
}
test('BRB-01 actual settings view has no backup settings and retains view-drafts and actual migration button',{timeout:20000},()=>scenario('settings',async page=>{
 assert.equal(await page.getByText(/备份/).count(),0);assert.equal(await page.getByLabel('应用数据目录',{exact:true}).inputValue(),'/isolated/current');await page.getByRole('button',{name:'迁移',exact:true}).click();await page.waitForFunction(()=>(window as any).f.migrations.length===1);assert.deepEqual(await page.evaluate(()=>(window as any).f.migrations),['start']);await page.getByRole('button',{name:'查看草稿',exact:true}).click();assert.equal(await page.evaluate(()=>(window as any).f.views()),1)
}))
for(const mode of['drafts','long'] as const)test(`BRB-02 actual ${mode} view copies readable preview and exports complete preserved records with no backup bridge`,{timeout:20000},()=>scenario(mode,async page=>{
 assert.equal(await page.getByRole('heading',{name:'保留的草稿',exact:true}).count(),2);assert.equal(await page.getByText(/备份/).count(),0);assert.equal(await page.getByRole('button',{name:/恢复|重试/}).count(),0);assert.equal(await page.getByRole('navigation',{name:'保留的草稿列表'}).getByRole('button').count(),1)
 const preview=await page.getByLabel('保留的草稿内容').inputValue();assert.equal(await page.getByLabel('保留的草稿内容').getAttribute('readonly'),'');assert.doesNotMatch(preview,/inert metadata|never-send/)
 if(mode==='long'){assert.equal(preview.length,100000);await page.getByText('预览仅显示前 100,000 个字符，完整内容可导出查看。',{exact:true}).waitFor()}
 await page.getByRole('button',{name:mode==='long'?'复制预览':'复制内容',exact:true}).click();await page.waitForFunction(()=>(window as any).f.copied.length===1);assert.deepEqual(await page.evaluate(()=>(window as any).f.copied),[preview]);await page.getByRole('button',{name:'导出草稿',exact:true}).click();await page.waitForFunction(()=>(window as any).f.exports.length===1)
 const result=await page.evaluate(()=>{const f=(window as any).f;return{records:f.records,current:f.read().items,exported:f.exports[0]}});assert.deepEqual(result.exported.snapshot.sources.recovery.items,result.records);assert.deepEqual(result.current,result.records);assert.equal(result.exported.sessionId,'ordinary-session')
}))
