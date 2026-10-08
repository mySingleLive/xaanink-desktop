import {_electron as electron} from 'playwright'
import {expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp,mkdir,rm,readFile,writeFile,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {DataRootManager} from '../desktop/core/data-root.ts'
import {directoryIdentity} from '../desktop/core/root-ownership.ts'
import {collectClosedRootFiles} from '../desktop/main/owned-root-files.ts'

const temporary=await realpath(await mkdtemp(join(tmpdir(),'xaanink-root-native-'))),root=join(temporary,'data'),target=join(temporary,'moved-data'),evidence='docs/evidence/implementation-11',startedAt=new Date().toISOString()
let app,page,closedProcess;const checks=[],errors=[]
async function launch(){
 app=await electron.launch({args:[resolve('.')],env:{...process.env,XAANINK_TEST_ROOT:root},timeout:45000});page=await app.firstWindow({timeout:45000});page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:45000})
}
async function close(){closedProcess=app.process();await app.close();app=null;assert(closedProcess.exitCode!==null||closedProcess.signalCode!==null,'migration may run only after actual Electron process exit')}
try{
 await mkdir(evidence,{recursive:true});execFileSync(process.execPath,['--import','tsx','scripts/seed-electron-fixture.ts',temporary],{encoding:'utf8'})
 await launch();assert.equal((await page.evaluate(()=>window.desktop.bootstrap())).dataRoot,root)
 assert.equal(await app.evaluate(({app})=>app.getPath('sessionData')),join(root,'session'))
 await close()
 const pointer=JSON.parse(await readFile(join(root+'-bootstrap','data-root.json'),'utf8'));assert.equal(pointer.root.path,root)
 checks.push('actual main startup initializes/adopts its default root before Chromium sessionData, then completes a real Electron process exit')
 await mkdir(target);await writeFile(join(root,'author-note.txt'),'keep unknown author file')
 const closed=()=>assert(closedProcess.exitCode!==null||closedProcess.signalCode!==null),identity=await directoryIdentity(root),inventory=await collectClosedRootFiles(identity,closed)
 const manager=new DataRootManager(await realpath(root+'-bootstrap'),root)
 const moved=await manager.migrate(await directoryIdentity(target),{quiesce:async()=>({source:identity,ownedFiles:inventory.files,ownedDirectories:inventory.directories,assertClosed:closed,release(){}})})
 assert.equal(moved.status,'complete');assert.equal(await readFile(join(root,'author-note.txt'),'utf8'),'keep unknown author file')
 await launch();assert.equal((await page.evaluate(()=>window.desktop.bootstrap())).dataRoot,target);assert.equal(await app.evaluate(({app})=>app.getPath('sessionData')),join(target,'session'))
 await expect(page.getByText('桌面验收夹具',{exact:true}).first()).toBeVisible()
 await page.getByRole('button',{name:'账号菜单'}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click()
 await expect(page.getByRole('textbox',{name:'应用数据目录',exact:true})).toHaveValue(target)
 checks.push('after real process exit, exact owned engine/session files and empty directories migrate; restarted Electron resolves the moved pointer and renders the original work/sidebar using new sessionData')
 await page.getByRole('button',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'玄墨',exact:true}).click()
 await expect.poll(async()=>JSON.parse(await readFile(join(target,'state.json'),'utf8')).value.settings.appearance.theme).toBe('ink')
 await page.screenshot({path:join(evidence,'native-root-startup.png')});await close();await launch()
 assert.equal((await page.evaluate(()=>window.desktop.bootstrap())).dataRoot,target);await expect(page.locator('html')).toHaveClass(/ink/)
 await assert.rejects(readFile(join(root,'state.json')),{code:'ENOENT'});assert.equal(JSON.parse(await readFile(join(root+'-bootstrap','data-root.json'),'utf8')).root.path,target)
 checks.push('a real user theme change is written only to the moved root and remains active on the next cold Electron launch; no fallback state is initialized in the old root')
 assert.deepEqual(errors,[]);await writeFile(join(evidence,'native-root-startup.json'),JSON.stringify({scope:'development real macOS Electron startup/exit plus offline migration core after process exit; not migration settings/progress UI, OS picker, Windows or formal acceptance',startedAt,completedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,passed:true,managedFileCount:inventory.files.length,managedDirectoryCount:inventory.directories.length,checks,errors},null,2)+'\n');console.log('Native moved-root startup passed.')
}catch(error){await writeFile(join(evidence,'native-root-startup-failure.json'),JSON.stringify({startedAt,checks,errors,error:String(error)},null,2)+'\n');try{await page?.screenshot({path:join(evidence,'native-root-startup-failure.png')})}catch{};throw error}
finally{if(app){const timer=setTimeout(()=>app?.process().kill('SIGKILL'),10000);try{await app.close().catch(()=>{})}finally{clearTimeout(timer)}}await rm(temporary,{recursive:true,force:true})}
