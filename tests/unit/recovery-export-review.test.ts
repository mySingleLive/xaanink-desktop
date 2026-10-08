import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import { transformSync } from 'esbuild'
import { FileExports, type FileExportOptions } from '../../desktop/main/file-export'
import { guardFileExportTarget } from '../../desktop/main/file-export-target'
import { validateDraftSnapshot } from '../../desktop/main/draft-journal'
import { fileExportFailureMessages } from '../../desktop/shared/file-export'
import type { CloseOwner } from '../../desktop/main/close-coordinator'
import type { DraftSnapshot } from '../../desktop/shared/drafts'
import { BusinessGate } from '../../desktop/main/business-gate'
import { ApplicationMetadataGate } from '../../desktop/main/application-metadata-gate'

// Narrow actual main functions/closures; the chooser is controlled, while
// FileExports, target protection, draft validation and isolated FS are real.
const source = ts.createSourceFile('index.ts', readFileSync('desktop/main/index.ts', 'utf8'), ts.ScriptTarget.Latest, true)
function declaration(name: string) { const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name); assert.ok(node); return node.getText(source) }
function closeProperty(name: string) {
  let result = ''
  function visit(node: ts.Node) { if (ts.isNewExpression(node) && node.expression.getText(source) === 'CloseCoordinator') { const object = node.arguments![0]; assert.ok(ts.isObjectLiteralExpression(object)); const property = object.properties.find(property => property.name?.getText(source) === name); assert.ok(property && ts.isPropertyAssignment(property)); result = property.initializer.getText(source) }; ts.forEachChild(node, visit) }
  visit(source); assert.ok(result); return result
}
function variable(name: string) { let result = ''; function visit(node: ts.Node) { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) result = node.initializer!.getText(source); ts.forEachChild(node, visit) }; visit(source); assert.ok(result); return result }
interface Session { owner: number; id: string; ready: boolean }
interface MainRig {
  save(input: unknown): Promise<boolean>
  exportClose(owner: CloseOwner): Promise<void>
  exports: FileExports
  replaceOwner(id: number, sessionId: string): void
  releaseOwner(): void
  closeData(): Promise<void>
  serviceCalls: string[]
}
const snapshot = (): DraftSnapshot => ({ version: 1, revision: 5, createdAt: new Date().toISOString(), autosaves: [{ id: randomUUID(), draft: { body: '尚未批准正文', comments: ['保留注释'] } }], sources: { staged: { candidates: ['草稿'] }, scene: { changed: true }, chat: { draft: '@角色 草稿', queued: [{ pendingRequest: { method: 'POST', url: '/api/novels', body: { title: '不能自动执行' } } }] }, workspace: { tabs: ['chapter'] }, recovery: { preserved: ['older copy'] }, comments: { text: '评论未保存' } }, issues: [{ source: 'comments', code: 'DRAFT_SOURCE_UNREADABLE' }] })
async function fixture(run: (f: { root: string; data: string; work: string; outside: string; session: Session; setup(options?: { chooser?: () => Promise<string | null>; protectedDirectories?: () => Promise<string[]>; reply?: () => Promise<unknown>; hooks?: Partial<FileExportOptions> }): MainRig }) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'xuanxiang-recovery-review86-'))), data = join(root, 'app'), bootstrap = join(root, 'bootstrap'), work = join(root, '作品'), outside = join(root, 'outside'); const instances: FileExports[] = []
  for (const path of [data, bootstrap, work, outside]) await mkdir(path)
  const session: Session = { owner: 8, id: randomUUID(), ready: false }
  try {
    await run({ root, data, work, outside, session, setup(options = {}) {
      class Exports extends FileExports { constructor(value: FileExportOptions) { super({ ...value, ...options.hooks }) } }
      const serviceCalls: string[] = []
      const dependencies = { FileExports: Exports, initialWindow: { isDestroyed: () => false, webContents: { id: 8 } }, initialSession: { ...session, release() {} }, ownerId: 8, dataRoot: data, bootstrapPath: bootstrap, validateDraftSnapshot, randomUUID, fileExportFailureMessages, guardFileExportTarget, serviceCalls, service: { call: async (name: string) => { serviceCalls.push(name); if (name === 'close') return; assert.equal(name, 'protected-directories'); return (options.protectedDirectories ?? (async () => [work]))() } }, dialog: { showSaveDialog: async () => { const path = await (options.chooser ?? (async () => join(outside, '恢复草稿.json')))(); return path ? { canceled: false, filePath: path } : { canceled: true } } }, closeChannel: { cancel() {}, request: options.reply ?? (async () => ({ status: 'export', snapshot: snapshot() })) }, conversationDirectories: { revokeOwner() {}, revokeAll() {}, flush: async () => {} }, applicationMetadata: new ApplicationMetadataGate(), draftJournal: { read: async () => null }, fileExports: { cancelWindow() {}, flush: async () => {} }, configurationFiles: { cancelWindow() {}, flush: async () => {} }, modelConfiguration: { cancelOwner() {} }, avatarAssets: { cancelOwner() {} }, authority: { revokeOwner() {} }, responseOwners: new Map(), businessGate: new BusinessGate(), repository: { read: async () => {} }, workLease: null, migrationHandoff: null }
      const text = `let window=initialWindow,draftSession=initialSession,businessClosed=false;${declaration('makeRecoveryExports')};let recoveryExports=makeRecoveryExports();${declaration('exportDraftSnapshot')};return {save:exportDraftSnapshot,exportClose:${closeProperty('exportDraft')},exports:recoveryExports,releaseOwner:${variable('releaseOwner')},closeData:${closeProperty('closeData')},serviceCalls,replaceOwner(id,sessionId){window={isDestroyed:()=>false,webContents:{id}};draftSession={owner:id,id:sessionId,ready:false,release(){}}}}`
      const rig = new Function(...Object.keys(dependencies), transformSync(text, { loader: 'ts' }).code)(...Object.values(dependencies)) as MainRig; instances.push(rig.exports); return rig
    } })
  } finally { for (const instance of instances) await instance.flush(); await rm(root, { recursive: true, force: true }) }
}

