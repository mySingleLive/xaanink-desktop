import {_electron as electron} from 'playwright'
import {expect} from '@playwright/test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp,mkdir,rm,writeFile,readFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import sharp from 'sharp'
const temporary=await mkdtemp(join(tmpdir(),'xaanink-native-images-')),root=join(temporary,'data'),evidence='docs/evidence/implementation-10'
const checks=[],errors=[],startedAt=new Date().toISOString();let app,page
await mkdir(evidence,{recursive:true})
async function ready(){page=await app.firstWindow({timeout:45000});page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:45000});await app.evaluate(({app,BrowserWindow})=>{app.focus({steal:true});BrowserWindow.getAllWindows()[0].focus()})}
const imageReady=async locator=>expect.poll(()=>locator.evaluate(image=>[image.complete,image.naturalWidth,image.naturalHeight]),{timeout:15000}).toEqual([true,40,60])
try{
 const seed=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/seed-electron-fixture.ts',temporary],{encoding:'utf8'}).trim().split('\n').at(-1))
 const files=[]
 for(const [index,color] of ['#c4ab85','#262a30'].entries()){const bytes=await sharp({create:{width:40,height:60,channels:3,background:color}}).png().toBuffer(),path=join(temporary,`image-${index}.png`);await writeFile(path,bytes);files.push({path,bytes})}
 app=await electron.launch({args:[resolve('.')],env:{...process.env,XAANINK_TEST_ROOT:root},timeout:45000});await ready()
 // Prepare a scene through the original local handler. Image uploads below use the actual Web controls.
 const scene=await page.evaluate(async novelId=>(await (await fetch(`/api/novels/${novelId}/scenes`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'本地图像场景'})})).json()).scene,seed.novelId)
 await page.reload();await page.getByRole('button',{name:'账号菜单'}).waitFor()
 await page.getByText('主题',{exact:true}).first().click();await page.getByTitle('点击打开封面面板',{exact:true}).click()
 await page.locator('.workspace-content input[type=file]').last().setInputFiles(files[0].path)
 const cover=()=>page.getByRole('img',{name:'桌面验收夹具封面',exact:true})
 await imageReady(cover());const first=await cover().getAttribute('src');assert.match(first,/^\/_desktop\/assets\//)
 const received=await page.evaluate(async url=>Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),first);assert.deepEqual(Buffer.from(received),files[0].bytes)
 await page.locator('.workspace-content input[type=file]').last().setInputFiles(files[1].path)
 await expect(cover()).not.toHaveAttribute('src',first);await imageReady(cover())
 await page.getByTitle(/手动上传，点击设为当前/).click();await expect(cover()).toHaveAttribute('src',first);await imageReady(cover())
 checks.push('original Web theme→cover panel uploads two files, displays full image/thumbnail, fetches exact same-origin bytes and reselects original version from history')
 await page.getByRole('tree',{name:'作品场景树'}).getByRole('treeitem').filter({hasText:'本地图像场景'}).click()
 await page.getByRole('button',{name:'打开场景外部示意图生成面板',exact:true}).click()
 await page.locator('.scene-image-workspace input[type=file]').setInputFiles(files[0].path)
 const sceneImage=page.getByRole('button',{name:'预览外部示意图原图',exact:true}).getByRole('img')
 await imageReady(sceneImage);const sceneUrl=await sceneImage.getAttribute('src');assert(sceneUrl.includes(scene.id))
 await page.getByRole('button',{name:'预览外部示意图原图',exact:true}).click();const dialog=page.getByRole('dialog',{name:'外部示意图原图',exact:true});await imageReady(dialog.getByRole('img'));await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'移除当前图',exact:true}).click();await expect(sceneImage).toHaveCount(0)
 await page.getByRole('button',{name:'设为当前',exact:true}).click();await imageReady(sceneImage)
 checks.push('original scene exterior panel uploads and displays protected /api/.../asset through the native protocol, previews full size, removes current image and restores retained history')
 assert.equal((await readdir(join(temporary,'work','assets'))).length,3)
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),{timeout:30000}).toBe(0)
 const opening=app.waitForEvent('window');await app.evaluate(({app})=>app.emit('activate'));page=await opening;await page.getByRole('button',{name:'账号菜单'}).waitFor();await imageReady(page.getByRole('button',{name:'预览外部示意图原图',exact:true}).getByRole('img'))
 checks.push('actual macOS window close/reopen reconnects work database and restores original scene tab with readable work-local assets; three versions remain on disk')
 await page.screenshot({path:join(evidence,'native-work-images.png')})
 assert.deepEqual(errors,[])
 await writeFile(join(evidence,'native-work-images.json'),JSON.stringify({scope:'development real Electron macOS arm64 original image components and local asset protocol; Playwright setInputFiles supplies isolated images, not OS file chooser acceptance; no model request or Windows/formal acceptance',startedAt,completedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,passed:true,checks,errors},null,2)+'\n')
 console.log('Native local work images passed.')
}catch(error){await writeFile(join(evidence,'native-work-images-failure.json'),JSON.stringify({startedAt,checks,errors,error:String(error)},null,2)+'\n');try{if(page)await page.screenshot({path:join(evidence,'native-work-images-failure.png')})}catch{};throw error}
finally{if(app){const timer=setTimeout(()=>app?.process().kill('SIGKILL'),10000);try{await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy()}).catch(()=>{});await app.close().catch(()=>{})}finally{clearTimeout(timer)}}await rm(temporary,{recursive:true,force:true});await rm(root+'-bootstrap',{recursive:true,force:true})}
