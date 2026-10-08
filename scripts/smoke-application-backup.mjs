import {_electron as electron} from 'playwright'
import {expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdtemp,rm,writeFile,readFile,readdir,realpath,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const require=createRequire(import.meta.url),temporary=await realpath(await mkdtemp(join(tmpdir(),'xaanink-native-application-backup-'))),root=join(temporary,'data'),evidence=process.env.XAANINK_BACKUP_EVIDENCE??'docs/evidence/implementation-30',startedAt=new Date().toISOString(),checks=[],errors=[],nativeLog=[]
let app,page,passed=false
async function settings(){await page.getByRole('button',{name:'账号菜单'}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();await expect(page.getByRole('button',{name:'立即备份',exact:true})).toBeVisible()}
async function recovery(){await page.getByRole('button',{name:'查看备份',exact:true}).click();await expect(page.getByRole('dialog',{name:'备份与草稿恢复'})).toBeVisible();await expect(page.getByRole('list',{name:'应用数据备份列表'}).getByRole('listitem')).toHaveCount(1,{timeout:60000})}
try{
 assert.equal(process.platform,'darwin');await mkdir(evidence,{recursive:true});execFileSync(process.execPath,['--import','tsx','scripts/seed-electron-fixture.ts',temporary],{encoding:'utf8'})
 const work=JSON.parse(await readFile(join(root,'catalog.json'),'utf8')).value[0];assert(work)
 app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],env:{...process.env,XAANINK_TEST_ROOT:root},timeout:60000})
 app.process().stderr.on('data',chunk=>nativeLog.push(String(chunk)));page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:60000});await settings()
 await page.getByRole('combobox',{name:'备份间隔'}).selectOption('60');await page.getByRole('combobox',{name:'保留备份份数'}).selectOption('2');await expect.poll(async()=>{const general=(await page.evaluate(()=>window.desktop.bootstrap())).settings.general;return[general.backupIntervalMinutes,general.backupRetention]}).toEqual([60,2])
 await page.getByRole('button',{name:'立即备份',exact:true}).click();await expect(page.getByRole('button',{name:'正在备份…',exact:true})).toBeDisabled()
 const outcome=await Promise.race([page.getByRole('status').filter({hasText:'已完成应用数据备份'}).waitFor({timeout:540000}).then(()=> 'saved'),page.getByRole('alert').filter({hasText:'APPLICATION_BACKUP_FAILED'}).waitFor({timeout:540000}).then(()=> 'failed')]);assert.equal(outcome,'saved',await page.getByRole('alert').allTextContents());await expect(page.getByRole('status').filter({hasText:'已完成 1 部作品备份'})).toBeVisible()
 const plan=JSON.parse(await readFile(join(root,'backup-plan.json'),'utf8')).value.lastSuccess;assert(Number.isSafeInteger(plan)&&plan>0)
 const first=await page.evaluate(()=>window.desktop.applicationBackups());assert.equal(first.length,1);assert.deepEqual(Object.keys(first[0]).sort(),['appId','bytes','createdAt','id'])
 assert.equal((await readdir(join(work.path,'backups'))).filter(name=>name.endsWith('.xxbackup')).length,1)
 for(const name of ['staging','validation'])assert.deepEqual(await readdir(join(root,'backups/application',name)),[])
 checks.push('actual original settings immediate button runs main application+work batch; verified package/one work backup/lastSuccess are durable and both temporary scopes empty')
 await page.screenshot({path:join(evidence,'native-application-backup-settings.png')});await recovery()
 await page.getByRole('button',{name:'刷新应用备份'}).click();await expect(page.getByRole('button',{name:'刷新应用备份'})).toBeEnabled({timeout:60000});await expect(page.getByRole('list',{name:'应用数据备份列表'}).getByRole('listitem')).toHaveCount(1)
 checks.push('actual recovery dialog reads verified public application receipts through trusted preload/IPC and refreshes visible history')
 await page.screenshot({path:join(evidence,'native-application-backup-history.png')})
 await page.keyboard.press('Escape');await page.evaluate(()=>window.desktop.command('window.close')).catch(()=>{})
 await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),{timeout:60000}).toBe(0);assert.equal(app.process().exitCode,null)
 await app.evaluate(({app})=>app.emit('activate'));page=await app.firstWindow({timeout:60000});page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:60000});await settings();await recovery()
 assert.deepEqual(await page.evaluate(()=>window.desktop.applicationBackups()),first);assert.equal(JSON.parse(await readFile(join(root,'backup-plan.json'),'utf8')).value.lastSuccess,plan)
 checks.push('real close drains worker and controlled macOS activate reopens actual original workbench; application history and plan survive without an extra backup')
 assert.deepEqual(errors,[]);await page.screenshot({path:join(evidence,'native-application-backup-reopened.png')})
 await writeFile(join(evidence,'native-application-backup.json'),JSON.stringify({scope:'development actual macOS Electron/original settings and recovery components/main IPC/original schema PGlite/real disk; controlled activate, no physical OS picker, Windows or formal531 acceptance',startedAt,completedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,passed:true,checks,errors},null,2)+'\n');passed=true;console.log('Native application and work backup/history passed.')
}catch(error){await writeFile(join(evidence,'native-application-backup-failure.json'),JSON.stringify({startedAt,checks,errors,nativeLog,error:String(error)},null,2)+'\n');try{await page?.screenshot({path:join(evidence,'native-application-backup-failure.png')})}catch{}throw error}
finally{await app?.close().catch(()=>{});if(passed){await rm(temporary,{recursive:true,force:true});await rm(root+'-bootstrap',{recursive:true,force:true})}else console.log('Retained isolated application-backup fixture:',temporary)}
