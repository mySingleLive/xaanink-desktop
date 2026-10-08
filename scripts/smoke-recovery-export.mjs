import {_electron as electron} from 'playwright'
import {expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdtemp,mkdir,rm,readFile,writeFile,readdir,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const require=createRequire(import.meta.url),temporary=await realpath(await mkdtemp(join(tmpdir(),'xaanink-recovery-export-native-'))),root=join(temporary,'data'),destination=join(temporary,'exports'),evidence='docs/evidence/implementation-21',checks=[],errors=[],startedAt=new Date().toISOString()
let app,page,passed=false
async function ready(current){page=current??await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:60000});await app.evaluate(({app,BrowserWindow})=>{app.focus({steal:true});BrowserWindow.getAllWindows()[0].focus()})}
async function settings(){await page.getByRole('button',{name:'账号菜单'}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click()}
try{
 assert.equal(process.platform,'darwin');await mkdir(evidence,{recursive:true});await mkdir(destination)
 const seed=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/seed-electron-fixture.ts',temporary],{encoding:'utf8'}).trim().split('\n').at(-1))
 app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],env:{...process.env,XAANINK_TEST_ROOT:root},timeout:60000});await ready()
 await page.locator('.chat-composer-editable').click();await page.keyboard.insertText('导出后仍待确认的对话输入')
 await page.getByText(/外观测试章/).last().click();await page.getByRole('button',{name:'编辑',exact:true}).click();const editor=page.locator('.monaco-editor').first();await expect(editor).toBeVisible({timeout:30000});await editor.getByRole('textbox',{name:'Editor content',exact:true}).press('Meta+ArrowDown');await page.keyboard.insertText('\n只导出恢复副本，不批准这段正文。');await expect(editor.locator('.view-lines')).toContainText('只导出恢复副本')
 await settings();await page.getByRole('switch',{name:'启动时恢复上次工作台',exact:true}).click();await expect(page.getByRole('switch',{name:'启动时恢复上次工作台',exact:true})).toHaveAttribute('aria-checked','false');await page.getByRole('button',{name:'关闭设置',exact:true}).click()
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),{timeout:30000}).toBe(0)
 const reopened=app.waitForEvent('window',{timeout:60000});await app.evaluate(({app})=>app.emit('activate'));await ready(await reopened);await expect(page.locator('.chat-composer-editable')).toHaveText('')
 await settings();await page.getByRole('button',{name:'查看备份',exact:true}).click();const recovery=page.getByRole('dialog',{name:'备份与草稿恢复',exact:true});await expect(recovery.getByRole('navigation',{name:'恢复草稿列表'})).toBeVisible()
 const save=recovery.getByRole('button',{name:'导出恢复草稿',exact:true})
 await app.evaluate(({dialog})=>{globalThis.recoveryExport21={target:null,calls:0};dialog.showSaveDialog=async()=>{const control=globalThis.recoveryExport21;control.calls++;return control.target?{canceled:false,filePath:control.target}:{canceled:true}}})
 await save.click();await expect.poll(()=>app.evaluate(()=>globalThis.recoveryExport21.calls)).toBe(1);await expect(save).toBeEnabled();assert.deepEqual(await readdir(destination),[]);assert.equal(await page.getByText('恢复草稿已导出',{exact:true}).count(),0)
 checks.push('original composer and Monaco unapproved inputs survive close/reopen as inert retained recovery; actual recovery export control cancellation writes no file and shows no success')
 const statePath=join(root,'state.json'),before=await readFile(statePath);await app.evaluate((_,target)=>{globalThis.recoveryExport21.target=target},statePath);await save.click();await expect(page.getByText('导出失败，原草稿仍保留在本机',{exact:true})).toBeVisible();assert.deepEqual(await readFile(statePath),before);await expect(save).toBeEnabled()
 checks.push('controlled native chooser selecting live application state.json is rejected without altering any configuration bytes')
 const target=join(destination,'恢复草稿.json');await app.evaluate((_,target)=>{globalThis.recoveryExport21.target=target},target);await save.click();await expect(page.getByText('恢复草稿已导出',{exact:true})).toBeVisible();await expect(save).toBeEnabled()
 const exported=JSON.parse(await readFile(target,'utf8'));assert.equal(exported.format,'xaanink-recovery');assert.equal(exported.version,1);assert(JSON.stringify(exported.snapshot.sources.recovery).includes('导出后仍待确认的对话输入'));assert(JSON.stringify(exported.snapshot.sources.recovery).includes('只导出恢复副本，不批准这段正文'));assert(JSON.stringify(exported.snapshot.sources.recovery).includes('operationId'))
 const chapter=await page.evaluate(async ids=>(await(await fetch(`/api/novels/${ids.novelId}/chapters/${ids.chapterId}`)).json()).chapter,seed);assert(!chapter.content.includes('只导出恢复副本'));await page.screenshot({path:join(evidence,'native-recovery-export.png')});assert.deepEqual(errors,[])
 checks.push('same original recovery dialog exports a verified complete JSON containing readable input and original inert execution metadata; database正文 remains unapproved')
 await writeFile(join(evidence,'native-recovery-export.json'),JSON.stringify({scope:'development actual macOS arm64 Electron original editor/composer/recovery UI and actual native save IPC; SaveDialog returns and activate event controlled, not physical OS chooser/Dock, Windows or formal acceptance',startedAt,completedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,checks,errors,passed:true},null,2)+'\n');passed=true;console.log('Native recovery export passed.')
}catch(error){await writeFile(join(evidence,'native-recovery-export-failure.json'),JSON.stringify({startedAt,checks,errors,error:String(error)},null,2)+'\n');try{await page?.screenshot({path:join(evidence,'native-recovery-export-failure.png')})}catch{};throw error}
finally{if(app){const timer=setTimeout(()=>app?.process().kill('SIGKILL'),5000);try{await app.close().catch(()=>{})}finally{clearTimeout(timer)}}if(passed)await rm(temporary,{recursive:true,force:true});else console.log('Retained isolated fixture:',temporary)}
