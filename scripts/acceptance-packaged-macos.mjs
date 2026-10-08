import {_electron as electron} from 'playwright'
import {mkdir, readFile, writeFile, lstat, readdir, realpath} from 'node:fs/promises'
import {createHash, randomUUID} from 'node:crypto'
import {homedir} from 'node:os'
import {resolve, join, relative, sep} from 'node:path'
import {createInterface} from 'node:readline'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {tsImport} from 'tsx/esm/api'
import {constants, lstatSync, realpathSync, openSync, fstatSync, readSync, closeSync} from 'node:fs'

assert.equal(process.platform, 'darwin')
assert(process.argv.slice(2).every(value => value === '--cold-inbox') && process.argv.slice(2).length <= 1)
const coldInbox = process.argv.includes('--cold-inbox')
const project = resolve(import.meta.dirname, '..')
const executable = join(project, 'release/mac-arm64/玄印写作.app/Contents/MacOS/玄印写作')
const evidence = join(project, 'docs/evidence/implementation-43/native')
await mkdir(evidence, {recursive: true})
const runId = randomUUID(), startedAt = new Date().toISOString()
const authorization = JSON.parse(await readFile(join(project, 'docs/evidence/implementation-39/user-test-data-authorization.json'), 'utf8'))
assert.equal(authorization.answer, '是，仅含测试数据，没有真实 Key')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const frozenBytes = await readFile(join(project, 'docs/evidence/implementation-43/packaging-frozen-v1.json'))
assert.equal(hash(frozenBytes), '3e0fc12669dda2c0a6b3a88084d7f862145cb91ebd9bb5e7288f49b6812adc3a')
const frozen = JSON.parse(frozenBytes)
const manifestBytes = await readFile(join(project, 'release/package-static-darwin-arm64.json'))
assert.equal(hash(manifestBytes), frozen.artifacts.find(row => row.path === 'release/package-static-darwin-arm64.json').sha256)
const manifest = JSON.parse(manifestBytes).contents
const state = {runId, startedAt, scope: 'Actual frozen phase43 packaged macOS app in explicitly authorized test-only existing data; no real model calls', mode: coldInbox ? 'native-cold-inbox' : 'ordinary-workbench', launches: [], errors: [], screenshots: [], forcedTermination: false}
let pendingSave = Promise.resolve()
const save = () => {
  const bytes = JSON.stringify(state, null, 2) + '\n'
  pendingSave = pendingSave.catch(() => {}).then(() => writeFile(join(evidence, `native-${runId}.json`), bytes))
  return pendingSave
}
async function bounded(promise, label, timeout = 10000) {
  let timer
  try {return await Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error(label + ' deadline exceeded')), timeout)})])}
  finally {clearTimeout(timer)}
}
async function verifyUnchangedApp() {
  const app = join(project, 'release/mac-arm64/玄印写作.app'), paths = []
  async function walk(directory) {
    for (const name of await readdir(directory)) {
      const path = join(directory, name), stat = await lstat(path)
      if (stat.isDirectory()) await walk(path)
      else {assert(stat.isFile() || stat.isSymbolicLink()); paths.push(relative(app, path).split(sep).join('/'))}
    }
  }
  await walk(app)
  assert.deepEqual(paths.sort(), manifest.files.map(row => row.path).sort())
  for (const row of manifest.files) {
    const path = join(app, row.path), stat = await lstat(path)
    if (row.symbolicLinkTarget) {
      assert(stat.isSymbolicLink())
      assert.equal(relative(app, await realpath(path)).split(sep).join('/'), row.symbolicLinkTarget)
    } else {assert(stat.isFile() && !stat.isSymbolicLink()); assert.equal(hash(await readFile(path)), row.sha256, row.path)}
  }
  state.packageVerification = {frozenSha256: hash(frozenBytes), manifestSha256: hash(manifestBytes), files: paths.length, unchanged: true}
}
await bounded(verifyUnchangedApp(), 'Full frozen package verification', 90000)
const parentIdentities = []
for (const path of [join(homedir(), '.xaanink'), join(homedir(), 'Library/Application Support/Xuanxiangxiezuo-Desktop')]) {
  const stat = await lstat(path, {bigint: true})
  assert(stat.isDirectory() && !stat.isSymbolicLink())
  parentIdentities.push({path, dev: String(stat.dev), ino: String(stat.ino)})
}
state.dataEnvironment = {authorization: 'Direct human confirmation; existing test data, no real Key', identities: parentIdentities, cleanup: 'none'}
// Hash only bounded, regular metadata files; never print user data or secret bytes.
state.dataEnvironment.beforeMetadata = []
for (const [directory, names] of [[parentIdentities[0].path, ['state.json', 'catalog.json', 'drafts.json', 'xaanink-app.json']], [parentIdentities[1].path, ['data-root.json']]]) {
  for (const name of names) {
    const path = join(directory, name)
    try {
      const stat = await lstat(path)
      assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32 * 1024 * 1024, 'Unsafe or oversized metadata: ' + name)
      state.dataEnvironment.beforeMetadata.push({path, bytes: stat.size, identity:{device:String(stat.dev),inode:String(stat.ino)}, sha256: createHash('sha256').update(await readFile(path)).digest('hex')})
    } catch (error) {if (error.code === 'ENOENT') state.dataEnvironment.beforeMetadata.push({path, absent: true}); else throw error}
  }
}
await save()
try {
  const pointer = JSON.parse(await readFile(join(parentIdentities[1].path, 'data-root.json'), 'utf8'))
  assert.equal(pointer.root?.path, parentIdentities[0].path, 'Configured data root is outside the explicitly confirmed environment')
  state.dataEnvironment.configuredRoot = pointer.root.path
} catch (error) {if (error.code !== 'ENOENT') throw error}
let coldDirectories, strictAuditObserver, beforeLease
const identity=stat=>({device:String(stat.dev),inode:String(stat.ino)})
const revision=stat=>({...identity(stat),size:String(stat.size),mtimeNs:String(stat.mtimeNs),ctimeNs:String(stat.ctimeNs)})
function canonicalDirectory(path) {
  const stat=lstatSync(path,{bigint:true});assert(stat.isDirectory()&&!stat.isSymbolicLink()&&realpathSync(path)===path)
  return {path,...identity(stat)}
}
function assertColdDirectories() {
  for(const expected of coldDirectories) assert.deepEqual(canonicalDirectory(expected.path),expected)
}
function boundedMetadataBytes(path,limit) {
  assertColdDirectories()
  const before=lstatSync(path,{bigint:true});assert(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=BigInt(limit))
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW)
  try {
    const opened=fstatSync(fd,{bigint:true});assert.deepEqual(revision(opened),revision(before))
    const buffer=Buffer.alloc(limit+1);let size=0,count
    do {count=readSync(fd,buffer,size,buffer.length-size,null);size+=count;assert(size<=limit)}while(count)
    assert.equal(size,Number(before.size));assert.deepEqual(revision(fstatSync(fd,{bigint:true})),revision(before));assert.deepEqual(revision(lstatSync(path,{bigint:true})),revision(before))
    assertColdDirectories();return {stat:before,bytes:buffer.subarray(0,size)}
  }finally{closeSync(fd)}
}
function coldAudit() {
  assertColdDirectories();const work=coldDirectories.find(row=>row.path.endsWith('/inbox')),observation=strictAuditObserver(work)
  const envelope=observation.phase==='absent'?null:JSON.parse(boundedMetadataBytes(join(work.path,'.xaanink-lease-recovery.json'),16384).bytes)
  observation.assertCurrent();assertColdDirectories();return envelope
}
async function initializeColdAssertions() {
  const baselineBytes=await readFile(join(project,frozen.historicalBaseline.path));assert.equal(hash(baselineBytes),frozen.historicalBaseline.sha256)
  const original=JSON.parse(baselineBytes),updates=new Map(frozen.historicalBaseline.changed.map(row=>[row.path,row.after]))
  for(const [path,expected] of Object.entries(original.productionInputs)) assert.equal(hash(await readFile(join(project,path))),updates.get(path)??expected,'Readonly verifier source changed: '+path)
  for(const row of frozen.newProductionInputs) assert.equal(hash(await readFile(join(project,row.path))),row.sha256)
  const core=await tsImport(join(project,'desktop/core/work-lease-recovery.ts'),import.meta.url);strictAuditObserver=core.observeWorkLeaseAudit
  const root=parentIdentities[0].path
  coldDirectories=[...parentIdentities.map(row=>({path:row.path,device:row.dev,inode:row.ino})),canonicalDirectory(join(root,'inbox')),canonicalDirectory(join(root,'inbox/database'))]
  assertColdDirectories()
  const audit=coldAudit(),lockPath=join(root,'inbox/.xaanink-lock')
  let lock=null,owner=null
  try {
    lock=canonicalDirectory(lockPath);const stat=lstatSync(lockPath,{bigint:true})
    const entries=await readdir(lockPath);assert(entries.length===0||entries.length===1&&entries[0]==='owner.json')
    if(entries.length) {assert.deepEqual(canonicalDirectory(lockPath),lock);const observed=boundedMetadataBytes(join(lockPath,'owner.json'),4096);owner={revision:revision(observed.stat),bytes:observed.bytes.toString('base64'),sha256:hash(observed.bytes)}}
    assert.deepEqual(revision(lstatSync(lockPath,{bigint:true})),revision(stat));assert.deepEqual(canonicalDirectory(lockPath),lock)
    lock={...lock,revision:revision(stat)}
  }catch(error){if(error.code!=='ENOENT')throw error;assert.equal(lock,null)}
  assert(owner||audit?.payload.phase==='observed','Cold verification requires an actual owner or unfinished audit')
  beforeLease={lock,owner,audit};state.beforeColdLeaseSummary={lock:lock?{path:lock.path,device:lock.device,inode:lock.inode}:null,ownerSha256:owner?.sha256??null,auditPhase:audit?.payload.phase??'absent'}
}
function assertColdLockAncestor() {
  assertColdDirectories()
  const path=join(parentIdentities[0].path,'inbox/.xaanink-lock')
  try {const current=canonicalDirectory(path);assert(beforeLease.lock);assert.deepEqual(current,{path:beforeLease.lock.path,device:beforeLease.lock.device,inode:beforeLease.lock.inode})}
  catch(error) {if(error.code!=='ENOENT')throw error}
}
async function metadataSnapshot() {
  assertColdDirectories();assertColdLockAncestor()
  const rows = []
  const paths = state.dataEnvironment.beforeMetadata.map(row => row.path)
  paths.push(join(parentIdentities[0].path, 'inbox/.xaanink-lock/owner.json'), join(parentIdentities[0].path, 'inbox/.xaanink-lease-recovery.json'))
  for (const path of paths) {
    assertColdLockAncestor()
    try {const observed=boundedMetadataBytes(path,32*1024*1024);rows.push({path,bytes:Number(observed.stat.size),identity:identity(observed.stat),sha256:hash(observed.bytes)});assertColdLockAncestor()}
    catch (error) {if(error.code === 'ENOENT') rows.push({path, absent: true}); else throw error}
  }
  assertColdDirectories();assertColdLockAncestor();return rows
}
async function databaseSnapshot() {
  const root = join(parentIdentities[0].path, 'inbox/database'), files = []; let bytes = 0
  async function walk(path) {
    assertColdDirectories()
    const stat = await lstat(path); assert(!stat.isSymbolicLink())
    if(stat.isDirectory()) for(const name of await readdir(path)) await walk(join(path,name))
    else {
      assert(stat.isFile() && stat.size <= 256*1024*1024); bytes += stat.size
      assert(bytes <= 1024*1024*1024 && files.length < 20000)
      files.push({path:relative(root,path), bytes:stat.size, sha256:hash(await readFile(path))})
    }
  }
  await walk(root); assertColdDirectories();return files.sort((a,b)=>a.path.localeCompare(b.path))
}
let application, page, launch, watchdog, child, input, ownedExit
function trackOwnedChild() {
  launch = {pid: child.pid, startedAt: new Date().toISOString(), executable, exitCode: null, exited: false}
  state.launches.push(launch)
  ownedExit=new Promise(resolve=>child.once('exit',resolve))
  child.once('exit', (code, signal) => {
    launch.exitCode = code; launch.exitSignal = signal ?? null; launch.exited = true; launch.exitedAt = new Date().toISOString(); clearTimeout(watchdog)
    launch.cleanNormalExit = (coldInbox ? ['cancel','repair'].includes(state.expectedColdOutcome) : state.normalQuitRequested === true) && code === 0 && signal == null && !state.forcedTermination
    if (!launch.cleanNormalExit) {state.errors.push('Exit did not satisfy requested normal exit + code 0 + no signal + no force'); process.exitCode = 1}
    input?.close(); process.stdin.pause(); void save().catch(error => console.error('exit evidence write failed:', error.code))
  })
  const ownedChild = child
  watchdog = setTimeout(() => {
    state.errors.push('600-second launch watchdog expired'); state.forcedTermination = true; process.exitCode = 1
    if (ownedChild.exitCode === null && ownedChild.signalCode === null) ownedChild.kill('SIGKILL')
    input?.close(); process.stdin.pause(); void save().catch(error => console.error('watchdog evidence write failed:', error.code))
  }, 600000)
}
async function startCold() {
  await initializeColdAssertions()
  state.beforeColdMetadata = await bounded(metadataSnapshot(), 'Cold metadata read')
  state.beforeColdDatabase = await bounded(databaseSnapshot(), 'Closed inbox database hashes', 90000)
  state.launchAttempt = {startedAt:new Date().toISOString(), executable, args:[], injection:'none', inspector:'none'}
  await save()
  child = spawn(executable, [], {stdio:['ignore','ignore','ignore']})
  trackOwnedChild()
  await bounded(new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)}), 'Direct owned app spawn')
  await save(); console.log(JSON.stringify({ready:true, mode:'native-cold-inbox', runId, pid:child.pid, executable, nativeDialogReady:'must observe through CUA; spawn alone is not dialog acceptance'}))
}
async function finishCold() {
  assert(launch.exited && launch.cleanNormalExit)
  state.afterColdMetadata = await bounded(metadataSnapshot(), 'After cold metadata read')
  state.afterColdDatabase = await bounded(databaseSnapshot(), 'After closed inbox database hashes', 90000)
  assert.deepEqual(state.afterColdDatabase, state.beforeColdDatabase, 'Cold helper changed original database files')
  for(const row of state.dataEnvironment.beforeMetadata) assert.deepEqual(state.afterColdMetadata.find(value=>value.path===row.path), row, 'Cold helper changed original application metadata')
  const owner = join(parentIdentities[0].path, 'inbox/.xaanink-lock/owner.json')
  const audit = join(parentIdentities[0].path, 'inbox/.xaanink-lease-recovery.json')
  assertColdDirectories()
  if(state.expectedColdOutcome==='cancel') {
    if(beforeLease.lock) assert.deepEqual(canonicalDirectory(beforeLease.lock.path),{path:beforeLease.lock.path,device:beforeLease.lock.device,inode:beforeLease.lock.inode})
    for(const path of [owner,audit]) assert.deepEqual(state.afterColdMetadata.find(row=>row.path===path),state.beforeColdMetadata.find(row=>row.path===path))
  } else {
    assert.equal(state.expectedColdOutcome,'repair')
    await assert.rejects(lstat(join(parentIdentities[0].path,'inbox/.xaanink-lock')),{code:'ENOENT'})
    const receipt=coldAudit();assert.equal(receipt?.payload.phase,'recovered')
    if(beforeLease.owner) {
      assert.deepEqual(receipt.payload.ownerProof,beforeLease.owner)
      assert.deepEqual(receipt.payload.lock,beforeLease.lock.revision)
    } else {
      assert(beforeLease.audit);assert.deepEqual(receipt.payload.ownerProof,beforeLease.audit.payload.ownerProof);assert.deepEqual(receipt.payload.lock,beforeLease.audit.payload.lock)
    }
    if(beforeLease.audit?.payload.phase==='observed') {
      assert.equal(receipt.payload.auditId,beforeLease.audit.payload.auditId);assert(receipt.payload.revision>beforeLease.audit.payload.revision)
    } else if(beforeLease.audit) assert.notEqual(receipt.payload.auditId,beforeLease.audit.payload.auditId)
    await assert.rejects(lstat(join(parentIdentities[0].path,'inbox/.xaanink-lock')),{code:'ENOENT'})
  }
  state.coldDataAssertions={databaseFilesUnchanged:state.afterColdDatabase.length,applicationMetadataUnchanged:true,expectedOutcome:state.expectedColdOutcome,passed:true}
  await save();console.log(JSON.stringify({exited:true,cleanNormalExit:true,pid:launch.pid,exitCode:launch.exitCode,data:state.coldDataAssertions}))
}
async function start() {
  if(coldInbox) return startCold()
  state.launchAttempt = {startedAt: new Date().toISOString(), executable, launchTimeoutMs: 45000}
  await save()
  try {application = await electron.launch({executablePath: executable, args: [], timeout: 45000})}
  catch (error) {
    state.launchAttempt.failed = true
    state.launchAttempt.cleanup = 'Playwright launch failure invokes its own process kill; no child handle was returned, so this harness cannot independently certify its PID exit'
    await save(); throw error
  }
  child = application.process()
  trackOwnedChild()
  const actual = await bounded(application.evaluate(({app, BrowserWindow}) => ({packaged: app.isPackaged, version: app.getVersion(), appPath: app.getAppPath(), userData: app.getPath('userData'), windows: BrowserWindow.getAllWindows().map(window => ({id: window.id, url: window.webContents.getURL(), sandbox: window.webContents.getLastWebPreferences().sandbox}))})), 'Main-process diagnostics')
  assert.equal(actual.packaged, true); assert.equal(actual.version, '0.1.0')
  assert.equal(actual.appPath, join(project, 'release/mac-arm64/玄印写作.app/Contents/Resources/app'))
  assert.equal(actual.userData, join(homedir(), 'Library/Application Support/Xuanxiangxiezuo-Desktop'))
  launch.actual = actual
  page = await application.firstWindow({timeout: 45000})
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => {
    state.errors.push(error.message.slice(0, 300)); process.exitCode = 1
    void save().catch(saveError => {process.exitCode = 1; console.error('page-error evidence write failed:', saveError.code)})
  })
  await page.getByRole('button', {name: '账号菜单', exact: true}).waitFor({timeout: 45000})
  assert.equal(page.url(), 'xaanink://app/')
  await save()
  console.log(JSON.stringify({ready: true, runId, pid: launch.pid, ...actual, url: page.url()}))
}
async function status() {
  if(coldInbox) {console.log(JSON.stringify({mode:'native-cold-inbox',pid:child.pid,exited:launch.exited,errors:[...state.errors]}));await save();return}
  const metadata = await bounded(application.evaluate(({app, BrowserWindow, Menu}) => ({packaged: app.isPackaged, version: app.getVersion(), appPath: app.getAppPath(), userData: app.getPath('userData'), menu: Menu.getApplicationMenu()?.items.map(item => item.label), windows: BrowserWindow.getAllWindows().map(window => ({id: window.id, url: window.webContents.getURL(), focused: window.isFocused(), sandbox: window.webContents.getLastWebPreferences().sandbox}))})), 'Status metadata')
  const bootstrap = await bounded(page.evaluate(() => window.desktop.bootstrap()), 'Public bootstrap')
  const result = {...metadata, dataRoot: bootstrap.dataRoot, theme: bootstrap.settings.appearance.theme, modelCount: bootstrap.models.length, errors: [...state.errors]}
  assert.equal(result.dataRoot, parentIdentities[0].path)
  assert(result.windows.every(window => window.sandbox === true))
  launch.lastStatus = result
  await save(); console.log(JSON.stringify(result))
}
async function quit() {
  if(coldInbox) throw Error('Cold mode exits only through actual native app buttons; harness quit is unavailable')
  if (launch.exited) {console.log(JSON.stringify({exited: true, cleanNormalExit: launch.cleanNormalExit, launch})); return}
  state.normalQuitRequested = true
  const deadline = Date.now() + 45000
  // Normal production app.quit goes through the original close coordinator.
  await bounded(application.evaluate(({app}) => app.quit()), 'Normal quit dispatch', 5000).catch(error => {if (!launch.exited) state.quitDispatchError = String(error).slice(0, 300)})
  while (!launch.exited && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
  if (!launch.exited) {state.errors.push('Normal app.quit did not exit within 45 seconds'); await save(); throw new Error('Normal quit deadline failed; data retained and watchdog remains active')}
  clearTimeout(watchdog)
  await save()
  if (!launch.cleanNormalExit) throw new Error('App terminated, but normal clean exit assertion failed')
  console.log(JSON.stringify({exited: true, cleanNormalExit: true, pid: launch.pid, exitCode: launch.exitCode, forcedTermination: state.forcedTermination}))
}
try {
  await start()
  input = createInterface({input: process.stdin})
  for await (const line of input) {
    try {
      const command = JSON.parse(line)
      if (command.action === 'expect-exit') {
        assert(coldInbox && !launch.exited && ['cancel','repair'].includes(command.outcome));state.expectedColdOutcome=command.outcome;await save();console.log(JSON.stringify({expectedExit:command.outcome,pid:launch.pid}))
      } else if (command.action === 'status') await status()
      else if (command.action === 'screenshot') {
        assert(!coldInbox,'Native-only dialog screenshots use CUA')
        const path = join(evidence, `native-${runId}-${state.screenshots.length + 1}.png`)
        await page.screenshot({path, timeout: 10000}); state.screenshots.push(path); await save(); console.log(JSON.stringify({screenshot: path}))
      } else if (command.action === 'quit') {await quit(); input.close(); break}
      else throw new Error('Unknown diagnostic command')
    } catch (error) {state.errors.push(String(error).slice(0, 300)); await save(); console.log(JSON.stringify({error: String(error).slice(0, 300)}))}
  }
  if(coldInbox) {
    if(!launch.exited) await bounded(ownedExit, 'Native-only exit wait', 600000)
    await finishCold()
  } else if (!launch.exited) await quit()
} catch (error) {
  state.errors.push(String(error).slice(0, 300))
  process.exitCode=1
  await save().catch(saveError => console.error('Failure evidence write failed:', saveError.code))
  if(coldInbox && child?.pid && launch && !launch.exited) {
    state.forcedTermination=true;state.coldExceptionCleanup={pid:child.pid,action:'SIGKILL precise owned child after harness failure'}
    child.kill('SIGKILL')
    try {await bounded(ownedExit,'Owned cold child exit acknowledgement',10000);state.coldExceptionCleanup.exited=true}
    catch(cleanupError) {state.errors.push(String(cleanupError).slice(0,300));await save().catch(()=>{});await ownedExit;state.coldExceptionCleanup.exited=true}
    await save().catch(()=>{})
  }
  if (application && launch && !launch.exited) await quit().catch(() => {})
  throw error
}
