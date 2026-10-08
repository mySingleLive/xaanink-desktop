import {_electron as electron} from 'playwright'
import {expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdtemp,rm,writeFile,realpath,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const require=createRequire(import.meta.url),temporary=await realpath(await mkdtemp(join(tmpdir(),'xaanink-macos-reopen-'))),root=join(temporary,'data'),evidence='docs/evidence/implementation-12',startedAt=new Date().toISOString(),errors=[]
let app,page,passed=false
try{
 assert.equal(process.platform,'darwin');await mkdir(evidence,{recursive:true});execFileSync(process.execPath,['--import','tsx','scripts/seed-electron-fixture.ts',temporary],{encoding:'utf8'})
 app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],env:{...process.env,XAANINK_TEST_ROOT:root},timeout:60000})
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:60000})
 const pid=app.process().pid,before=await page.evaluate(()=>window.desktop.bootstrap())
 await page.evaluate(()=>window.desktop.command('window.close')).catch(()=>{})
 await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),{timeout:60000}).toBe(0)
 assert.equal(app.process().exitCode,null)
 // Exercise Electron's actual activate handler; this is not a physical Dock click.
 await app.evaluate(({app})=>app.emit('activate'))
 page=await app.firstWindow({timeout:60000});page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:60000})
 assert.equal(app.process().pid,pid);const after=await page.evaluate(()=>window.desktop.bootstrap());assert.equal(after.dataRoot,before.dataRoot);assert.notEqual(after.draftSessionId,before.draftSessionId)
 await expect(page.getByText('桌面验收夹具',{exact:true}).first()).toBeVisible();await page.getByRole('button',{name:'账号菜单'}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();await expect(page.getByRole('textbox',{name:'应用数据目录',exact:true})).toHaveValue(root)
 await page.screenshot({path:join(evidence,'native-macos-reopen.png')});assert.deepEqual(errors,[])
 await writeFile(join(evidence,'native-macos-reopen.json'),JSON.stringify({scope:'real macOS Electron development: original window.close command, actual close/save/service drain, no-window process remains alive; controlled Electron activate event (not a physical Dock click), new window and draft session, original work and settings bootstrap',startedAt,completedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,passed:true,errors},null,2)+'\n');passed=true
 console.log('Native macOS window-close / activate passed.')
}catch(error){await writeFile(join(evidence,'native-macos-reopen-failure.json'),JSON.stringify({startedAt,errors,error:String(error)},null,2)+'\n');try{await page?.screenshot({path:join(evidence,'native-macos-reopen-failure.png')})}catch{};throw error}
finally{await app?.close().catch(()=>{});if(passed){await rm(temporary,{recursive:true,force:true});await rm(root+'-bootstrap',{recursive:true,force:true})}else console.log('Retained isolated reopen fixture:',temporary)}
