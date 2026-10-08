import {_electron as electron} from 'playwright'
import {expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const temporary=await mkdtemp(join(tmpdir(),'xaanink-config-smoke-')),root=join(temporary,'data'),evidence='docs/evidence/implementation-09',startedAt=new Date().toISOString()
let app,page;const checks=[],errors=[]
try{
 await mkdir(evidence,{recursive:true});execFileSync(process.execPath,['--import','tsx','scripts/seed-electron-fixture.ts',temporary],{encoding:'utf8'})
 app=await electron.launch({args:[resolve('.')],env:{...process.env,XAANINK_TEST_ROOT:root},timeout:45000});page=await app.firstWindow({timeout:45000});page.on('pageerror',e=>errors.push(e.message))
 await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:45000});await page.getByRole('button',{name:'账号菜单'}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click()
 // Native selection is deliberately controlled; this tests UI→main→real FS,
 // and does not stand in for the separately pending physical OS picker check.
 const destination=join(temporary,'export.json'),incoming=join(temporary,'incoming.json')
 await app.evaluate(({dialog},paths)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:paths.destination});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[paths.incoming]})},{destination,incoming})
 await page.getByRole('button',{name:'导出配置',exact:true}).click({timeout:3000})
 await expect.poll(async()=>{try{return JSON.parse(await readFile(destination,'utf8')).format}catch(error){if(error.code==='ENOENT')return null;throw error}}).toBe('xaanink-settings')
 const portable=JSON.parse(await readFile(destination,'utf8'));for(const field of ['apiKey','encryptedKey','dataRoot','defaultParent','avatarAssetId'])assert(!(await readFile(destination,'utf8')).includes(field))
 checks.push('settings export invokes controlled native-selection seam and writes portable schema to real isolated disk without keys/paths')
 portable.settings.appearance.theme='ink';portable.settings.appearance.uiFontSize=18;portable.settings.user.penName='跨设备作者';await writeFile(incoming,JSON.stringify(portable))
 await page.getByRole('button',{name:'导入配置',exact:true}).click()
 const preview=page.getByRole('dialog',{name:'导入配置',exact:true});await expect(preview).toBeVisible()
 assert.equal(JSON.parse(await readFile(join(root,'state.json'),'utf8')).value.settings.appearance.theme,'paper')
 await preview.getByRole('checkbox',{name:'导入 笔名',exact:true}).uncheck();await preview.getByRole('button',{name:'应用所选配置',exact:true}).click()
 await expect(preview).not.toBeVisible()
 await expect.poll(async()=>JSON.parse(await readFile(join(root,'state.json'),'utf8')).value.settings.appearance.theme).toBe('ink')
 let settings=JSON.parse(await readFile(join(root,'state.json'),'utf8')).value.settings
 assert.equal(settings.appearance.uiFontSize,18);assert.equal(settings.user.penName,'作者');await expect(page.locator('html')).toHaveClass(/ink/)
 checks.push('import preview performs no writes; selected theme/font size apply immediately through actual repository while deselected pen name is unchanged')
 await page.getByRole('button',{name:'导入配置',exact:true}).click();await expect(preview).toBeVisible();await preview.getByRole('button',{name:'取消',exact:true}).click();assert.equal(JSON.parse(await readFile(join(root,'state.json'),'utf8')).value.settings.user.penName,'作者')
 await writeFile(incoming,'{invalid');await page.getByRole('button',{name:'导入配置',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'配置文件不是有效 JSON'})).toBeVisible()
 checks.push('cancelled preview and invalid JSON preserve confirmed settings with a visible error')
 await page.screenshot({path:join(evidence,'native-configuration.png')});assert.deepEqual(errors,[])
 await writeFile(join(evidence,'native-configuration.json'),JSON.stringify({scope:'development actual Electron macOS UI/main/real FS; controlled native-picker return values, not system file chooser, Windows or formal acceptance',startedAt,completedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,passed:true,checks,errors},null,2)+'\n')
 console.log('Native configuration flow passed.')
}catch(error){await writeFile(join(evidence,'native-configuration-failure.json'),JSON.stringify({startedAt,checks,errors,error:String(error)},null,2)+'\n');try{await page?.screenshot({path:join(evidence,'native-configuration-failure.png')})}catch{};throw error}
finally{if(app){const timer=setTimeout(()=>app?.process().kill('SIGKILL'),10000);try{await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy()}).catch(()=>{});await app.close().catch(()=>{})}finally{clearTimeout(timer)}}await rm(temporary,{recursive:true,force:true})}
