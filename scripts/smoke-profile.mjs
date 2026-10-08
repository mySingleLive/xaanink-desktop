import { _electron as electron } from 'playwright'
import { expect } from '@playwright/test'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import sharp from 'sharp'

// The two native file panels are operated through the computer-use tool. No
// showOpenDialog mock or DOM file-input replacement is used in this check.
const temporary = await mkdtemp(join(tmpdir(),'xaanink-profile-smoke-'))
const fixture = join(temporary,'avatar-fixture.png')
const evidence = 'docs/evidence/implementation-05'
const startedAt = new Date().toISOString(), checks = [], rendererErrors = []
let app
await mkdir(evidence,{recursive:true})
await sharp({create:{width:720,height:480,channels:3,background:'#987650'}}).png().toFile(fixture)
async function launch() {
  app = await electron.launch({args:[resolve('.')],env:{...process.env,XAANINK_TEST_ROOT:join(temporary,'data')},timeout:45000})
  const page = await app.firstWindow({timeout:45000})
  page.on('pageerror',error => rendererErrors.push(error.message))
  await page.getByRole('button',{name:'账号菜单'}).waitFor({timeout:45000})
  return page
}
try {
  let page = await launch()
  await page.getByRole('button',{name:'账号菜单'}).click()
  await page.getByRole('menuitem',{name:'设置',exact:true}).click()
  await page.getByRole('button',{name:'用户',exact:true}).click()
  await page.getByRole('button',{name:'编辑用户',exact:true}).click()
  const editor=page.getByRole('dialog',{name:'编辑用户',exact:true})
  await editor.getByRole('textbox',{name:'笔名',exact:true}).fill('本地验收作者')
  await editor.getByRole('textbox',{name:'邮件',exact:true}).fill('fixture@example.test')
  const previous=(await page.evaluate(() => window.desktop.bootstrap())).settings.user
  assert.equal(previous.penName,'作者')
  await editor.getByRole('button',{name:'选择头像',exact:true}).click()
  process.stdout.write('NATIVE_PICKER_CANCEL_READY\n')
  await expect(editor.getByText('读取中…',{exact:true})).not.toBeVisible({timeout:180000})
  assert.deepEqual((await page.evaluate(() => window.desktop.bootstrap())).settings.user,previous)
  checks.push('actual macOS image picker cancellation preserves the profile draft and confirmed user')
  await editor.getByRole('button',{name:'选择头像',exact:true}).click()
  process.stdout.write(`NATIVE_PICKER_FILE_READY ${fixture}\n`)
  const preview=editor.locator('img[src^="data:image/png"]')
  await expect(preview).toBeVisible({timeout:180000})
  await expect.poll(() => preview.evaluate(image => image.complete && image.naturalWidth)).toBe(512)
  const bounds=await editor.evaluate(element => {
    const avatar=element.querySelector('[aria-label="选择头像"]').getBoundingClientRect()
    const fields=element.querySelector('fieldset').getBoundingClientRect()
    return {avatar:{x:avatar.x,y:avatar.y,height:avatar.height,right:avatar.right},fields:{x:fields.x,y:fields.y,height:fields.height}}
  })
  assert.ok(bounds.avatar.right <= bounds.fields.x)
  assert.equal(bounds.avatar.y,bounds.fields.y)
  assert.equal(bounds.avatar.height,bounds.fields.height)
  assert.deepEqual((await page.evaluate(() => window.desktop.bootstrap())).settings.user,previous)
  await editor.getByRole('button',{name:'保存',exact:true}).click()
  await expect(editor).not.toBeVisible()
  await expect(page.getByRole('button',{name:'编辑用户',exact:true})).toBeFocused()
  const saved=(await page.evaluate(() => window.desktop.bootstrap())).settings.user
  assert.equal(saved.penName,'本地验收作者'); assert.equal(saved.email,'fixture@example.test'); assert.ok(saved.avatarAssetId)
  const card=page.locator('.desktop-user-card')
  await expect(card.locator('img')).toBeVisible()
  await expect.poll(() => card.locator('img').evaluate(image => image.complete && image.naturalWidth)).toBe(512)
  const image=await sharp(await readFile(join(temporary,'data','assets','global',saved.avatarAssetId+'.png'))).metadata()
  assert.equal(image.width,512);assert.equal(image.format,'png');assert.equal(image.exif,undefined)
  checks.push('system-selected PNG previews only in the draft, with full-height avatar left of the fields','explicit save commits one profile and local normalized PNG; native final focus returns to edit')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const pixels=await app.evaluate(async ({BrowserWindow}) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'))
  await writeFile(join(evidence,'native-profile.png'),Buffer.from(pixels,'base64'))
  await page.getByRole('button',{name:'关闭设置',exact:true}).click()
  const account=page.getByRole('button',{name:'账号菜单'})
  await expect(account).toContainText('本地验收作者')
  await expect.poll(() => account.locator('img').evaluate(image => image.naturalWidth)).toBe(512)
  await app.close(); app=null
  page=await launch()
  assert.deepEqual((await page.evaluate(() => window.desktop.bootstrap())).settings.user,saved)
  await expect(page.getByRole('button',{name:'账号菜单'})).toContainText('本地验收作者')
  await expect.poll(() => page.getByRole('button',{name:'账号菜单'}).locator('img').evaluate(image => image.naturalWidth)).toBe(512)
  const bypass=await page.evaluate(async () => {
    const before=await window.desktop.bootstrap()
    try { await window.desktop.settings({type:'update',revision:before.revision,settings:{...before.settings,user:{...before.settings.user,penName:'不应保存'}}});return false }
    catch { return (await window.desktop.bootstrap()).settings.user.penName===before.settings.user.penName }
  })
  assert.equal(bypass,true);assert.deepEqual(rendererErrors,[])
  checks.push('account menu updates only after save and survives full app restart','ordinary settings IPC cannot bypass the explicit profile-save transaction')
  await writeFile(join(evidence,'profile-latest.json'),JSON.stringify({scope:'development macOS arm64 Electron + real native file picker only; not packaged or full formal acceptance',startedAt,completedAt:new Date().toISOString(),status:'passed',checks},null,2)+'\n')
} catch(error) {
  const message=String(error).replaceAll(process.cwd(),'<repo>').replaceAll(temporary,'<isolated-temp>').replaceAll(homedir(),'<home>')
  await writeFile(join(evidence,'profile-latest.json'),JSON.stringify({scope:'development Electron profile only',startedAt,status:'failed',checks,error:message},null,2)+'\n')
  throw error
} finally { await app?.close().catch(()=>{});await rm(temporary,{recursive:true,force:true}) }
