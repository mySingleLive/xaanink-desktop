import assert from 'node:assert/strict'
import { _electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

assert.equal(process.platform,'win32','This report requires actual Windows')
const directory=await mkdtemp(join(tmpdir(),'xaanink-surfaces-')),root=join(directory,'data')
const label=process.argv[3]??'native-local-01'
assert(/^[a-z0-9-]+$/.test(label),'Safe evidence label required')
const evidence=resolve('docs/evidence/workspace-surfaces',label),report={scope:'Actual Windows Electron, current built real React components; isolated synthetic data, zero models, renderer offline; CDP pointer/keyboard, not physical OS mouse/IME or macOS acceptance. No proposed CSS/DOM replacement.',startedAt:new Date().toISOString(),checks:[],errors:[],sourceHashes:{},bundleHashes:{}}
await mkdir(evidence,{recursive:true})
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
for(const file of ['src/app/desktop.css','src/app/globals.css','src/components/layout/DashboardShell.tsx','src/components/editor/MarkdownEditor.tsx','src/components/content/planning/planning.module.css','desktop/core/directory-sync.ts','desktop/main/file-export.ts','desktop/core/work-lease-recovery.ts','desktop/core/root-relocation.ts','desktop/core/root-authority.ts','scripts/verify-workspace-surfaces.mjs','scripts/seed-workspace-surfaces.ts','package-lock.json'])report.sourceHashes[file]=hash(await readFile(file))
async function built(dir){for(const e of await readdir(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isDirectory())await built(path);else if(/\.(css|js|cjs)$/.test(e.name))report.bundleHashes[path.replace(resolve('.')+'\\','')]=hash(await readFile(path))}}
await built(resolve('dist'));await built(resolve('.next/static'))
let app,page
const env={...process.env,XAANINK_TEST_ROOT:root};delete env.ELECTRON_RUN_AS_NODE
async function launch(){
  const packaged=process.argv[2]
  app=await _electron.launch({...(packaged?{executablePath:resolve(packaged),args:[]}:{args:[resolve('.')]}),env,timeout:90000})
  page=await app.firstWindow({timeout:90000});page.on('pageerror',e=>report.errors.push(e.message));await page.context().setOffline(true)
  await page.getByRole('button',{name:'账号菜单',exact:true}).waitFor({timeout:90000})
  assert.equal(page.url(),'xaanink://app/')
  const state=await page.evaluate(()=>window.desktop.bootstrap());assert.equal(state.dataRoot,root);assert.equal(state.models.length,0)
  report.runtime=await app.evaluate(()=>({platform:process.platform,electron:process.versions.electron,node:process.versions.node}))
  if(packaged)report.packagedExecutableHash=hash(await readFile(resolve(packaged)))
}
async function bounds(width=1440,height=900){await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setBounds({width,height}),{width,height});await settle()}
async function settle(){await page.waitForTimeout(750)}
async function appearance(patch){
  await page.evaluate(async patch=>{const s=await window.desktop.bootstrap();await window.desktop.settings({type:'update',revision:s.revision,settings:{...s.settings,appearance:{...s.settings.appearance,...patch}}})},patch)
  if(patch.theme)await page.waitForFunction(theme=>document.documentElement.classList.contains(theme),patch.theme)
  if(patch.zoom)assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()),patch.zoom)
  await settle()
}
const palette=['rgb(245, 238, 220)','rgb(250, 246, 232)','rgb(248, 243, 228)']
async function inspect(label){
  const result=await page.evaluate(()=>{
    const rect=el=>el.getBoundingClientRect().toJSON(),color=s=>getComputedStyle(document.querySelector(s)).backgroundColor
    const panels=['sidebar','chat','content'].map(id=>({id,rect:rect(document.querySelector('.workspace-'+id))}))
    const horizontal=[['.workspace-chat .chatpane > .desktop-drag','bottom'],['.workspace-sidebar > div > .border-t','top'],['.content-tabs > [role=tablist]','bottom']].flatMap(([s,edge])=>{const el=document.querySelector(s);if(!el)return[];const style=getComputedStyle(el);return[{s,width:parseFloat(edge==='top'?style.borderTopWidth:style.borderBottomWidth),color:edge==='top'?style.borderTopColor:style.borderBottomColor}]})
    const handles=[...document.querySelectorAll('.workspace-group > [data-separator]')].map(el=>{const s=getComputedStyle(el);return {rect:rect(el),width:parseFloat(s.width),stroke:parseFloat(s.borderLeftWidth),color:s.borderLeftColor,background:s.backgroundColor,children:el.children.length}})
    const captions=[...document.querySelectorAll('.desktop-sidebar-controls,.chatpane > .desktop-drag,.content-tabs > .desktop-drag')].map(el=>rect(el))
    const controls=[...document.querySelectorAll('.desktop-sidebar-controls button,.chatpane > .desktop-drag > button,.content-tabs > .desktop-drag > button,[data-desktop-menu-button]')].filter(el=>el.getBoundingClientRect().width>0).map(el=>({label:el.getAttribute('aria-label'),content:!!el.closest('.content-tabs'),menu:el.hasAttribute('data-desktop-menu-button'),rect:rect(el),svg:el.querySelector('svg')?rect(el.querySelector('svg')):null}))
    return {dpr:devicePixelRatio,viewportWidth:innerWidth,font:getComputedStyle(document.documentElement).fontSize,colors:[color('.workspace-sidebar > div'),color('.workspace-chat .chatpane'),color('.content-tabs')],panels,horizontal,handles,captions,controls}
  })
  const zoom=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
  assert.deepEqual(result.colors,palette,label)
  assert.equal(result.handles.length,2)
  const width=result.horizontal[0].width
  for(const line of result.horizontal){assert(Math.abs(line.width-width)<.015,label+' horizontal width');assert.equal(line.color,'rgb(216, 203, 166)')}
  for(const [i,line]of result.handles.entries()){
    assert.equal(line.width,0);assert.equal(line.children,0);assert.equal(line.background,'rgba(0, 0, 0, 0)')
    assert.equal(line.color,'rgb(216, 203, 166)');assert(Math.abs(line.stroke-width)<.015)
    assert(Math.abs(line.rect.width-width)<.015)
    assert(Math.abs(line.rect.left-result.panels[i].rect.right)<.02&&Math.abs(line.rect.right-result.panels[i+1].rect.left)<.02,label+' no gutter')
  }
  assert(result.captions.every(r=>Math.abs(r.height*zoom-44)<.12),label+' caption heights')
  const menu=result.controls.find(c=>c.menu);assert(menu)
  assert(menu.rect.right*zoom<=result.viewportWidth*zoom-138+.2,label+' native caption safe area')
  for(const control of result.controls){
    const size=control.content?24:28,r=control.rect
    assert(Math.abs((r.top+r.height/2)*zoom-16)<.65,label+' actual caption button center')
    assert(Math.abs(r.width*zoom-size)<.15&&Math.abs(r.height*zoom-size)<.15,label+' actual caption button dimensions')
    if(control.content)assert(r.right<=menu.rect.left+.02,label+' content tools avoid app menu')
    if(control.svg)assert(Math.abs(control.svg.width*zoom-16)<.15&&Math.abs(control.svg.height*zoom-16)<.15,label+' actual caption icon dimensions')
  }
  report.checks.push({label,zoom,...result});return result
}
async function screenshot(label){await page.screenshot({path:join(evidence,label+'.png')});report.checks.push({label:label+'-screenshot',hash:hash(await readFile(join(evidence,label+'.png')))})}
async function bg(selector,expected,label){await page.locator(selector).first().waitFor();const color=await page.locator(selector).first().evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(color,expected,label);report.checks.push({label,color})}
async function tab(title){await page.getByRole('tab',{name:title}).click();await settle()}
async function collapsed(selector,separators,label){
  await page.waitForFunction(selector=>document.querySelector(selector).getBoundingClientRect().width*devicePixelRatio<=1,selector,{timeout:10000});await settle()
  const geometry=await page.locator(selector).evaluate(el=>({width:el.getBoundingClientRect().width,dpr:devicePixelRatio,panel:el.parentElement.getBoundingClientRect().toJSON()}))
  assert(geometry.width*geometry.dpr<=1);assert.equal(await page.locator('.workspace-group > [data-separator]').count(),separators)
  report.checks.push({label,...geometry,maximumDevicePixels:1,separators})
}
try{
  await launch();await bounds()
  await page.getByRole('button',{name:'显示内容面板',exact:true}).click();await settle()
  await inspect('empty-paper');await screenshot('implemented-empty-paper')
  await app.close();app=null
  execFileSync(process.execPath,['--import','tsx','scripts/seed-workspace-surfaces.ts',directory],{encoding:'utf8',timeout:90000,windowsHide:true})
  await launch();await bounds(1800,1000)
  await page.getByRole('tab',{name:'普通内容验证',exact:true}).waitFor({timeout:60000})
  await inspect('populated-paper')
  await page.getByText('暂存并换任务',{exact:true}).click()
  await page.getByRole('button',{name:/创建其他角色/}).click()
  const aiEditor=page.locator('.workspace-chat .monaco-editor').first();await aiEditor.waitFor({timeout:60000})
  await bg('.workspace-chat .monaco-editor .monaco-editor-background','rgb(249, 244, 228)','AI real editor retains original paper')
  assert(await page.getByText('独立界面验证消息。',{exact:true}).isVisible())
  await bg('.workspace-chat .chatpane',palette[1],'real message conversation surface')
  const aiSurface=await aiEditor.evaluate(el=>getComputedStyle(el.closest('[data-testid="story-task-navigation"]')).backgroundColor);assert.equal(aiSurface,'rgb(252, 248, 238)');report.checks.push({label:'real AI task surface',color:aiSurface})
  for(const [title,selector]of [['规划验证','.workspace-content [class*="__workspace"]'],['试验场验证','.workspace-content .scpane'],['场景验证','.workspace-content .scene-workspace'],['候选稿验证','[data-testid="candidate-panel"]']]){
    await tab(title)
    await bg(selector,palette[2],title+' surface')
    await screenshot('panel-'+({'规划验证':'planning','试验场验证':'scenario','场景验证':'scene','候选稿验证':'candidate'}[title]))
  }
  await tab('正文验证')
  const content=page.locator('.workspace-content')
  await content.getByRole('button',{name:'编辑',exact:true}).click()
  const editor=content.locator('.monaco-editor').first();await editor.waitFor({timeout:60000});const original=await editor.elementHandle()
  await bg('.workspace-content .monaco-editor .monaco-editor-background',palette[2],'real manuscript editor')
  await bg('.workspace-content .monaco-editor .margin',palette[2],'real manuscript gutter')
  const originalText=await editor.locator('.view-lines').textContent()
  await editor.getByRole('textbox',{name:'Editor content',exact:true}).focus();await page.keyboard.press('Control+End');await page.keyboard.insertText('【分栏草稿】')
  await page.waitForFunction(()=>document.querySelector('.workspace-content .view-lines')?.textContent.includes('【分栏草稿】'))
  await page.keyboard.press('Shift+Home')
  const draftText=await editor.locator('.view-lines').textContent()
  await appearance({theme:'ink'});assert.equal(await original.evaluate(el=>el.isConnected),true)
  await appearance({theme:'paper'});assert.equal(await original.evaluate(el=>el.isConnected),true);assert.equal(await editor.locator('.view-lines').textContent(),draftText)
  assert(await page.getByText('独立界面验证消息。',{exact:true}).isVisible());await bg('.workspace-chat .chatpane',palette[1],'message conversation after theme roundtrip')
  // Replacing the selected final line proves the model selection survives,
  // rather than inferring it from Monaco's input proxy textarea offsets.
  await editor.getByRole('textbox',{name:'Editor content',exact:true}).focus();await page.keyboard.insertText('【选区替换】')
  await page.waitForFunction(()=>document.querySelector('.workspace-content .view-lines')?.textContent.includes('【选区替换】')&&!document.querySelector('.workspace-content .view-lines')?.textContent.includes('第二段正文。'))
  assert(!(await editor.locator('.view-lines').textContent()).includes('【分栏草稿】'))
  await page.keyboard.press('Control+z');await page.waitForFunction(()=>document.querySelector('.workspace-content .view-lines')?.textContent.includes('【分栏草稿】'))
  await editor.getByRole('textbox',{name:'Editor content',exact:true}).focus();await page.keyboard.press('Control+z')
  await page.waitForFunction(()=>!document.querySelector('.workspace-content .view-lines')?.textContent.includes('【分栏草稿】'))
  assert.equal(await editor.locator('.view-lines').textContent(),originalText)
  report.checks.push({label:'original editor draft-model-selection-undo survives paper-ink-paper',sameElement:true,selectionVerifiedByReplacement:true,draftBeforeAfterHash:hash(Buffer.from(draftText)),undoRestoredOriginal:true})
  const cdp=await page.context().newCDPSession(page)
  await page.keyboard.press('Control+End')
  await cdp.send('Input.imeSetComposition',{text:'组合输入验证',selectionStart:6,selectionEnd:6})
  await appearance({theme:'ink'});await appearance({theme:'paper'})
  await cdp.send('Input.insertText',{text:'组合输入验证'})
  await page.waitForFunction(()=>document.querySelector('.workspace-content .view-lines')?.textContent.includes('组合输入验证'))
  assert.equal(await original.evaluate(el=>el.isConnected),true)
  await page.keyboard.press('Control+z');await page.waitForFunction(()=>!document.querySelector('.workspace-content .view-lines')?.textContent.includes('组合输入验证'))
  report.checks.push({label:'Chromium IME composition chain survives theme roundtrip and undo',driver:'CDP imeSetComposition/insertText; synthetic Chromium composition, physical Windows IME not executed'})
  await cdp.detach()
  await content.getByRole('button',{name:'分屏',exact:true}).click();await settle()
  const split=await content.locator('.desktop-markdown-split').evaluate(el=>{const [left,line,right]=[...el.children].map(n=>n.getBoundingClientRect()),style=getComputedStyle(el.children[1]);return{left:left.width,right:right.width,line:line.width,stroke:parseFloat(style.borderLeftWidth),gapLeft:line.left-left.right,gapRight:right.left-line.right}})
  assert(Math.abs(split.line-split.stroke)<.02&&Math.abs(split.gapLeft)<.02&&Math.abs(split.gapRight)<.02);assert(split.left>40&&split.right>40)
  report.checks.push({label:'real edit-preview split border-only',...split});await screenshot('implemented-manuscript-split')
  await content.getByRole('button',{name:'预览',exact:true}).click();await settle()
  await bg('.content-tabs',palette[2],'real manuscript preview surface')
  const hr=await content.locator('.markdown-body hr').evaluate(el=>({height:getComputedStyle(el).height,width:getComputedStyle(el).borderTopWidth,color:getComputedStyle(el).borderTopColor}));assert.equal(hr.height,'0px');assert.equal(hr.color,'rgb(216, 203, 166)');report.checks.push({label:'real Markdown hr',...hr})
  await content.getByRole('button',{name:'正文功能菜单',exact:true}).click()
  const menu=page.locator('[data-slot=dropdown-menu-separator]').first();await menu.waitFor();const menuWidth=await menu.evaluate(el=>getComputedStyle(el).borderTopWidth);assert.equal(menuWidth,hr.width);await page.keyboard.press('Escape');report.checks.push({label:'real manuscript menu divider matches hr',width:menuWidth})
  await bounds(3200,1200)
  for(const zoom of [.75,1,1.25,1.5,2])for(const uiFontSize of [11,24]){await appearance({zoom,uiFontSize});await inspect('zoom-'+zoom+'-font-'+uiFontSize)}
  await appearance({zoom:1,uiFontSize:14});await bounds(1800,1000)
  for(const index of [0,1]){
    const handle=page.locator('.workspace-group > [data-separator]').nth(index),r=await handle.boundingBox(),pane=page.locator(index===0?'.workspace-sidebar':'.workspace-chat'),before=(await pane.boundingBox()).width
    await page.mouse.move(r.x+r.width+3,r.y+240);await page.mouse.down();await page.mouse.move(r.x+60,r.y+240,{steps:8});await page.mouse.up();await settle()
    assert(Math.abs((await pane.boundingBox()).width-before)>20,'Invisible line hit range must resize')
    const beforeKey=(await pane.boundingBox()).width;await handle.focus();await handle.press('ArrowRight');await settle();assert(Math.abs((await pane.boundingBox()).width-beforeKey)>2)
  }
  report.checks.push({label:'real Group edge pointer and keyboard resize',driver:'Electron CDP mouse/keyboard'})
  await page.getByRole('button',{name:'进入全屏',exact:true}).click();await collapsed('.workspace-chat',0,'actual content fullscreen collapsed AI');assert.equal(await page.getByRole('button',{name:'退出全屏',exact:true}).getAttribute('aria-pressed'),'true')
  await page.getByRole('button',{name:'退出全屏',exact:true}).click();await settle()
  await page.getByRole('button',{name:'展开或收起左侧导航栏',exact:true}).click();await collapsed('.workspace-sidebar',1,'actual sidebar collapsed');assert(await page.getByRole('button',{name:'显示左侧导航栏',exact:true}).isEnabled())
  await page.getByRole('button',{name:'显示左侧导航栏',exact:true}).click();await settle()
  await page.getByRole('button',{name:'显示 / 隐藏内容面板',exact:true}).click();await page.locator('.workspace-content').waitFor({state:'detached'})
  await page.getByRole('button',{name:'显示内容面板',exact:true}).click();await settle()
  await bounds(760,900)
  for(const [label,pane]of [['作品目录','sidebar'],['返回对话','chat'],['查看内容','content']]){await page.getByRole('navigation',{name:'创作工作区'}).getByRole('button',{name:label,exact:true}).click();assert.equal(await page.locator('.dashboard-shell').getAttribute('data-narrow-pane'),pane)}
  report.checks.push({label:'real visibility-fullscreen-narrow controls'})
  await appearance({theme:'ink'});await app.close();app=null;await launch();assert((await page.evaluate(()=>window.desktop.bootstrap())).settings.appearance.theme==='ink');await appearance({theme:'paper'});await bounds(1800,1000);await inspect('reopened-paper')
  assert.deepEqual(report.errors,[]);report.status='passed'
}catch(error){report.status='failed';report.failure=String(error);report.failureGeometry=await page?.evaluate(()=>[...document.querySelectorAll('.workspace-sidebar,.workspace-chat,.workspace-content')].map(el=>({className:el.className,rect:el.getBoundingClientRect().toJSON(),panel:el.parentElement.getBoundingClientRect().toJSON(),style:el.getAttribute('style'),panelStyle:el.parentElement.getAttribute('style')}))).catch(()=>null);await page?.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});process.exitCode=1}
finally{await app?.close().catch(()=>{});report.completedAt=new Date().toISOString();await writeFile(join(evidence,'windows-electron.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure,errors:report.errors}))}