test('RE86-01 a delayed failed-close export reply from the old owner cannot open a save chooser in a new window session', { timeout: 5000 }, () => fixture(async f => {
  const response = Promise.withResolvers<unknown>(), entered = Promise.withResolvers<void>(); let choices = 0
  const rig = f.setup({ reply: () => { entered.resolve(); return response.promise }, chooser: async () => { choices++; return join(f.outside, '恢复草稿.json') } }), owner = { owner: f.session.owner, sessionId: f.session.id }
  const pending = rig.exportClose(owner)
  try {
    await Promise.race([entered.promise, pending.then(() => { throw Error('failed-close reply boundary was not entered') })]); rig.replaceOwner(80, randomUUID()); response.resolve({ status: 'export', snapshot: snapshot() })
    await assert.rejects(pending, /窗口|变化/); assert.equal(choices, 0); assert.deepEqual(await readdir(f.outside), [])
  } finally { response.resolve({ status: 'export', snapshot: snapshot() }); await pending.catch(() => {}) }
}))

test('RE86-02 protected-directory discovery failure fails closed without overwriting a chosen existing file', { timeout: 5000 }, () => fixture(async f => {
  const target = join(f.outside, '恢复草稿.json'); await writeFile(target, '作者已有文档'); let discoveries = 0
  const rig = f.setup({ chooser: async () => target, protectedDirectories: async () => { discoveries++; throw Error('private worker connection') } })
  await assert.rejects(rig.save(snapshot()), /内部数据/); assert.ok(discoveries > 0); assert.equal(await readFile(target, 'utf8'), '作者已有文档'); assert.deepEqual(await readdir(f.outside), ['恢复草稿.json'])
}))

test('RE86-03 recovery export from a failed unready close preserves all data-only sources/issues and rejects protected work internals', { timeout: 5000 }, () => fixture(async f => {
  await writeFile(join(f.work, 'xuanxiang-work.json'), 'original manifest'); await mkdir(join(f.work, 'database')); const database = join(f.work, 'database', 'recovery.json'); await writeFile(database, 'original database bytes')
  let selected: string | null = database; const rig = f.setup({ chooser: async () => selected }), input = snapshot()
  await assert.rejects(rig.save(input), /内部数据/); assert.equal(await readFile(database, 'utf8'), 'original database bytes')
  selected = join(f.work, '用户恢复草稿.json'); assert.equal(await rig.save(input), true); const saved = JSON.parse(await readFile(selected, 'utf8')); assert.deepEqual(saved, { format: 'xaanink-recovery', version: 1, snapshot: input }); assert.equal(await readFile(join(f.work, 'xuanxiang-work.json'), 'utf8'), 'original manifest')
  selected = null; assert.equal(await rig.save(input), false)
}))

