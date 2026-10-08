import {_electron as electron} from 'playwright'
import {expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
const temporary=await mkdtemp(join(tmpdir(),'xaanink-recovery-')),evidence='docs/evidence/implementation-08',root=join(temporary,'data')
const checks=[],errors=[],startedAt=new Date().toISOString()
let app
await mkdir(evidence,{recursive:true})
const journal=async()=>JSON.parse(await readFile(join(root,'drafts.json'),'utf8'))
const ready=async(provided)=>{
 const page=provided??await app.firstWindow({timeout:45000})
 page.on('pageerror',error=>errors.push(error.message))
 await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:45000})
 await app.evaluate(({app,BrowserWindow})=>{app.focus({steal:true});BrowserWindow.getAllWindows()[0].focus()})
 return page
}
const closeWindow=async()=>{
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close())
 await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),{timeout:30000}).toBe(0)
}
const reopen=async()=>{const opened=app.waitForEvent('window',{timeout:45000});await app.evaluate(({app})=>app.emit('activate'));return ready(await opened)}
const launch=()=>electron.launch({args:[resolve('.')],env:{...process.env,XAANINK_TEST_ROOT:root},timeout:45000})
const settings=async page=>{await page.getByRole('button',{name:'账号菜单'}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click()}
try{
 const seed=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/seed-electron-fixture.ts',temporary],{encoding:'utf8'}).trim().split('\n').at(-1))
 app=await launch();let page=await ready()
 const composer=()=>page.locator('.chat-composer-editable')
 await composer().click();await page.keyboard.insertText('重开后保留的对话草稿')
 await page.getByText(/外观测试章/).last().click();await page.getByRole('button',{name:'编辑',exact:true}).click()
 const editor=page.locator('.monaco-editor').first();await expect(editor).toBeVisible({timeout:30000})
 await editor.getByRole('textbox',{name:'Editor content',exact:true}).press('Meta+ArrowDown');await page.keyboard.insertText('\n关闭前的正文输入');await expect(editor.locator('.view-lines')).toContainText('关闭前的正文输入')
 await closeWindow()
 const closed=await journal();assert(closed.snapshot.sources.workspace.tabs.some(tab=>tab.refId===seed.chapterId));assert(closed.snapshot.sources.workspace.layout.contentVisible)
 assert(JSON.stringify(closed.snapshot.sources.chat).includes('重开后保留的对话草稿'))
 page=await reopen();await expect(composer()).toContainText('重开后保留的对话草稿')
 await expect(page.locator('.workspace-content')).toBeVisible()
 const chapter=await page.evaluate(async ids=>(await (await fetch(`/api/novels/${ids.novelId}/chapters/${ids.chapterId}`)).json()).chapter,seed)
 assert(!chapter.content.includes('关闭前的正文输入'),'close must not approve a staged manuscript change')
 const staged=Object.values(closed.snapshot.sources.staged.batches).flatMap(batch=>batch.changes);assert(staged.some(change=>change.targetId===seed.chapterId&&change.request.body.content.includes('关闭前的正文输入')))
 await expect(page.getByTestId('staged-edit-button')).toBeVisible()
 checks.push('actual macOS window close persists original Monaco input as an unapproved staged change; the database manuscript remains unchanged; application stays running and activate restores original tab, layout, staging controls and composer draft')
 await composer().click();await page.keyboard.press('Meta+a');await page.keyboard.insertText('渲染窗口意外销毁前的草稿')
 await expect.poll(async()=>JSON.stringify((await journal()).snapshot.sources.chat),{timeout:10000}).toContain('渲染窗口意外销毁前的草稿')
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].destroy())
 page=await reopen();await expect(composer()).toContainText('渲染窗口意外销毁前的草稿')
 checks.push('abrupt renderer window destruction restores the last durable composer checkpoint without sending a model request')
 await settings(page);await page.getByRole('button',{name:'通用',exact:true}).click()
 const switcher=page.getByRole('switch',{name:'启动时恢复上次工作台',exact:true})
 await switcher.click();await expect(switcher).toHaveAttribute('aria-checked','false')
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();await expect(composer()).toContainText('渲染窗口意外销毁前的草稿')
 await closeWindow();page=await reopen();await expect(composer()).toHaveText('')
 await expect(page.locator('.workspace-content')).toHaveCount(0)
 await settings(page);await page.getByRole('button',{name:'通用',exact:true}).click();await page.getByRole('button',{name:'查看保留的草稿',exact:true}).click()
 const recovery=page.getByRole('dialog',{name:'保留的草稿',exact:true});await expect(recovery).toBeVisible()
 assert((await recovery.getByRole('navigation',{name:'恢复草稿列表'}).getByRole('button').count())>0)
 await page.screenshot({path:join(evidence,'native-recovery.png')})
 checks.push('disabling startup restore preserves current input until close, starts with an empty original workbench next time, and exposes retained copies in recovery dialog')
 await closeWindow();await app.close();app=undefined
 const corrupt=Buffer.from('{ isolated invalid journal fixture\n'),before=createHash('sha256').update(corrupt).digest('hex');await writeFile(join(root,'drafts.json'),corrupt)
 app=await launch();page=await app.firstWindow({timeout:45000});await expect(page.getByRole('alert').filter({hasText:'原文件已保留'})).toContainText('原文件已保留',{timeout:45000});await closeWindow()
 assert.equal(createHash('sha256').update(await readFile(join(root,'drafts.json'))).digest('hex'),before)
 checks.push('unreadable journal prevents editable workbench but can close its unmodified window while preserving exact corrupt fixture bytes')
 assert.deepEqual(errors,[])
 await writeFile(join(evidence,'native-recovery.json'),JSON.stringify({scope:'development real Electron macOS window close and recovery; not formal 531-case acceptance, physical Dock click, OS crash, native picker or Windows acceptance',startedAt,completedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,passed:true,checks,errors},null,2)+'\n')
 console.log('Native close and recovery smoke passed.')
}catch(error){
 await writeFile(join(evidence,'native-recovery-failure.json'),JSON.stringify({startedAt,completedAt:new Date().toISOString(),checks,errors,error:String(error)},null,2)+'\n')
 try{const pages=app?.windows()??[];if(pages[0])await pages[0].screenshot({path:join(evidence,'native-recovery-failure.png')})}catch{}
 throw error
}finally{
 // Test-only teardown may destroy the isolated window to avoid an intentional
 // native failure dialog preventing cleanup. Never used by the shipped app.
 if(app){const timer=setTimeout(()=>app?.process().kill('SIGKILL'),10000);try{await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy()}).catch(()=>{});await app.close().catch(()=>{})}finally{clearTimeout(timer)}}
 await rm(temporary,{recursive:true,force:true})
}
