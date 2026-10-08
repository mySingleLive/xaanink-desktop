import {_electron as electron,chromium} from 'playwright'
import {expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,rm,readFile,writeFile,realpath,rename,lstat,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'

const require=createRequire(import.meta.url)
const temporary=await realpath(await mkdtemp(join(tmpdir(),'xaanink-native-relocation-')))
const root=join(temporary,'data'),moved=join(temporary,'data-moved'),bootstrap=`${root}-bootstrap`
const evidence=process.env.XAANINK_RELOCATION_EVIDENCE??'docs/evidence/implementation-33/native-attempt-01'
const startedAt=new Date().toISOString(),checks=[],errors=[],pids=new Set(),logs=[]
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r))
const port=server.address().port;await new Promise(r=>server.close(r))
let app,page,browser,passed=false
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}}
async function launch(){
 app=await electron.launch({executablePath:require('electron'),args:[resolve('.'),`--remote-debugging-port=${port}`],env:{...process.env,XAANINK_TEST_ROOT:root},timeout:60000})
 pids.add(app.process().pid);app.process().stderr.on('data',data=>logs.push(data.toString()))
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message))
}
async function connect(){
 const until=Date.now()+60000;let last
 while(Date.now()<until){try{
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:2000})
  const context=browser.contexts()[0]
  await expect.poll(()=>context.pages().some(p=>p.url()==='xaanink://app/'),{timeout:5000}).toBe(true)
  page=context.pages().find(p=>p.url()==='xaanink://app/');page.on('pageerror',e=>errors.push(e.message))
  const cdp=await browser.newBrowserCDPSession(),info=await cdp.send('SystemInfo.getProcessInfo'),native=info.processInfo.find(p=>p.type==='browser')
  assert(native);pids.add(native.id);await cdp.detach();return native.id
 }catch(error){last=error;await new Promise(r=>setTimeout(r,200))}}
 throw last
}
async function missing(path){await assert.rejects(lstat(path),{code:'ENOENT'})}
try{
 assert.equal(process.platform,'darwin');await mkdir(evidence,{recursive:true})
 const seed=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/seed-electron-fixture.ts',temporary],{encoding:'utf8'}).trim().split('\n').at(-1))
 const work=JSON.parse(await readFile(join(root,'catalog.json'),'utf8')).value[0]
 const workManifest=await readFile(join(work.path,'xaanink-work.json'))
 await launch();await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:60000})
 await page.locator('.chat-composer-editable').click();await page.keyboard.insertText('原目录移动后仍保留的未提交输入')
 const initialProcess=app.process(),initialPid=initialProcess.pid
 await page.evaluate(()=>window.desktop.command('app.quit')).catch(()=>{})
 await expect.poll(()=>alive(initialPid),{timeout:30000}).toBe(false);app=null
 const oldPointer=JSON.parse(await readFile(join(bootstrap,'data-root.json'),'utf8'))
 const pointerBytes=await readFile(join(bootstrap,'data-root.json')),marker=await readFile(join(root,'xaanink-app.json')),catalog=await readFile(join(root,'catalog.json')),drafts=await readFile(join(root,'drafts.json'))
 assert.ok(drafts.toString().includes('原目录移动后仍保留的未提交输入'))
 await rename(root,moved);await launch()
 await page.getByRole('heading',{name:'定位原数据目录',exact:true}).waitFor({timeout:30000})
 await expect(page.getByRole('heading',{name:'原数据目录无法访问',exact:true})).toBeVisible()
 assert.deepEqual(await page.evaluate(()=>({business:typeof window.desktop,restricted:Object.keys(window.desktopRootRelocation).sort()})),{business:'undefined',restricted:['command','state','subscribe']})
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.session.storagePath),null)
 await missing(root);assert.deepEqual(await readFile(join(moved,'drafts.json')),drafts)
 await page.screenshot({path:join(evidence,'unavailable.png')})
 checks.push('after a real closed workbench and same-filesystem rename, actual first-turn startup opens only the restricted memory-session relocation UI; no business bridge or replacement root is created and draft bytes remain intact')
 await app.evaluate(({dialog},values)=>{
  globalThis.relocationSmoke33={step:0,confirmations:[]}
  dialog.showOpenDialog=async(_window,options)=>{
   if(options.title!=='定位原数据目录'||JSON.stringify(options.properties)!==JSON.stringify(['openDirectory']))throw Error('unexpected directory picker')
   const step=globalThis.relocationSmoke33.step++
   if(step===0)return{canceled:true,filePaths:[]}
   return{canceled:false,filePaths:[step===1?values.wrong:values.moved]}
  }
  dialog.showMessageBox=async(_window,options)=>{
   if(options.title!=='确认原数据目录'||!options.detail.includes(values.root)||!options.detail.includes(values.moved)||options.defaultId!==1||options.cancelId!==1)throw Error('unexpected native confirmation')
   globalThis.relocationSmoke33.confirmations.push(options.detail);return{response:0}
  }
 },{root,moved,wrong:work.path})
 const choose=()=>page.getByRole('button',{name:'定位原数据目录',exact:true})
 await choose().click();await expect(page.getByRole('heading',{name:'定位已取消',exact:true})).toBeVisible()
 assert.deepEqual(await readFile(join(bootstrap,'data-root.json')),pointerBytes);await missing(root)
 await choose().click();await expect(page.getByText('所选目录不是原物理数据目录，请选择原目录。复制或跨磁盘恢复需使用备份恢复。',{exact:true})).toBeVisible()
 assert.deepEqual(await readFile(join(bootstrap,'data-root.json')),pointerBytes)
 assert.deepEqual(await readFile(join(work.path,'xaanink-work.json')),workManifest)
 assert.equal((await readdir(bootstrap)).filter(n=>n.startsWith('root-relocation-')).length,0)
 await page.screenshot({path:join(evidence,'wrong-directory.png')})
 checks.push('controlled native picker cancellation and selection of an existing work directory preserve pointer and work bytes; the actual UI rejects the unrelated directory and permits another selection')
 const oldProcess=app.process(),oldPid=oldProcess.pid,exited=new Promise(r=>oldProcess.once('exit',r))
 await choose().click()
 await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('relocation did not exit old process')),60000).unref())]);app=null
 const pid=await connect();assert.notEqual(pid,oldPid);assert.equal(alive(oldPid),false)
 await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:60000})
 await expect(page.getByText('桌面验收夹具',{exact:true}).first()).toBeVisible({timeout:30000})
 const pointer=JSON.parse(await readFile(join(bootstrap,'data-root.json'),'utf8'))
 assert.equal(pointer.revision,oldPointer.revision+1);assert.equal(pointer.rootId,oldPointer.rootId)
 assert.deepEqual(pointer.root,{...oldPointer.root,path:moved})
 assert.equal((await readdir(bootstrap)).filter(n=>n.startsWith('root-relocation-')&&n.endsWith('.json')).length,1)
 await missing(root);assert.deepEqual(await readFile(join(moved,'xaanink-app.json')),marker)
 assert.deepEqual(await readFile(join(moved,'catalog.json')),catalog)
 assert.deepEqual(await readFile(join(work.path,'xaanink-work.json')),workManifest)
 const chapter=await page.evaluate(async ids=>(await(await fetch(`/api/novels/${ids.novelId}/chapters/${ids.chapterId}`)).json()).chapter,seed)
 assert.ok(chapter.content.includes('用于独立桌面测试的中文正文'))
 assert.ok((await readFile(join(moved,'drafts.json'),'utf8')).includes('原目录移动后仍保留的未提交输入'))
 await page.screenshot({path:join(evidence,'reopened.png')})
 checks.push('confirmed same-inode directory is recorded by one append-only receipt and one pointer revision; actual app.relaunch replaces the PID and original Web workbench, chapter, work identity and unsent draft survive at the new root')
 await page.evaluate(()=>window.desktop.command('app.quit')).catch(()=>{})
 await expect.poll(()=>alive(pid),{timeout:30000}).toBe(false);assert.deepEqual(errors,[])
 await writeFile(join(evidence,'native-root-relocation.json'),JSON.stringify({scope:'development actual macOS arm64 Electron, original schema and workbench, same-inode rename and real cold relaunch; native picker and confirmation returns controlled, not physical OS picker, Windows or formal 531-case acceptance',startedAt,completedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,passed:true,checks,errors},null,2)+'\n')
 passed=true;console.log('Native root relocation passed.')
}catch(error){
 await writeFile(join(evidence,'failure.json'),JSON.stringify({startedAt,checks,errors,error:String(error),log:logs.join('').slice(-8000)},null,2)+'\n')
 try{await page?.screenshot({path:join(evidence,'failure.png')})}catch{}
 throw error
}finally{
 if(app){const timer=setTimeout(()=>app?.process().kill('SIGKILL'),5000);try{await app.close().catch(()=>{})}finally{clearTimeout(timer)}}
 for(const pid of pids)if(alive(pid))try{process.kill(pid,'SIGTERM')}catch{}
 await new Promise(r=>setTimeout(r,250))
 for(const pid of pids)if(alive(pid))try{process.kill(pid,'SIGKILL')}catch{}
 if(passed)await rm(temporary,{recursive:true,force:true});else console.log('Retained isolated relocation fixture:',temporary)
}