test('RE86-04 exact recovery owner changes during the chooser cannot overwrite the selected old file', { timeout: 5000 }, () => fixture(async f => {
  const gate = Promise.withResolvers<string | null>(), entered = Promise.withResolvers<void>(), target = join(f.outside, '恢复草稿.json'); await writeFile(target, 'old copy')
  const rig = f.setup({ chooser: () => { entered.resolve(); return gate.promise } }), pending = rig.save(snapshot())
  try {
    await Promise.race([entered.promise, pending.then(() => { throw Error('save chooser boundary was not entered') })]); rig.replaceOwner(8, randomUUID()); gate.resolve(target)
    await assert.rejects(pending, /窗口|变化/); assert.equal(await readFile(target, 'utf8'), 'old copy'); assert.deepEqual(await readdir(f.outside), ['恢复草稿.json'])
  } finally { gate.resolve(target); await pending.catch(() => {}) }
}))
test('RE86-05 actual releaseOwner invalidates recovery export but closeData still drains its post-rename physical IO before worker close', { timeout: 5000 }, () => fixture(async f => {
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), target = join(f.outside, '恢复草稿.json')
  const rig = f.setup({ hooks: { beforeDirectorySync: async () => { entered.resolve(); await release.promise } } }), saving = rig.save(snapshot()); void saving.catch(() => {})
  let closed = false, closing: Promise<void> | undefined
  try {
    await Promise.race([entered.promise, saving.then(() => { throw Error('post-rename physical IO boundary was not entered') })]); assert.equal(JSON.parse(await readFile(target, 'utf8')).format, 'xaanink-recovery'); rig.releaseOwner(); closing = rig.closeData().then(() => { closed = true })
    await new Promise(setImmediate); assert.equal(closed, false); assert.equal(rig.serviceCalls.includes('close'), false); release.resolve(); await assert.rejects(saving, /窗口|变化/); await closing; assert.equal(rig.serviceCalls.filter(name => name === 'close').length, 1); assert.equal(JSON.parse(await readFile(target, 'utf8')).format, 'xaanink-recovery')
  } finally { release.resolve(); await saving.catch(() => {}); await closing?.catch(() => {}) }
}))
test('RE86-06 malformed UTF8, unknown recovery fields and snapshots over 16MiB never open the recovery chooser', { timeout: 5000 }, () => fixture(async f => {
  let choices = 0; const rig = f.setup({ chooser: async () => { choices++; return join(f.outside, '恢复草稿.json') } })
  const invalid = [new Uint8Array([0xff]), new TextEncoder().encode(JSON.stringify({ format: 'xuanxiang-recovery', version: 1, snapshot: snapshot(), execute: true })), new TextEncoder().encode(JSON.stringify({ format: 'xuanxiang-recovery', version: 1, snapshot: { ...snapshot(), sources: { chat: { text: 'x'.repeat(16 * 1024 * 1024) } } } }))]
  for (const bytes of invalid) { const result = await rig.exports.save(`8:${f.session.id}`, { id: randomUUID(), format: 'recovery', filename: '恢复草稿.json', bytes }); assert.equal(result.status, 'failed'); if (result.status === 'failed') assert.equal(result.code, 'EXPORT_INPUT_INVALID') }
  assert.equal(choices, 0); assert.deepEqual(await readdir(f.outside), [])
}))
test('RE86-07 exact root/lock/manifest protection applies to recovery exports even when an unregistered work is absent from the worker list', { timeout: 5000 }, () => fixture(async f => {
  const bootstrap = join(f.root, 'bootstrap'), unregistered = join(f.root, 'unregistered'); await mkdir(unregistered); await mkdir(join(unregistered, '.xuanxiang-lock')); await writeFile(join(unregistered, 'xuanxiang-work.json'), 'unregistered marker')
  const targets = [join(f.data, 'state.json'), join(bootstrap, 'root-pointer.json'), join(unregistered, 'xuanxiang-work.json'), join(unregistered, '.xuanxiang-lock/owner.json')]
  let selected = targets[0]; const rig = f.setup({ chooser: async () => selected, protectedDirectories: async () => [] })
  for (const target of targets) { selected = target; await writeFile(target, 'exact original bytes'); await assert.rejects(rig.save(snapshot()), /内部数据/); assert.equal(await readFile(target, 'utf8'), 'exact original bytes') }
}))
