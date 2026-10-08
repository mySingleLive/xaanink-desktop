import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { hostname, tmpdir } from 'node:os'
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { directoryIdentity } from '../../desktop/core/root-ownership'
import { WorkLeaseHandoff, WorkLeaseHandoffError, type WorkLeaseHandoffOptions } from '../../desktop/main/work-lease-handoff'
import { CloseCoordinator } from '../../desktop/main/close-coordinator'

const deadPid = (async () => { const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }); await once(child, 'exit'); assert.ok(child.pid); assert.throws(() => process.kill(child.pid!, 0), { code: 'ESRCH' }); return child.pid! })()
const safeFailure = (error: unknown) => error instanceof WorkLeaseHandoffError && /^HANDOFF_[A-Z_]+$/.test(error.code) && !Object.hasOwn(error, 'cause') && !/private|lease23/i.test(error.message)
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'xuanxiang-lease23-'))), lock = join(root, '.xuanxiang-lock'), ownerPath = join(lock, 'owner.json'); await mkdir(lock)
  const lease = { token: randomUUID(), pid: await deadPid, host: hostname() }, ownerBytes = JSON.stringify(lease); await writeFile(ownerPath, ownerBytes); await writeFile(join(root, 'xuanxiang-work.json'), 'original manifest'); await writeFile(join(root, 'database.bin'), 'original database bytes')
  const work = await directoryIdentity(root), identity = { workId: randomUUID(), owner: { owner: 8, sessionId: randomUUID() } }, events: string[] = [], notices: string[] = []
  let closed = false, held = true, current = { ...identity.owner }, restarts = 0; let handoff: WorkLeaseHandoff
  const options: WorkLeaseHandoffOptions = {
    assertHost() { if (!held) throw Error('private stable lock lost') },
    assertOwner(owner) { if (owner.owner !== current.owner || owner.sessionId !== current.sessionId) throw Error('private owner changed') },
    assertClosed() { if (!closed) throw Error('private still-open engine') },
    async target(id) { assert.equal(id, identity.workId); assert.equal(closed, true); events.push('target'); return work },
    async confirm(preview) { events.push('confirm'); assert.deepEqual(preview.owner, lease); assert.deepEqual(preview.work, work); assert.equal(await readFile(ownerPath, 'utf8'), ownerBytes); return true },
    async close(intent) { assert.equal(intent, 'quit'); events.push('flush'); events.push('controlled-worker-close-ack'); closed = true; await handoff.finishClosed(); handoff.commit(); return true },
    async notice(message) { notices.push(message); events.push('notice') },
    restart() { events.push('restart'); restarts++ },
  }
  handoff = new WorkLeaseHandoff(identity, options)
  return { root, lock, ownerPath, ownerBytes, lease, work, identity, events, notices, options, handoff, restarts: () => restarts, setClosed: (value: boolean) => { closed = value }, loseOwner: () => { current = { owner: 80, sessionId: randomUUID() } }, restoreOwner: () => { current = { ...identity.owner } }, loseHost: () => { held = false }, cleanup: () => rm(root, { recursive: true, force: true }) }
}
test('LH23-01 actual dead-child lease recovery occurs only after controlled host flush/close proof and exact preview confirmation, then schedules one cold restart', async () => {
  const f = await fixture(); try { assert.equal(await f.handoff.start(), true); assert.deepEqual(f.events, ['flush', 'controlled-worker-close-ack', 'target', 'confirm', 'notice', 'restart']); assert.equal(f.handoff.outcome?.status, 'recovered'); assert.equal(f.restarts(), 1); await assert.rejects(lstat(f.lock), { code: 'ENOENT' }); assert.equal(await readFile(join(f.root, 'database.bin'), 'utf8'), 'original database bytes'); assert.equal(await readFile(join(f.root, 'xuanxiang-work.json'), 'utf8'), 'original manifest'); assert.equal(f.handoff.commit(), false) } finally { await f.cleanup() }
})
test('LH23-02 rejecting the sole native deletion confirmation preserves owner but still cold restarts after close', async () => {
  const f = await fixture(); try { f.options.confirm = async () => false; assert.equal(await f.handoff.start(), true); assert.equal(f.handoff.outcome?.status, 'cancelled'); assert.equal(await readFile(f.ownerPath, 'utf8'), f.ownerBytes); assert.equal(f.restarts(), 1); assert.equal(f.notices.length, 1); await assert.rejects(lstat(join(f.root, '.xuanxiang-lease-recovery.json')), { code: 'ENOENT' }) } finally { await f.cleanup() }
})
test('LH23-03 a live PID produces a fixed failed notice and cold restart, without a confirmation or deletion', async () => {
  const f = await fixture(); try { const bytes = JSON.stringify({ ...f.lease, pid: process.pid }); await writeFile(f.ownerPath, bytes); assert.equal(await f.handoff.start(), true); assert.equal(f.handoff.outcome?.status, 'failed'); assert.equal(f.events.includes('confirm'), false); assert.equal(await readFile(f.ownerPath, 'utf8'), bytes); assert.equal(f.restarts(), 1); assert.equal(f.notices.length, 1); assert.doesNotMatch(f.notices[0], /private|lease23|已恢复|成功/) } finally { await f.cleanup() }
})
test('LH23-04 existing CloseCoordinator cancellation before database close never prepares or deletes a lease', async () => {
  const f = await fixture(); try { f.options.close = async () => false; assert.equal(await f.handoff.start(), false); assert.equal(f.handoff.requiresRestart, false); assert.deepEqual(f.events, []); assert.equal(f.restarts(), 0); assert.equal(await readFile(f.ownerPath, 'utf8'), f.ownerBytes) } finally { await f.cleanup() }
})
test('LH23-05 no afterClose or commit may run before the real closed-host proof', async () => {
  const f = await fixture(); try { await assert.rejects(f.handoff.finishClosed(), (error: unknown) => safeFailure(error) && (error as WorkLeaseHandoffError).code === 'HANDOFF_NOT_STARTED'); assert.throws(() => f.handoff.commit(), (error: unknown) => safeFailure(error) && (error as WorkLeaseHandoffError).code === 'HANDOFF_STATE_INVALID'); assert.equal(f.restarts(), 0); assert.equal(await readFile(f.ownerPath, 'utf8'), f.ownerBytes) } finally { await f.cleanup() }
})
test('LH23-06 stable host or owner loss before start fails safely and never asks the host to close', async () => {
  for (const guard of ['host', 'owner']) { const f = await fixture(); try { if (guard === 'host') f.loseHost(); else f.loseOwner(); await assert.rejects(f.handoff.start(), (error: unknown) => safeFailure(error) && (error as WorkLeaseHandoffError).code === (guard === 'host' ? 'HANDOFF_HOST_LOST' : 'HANDOFF_OWNER_CHANGED')); assert.deepEqual(f.events, []); assert.equal(f.restarts(), 0); assert.equal(await readFile(f.ownerPath, 'utf8'), f.ownerBytes) } finally { await f.cleanup() } }
})
test('LH23-07 a settled native-confirmation exception keeps closed handoff pending; retry does not flush old buffers twice', async () => {
  const f = await fixture(); let confirmations = 0
  try { f.options.confirm = async () => { if (++confirmations === 1) throw Error('private native confirmation exception'); return true }; await assert.rejects(f.handoff.start(), safeFailure); assert.equal(f.handoff.requiresRestart, true); assert.equal(f.handoff.ready, false); assert.equal(f.restarts(), 0); assert.throws(() => f.handoff.commit(), safeFailure); await f.handoff.finishClosed(); f.handoff.commit(); assert.equal(f.restarts(), 1); assert.equal(f.events.filter(event => event === 'flush').length, 1); assert.equal(f.events.filter(event => event === 'target').length, 1); assert.equal(confirmations, 2); await assert.rejects(lstat(f.lock), { code: 'ENOENT' }) } finally { await f.cleanup() }
})
test('LH23-08 a notice exception after successful recovery retries only the notice, never the deletion or old buffer flush', async () => {
  const f = await fixture(); let notices = 0, removed = 0
  try { f.options.recoveryHook = phase => { if (phase === 'after-owner-unlink') removed++ }; f.options.notice = async () => { if (++notices === 1) throw Error('private notice failed') }; await assert.rejects(f.handoff.start(), safeFailure); assert.equal(f.handoff.outcome?.status, 'recovered'); assert.equal(f.handoff.ready, false); assert.equal(f.restarts(), 0); await f.handoff.finishClosed(); f.handoff.commit(); assert.equal(removed, 1); assert.equal(notices, 2); assert.equal(f.events.filter(event => event === 'flush').length, 1); assert.equal(f.restarts(), 1) } finally { await f.cleanup() }
})
test('LH23-09 an observed owner change during confirmation permanently revokes the old handoff even if the same nonce is restored later', async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), answer = Promise.withResolvers<boolean>(); let pending: Promise<boolean> | undefined
  try { f.options.confirm = async () => { entered.resolve(); return answer.promise }; pending = f.handoff.start(); void pending.catch(() => {}); await entered.promise; f.loseOwner(); answer.resolve(true); await assert.rejects(pending, safeFailure); assert.equal(f.handoff.ready, false); assert.equal(f.restarts(), 0); f.restoreOwner(); await assert.rejects(f.handoff.finishClosed(), (error: unknown) => error instanceof WorkLeaseHandoffError && error.code === 'HANDOFF_OWNER_CHANGED'); assert.throws(() => f.handoff.commit(), safeFailure); assert.equal(await readFile(f.ownerPath, 'utf8'), f.ownerBytes) }
  finally { answer.resolve(false); await pending?.catch(() => {}); await f.cleanup() }
})
test('LH23-10 cancel waits for a real pending confirmation even if it ignores AbortSignal; a late true cannot delete and still cold restarts once', async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), answer = Promise.withResolvers<boolean>(); let pending: Promise<boolean> | undefined, cancellation: Promise<void> | undefined, aborted = false
  try { f.options.confirm = async (_preview, signal) => { signal.addEventListener('abort', () => { aborted = true }, { once: true }); entered.resolve(); return answer.promise }; pending = f.handoff.start(); void pending.catch(() => {}); await entered.promise; let drained = false; cancellation = f.handoff.cancel().then(() => { drained = true }); await new Promise(setImmediate); assert.equal(aborted, true); assert.equal(drained, false); assert.equal(f.handoff.ready, false); assert.equal(f.restarts(), 0); answer.resolve(true); await cancellation; assert.equal(await pending, true); assert.equal(f.handoff.outcome?.status, 'cancelled'); assert.equal(await readFile(f.ownerPath, 'utf8'), f.ownerBytes); assert.equal(f.restarts(), 1) }
  finally { answer.resolve(false); await pending?.catch(() => {}); await cancellation?.catch(() => {}); await f.cleanup() }
})
test('LH23-11 cancellation drains actual audit file IO before returning, refuses commit while it waits, and never deletes owner', async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(); let pending: Promise<boolean> | undefined, cancellation: Promise<void> | undefined
  try { f.options.recoveryHook = async phase => { if (phase === 'before-audit-rename') { entered.resolve(); await release.promise } }; pending = f.handoff.start(); void pending.catch(() => {}); await entered.promise; assert.ok((await readdir(f.root)).some(name => name.endsWith('.tmp'))); let drained = false; cancellation = f.handoff.cancel().then(() => { drained = true }); await new Promise(setImmediate); assert.equal(drained, false); assert.throws(() => f.handoff.commit(), safeFailure); assert.equal(f.restarts(), 0); release.resolve(); await cancellation; assert.equal(await pending, true); assert.equal(f.handoff.outcome?.status, 'cancelled'); assert.equal(await readFile(f.ownerPath, 'utf8'), f.ownerBytes); assert.equal((await readdir(f.root)).some(name => name.endsWith('.tmp')), false); assert.equal(f.restarts(), 1) }
  finally { release.resolve(); await pending?.catch(() => {}); await cancellation?.catch(() => {}); await f.cleanup() }
})
test('LH23-12 partial owner removal stays cleanup-pending with its durable audit and cannot be announced as successful', async () => {
  const f = await fixture(); try { f.options.recoveryHook = phase => { if (phase === 'before-directory-remove') throw Error('private rmdir IO') }; assert.equal(await f.handoff.start(), true); assert.equal(f.handoff.outcome?.status, 'cleanup-pending'); assert.deepEqual(await readdir(f.lock), []); assert.equal(JSON.parse(await readFile(join(f.root, '.xuanxiang-lease-recovery.json'), 'utf8')).payload.phase, 'observed'); assert.equal(f.restarts(), 1); assert.doesNotMatch(f.notices[0], /已恢复|成功/); assert.equal(await readFile(join(f.root, 'database.bin'), 'utf8'), 'original database bytes') } finally { await f.cleanup() }
})
test('LH23-13 start/afterClose/restart callbacks can reenter synchronously without a duplicate close, recovery or relaunch', async () => {
  const f = await fixture(); let nestedStart: Promise<boolean> | undefined, nestedFinish: Promise<void> | undefined, nestedCommit: boolean | undefined, closed = 0, restarted = 0
  try { const originalClose = f.options.close; f.options.close = async intent => { closed++; nestedStart = f.handoff.start(); return originalClose(intent) }; const originalNotice = f.options.notice; f.options.notice = async message => { nestedFinish = f.handoff.finishClosed(); await originalNotice(message) }; const originalRestart = f.options.restart; f.options.restart = () => { restarted++; nestedCommit = f.handoff.commit(); originalRestart() }; const pending = f.handoff.start(); assert.strictEqual(f.handoff.start(), pending); assert.equal(await pending, true); assert.strictEqual(nestedStart, pending); await nestedFinish; assert.equal(closed, 1); assert.equal(restarted, 1); assert.equal(nestedCommit, false); assert.equal(f.restarts(), 1); assert.equal(f.events.filter(event => event === 'confirm').length, 1) } finally { await f.cleanup() }
})
test('LH23-14 the actual CloseCoordinator retries only afterClose after confirmation failure and never rewrites old flushed buffers', async () => {
  const f = await fixture(); let flushed = 0, closed = 0, confirmations = 0
  try {
    f.options.confirm = async () => { if (++confirmations === 1) throw Error('private native prompt failure'); return true }
    const coordinator = new CloseCoordinator({ current: () => f.identity.owner, busy: async () => false, confirmStop: async () => true, stopTasks: async () => {}, flush: async () => { flushed++; await writeFile(join(f.root, 'drafts.txt'), 'original flushed draft') }, closeData: async () => { closed++; f.setClosed(true) }, afterClose: () => f.handoff.finishClosed(), failed: async () => 'retry', exportDraft: async () => { throw Error('unexpected export') }, commit: intent => { assert.equal(intent, 'quit'); f.handoff.commit() }, release: () => {} })
    f.options.close = intent => coordinator.request(intent)
    assert.equal(await f.handoff.start(), true); assert.equal(flushed, 1); assert.equal(closed, 1); assert.equal(confirmations, 2); assert.equal(f.restarts(), 1); assert.equal(await readFile(join(f.root, 'drafts.txt'), 'utf8'), 'original flushed draft')
  } finally { await f.cleanup() }
})
test('LH23-15 read-only target failure stays closed and retries the target without repeating old flush or falsely announcing recovery', async () => {
  const f = await fixture(); let reads = 0
  try { const original = f.options.target; f.options.target = async id => { if (++reads === 1) throw Error('private worker metadata failed'); return original(id) }; await assert.rejects(f.handoff.start(), safeFailure); assert.equal(f.handoff.requiresRestart, true); assert.equal(f.handoff.ready, false); assert.equal(f.notices.length, 0); assert.equal(await readFile(f.ownerPath, 'utf8'), f.ownerBytes); await f.handoff.finishClosed(); f.handoff.commit(); assert.equal(reads, 2); assert.equal(f.events.filter(event => event === 'flush').length, 1); assert.equal(f.restarts(), 1) } finally { await f.cleanup() }
})
test('LH23-16 real durable-audit IO failure keeps deletion uncommitted; afterClose retry reuses only the still-valid exact confirmation', async () => {
  const f = await fixture(); let failures = 0
  try { f.options.recoveryHook = phase => { if (phase === 'before-audit-sync' && failures++ === 0) throw Error('private directory sync failed') }; await assert.rejects(f.handoff.start(), safeFailure); assert.equal(f.handoff.ready, false); assert.equal(f.restarts(), 0); assert.equal(await readFile(f.ownerPath, 'utf8'), f.ownerBytes); assert.equal(JSON.parse(await readFile(join(f.root, '.xuanxiang-lease-recovery.json'), 'utf8')).payload.phase, 'observed'); delete f.options.recoveryHook; await f.handoff.finishClosed(); f.handoff.commit(); assert.equal(f.events.filter(event => event === 'confirm').length, 1); assert.equal(f.events.filter(event => event === 'target').length, 1); assert.equal(f.restarts(), 1) } finally { await f.cleanup() }
})
test('LH23-17 restart exceptions remain unconfirmed and cannot cause a second relaunch callback', async () => {
  const f = await fixture(); let calls = 0
  try { f.options.restart = () => { calls++; throw Error('private relaunch registration unknown') }; await assert.rejects(f.handoff.start(), (error: unknown) => error instanceof WorkLeaseHandoffError && error.code === 'HANDOFF_RESTART_UNCONFIRMED'); assert.equal(f.handoff.pending, true); assert.equal(f.handoff.requiresRestart, true); assert.equal(f.handoff.ready, false); assert.throws(() => f.handoff.commit(), safeFailure); assert.equal(calls, 1); assert.equal(f.handoff.outcome?.status, 'recovered'); await assert.rejects(lstat(f.lock), { code: 'ENOENT' }) } finally { await f.cleanup() }
})
test('LH23-18 renderer paths, malformed IDs or extra owner fields cannot enter a handoff', async () => {
  const f = await fixture()
  try { for (const identity of [{ ...f.identity, path: f.root }, { ...f.identity, workId: 'not-uuid' }, { ...f.identity, owner: { ...f.identity.owner, path: f.root } }]) assert.throws(() => new WorkLeaseHandoff(identity, f.options), (error: unknown) => error instanceof WorkLeaseHandoffError && error.code === 'HANDOFF_INPUT_INVALID'); assert.equal(await readFile(f.ownerPath, 'utf8'), f.ownerBytes); assert.deepEqual(f.events, []) } finally { await f.cleanup() }
})
test('LH23-19 cancellation waits for a delayed catalog target and never consumes its late result as confirmation', async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(); let pending: Promise<boolean> | undefined, cancellation: Promise<void> | undefined
  try { f.options.target = async () => { entered.resolve(); await release.promise; return f.work }; pending = f.handoff.start(); void pending.catch(() => {}); await entered.promise; let drained = false; cancellation = f.handoff.cancel().then(() => { drained = true }); await new Promise(setImmediate); assert.equal(drained, false); assert.equal(f.restarts(), 0); release.resolve(); await cancellation; assert.equal(await pending, true); assert.equal(f.handoff.outcome?.status, 'cancelled'); assert.equal(f.events.includes('confirm'), false); assert.equal(await readFile(f.ownerPath, 'utf8'), f.ownerBytes) }
  finally { release.resolve(); await pending?.catch(() => {}); await cancellation?.catch(() => {}); await f.cleanup() }
})
test('LH23-20 cancellation after actual owner removal reports cleanup-pending truthfully and leaves the inert durable audit for a new confirmation', async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(); let pending: Promise<boolean> | undefined, cancellation: Promise<void> | undefined
  try { f.options.recoveryHook = async phase => { if (phase === 'after-owner-unlink') { entered.resolve(); await release.promise } }; pending = f.handoff.start(); void pending.catch(() => {}); await entered.promise; await assert.rejects(lstat(f.ownerPath), { code: 'ENOENT' }); let drained = false; cancellation = f.handoff.cancel().then(() => { drained = true }); await new Promise(setImmediate); assert.equal(drained, false); assert.equal(f.restarts(), 0); release.resolve(); await cancellation; assert.equal(await pending, true); assert.equal(f.handoff.outcome?.status, 'cleanup-pending'); assert.deepEqual(await readdir(f.lock), []); assert.equal(JSON.parse(await readFile(join(f.root, '.xuanxiang-lease-recovery.json'), 'utf8')).payload.phase, 'observed'); assert.doesNotMatch(f.notices[0], /已恢复|成功/); assert.equal(f.restarts(), 1) }
  finally { release.resolve(); await pending?.catch(() => {}); await cancellation?.catch(() => {}); await f.cleanup() }
})
test('LH23-21 losing an established closed-host proof permanently prevents recovery or commit even if a later flag says closed again', async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), answer = Promise.withResolvers<boolean>(); let pending: Promise<boolean> | undefined
  try { f.options.confirm = async () => { entered.resolve(); return answer.promise }; pending = f.handoff.start(); void pending.catch(() => {}); await entered.promise; f.setClosed(false); answer.resolve(true); await assert.rejects(pending, (error: unknown) => error instanceof WorkLeaseHandoffError && error.code === 'HANDOFF_NOT_CLOSED'); f.setClosed(true); await assert.rejects(f.handoff.finishClosed(), safeFailure); assert.throws(() => f.handoff.commit(), safeFailure); assert.equal(await readFile(f.ownerPath, 'utf8'), f.ownerBytes); assert.equal(f.restarts(), 0) }
  finally { answer.resolve(false); await pending?.catch(() => {}); await f.cleanup() }
})
test('LH23-22 afterClose entry is an irreversible lifecycle barrier even when its first closed proof fails; retry never flushes the old editor again', async () => {
  const f = await fixture()
  try { f.options.close = async () => { f.events.push('flush'); return f.handoff.finishClosed().then(() => { f.handoff.commit(); return true }) }; await assert.rejects(f.handoff.start(), (error: unknown) => error instanceof WorkLeaseHandoffError && error.code === 'HANDOFF_NOT_CLOSED'); assert.equal(f.handoff.requiresRestart, true); assert.equal(f.handoff.pending, true); assert.equal(f.events.includes('target'), false); assert.equal(await readFile(f.ownerPath, 'utf8'), f.ownerBytes); f.setClosed(true); await f.handoff.finishClosed(); f.handoff.commit(); assert.equal(f.events.filter(event => event === 'flush').length, 1); assert.equal(f.restarts(), 1) } finally { await f.cleanup() }
})
