import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { hostname, tmpdir } from 'node:os'
import { mkdtemp, mkdir, writeFile, readFile, rm, rmdir, realpath, readdir, lstat, rename, symlink, link, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { directoryIdentity } from '../../desktop/core/root-ownership'
import { WorkLeaseRecovery, WorkLeaseRecoveryError, type WorkLeaseRecoveryOptions } from '../../desktop/core/work-lease-recovery'

const code = (expected: string) => (error: unknown) => error instanceof WorkLeaseRecoveryError && error.code === expected
const deadPid = (async () => { const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }); await once(child, 'exit'); assert.ok(child.pid); assert.throws(() => process.kill(child.pid!, 0), { code: 'ESRCH' }); return child.pid! })()
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'xuanxiang-lease19-'))), lock = join(root, '.xuanxiang-lock'), ownerPath = join(lock, 'owner.json')
  await mkdir(lock); const owner = { token: randomUUID(), pid: await deadPid, host: hostname() }, bytes = JSON.stringify(owner)
  await writeFile(ownerPath, bytes); await mkdir(join(root, 'database')); await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'database', 'original.bin'), new Uint8Array([0, 255, 4, 9])); await writeFile(join(root, 'assets', 'original.png'), 'asset bytes'); await writeFile(join(root, 'xuanxiang-work.json'), 'immutable manifest')
  const work = await directoryIdentity(root); let held = true, closed = true; const confirmed = new Set<string>()
  const options: WorkLeaseRecoveryOptions = { assertHost() { if (!held) throw Error('private instance cause') }, assertWorkClosed() { if (!closed) throw Error('private live DB') }, assertConfirmed(requestId) { if (!confirmed.has(requestId)) throw Error('private no confirmation') } }
  const service = new WorkLeaseRecovery(options)
  return { root, lock, ownerPath, owner, bytes, work, options, service, setHeld: (value: boolean) => { held = value }, setClosed: (value: boolean) => { closed = value }, confirm: (requestId: string) => { confirmed.add(requestId) }, cleanup: () => rm(root, { recursive: true, force: true }), async preserved() { return Promise.all(['database/original.bin', 'assets/original.png', 'xuanxiang-work.json'].map(async path => [path, createHash('sha256').update(await readFile(join(root, path))).digest('hex')])) } }
}
test('WL19-01 a genuinely exited child process can be explicitly recovered without changing database/assets/manifest bytes', async () => {
  const f = await fixture(); try { const before = await f.preserved(), prepared = await f.service.prepare(f.work); assert.match(prepared.requestId, /^[a-f\d-]{36}$/); assert.deepEqual(prepared.owner, f.owner); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes); f.confirm(prepared.requestId); assert.deepEqual(await f.service.recover(prepared.requestId), { requestId: prepared.requestId, status: 'recovered' }); assert.deepEqual(await f.preserved(), before); await assert.rejects(lstat(f.lock), { code: 'ENOENT' }) } finally { await f.cleanup() }
})
test('WL19-02 lack of explicit confirmation, stable host lock or closed work never removes the old owner', async () => {
  const f = await fixture(); try { const prepared = await f.service.prepare(f.work); await assert.rejects(f.service.recover(prepared.requestId), code('CONFIRMATION_REQUIRED')); f.confirm(prepared.requestId); f.setClosed(false); await assert.rejects(f.service.recover(prepared.requestId), code('WORK_NOT_CLOSED')); f.setClosed(true); f.setHeld(false); await assert.rejects(f.service.recover(prepared.requestId), code('HOST_NOT_OWNED')); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes) } finally { await f.cleanup() }
})
test('WL19-03 a live real PID is never treated as stale', async () => {
  const f = await fixture(); try { await writeFile(f.ownerPath, JSON.stringify({ ...f.owner, pid: process.pid })); await assert.rejects(f.service.prepare(f.work), code('OWNER_ALIVE')); assert.equal(JSON.parse(await readFile(f.ownerPath, 'utf8')).pid, process.pid) } finally { await f.cleanup() }
})
test('WL19-04 EPERM and unknown probe errors fail closed; only ESRCH is dead', async () => {
  const f = await fixture(); try { for (const failure of ['EPERM', 'EACCES', 'EIO', undefined]) { f.options.probePid = () => { throw Object.assign(Error('sensitive process error'), { code: failure }) }; await assert.rejects(new WorkLeaseRecovery(f.options).prepare(f.work), code('OWNER_UNCERTAIN')); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes) } } finally { await f.cleanup() }
})
test('WL19-05 foreign-host and malformed owners are preserved instead of guessed or repaired', async () => {
  const f = await fixture(); try { const cases = [{ ...f.owner, host: 'foreign-host.invalid' }, { ...f.owner, token: 'not-a-token' }, { ...f.owner, pid: 0 }, { ...f.owner, pid: -1 }, { ...f.owner, pid: 1.5 }, { ...f.owner, other: 'unknown' }, { host: hostname(), pid: f.owner.pid }, 'not json']; for (const value of cases) { const bytes = typeof value === 'string' ? value : JSON.stringify(value); await writeFile(f.ownerPath, bytes); await assert.rejects(f.service.prepare(f.work), code(typeof value === 'object' && value.host === 'foreign-host.invalid' ? 'OWNER_FOREIGN' : 'OWNER_INVALID')); assert.equal(await readFile(f.ownerPath, 'utf8'), bytes) } } finally { await f.cleanup() }
})
test('WL19-06 unknown neighbours, owner symlinks and owner hardlinks are all preserved', async () => {
  const f = await fixture(); try { await writeFile(join(f.lock, 'foreign'), 'keep'); await assert.rejects(f.service.prepare(f.work), code('LOCK_CONTENTS_UNKNOWN')); await unlink(join(f.lock, 'foreign')); await unlink(f.ownerPath); const outside = join(f.root, 'outside-owner.json'); await writeFile(outside, f.bytes); await symlink(outside, f.ownerPath); await assert.rejects(f.service.prepare(f.work), code('OWNER_INVALID')); await unlink(f.ownerPath); await link(outside, f.ownerPath); await assert.rejects(f.service.prepare(f.work), code('OWNER_INVALID')); assert.equal(await readFile(outside, 'utf8'), f.bytes) } finally { await f.cleanup() }
})
test('WL19-07 replacing the lease directory between confirmation and commit rejects the entire recovery', async () => {
  const f = await fixture(); try { const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId); f.options.hook = async phase => { if (phase === 'before-owner-unlink') { await rename(f.lock, f.lock + '-old'); await mkdir(f.lock); await writeFile(f.ownerPath, f.bytes) } }; await assert.rejects(f.service.recover(prepared.requestId), code('LOCK_CHANGED')); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes); assert.equal(await readFile(join(f.lock + '-old', 'owner.json'), 'utf8'), f.bytes) } finally { await f.cleanup() }
})
test('WL19-08 same-inode owner bytes ABA and unknown-neighbour directory ABA are detected before unlink', async () => {
  for (const change of ['owner', 'directory']) { const f = await fixture(); try { const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId); f.options.hook = async phase => { if (phase !== 'before-owner-unlink') return; if (change === 'owner') { await writeFile(f.ownerPath, JSON.stringify({ ...f.owner, token: randomUUID() })); await writeFile(f.ownerPath, f.bytes) } else { await writeFile(join(f.lock, 'foreign'), 'keep'); await unlink(join(f.lock, 'foreign')) } }; await assert.rejects(f.service.recover(prepared.requestId), code(change === 'owner' ? 'OWNER_CHANGED' : 'LOCK_CHANGED')); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes) } finally { await f.cleanup() } }
})
test('WL19-09 rmdir failure after exact owner removal is retryable but cannot delete a newly arrived owner', async () => {
  const f = await fixture(); try { const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId); f.options.hook = async phase => { if (phase === 'before-directory-remove') throw Error('simulated directory IO') }; assert.equal((await f.service.recover(prepared.requestId)).status, 'cleanup-pending'); assert.deepEqual(await readdir(f.lock), []); delete f.options.hook; await writeFile(f.ownerPath, JSON.stringify({ ...f.owner, token: randomUUID(), pid: process.pid })); await assert.rejects(f.service.recover(prepared.requestId), code('LOCK_CONTENTS_UNKNOWN')); assert.ok((await readdir(f.lock)).includes('owner.json')); await unlink(f.ownerPath); f.service.cancel(prepared.requestId); const retry = await f.service.prepare(f.work); f.confirm(retry.requestId); assert.equal((await f.service.recover(retry.requestId)).status, 'recovered') } finally { await f.cleanup() }
})
test('WL19-10 partial cleanup refuses a replacement empty lease and completed replay never removes a later new lease', async () => {
  const f = await fixture(); try { const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId); f.options.hook = async phase => { if (phase === 'before-directory-remove') throw Error('IO') }; assert.equal((await f.service.recover(prepared.requestId)).status, 'cleanup-pending'); delete f.options.hook; await rename(f.lock, f.lock + '-partial'); await mkdir(f.lock); await assert.rejects(f.service.recover(prepared.requestId), code('LOCK_CHANGED')); assert.deepEqual(await readdir(f.lock), []); await rmdir(f.lock); await rename(f.lock + '-partial', f.lock); f.service.cancel(prepared.requestId); const retry = await f.service.prepare(f.work); f.confirm(retry.requestId); assert.equal((await f.service.recover(retry.requestId)).status, 'recovered'); await mkdir(f.lock); await writeFile(f.ownerPath, f.bytes); assert.equal((await f.service.recover(retry.requestId)).status, 'recovered'); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes) } finally { await f.cleanup() }
})
test('WL19-11 cancellation retires an inert preview and foreign request IDs cannot authorize deletion', async () => {
  const f = await fixture(); try { const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId); await assert.rejects(f.service.recover(randomUUID()), code('REQUEST_INVALID')); f.service.cancel(prepared.requestId); await assert.rejects(f.service.recover(prepared.requestId), code('REQUEST_INVALID')); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes) } finally { await f.cleanup() }
})
test('WL19-12 durable audit exists before owner deletion and a new instance needs a new explicit confirmation for empty-lock cleanup', async () => {
  const f = await fixture(); try { const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId); f.options.hook = async phase => { if (phase === 'after-owner-unlink') { assert.ok((await lstat(join(f.root, '.xuanxiang-lease-recovery.json'))).isFile()); throw Error('simulated process interruption') } }; assert.equal((await f.service.recover(prepared.requestId)).status, 'cleanup-pending'); assert.deepEqual(await readdir(f.lock), []); delete f.options.hook; const newInstance = new WorkLeaseRecovery(f.options), retry = await newInstance.prepare(f.work); assert.notEqual(retry.requestId, prepared.requestId); await assert.rejects(newInstance.recover(retry.requestId), code('CONFIRMATION_REQUIRED')); f.confirm(retry.requestId); assert.equal((await newInstance.recover(retry.requestId)).status, 'recovered') } finally { await f.cleanup() }
})
test('WL19-13 audit directory-sync failure never deletes owner; retry must make audit durable before cleanup', async () => {
  const f = await fixture(); try { const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId); f.options.hook = async phase => { if (phase === 'before-audit-sync') throw Error('private audit disk failure') }; await assert.rejects(f.service.recover(prepared.requestId), code('AUDIT_DURABILITY_UNCONFIRMED')); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes); delete f.options.hook; assert.equal((await f.service.recover(prepared.requestId)).status, 'recovered') } finally { await f.cleanup() }
})
test('WL19-14 same-byte replacement of persisted audit is rejected even by a fresh instance', async () => {
  const f = await fixture(); try { const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId); f.options.hook = async phase => { if (phase === 'before-directory-remove') throw Error('stop'); }; assert.equal((await f.service.recover(prepared.requestId)).status, 'cleanup-pending'); const path = join(f.root, '.xuanxiang-lease-recovery.json'), bytes = await readFile(path); await rename(path, path + '-old'); await writeFile(path, bytes); delete f.options.hook; await assert.rejects(new WorkLeaseRecovery(f.options).prepare(f.work), code('AUDIT_CHANGED')); assert.deepEqual(await readdir(f.lock), []) } finally { await f.cleanup() }
})
test('WL19-15 cancelling after an inert audit has been written leaves the owner and permits only a newly confirmed preview', async () => {
  const f = await fixture(); try { const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId); f.options.hook = async phase => { if (phase === 'before-owner-unlink') f.service.cancel(prepared.requestId) }; await assert.rejects(f.service.recover(prepared.requestId), code('REQUEST_INVALID')); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes); assert.ok((await lstat(join(f.root, '.xuanxiang-lease-recovery.json'))).isFile()); delete f.options.hook; const retry = await f.service.prepare(f.work); await assert.rejects(f.service.recover(retry.requestId), code('CONFIRMATION_REQUIRED')); f.confirm(retry.requestId); assert.equal((await f.service.recover(retry.requestId)).status, 'recovered') } finally { await f.cleanup() }
})
test('WL19-16 cancelled recovery retains its physical flight until flush actually completes', async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(); let flight: Promise<unknown> | undefined
  try { const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId); f.options.hook = async phase => { if (phase === 'before-owner-unlink') { entered.resolve(); await release.promise } }; flight = f.service.recover(prepared.requestId); void flight.catch(() => {}); await entered.promise; f.service.cancel(prepared.requestId); let flushed = false; const flush = f.service.flush().then(() => { flushed = true }); await new Promise(setImmediate); assert.equal(flushed, false); release.resolve(); await assert.rejects(flight, code('REQUEST_INVALID')); await flush; assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes) }
  finally { release.resolve(); await flight?.catch(() => {}); await f.cleanup() }
})
test('WL19-17 an actual rmdir IO failure preserves the durable receipt and supports an explicitly confirmed fresh-instance retry', async () => {
  const f = await fixture(), original = fs.rmdirSync; let failed = false
  try {
    const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId)
    fs.rmdirSync = ((path: fs.PathLike, ...args: unknown[]) => { if (String(path) === f.lock && !failed) { failed = true; throw Object.assign(Error('private kernel IO'), { code: 'EIO' }) }; return Reflect.apply(original, fs, [path, ...args]) }) as typeof fs.rmdirSync; syncBuiltinESMExports()
    assert.equal((await f.service.recover(prepared.requestId)).status, 'cleanup-pending'); assert.equal(failed, true); assert.deepEqual(await readdir(f.lock), [])
    fs.rmdirSync = original; syncBuiltinESMExports()
    const next = new WorkLeaseRecovery(f.options), retry = await next.prepare(f.work); f.confirm(retry.requestId)
    assert.equal((await next.recover(retry.requestId)).status, 'recovered'); await assert.rejects(lstat(f.lock), { code: 'ENOENT' })
  } finally { fs.rmdirSync = original; syncBuiltinESMExports(); await f.cleanup() }
})
test('WL19-18 a completion receipt renamed before directory-sync failure can be finalized only after a new confirmation', async () => {
  const f = await fixture(); let commits = 0
  try {
    const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId)
    f.options.hook = phase => { if (phase === 'after-audit-commit') commits++; if (phase === 'before-audit-sync' && commits === 2) throw Error('private final receipt sync failure') }
    assert.equal((await f.service.recover(prepared.requestId)).status, 'cleanup-pending'); await assert.rejects(lstat(f.lock), { code: 'ENOENT' })
    delete f.options.hook; const next = new WorkLeaseRecovery(f.options), retry = await next.prepare(f.work)
    assert.equal(retry.stage, 'lock-absent'); await assert.rejects(next.recover(retry.requestId), code('CONFIRMATION_REQUIRED')); f.confirm(retry.requestId)
    assert.equal((await next.recover(retry.requestId)).status, 'recovered'); assert.equal(JSON.parse(await readFile(join(f.root, '.xuanxiang-lease-recovery.json'), 'utf8')).payload.phase, 'recovered')
  } finally { await f.cleanup() }
})
test('WL19-19 replacing the trusted work directory before deletion preserves both old and replacement owners', async () => {
  const f = await fixture(), moved = f.root + '-old'
  try {
    const before = await f.preserved(), prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId)
    f.options.hook = async phase => { if (phase === 'before-owner-unlink') { await rename(f.root, moved); await mkdir(f.root); await mkdir(f.lock); await writeFile(f.ownerPath, f.bytes) } }
    await assert.rejects(f.service.recover(prepared.requestId), code('WORK_CHANGED')); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes); assert.equal(await readFile(join(moved, '.xuanxiang-lock/owner.json'), 'utf8'), f.bytes)
    assert.deepEqual(await Promise.all(['database/original.bin', 'assets/original.png', 'xuanxiang-work.json'].map(async path => [path, createHash('sha256').update(await readFile(join(moved, path))).digest('hex')])), before)
  } finally { await f.cleanup(); await rm(moved, { recursive: true, force: true }) }
})
test('WL19-20 empty locks without matching audit, symlink locks and copied-work audits never grant cleanup', async () => {
  const f = await fixture(), destination = await realpath(await mkdtemp(join(tmpdir(), 'xuanxiang-lease19-copy-')))
  try {
    await unlink(f.ownerPath); await assert.rejects(f.service.prepare(f.work), code('OWNER_INVALID')); assert.deepEqual(await readdir(f.lock), [])
    await rename(f.lock, f.lock + '-real'); await symlink(f.lock + '-real', f.lock); await assert.rejects(f.service.prepare(f.work), code('LOCK_CHANGED')); await unlink(f.lock); await rename(f.lock + '-real', f.lock); await writeFile(f.ownerPath, f.bytes)
    const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId); f.options.hook = phase => { if (phase === 'before-directory-remove') throw Error('stop') }; assert.equal((await f.service.recover(prepared.requestId)).status, 'cleanup-pending')
    const audit = join(f.root, '.xuanxiang-lease-recovery.json'); await rename(audit, join(destination, '.xuanxiang-lease-recovery.json')); await mkdir(join(destination, '.xuanxiang-lock'))
    delete f.options.hook; await assert.rejects(new WorkLeaseRecovery(f.options).prepare(await directoryIdentity(destination)), code('AUDIT_CHANGED')); assert.deepEqual(await readdir(join(destination, '.xuanxiang-lock')), [])
  } finally { await f.cleanup(); await rm(destination, { recursive: true, force: true }) }
})
test('WL19-21 oversized, invalid UTF8, unknown schema, symlink and hardlinked audits are bounded and preserved', async () => {
  const f = await fixture(), audit = join(f.root, '.xuanxiang-lease-recovery.json')
  try {
    for (const bytes of [Buffer.alloc(16385, 97), Buffer.from([0xff]), Buffer.from('{"schemaVersion":99}')]) { await writeFile(audit, bytes); await assert.rejects(f.service.prepare(f.work), code('AUDIT_INVALID')); assert.deepEqual(await readFile(audit), bytes); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes) }
    await unlink(audit); const outside = join(f.root, 'outside-audit'); await writeFile(outside, 'keep'); await symlink(outside, audit); await assert.rejects(f.service.prepare(f.work), code('AUDIT_INVALID')); await unlink(audit); await link(outside, audit); await assert.rejects(f.service.prepare(f.work), code('AUDIT_INVALID')); assert.equal(await readFile(outside, 'utf8'), 'keep')
  } finally { await f.cleanup() }
})
test('WL19-22 same-byte replacement of the wx audit temporary is never renamed or removed', async () => {
  const f = await fixture(); let foreign: string | undefined
  try {
    const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId)
    f.options.hook = async phase => { if (phase === 'before-audit-rename') { const name = (await readdir(f.root)).find(name => name.startsWith('.xuanxiang-lease-recovery-') && name.endsWith('.tmp')); assert.ok(name); foreign = join(f.root, name); const bytes = await readFile(foreign); await rename(foreign, foreign + '-owned'); await writeFile(foreign, bytes) } }
    await assert.rejects(f.service.recover(prepared.requestId), code('AUDIT_CHANGED')); assert.ok(foreign); assert.ok((await lstat(foreign)).isFile()); await assert.rejects(lstat(join(f.root, '.xuanxiang-lease-recovery.json')), { code: 'ENOENT' }); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes)
  } finally { await f.cleanup() }
})
test('WL19-23 post-rename foreign audit replacement never deletes owner or gets recognized by a new instance', async () => {
  const f = await fixture(), audit = join(f.root, '.xuanxiang-lease-recovery.json')
  try {
    const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId)
    f.options.hook = async phase => { if (phase === 'after-audit-commit') { const bytes = await readFile(audit); await rename(audit, audit + '-own'); await writeFile(audit, bytes); throw Error('private postrename IO') } }
    await assert.rejects(f.service.recover(prepared.requestId), code('AUDIT_DURABILITY_UNCONFIRMED')); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes); delete f.options.hook; await assert.rejects(new WorkLeaseRecovery(f.options).prepare(f.work), code('AUDIT_CHANGED'))
  } finally { await f.cleanup() }
})
test('WL19-24 repeated recovery shares one flight including synchronous reentry, while confirmation is not persisted', async () => {
  const f = await fixture(); let nested: Promise<unknown> | undefined, removed = 0
  try {
    const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId)
    f.options.hook = phase => { if (phase === 'before-owner-unlink') nested = f.service.recover(prepared.requestId); if (phase === 'after-owner-unlink') removed++ }
    const first = f.service.recover(prepared.requestId); assert.strictEqual(f.service.recover(prepared.requestId), first); await first; assert.strictEqual(nested, first); assert.equal(removed, 1)
    const audit = JSON.parse(await readFile(join(f.root, '.xuanxiang-lease-recovery.json'), 'utf8')); assert.equal(audit.payload.phase, 'recovered'); assert.equal(Object.hasOwn(audit.payload, 'confirmed'), false)
  } finally { await nested?.catch(() => {}); await f.cleanup() }
})
test('WL19-25 cleanup after a failed temporary commit cannot unlink a foreign replacement arriving during its asynchronous lstat', async () => {
  const f = await fixture(), original = (await import('node:fs/promises')).default.lstat, promises = (await import('node:fs/promises')).default; let temporary: string | undefined, injected = false
  try {
    const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId)
    f.options.hook = async phase => { if (phase === 'before-audit-rename') { const name = (await readdir(f.root)).find(name => name.startsWith('.xuanxiang-lease-recovery-') && name.endsWith('.tmp')); assert.ok(name); temporary = join(f.root, name); throw Error('force owned temporary cleanup') } }
    promises.lstat = (async (...args: Parameters<typeof promises.lstat>) => { const info = await Reflect.apply(original, promises, args); if (String(args[0]) === temporary && !injected) { injected = true; await rename(temporary!, temporary! + '-original'); await writeFile(temporary!, 'foreign neighbour retained') }; return info }) as typeof promises.lstat; syncBuiltinESMExports()
    await assert.rejects(f.service.recover(prepared.requestId), code('AUDIT_WRITE_FAILED')); assert.equal(injected, true); assert.equal(await readFile(temporary!, 'utf8'), 'foreign neighbour retained'); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes)
  } finally { promises.lstat = original; syncBuiltinESMExports(); await f.cleanup() }
})
test('WL19-26 asynchronous trusted guard mistakes fail closed without a late unhandled rejection', async () => {
  const f = await fixture()
  try {
    const wrongHost = new WorkLeaseRecovery({ ...f.options, assertHost: () => Promise.reject(Error('private invalid async guard')) }); await assert.rejects(wrongHost.prepare(f.work), code('HOST_NOT_OWNED'))
    const wrongConfirmation = new WorkLeaseRecovery({ ...f.options, assertConfirmed: () => Promise.reject(Error('private invalid async confirmation')) }), prepared = await wrongConfirmation.prepare(f.work)
    await assert.rejects(wrongConfirmation.recover(prepared.requestId), code('CONFIRMATION_REQUIRED')); await new Promise(setImmediate); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes)
  } finally { await f.cleanup() }
})
test('WL19-27 simulated Windows directory-sync policy attempts IO, exempts only known unsupported open/sync errors, and keeps ordinary IO/close failures unconfirmed', async () => {
  const promises = (await import('node:fs/promises')).default, original = promises.open, platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  for (const scenario of ['open:EISDIR', 'sync:EINVAL', 'open:EIO', 'open:EPERM', 'close:ENOSYS']) {
    const f = await fixture(); let attempts = 0
    try {
      Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
      promises.open = (async (...args: Parameters<typeof promises.open>) => {
        if (String(args[0]) !== f.root || args[1] !== 'r') return Reflect.apply(original, promises, args)
        attempts++; const [phase, failure] = scenario.split(':'); if (phase === 'open') throw Object.assign(Error('private simulated Windows IO'), { code: failure })
        const handle: Awaited<ReturnType<typeof original>> = await Reflect.apply(original, promises, args)
        if (phase === 'sync') handle.sync = async () => { throw Object.assign(Error('unsupported simulated fsync'), { code: failure }) }
        else { const close = handle.close.bind(handle); handle.close = async () => { await close(); throw Object.assign(Error('private close IO'), { code: failure }) } }
        return handle
      }) as typeof promises.open; syncBuiltinESMExports()
      const prepared = await f.service.prepare(f.work); f.confirm(prepared.requestId)
      if (scenario === 'open:EISDIR' || scenario === 'sync:EINVAL') assert.equal((await f.service.recover(prepared.requestId)).status, 'recovered')
      else { await assert.rejects(f.service.recover(prepared.requestId), code('AUDIT_DURABILITY_UNCONFIRMED')); assert.equal(await readFile(f.ownerPath, 'utf8'), f.bytes) }
      assert.ok(attempts > 0)
    } finally { promises.open = original; syncBuiltinESMExports(); Object.defineProperty(process, 'platform', platform); await f.cleanup() }
  }
})
