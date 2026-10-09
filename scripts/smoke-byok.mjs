import { _electron as electron } from 'playwright'
import { expect } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = await realpath(await mkdtemp(join(tmpdir(), 'xaanink-byok-native-')))
const checks = [], network = []
let app
const restoreClipboard=async()=>{
  if(!app)return
  try {
    await app.evaluate(async({clipboard})=>{
      if(!Array.isArray(globalThis.__priorClipboardItems))return
      if(globalThis.__priorClipboardItems.length)await clipboard.write(globalThis.__priorClipboardItems)
      else clipboard.clear()
      if(await clipboard.readText()!==globalThis.__priorClipboardText)throw Error('clipboard-restore-mismatch')
      delete globalThis.__priorClipboardItems;delete globalThis.__priorClipboardText
    })
  } catch {throw Error('测试剪贴板恢复失败；本次原生验证不得记为通过')}
}
try {
  const guard = join(root, 'offline-guard.cjs'), harness = join(root, 'offline-main.cjs'), report = join(root, 'offline-checks.txt')
  await writeFile(guard, `
const fs = require('node:fs'), net = require('node:net');
const record = value => fs.appendFileSync(process.env.XAANINK_OFFLINE_GUARD_REPORT, value + '\\n');
record('guard-loaded');
const denied = () => { record('network-denied'); throw Error('Offline verification forbids network access'); };
const originalFetch = globalThis.fetch;
globalThis.fetch = function(input,...args) { const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url; if (/^https?:/i.test(url ?? '')) return denied(); return originalFetch.call(this,input,...args); };
for (const name of ['node:http','node:https']) { const api = require(name); api.request = denied; api.get = denied; }
for (const [prototype,name] of [[net.Server.prototype,'listen'],[net.Socket.prototype,'connect']]) {
  const original = prototype[name];
  prototype[name] = function(...args) { const normalized = Array.isArray(args[0]) ? args[0] : net._normalizeArgs(args); if (!normalized[0]?.path) return denied(); return original.apply(this,args); };
}
`)
  const preflightReport = join(root, 'offline-preflight.txt')
  execFileSync(process.execPath, ['--require', guard, '-e', `
const net=require('node:net'),assert=require('node:assert/strict');
for(const args of [[443],['443','example.invalid'],[{port:443,host:'example.invalid'}]]) assert.throws(()=>new net.Socket().connect(...args),/Offline verification/);
for(const args of [[443],['443'],[{port:443}]]) assert.throws(()=>net.createServer().listen(...args),/Offline verification/);
const server=net.createServer();server.listen(${JSON.stringify(join(root, 'allowed-unix.sock'))},()=>server.close());
`], { env: { ...process.env, XAANINK_OFFLINE_GUARD_REPORT: preflightReport }, timeout: 10000 })
  assert.equal((await readFile(preflightReport, 'utf8')).split('\n').filter(value => value === 'network-denied').length, 6)
  await writeFile(harness, `
require(${JSON.stringify(guard)});
const workers = require('node:worker_threads'), Worker = workers.Worker;
workers.Worker = class extends Worker { constructor(file, options = {}) { super(file, { ...options, execArgv: [...(options.execArgv ?? []), '--require', ${JSON.stringify(guard)}] }); } };
const {app,session,net} = require('electron'), fs = require('node:fs');
const denied = () => { fs.appendFileSync(process.env.XAANINK_OFFLINE_GUARD_REPORT, 'network-denied\\n'); throw Error('Offline verification forbids network access'); };
net.fetch = denied; net.request = denied;
app.setAppPath(${JSON.stringify(resolve('.'))});
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (_details,callback) => { fs.appendFileSync(process.env.XAANINK_OFFLINE_GUARD_REPORT,'network-denied\\n'); callback({cancel:true}); }));
require(${JSON.stringify(resolve('dist/main/index.cjs'))});
`)
  app = await electron.launch({ args: [harness], env: { ...process.env, XAANINK_TEST_ROOT: join(root, 'data'), XAANINK_OFFLINE_GUARD_REPORT: report }, timeout: 45000 })
  const page = await app.firstWindow({ timeout: 45000 })
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(new URL(request.url()).origin) })
  await page.getByRole('button', { name: '账号菜单' }).waitFor({ timeout: 45000 })
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setTitle('玄印写作 · 配置模型回归验证'))
  assert.equal((await page.evaluate(() => window.desktop.bootstrap())).models.length, 0)
  checks.push('actual compiled main and service start with network/TCP listener guards installed before entry; no default models')
  await page.getByRole('button', { name: '账号菜单' }).click()
  await page.getByRole('menuitem', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '模型', exact: true }).click()
  await page.getByRole('button', { name: '添加文本模型', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '配置模型', exact: true })
  const providers={TEXT:['OpenAI','Anthropic','Google','xAI','深度求索','月之暗面','智谱','Xiaomi','阿里巴巴','MiniMax','腾讯','字节跳动'],IMAGE:['OpenAI','Google','xAI','智谱','阿里巴巴','MiniMax','腾讯','字节跳动']}
  for(const kind of ['TEXT','IMAGE']){
  if(kind==='IMAGE'){await dialog.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'添加文生图模型',exact:true}).click()}
  for (const name of providers[kind]) {
    await dialog.getByLabel('供应商', { exact: true }).click()
    await page.getByLabel('搜索供应商', { exact: true }).fill(name)
    await page.getByRole('option').filter({ hasText: name }).click()
    await expect(dialog.getByLabel('API Key', { exact: true })).toHaveValue('')
    await expect(dialog.getByLabel('协议', { exact: true })).toHaveCount(0)
    await expect(dialog.getByLabel('Base URL', { exact: true })).toHaveCount(0)
    await expect(dialog.getByLabel('可用模型', { exact: true })).toBeEnabled()
    await dialog.getByLabel('可用模型',{exact:true}).click()
    const list=page.getByRole('listbox',{name:'可用模型',exact:true})
    await list.waitFor({state:'visible',timeout:5000})
    assert.ok(await list.getByRole('option').count()>0,`${name} ${kind} catalog`)
    const option=list.locator('[role="option"]:not([data-disabled])').first()
    await option.click()
    await expect(dialog.getByLabel('可用模型',{exact:true})).not.toContainText('请选择可用模型')
    await expect(dialog.getByLabel('API Key',{exact:true})).toHaveValue('')
    assert.equal((await page.evaluate(() => window.desktop.bootstrap())).models.length, 0)
    checks.push(`${name} ${kind}: empty-Key sourced catalog and single selection, no request or persistence`)
  }
  }
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  if(process.env.XAANINK_NATIVE_INPUT_MENU==='1'){
    await page.getByRole('button',{name:'添加文本模型',exact:true}).click()
    const key=dialog.getByLabel('API Key',{exact:true})
    await key.evaluate(element=>{globalThis.__nativeFixtureActivated=false;element.addEventListener('pointerdown',event=>{globalThis.__nativeFixtureActivated=event.isTrusted},{once:true})})
    console.log(JSON.stringify({stage:'native-clipboard-initial-focus',focused:await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFocused()),documentFocused:await page.evaluate(()=>document.hasFocus())}))
    console.log('NATIVE_CLIPBOARD_READY_FOCUS')
    await expect.poll(()=>page.evaluate(()=>globalThis.__nativeFixtureActivated===true&&document.hasFocus()),{timeout:120000}).toBe(true)
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFocused()),{timeout:120000}).toBe(true)
    // Preserve the user's prior clipboard only in this owned main process.
    try {
      await app.evaluate(async({clipboard,ClipboardItem})=>{
        const text=await clipboard.readText(),items=await clipboard.read(),snapshot=[]
        for(const item of items){if(!item.types.length)continue;const payload={};for(const type of item.types)payload[type]=await item.getType(type);snapshot.push(new ClipboardItem(payload))}
        globalThis.__priorClipboardItems=snapshot;globalThis.__priorClipboardText=text
      })
    } catch {throw Error('测试剪贴板备份失败；未覆盖原剪贴板')}
    await app.evaluate(({clipboard})=>clipboard.writeText('native-before-keyboard-copy'))
    await key.fill('native-clipboard-fixture');await key.evaluate(element=>element.setSelectionRange(0,6))
    assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'native-before-keyboard-copy')
    console.log('NATIVE_KEYBOARD_READY_COPY')
    await expect.poll(()=>app.evaluate(async({clipboard})=>(await clipboard.readText())==='native'),{timeout:120000}).toBe(true)
    await expect(key).toHaveAttribute('type','password')
    checks.push('default Cmd+C copies only the masked API Key selection to real macOS clipboard')
    await page.keyboard.press('Meta+x');await expect(key).toHaveValue('-clipboard-fixture')
    await page.keyboard.press('Meta+z');await expect(key).toHaveValue('native-clipboard-fixture')
    await app.evaluate(({clipboard})=>clipboard.writeText('native-paste-fixture'))
    await key.evaluate(element=>element.setSelectionRange(0,element.value.length));await page.keyboard.press('Meta+v');await expect(key).toHaveValue('native-paste-fixture')
    await page.keyboard.press('Meta+z');await expect(key).toHaveValue('native-clipboard-fixture')
    await page.keyboard.press('Meta+Shift+z');await expect(key).toHaveValue('native-paste-fixture')
    await page.keyboard.press('Meta+z');await expect(key).toHaveValue('native-clipboard-fixture')
    checks.push('default Cmd+X/Cmd+V edit the controlled masked Key and native undo/redo restore its value')
    await key.fill('native-menu-fixture');await key.evaluate(element=>element.setSelectionRange(0,element.value.length))
    await app.evaluate(({clipboard})=>clipboard.writeText('native-before-menu'))
    await key.click({button:'right'})
    console.log('NATIVE_MENU_READY_COPY')
    await expect.poll(()=>app.evaluate(async({clipboard})=>(await clipboard.readText())==='native-menu-fixture'),{timeout:120000}).toBe(true)
    checks.push('actual native right-click Copy selected through the macOS menu writes system clipboard')
    await key.fill('');await app.evaluate(({clipboard})=>clipboard.writeText('native-menu-paste-fixture'))
    await key.click({button:'right'});console.log('NATIVE_MENU_READY_PASTE')
    await expect(key).toHaveValue('native-menu-paste-fixture',{timeout:120000})
    checks.push('actual native right-click Paste selected through the macOS menu updates masked input')
    await key.evaluate(element=>element.setSelectionRange(0,element.value.length));await page.keyboard.press('Shift+F10')
    console.log('NATIVE_MENU_READY_CUT')
    await expect(key).toHaveValue('',{timeout:120000});await page.keyboard.press('Meta+z');await expect(key).toHaveValue('native-menu-paste-fixture')
    checks.push('Shift+F10 opens actual native menu; macOS Cut selection and undo preserve controlled value')
    await expect(key).toHaveAttribute('type','password')
    await dialog.getByRole('button',{name:'取消',exact:true}).click()
  }
  assert.equal((await page.evaluate(() => window.desktop.bootstrap())).models.length, 0)
  assert.deepEqual(network, [])
  const guardEvents = (await readFile(report, 'utf8')).trim().split('\n')
  assert.ok(guardEvents.filter(value => value === 'guard-loaded').length >= 2, 'main and actual service worker both load guards')
  assert.equal(guardEvents.filter(value => value === 'network-denied').length, 0)
  checks.push('provider switching and cancellation clear drafts; main/service deny external HTTP/TCP and TCP listening before startup with zero attempts')
  if(process.env.XAANINK_NATIVE_INPUT_MENU==='1'){await restoreClipboard();checks.push('actual original clipboard payloads were materialized in owned main memory and restored before reporting success')}
  await mkdir('docs/evidence/model-dialog-repair', { recursive: true })
  const compiledArtifacts=Object.fromEntries(await Promise.all(['dist/main/index.cjs','dist/preload/index.cjs','dist/service/index.cjs'].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])))
  await writeFile('docs/evidence/model-dialog-repair/native.json', JSON.stringify({ at: new Date().toISOString(), checks, passed: true, guardPreflight: { tcpFormsRejected: 6, actualUnixSocketAllowed: true }, offlineGuardLoads: guardEvents.filter(value => value === 'guard-loaded').length, blockedNetworkAttempts: 0, realProviderCalls: false, credentialPersistence: false,compiledArtifacts, nativeMenuInteraction:process.env.XAANINK_NATIVE_INPUT_MENU==='1' }, null, 2) + '\n')
  console.log(JSON.stringify({ passed: true, checks: checks.length }))
} finally { try{await restoreClipboard()}finally{try{if(app)await app.close()}finally{await rm(root, { recursive: true, force: true })}} }
