import {_electron as electron,chromium} from 'playwright'
import {expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,rm,readFile,writeFile,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const require=createRequire(import.meta.url),temporary=await realpath(await mkdtemp(join(tmpdir(),'xaanink-runtime-migration-'))),root=join(temporary,'data'),target=join(temporary,'moved-data'),evidence='docs/evidence/implementation-12',startedAt=new Date().toISOString()
const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve))
let app,page,browser,safeCleanup=false;const checks=[],errors=[],pids=new Set(),captured=[]
async function connect(){
 const until=Date.now()+60000;let error
 while(Date.now()<until){try{const candidate=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:2000});const context=candidate.contexts()[0];await expect.poll(()=>context.pages().some(p=>p.url()==='xaanink://app/'),{timeout:5000}).toBe(true);browser=candidate;page=context.pages().find(p=>p.url()==='xaanink://app/');page.on('pageerror',e=>errors.push(e.message));const cdp=await browser.newBrowserCDPSession();const processes=await cdp.send('SystemInfo.getProcessInfo');const main=processes.processInfo.find(p=>p.type==='browser');assert(main);pids.add(main.id);await cdp.detach();return main.id}catch(e){error=e;await new Promise(r=>setTimeout(r,200))}}
 throw error??Error('Relaunched application unavailable')
}
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}}
try{
 await mkdir(evidence,{recursive:true});execFileSync(process.execPath,['--import','tsx','scripts/seed-electron-fixture.ts',temporary],{encoding:'utf8'})
 await mkdir(target);await writeFile(join(root,'author-note.txt'),'retain unknown author file')
 app=await electron.launch({executablePath:require('electron'),args:[resolve('.'),`--remote-debugging-port=${port}`],env:{...process.env,XAANINK_TEST_ROOT:root},timeout:60000})
 pids.add(app.process().pid);page=await app.firstWindow({timeout:60000});page.on('pageerror',e=>errors.push(e.message));app.process().stderr.on('data',data=>captured.push(data.toString()))
 await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:60000});await page.getByRole('button',{name:'账号菜单'}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click()
 await expect(page.getByRole('textbox',{name:'应用数据目录',exact:true})).toHaveValue(root)
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]})})
 await page.getByRole('button',{name:'迁移',exact:true}).click();await expect(page.getByRole('button',{name:'迁移',exact:true})).toBeEnabled();await assert.rejects(readFile(join(root+'-bootstrap','root-migration-request.json')),{code:'ENOENT'})
 checks.push('actual settings migration control calls native dialog API; controlled canceled picker returns without durable request or restart')
 await app.evaluate(({dialog},target)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[target]});dialog.showMessageBox=async()=>({response:0,checkboxChecked:false})},target)
 await page.getByRole('button',{name:'迁移',exact:true}).click();await expect(page.getByRole('button',{name:'迁移',exact:true})).toBeEnabled();await assert.rejects(readFile(join(root+'-bootstrap','root-migration-request.json')),{code:'ENOENT'})
 checks.push('controlled confirmation cancellation leaves the same real workbench process and original data root')
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false})})
 const old=app.process(),oldPid=old.pid,exited=new Promise(resolve=>old.once('exit',resolve))
 await page.getByRole('button',{name:'迁移',exact:true}).click();await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('old Electron did not exit')),60000).unref())]);assert(old.exitCode!==null||old.signalCode!==null);app=null
 const maintenancePid=await connect();assert.notEqual(maintenancePid,oldPid);assert.equal(alive(oldPid),false)
 await expect(page.getByRole('heading',{name:'迁移应用数据',exact:true})).toBeVisible({timeout:45000})
 assert.equal(await page.evaluate(()=>typeof window.desktop),'undefined');assert.equal(await page.evaluate(()=>typeof window.desktopMaintenance),'object')
 await expect.poll(async()=>{const state=await page.evaluate(()=>window.desktopMaintenance.state());return state.canContinue},{timeout:120000,intervals:[200,500,1000]}).toBe(true)
 const result=await page.evaluate(()=>window.desktopMaintenance.state());assert.equal(result.phase,'complete');assert.equal(result.pendingCount,0);assert(result.totalFiles>0);assert.equal(result.copiedFiles,result.totalFiles)
 assert.equal(JSON.parse(await readFile(join(root+'-bootstrap','data-root.json'),'utf8')).root.path,target);assert.equal(await readFile(join(root,'author-note.txt'),'utf8'),'retain unknown author file')
 await page.screenshot({path:join(evidence,'native-runtime-migration.png')});checks.push('real app.relaunch exits the old process, isolated maintenance process exposes only restricted bridge, copies actual files and directories and confirms a durable completed result')
 await page.getByRole('button',{name:'返回工作台',exact:true}).click();await expect.poll(()=>alive(maintenancePid),{timeout:60000}).toBe(false)
 const finalPid=await connect();assert.notEqual(finalPid,maintenancePid);await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:60000});assert.equal(await page.evaluate(()=>window.desktopMaintenance),undefined)
 assert.equal((await page.evaluate(()=>window.desktop.bootstrap())).dataRoot,target);await expect(page.getByText('桌面验收夹具',{exact:true}).first()).toBeVisible()
 const ledger=JSON.parse(await readFile(join(root+'-bootstrap','root-migration-request.json'),'utf8'));assert.equal(ledger.active,null);assert.deepEqual(ledger.results,[])
 await page.getByRole('button',{name:'账号菜单'}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();await expect(page.getByRole('textbox',{name:'应用数据目录',exact:true})).toHaveValue(target)
 await page.screenshot({path:join(evidence,'native-runtime-migration-workbench.png')});checks.push('return action acknowledges only the shown receipt and performs another actual cold relaunch into original Web workbench and original work, using the new root')
 await page.evaluate(()=>window.desktop.command('app.quit')).catch(()=>{});await expect.poll(()=>alive(finalPid),{timeout:60000}).toBe(false)
 assert.deepEqual(errors,[]);await writeFile(join(evidence,'native-runtime-migration.json'),JSON.stringify({scope:'development real macOS Electron settings/close, actual relaunch through maintenance and back; native picker and confirmation returns controlled, not OS chooser UI, Windows or formal acceptance',startedAt,completedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,passed:true,result:{phase:result.phase,copiedFiles:result.copiedFiles,totalFiles:result.totalFiles,pendingCount:result.pendingCount},checks,errors},null,2)+'\n');safeCleanup=true;console.log('Native runtime migration passed.')
}catch(error){await writeFile(join(evidence,'native-runtime-migration-failure.json'),JSON.stringify({startedAt,checks,errors,error:String(error),processLog:captured.join('').slice(-5000)},null,2)+'\n');try{await page?.screenshot({path:join(evidence,'native-runtime-migration-failure.png')})}catch{};throw error}
finally{if(app)await app.close().catch(()=>{});for(const pid of pids)if(alive(pid)){try{process.kill(pid,'SIGTERM')}catch{}}await new Promise(r=>setTimeout(r,300));for(const pid of pids)if(alive(pid)){try{process.kill(pid,'SIGKILL')}catch{}}if(safeCleanup){await rm(temporary,{recursive:true,force:true});await rm(root+'-bootstrap',{recursive:true,force:true})}else console.log('Retained isolated migration fixture for diagnosis:',temporary)}
