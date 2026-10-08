import {_electron as electron} from 'playwright'
import {expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import {tmpdir,homedir} from 'node:os'
import {join,resolve} from 'node:path'
const temporary=await mkdtemp(join(tmpdir(),'xaanink-commands-')),evidence='docs/evidence/implementation-07'
const checks=[],errors=[],startedAt=new Date().toISOString()
let app,clipboardSaved=false
await mkdir(evidence,{recursive:true})
try{
 execFileSync(process.execPath,['--import','tsx','scripts/seed-electron-fixture.ts',temporary],{encoding:'utf8'})
 app=await electron.launch({args:[resolve('.')],env:{...process.env,XAANINK_TEST_ROOT:join(temporary,'data')},timeout:45000})
 const page=await app.firstWindow({timeout:45000})
 page.on('pageerror',error=>errors.push(error.message))
 await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:45000})
 await page.evaluate(()=>{
  globalThis.__commandDiagnostics=[]
  globalThis.__commandKeys=[]
  window.addEventListener('keydown',event=>{if(event.metaKey)setTimeout(()=>globalThis.__commandKeys.push({key:event.key,code:event.code,meta:event.metaKey,ctrl:event.ctrlKey,prevented:event.defaultPrevented,target:event.target?.className}),0)},true)
  new MutationObserver(()=>{for(const toast of document.querySelectorAll('[data-sonner-toast]')){const text=toast.textContent;if(text&&!globalThis.__commandDiagnostics.includes(text))globalThis.__commandDiagnostics.push(text)}}).observe(document.body,{childList:true,subtree:true})
 })
 const focus=async()=>{await app.evaluate(({app,BrowserWindow})=>{app.focus({steal:true});BrowserWindow.getAllWindows()[0].focus()});await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFocused())).toBe(true)}
 await focus()
 const settings=async()=>{await page.getByRole('button',{name:'账号菜单'}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click()}
 await settings();await page.getByRole('button',{name:'快捷键',exact:true}).click()
 await expect(page.getByText('正在读取正文编辑器命令…',{exact:true})).not.toBeVisible({timeout:30000})
 await expect(page.getByText(/正文编辑器命令目录暂不可用/)).not.toBeVisible()
 assert((await page.locator('[id^="shortcut-"]').count())>200,'assembled editor command catalog is visible before opening a document')
 checks.push('assembled local Monaco command catalog loaded before first document')
 const search=page.getByRole('textbox',{name:'快捷键搜索'})
 const addBinding=async(id,label,key)=>{
  await search.fill(id);await page.getByRole('button',{name:`添加 ${label} 的快捷键`,exact:true}).click()
  await page.getByRole('textbox',{name:'录制快捷键'}).press(key)
  await page.getByRole('dialog',{name:'添加快捷键',exact:true}).getByRole('button',{name:'保存',exact:true}).click()
  await expect(page.getByRole('dialog',{name:'添加快捷键',exact:true})).not.toBeVisible()
 }
 await addBinding('ai.clear','清空输入草稿','F8')
 await addBinding('text.paste','粘贴','F9')
 await page.getByRole('button',{name:'关闭设置',exact:true}).click()
 const composer=page.locator('.chat-composer-editable')
 await composer.click();await page.keyboard.insertText('保留的输入草稿')
 await page.keyboard.press('F8');await expect(composer).toHaveText('')
 await page.keyboard.press('Meta+z');await expect(composer).toHaveText('保留的输入草稿')
 await page.keyboard.press('Shift+Enter');await page.keyboard.insertText('第二行')
 assert((await composer.innerText()).includes('\n'))
 checks.push('custom AI clear executes once, native undo restores text, default newline inserts a line')
 await settings();await page.getByRole('button',{name:'用户',exact:true}).click()
 await page.getByRole('button',{name:'编辑用户',exact:true}).click()
 const user=page.getByRole('dialog',{name:'编辑用户',exact:true}),pen=user.getByRole('textbox',{name:'笔名',exact:true})
 await pen.fill('剪切操作夹具');await pen.press('Meta+a')
 await app.evaluate(async({clipboard})=>{globalThis.__commandTestClipboard=await clipboard.read()})
 clipboardSaved=true
 await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('text.cut').click())
 await expect(pen).toHaveValue('')
 assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'剪切操作夹具')
 await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('text.undo').click())
 await expect(pen).toHaveValue('剪切操作夹具')
 await app.evaluate(async({clipboard})=>{await clipboard.writeText('粘贴操作夹具')})
 await focus();await pen.press('Meta+a');await pen.press('F9');await expect(pen).toHaveValue('粘贴操作夹具')
 await pen.press('Meta+z');await expect(pen).toHaveValue('剪切操作夹具')
 checks.push('native menu cut/undo and custom paste affect the retained profile input and preserve undo')
 await user.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'关闭设置',exact:true}).click()
 await page.getByText(/外观测试章/).last().click();await page.getByRole('button',{name:'编辑',exact:true}).click()
 const editor=page.locator('.monaco-editor').first()
 await expect(editor).toBeVisible({timeout:30000})
 await editor.getByRole('textbox',{name:'Editor content',exact:true}).press('Meta+ArrowDown')
 await page.keyboard.insertText('命令验收文本');await page.keyboard.press('Shift+Alt+ArrowLeft')
 await page.keyboard.press('Meta+b');await expect(editor.locator('.view-lines')).toContainText('**')
 await page.keyboard.press('Meta+z');await expect(editor.locator('.view-lines')).not.toContainText('**')
 checks.push('original Monaco formatting uses the existing content and undo stack')
 await page.keyboard.press('Meta+ArrowDown');await page.keyboard.insertText('\n# 快捷键标题\n    折叠内层正文\n    折叠内层第二行\n折叠外正文')
 await expect(editor.locator('.view-lines')).toContainText('折叠内层正文')
 await page.keyboard.press('Meta+ArrowUp')
 await expect.poll(()=>editor.locator('.codicon-folding-expanded').count()).toBeGreaterThan(0)
 await page.keyboard.press('Meta+k');await page.keyboard.press('Meta+0')
 await expect(editor.locator('.view-lines')).not.toContainText('折叠内层正文')
 await page.keyboard.press('Meta+k');await page.keyboard.press('Meta+j')
 await expect(editor.locator('.view-lines')).toContainText('折叠内层正文')
 checks.push('native Monaco Cmd+K chord retains fold/unfold behavior despite global chat search')
 await page.getByRole('button',{name:'预览',exact:true}).click()
 const preview=page.locator('.desktop-markdown-editor .markdown-body').first()
 await expect(preview).toBeVisible();await preview.getByText('快捷键标题',{exact:true}).click()
 await page.keyboard.press('Meta+a')
 await focus();await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('text.copy').click())
 await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toContain('用于独立桌面测试的中文正文')
 const copied=await app.evaluate(({clipboard})=>clipboard.readText());assert(copied.includes('折叠内层正文'));assert(!copied.includes('创建作品'))
 await page.keyboard.press('Meta+x')
 await expect(editor).toBeVisible({timeout:15000});await expect(editor.locator('.view-lines')).not.toContainText('用于独立桌面测试的中文正文')
 await editor.getByRole('textbox',{name:'Editor content',exact:true}).press('Meta+z')
 await expect(editor.locator('.view-lines')).toContainText('用于独立桌面测试的中文正文')
 checks.push('preview select-all and native copy stay within the manuscript; cut switches to the original editor and native undo restores it')
 assert.deepEqual(errors,[])
 await page.screenshot({path:join(evidence,'native-commands.png')})
 await writeFile(join(evidence,'commands-latest.json'),JSON.stringify({scope:'development macOS arm64 Electron command integration; not physical keyboard, system picker, Windows, or full acceptance',startedAt,completedAt:new Date().toISOString(),status:'passed',checks,errors},null,2)+'\n')
 console.log(JSON.stringify({status:'passed',checks}))
}catch(error){
 if(app){const page=await app.firstWindow();await page.screenshot({path:join(evidence,'commands-failure.png')}).catch(()=>{});console.log(await page.evaluate(()=>({messages:globalThis.__commandDiagnostics,keys:globalThis.__commandKeys,folds:document.querySelectorAll('.codicon-folding-expanded').length,focused:document.hasFocus(),active:document.activeElement?.getAttribute('aria-label')})).catch(()=>''))}
 await writeFile(join(evidence,'commands-latest.json'),JSON.stringify({scope:'development Electron command integration',startedAt,status:'failed',checks,error:String(error).replaceAll(process.cwd(),'<repo>').replaceAll(temporary,'<isolated-temp>').replaceAll(homedir(),'<home>'),errors},null,2)+'\n')
 throw error
}finally{
 if(clipboardSaved)await app?.evaluate(async({clipboard})=>{await clipboard.write(globalThis.__commandTestClipboard);delete globalThis.__commandTestClipboard}).catch(()=>{})
 await app?.close().catch(()=>{});await rm(temporary,{recursive:true,force:true})
}
