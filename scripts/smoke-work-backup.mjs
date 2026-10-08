import {_electron as electron} from 'playwright'
import {expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {mkdtemp,rm,writeFile,readFile,readdir,realpath,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const require=createRequire(import.meta.url),temporary=await realpath(await mkdtemp(join(tmpdir(),'xaanink-native-backup-'))),root=join(temporary,'data'),evidence='docs/evidence/implementation-13',startedAt=new Date().toISOString(),errors=[],checks=[]
let app,page,passed=false
async function settings(){await page.getByRole('button',{name:'账号菜单'}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();await expect(page.getByRole('button',{name:'立即备份',exact:true})).toBeVisible()}
try{
 assert.equal(process.platform,'darwin');await mkdir(evidence,{recursive:true});execFileSync(process.execPath,['--import','tsx','scripts/seed-electron-fixture.ts',temporary],{encoding:'utf8'})
 const catalog=JSON.parse(await readFile(join(root,'catalog.json'),'utf8')),work=catalog.value[0];assert(work)
 app=await electron.launch({executablePath:require('electron'),args:[resolve('.')],env:{...process.env,XAANINK_TEST_ROOT:root},timeout:60000})
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:60000});await settings()
 await page.getByRole('combobox',{name:'备份间隔'}).selectOption('1');await page.getByRole('combobox',{name:'保留备份份数'}).selectOption('2');await expect.poll(async()=>(await page.evaluate(()=>window.desktop.bootstrap())).settings.general.backupRetention).toBe(2)
 await page.getByRole('button',{name:'立即备份',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已完成 1 部作品备份'})).toBeVisible({timeout:60000});const first=JSON.parse(await readFile(join(root,'backup-plan.json'),'utf8')).value.lastSuccess
 assert.equal((await readdir(join(work.path,'backups'))).filter(x=>x.endsWith('.xxbackup')).length,1);checks.push('real settings controls persist interval 1/retention 2; actual immediate button completes only after worker snapshot and disk schedule ACK')
 await page.screenshot({path:join(evidence,'native-work-backup-settings.png')})
 await expect.poll(async()=>JSON.parse(await readFile(join(root,'backup-plan.json'),'utf8')).value.lastSuccess,{timeout:90000,intervals:[1000]}).toBeGreaterThan(first)
 const scheduled=JSON.parse(await readFile(join(root,'backup-plan.json'),'utf8')).value.lastSuccess;assert(scheduled-first>=59000);assert.equal((await readdir(join(work.path,'backups'))).filter(x=>x.endsWith('.xxbackup')).length,2)
 checks.push('actual main timer waits about 60 seconds and writes a second real consistent work backup without UI clicks or fake clock')
 await page.getByRole('button',{name:'关闭设置'}).click();await page.evaluate(()=>window.desktop.command('window.close')).catch(()=>{})
 await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),{timeout:60000}).toBe(0);assert.equal(app.process().exitCode,null)
 await app.evaluate(({app})=>app.emit('activate'));page=await app.firstWindow({timeout:60000});page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:60000});await settings()
 await expect(page.getByRole('combobox',{name:'备份间隔'})).toHaveValue('1');await page.getByRole('button',{name:'立即备份',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已完成 1 部作品备份'})).toBeVisible({timeout:60000})
 assert.equal((await readdir(join(work.path,'backups'))).filter(x=>x.endsWith('.xxbackup')).length,2);checks.push('actual close drains scheduler/workers; controlled macOS activate creates fresh window, retains settings, resumes real backup and retention count')
 await page.screenshot({path:join(evidence,'native-work-backup-reopen.png')});assert.deepEqual(errors,[])
 await writeFile(join(evidence,'native-work-backup.json'),JSON.stringify({scope:'development real macOS Electron/actual settings button and real one-minute timer, worker/PGlite/disk retention, actual window close and controlled activate event; no physical Dock interaction, OS chooser, Windows or formal acceptance',startedAt,completedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,passed:true,scheduledIntervalMs:scheduled-first,checks,errors},null,2)+'\n');passed=true;console.log('Native actual timed work backup passed.')
}catch(error){await writeFile(join(evidence,'native-work-backup-failure.json'),JSON.stringify({startedAt,checks,errors,error:String(error)},null,2)+'\n');try{await page?.screenshot({path:join(evidence,'native-work-backup-failure.png')})}catch{};throw error}
finally{await app?.close().catch(()=>{});if(passed){await rm(temporary,{recursive:true,force:true});await rm(root+'-bootstrap',{recursive:true,force:true})}else console.log('Retained isolated backup fixture:',temporary)}
