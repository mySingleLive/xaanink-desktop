import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DataRootManager, type RootOptions } from "../../desktop/core/data-root"
import { directoryIdentity } from "../../desktop/core/root-ownership"
import { RootMigrationRequests } from "../../desktop/main/root-migration-request"
import { RootMaintenanceRunner, type MaintenanceDataRoot, type RootMaintenanceRunnerOptions } from "../../desktop/main/root-maintenance-runner"
import { collectClosedRootFiles } from "../../desktop/main/owned-root-files"
import type { RootMaintenanceState } from "../../desktop/shared/root-maintenance"

function gate() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes }); return { promise, resolve } }
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "xuanxiang-runner-independent-")))
  const source = join(base, "from"), target = join(base, "to"), bootstrap = join(base, "boot"), work = join(base, "author-work")
  for (const directory of [source, target, bootstrap, work]) await mkdir(directory)
  await mkdir(join(source, "inbox/database/pg_notify"), { recursive: true })
  const owner = randomUUID(), rootId = randomUUID(), pointer = { schemaVersion: 1 as const, revision: 3, rootId, migrationId: null, root: await directoryIdentity(source) }
  await writeFile(join(source, "xuanxiang-app.json"), JSON.stringify({ schemaVersion: 1, app: "Xuanxiangxiezuo-Desktop", id: rootId, phase: "ready", inboxReady: true }))
  await writeFile(join(source, "catalog.json"), JSON.stringify({ schemaVersion: 1, revision: 0, value: [{ path: work }] }))
  await writeFile(join(source, "drafts.json"), "independent local draft")
  await writeFile(join(source, "state.json"), "controlled local settings bytes")
  await writeFile(join(source, "inbox/database/PG_VERSION"), "17")
  await writeFile(join(source, "unknown-note.txt"), "foreign root note")
  await writeFile(join(work, "chapter.md"), "work stays here")
  await writeFile(join(bootstrap, "data-root.json"), JSON.stringify(pointer))
  let closed = true, migrations = 0, recoveries = 0, continues = 0, quits = 0
  // Controlled maintenance closure gate only; real isolated filesystem below.
  // No actual Electron, PGlite process or OS single-instance lock is asserted.
  const guard = () => { if (!closed) throw Error("controlled closure proof unavailable") }
  const authority = new DataRootManager(bootstrap, source)
  const writeOptions: { beforeRename?: () => Promise<void>; beforeDirectorySync?: () => Promise<void> } = {}
  const requests = new RootMigrationRequests(bootstrap, { resolveSource: () => authority.resolve(), assertOwner(nonce) { assert.equal(nonce, owner) }, assertStableLock: guard, assertClosed: guard, writeOptions })
  const options: RootMaintenanceRunnerOptions = { bootstrap, defaultRoot: source, requests, theme: "paper", host: { assertMaintenanceClosed: guard }, onContinue: async () => { continues++ }, onQuit: async () => { quits++ }, createManager(input: RootOptions & {migrationId: string}) {
    const manager: MaintenanceDataRoot = new DataRootManager(bootstrap, source, input)
    const migrate = manager.migrate.bind(manager), recover = manager.recover.bind(manager)
    manager.migrate = async (...args) => { migrations++; return migrate(...args) }
    manager.recover = async (...args) => { recoveries++; return recover(...args) }
    return manager
  } }
  const proof = await directoryIdentity(target)
  return { base, source, target, bootstrap, work, owner, pointer, proof, requests, writeOptions, authority, options,
    get migrations() { return migrations }, get recoveries() { return recoveries }, get continues() { return continues }, get quits() { return quits },
    setClosed(value: boolean) { closed = value },
    prepare: () => requests.prepare(owner, proof),
    async arm() { const prepared = await requests.prepare(owner, proof); return requests.arm(owner, prepared.requestId) },
    async close() { await requests.flush().catch(() => undefined); await rm(base, { recursive: true, force: true }) },
  }
}

test("RMR72-01: initial publishing reentry shares the actual start completion instead of acknowledging preparing before real IO", async () => {
  const f = await fixture(); let running: Promise<RootMaintenanceState> | undefined, nested: Promise<RootMaintenanceState> | undefined
  try {
    await f.arm(); const runner = new RootMaintenanceRunner(f.options)
    runner.subscribe(state => { if (state.revision === 1) nested = runner.start() })
    running = runner.start(); assert.ok(nested)
    const [outerState, innerState] = await Promise.all([running, nested])
    assert.equal(outerState.phase, "cleanup-pending"); assert.equal(f.migrations, 1)
    assert.equal(innerState.phase, "cleanup-pending", "a subscribed caller must await the same real migration, not a pre-IO snapshot")
    assert.equal(outerState.pendingCount, 1); assert.deepEqual(outerState.pendingItems, ["unknown-note.txt"])
    assert.equal(nested, running)
    assert.equal(await readFile(join(f.target, "drafts.json"), "utf8"), "independent local draft")
  } finally { await running?.catch(() => undefined); await f.close() }
})

test("RMR72-02: cancel at the first prepared-state notification must durably cancel, not leave an uncancellable prepared request", async () => {
  const f = await fixture(); let running: Promise<RootMaintenanceState> | undefined, cancelling: Promise<void> | undefined
  try {
    const prepared = await f.prepare(), runner = new RootMaintenanceRunner(f.options)
    runner.subscribe(state => { if (state.phase === "preparing" && state.canCancel && !cancelling) cancelling = runner.cancel() })
    running = runner.start(); await running; assert.ok(cancelling); await cancelling
    assert.equal(f.migrations, 0); assert.deepEqual(await readdir(f.target), [])
    assert.equal((await f.requests.inspect()).active, null, "accepted prepared cancellation must have its durable receipt before resolving")
    assert.equal((await f.requests.readResult())?.requestId, prepared.requestId)
    assert.equal(runner.state().phase, "cancelled"); assert.equal(runner.state().canContinue, true)
    assert.equal(await readFile(join(f.source, "drafts.json"), "utf8"), "independent local draft")
  } finally { await running?.catch(() => undefined); await cancelling?.catch(() => undefined); await f.close() }
})

test("RMR72-03: continue ACK waits actual directory sync; racing quit shares one handoff and preserves the next FIFO result and armed active", async () => {
  const f = await fixture(), entered = gate(), allow = gate(); let continuation: Promise<void> | undefined
  try {
    const first = await f.prepare(); await f.requests.cancel(first.requestId, f.owner)
    const second = await f.prepare(); const secondReceipt = await f.requests.cancel(second.requestId, f.owner)
    const active = await f.arm(), runner = new RootMaintenanceRunner(f.options); await runner.start()
    f.writeOptions.beforeDirectorySync = async () => { entered.resolve(); await allow.promise }
    continuation = runner.continue(); await entered.promise; const quitting = runner.quit()
    assert.equal(quitting, continuation); assert.equal(f.continues, 0); assert.equal(f.quits, 0)
    allow.resolve(); await Promise.all([continuation, quitting]); f.writeOptions.beforeDirectorySync = undefined
    const snapshot = await f.requests.inspect()
    assert.equal(f.continues, 1); assert.equal(f.quits, 0); assert.equal(f.migrations, 0)
    assert.equal(snapshot.active?.requestId, active.requestId)
    assert.deepEqual(snapshot.results.map(result => result.receiptId), [secondReceipt.receiptId])
  } finally { allow.resolve(); await continuation?.catch(() => undefined); await f.close() }
})

test("RMR72-04: executing cannot reuse a real prior rolled-back journal for the same source and target under another nonce", async () => {
  const f = await fixture()
  try {
    const oldNonce = randomUUID(), abort = new AbortController(), owned = await collectClosedRootFiles(f.pointer.root, f.options.host.assertMaintenanceClosed)
    const oldCore = new DataRootManager(f.bootstrap, f.source, { migrationId: oldNonce, hook(phase) { if (phase === "file-copied") abort.abort() } })
    await assert.rejects(oldCore.migrate(f.proof, { quiesce: async () => ({ source: f.pointer.root, ownedFiles: owned.files, ownedDirectories: owned.directories, assertClosed: f.options.host.assertMaintenanceClosed, release() {} }) }, abort.signal))
    const armed = await f.arm(), execution = await f.requests.startArmed(armed.requestId)
    assert.notEqual(execution.executionNonce, oldNonce)
    const runner = new RootMaintenanceRunner(f.options), result = await runner.start()
    assert.equal(result.phase, "recovery-required"); assert.equal(result.canContinue, false)
    assert.equal(f.migrations, 0); assert.equal(f.recoveries, 0)
    const active = (await f.requests.inspect()).active; assert.ok(active?.phase === "executing")
    assert.equal(active.executionNonce, execution.executionNonce)
    assert.equal(await f.requests.readResult(), null)
    assert.equal(await readFile(join(f.source, "drafts.json"), "utf8"), "independent local draft")
  } finally { await f.close() }
})

test("RMR72-05: losing the real journal after committed cleanup and before release never clears executing or enables a new migrate", async () => {
  const f = await fixture()
  try {
    await f.arm(); f.options.host.release = async outcome => { if (outcome === "new-root") { await rm(join(f.bootstrap, "root-migration.json")); throw Error("controlled postcommit journal loss") } }
    const first = new RootMaintenanceRunner(f.options), state = await first.start()
    assert.equal(state.phase, "recovery-required"); assert.equal(state.canContinue, false)
    assert.equal((await f.requests.inspect()).active?.phase, "executing"); assert.equal(await f.requests.readResult(), null)
    assert.equal(await readFile(join(f.target, "drafts.json"), "utf8"), "independent local draft")
    const resolution = await f.authority.resolve(); assert.ok(resolution.state === "existing"); assert.equal(resolution.pointer.root.path, f.target)
    f.options.host.release = undefined
    assert.equal((await new RootMaintenanceRunner(f.options).start()).phase, "recovery-required")
    assert.equal(f.migrations, 1)
    assert.equal(await readFile(join(f.source, "unknown-note.txt"), "utf8"), "foreign root note")
    assert.equal(await readFile(join(f.work, "chapter.md"), "utf8"), "work stays here")
  } finally { await f.close() }
})

test("RMR72-06: closure proof lost immediately after durable finish suppresses continue, then original receipt recovery does no additional copy", async () => {
  const f = await fixture()
  try {
    await f.arm()
    f.writeOptions.beforeDirectorySync = async () => {
      const value = JSON.parse(await readFile(join(f.bootstrap, "root-migration-request.json"), "utf8"))
      if (value.results.some((result: {outcome: {status: string}}) => result.outcome.status === "cleanup-pending")) f.setClosed(false)
    }
    const runner = new RootMaintenanceRunner(f.options), result = await runner.start()
    assert.equal(result.phase, "recovery-required"); assert.equal(result.canContinue, false)
    await assert.rejects(runner.continue(), /CANNOT_CONTINUE/); assert.equal(f.continues, 0)
    f.setClosed(true); f.writeOptions.beforeDirectorySync = undefined
    const snapshot = await f.requests.inspect(); assert.equal(snapshot.active, null); assert.equal(snapshot.results[0].outcome.status, "cleanup-pending")
    assert.ok("pendingCount" in snapshot.results[0].outcome); assert.equal(snapshot.results[0].outcome.pendingCount,1)
    assert.equal((await runner.start()).phase, "cleanup-pending"); assert.equal(f.migrations, 1)
    assert.equal((await f.requests.readResult())?.receiptId, snapshot.results[0].receiptId)
    assert.equal(await readFile(join(f.target, "drafts.json"), "utf8"), "independent local draft")
  } finally { f.setClosed(true); await f.close() }
})

test("RMR72-07: an actual ACK post-rename sync failure cannot relaunch, and exact receipt retry preserves another result and active", async () => {
  const f = await fixture()
  try {
    const first = await f.prepare(), firstReceipt = await f.requests.cancel(first.requestId, f.owner)
    const second = await f.prepare(), secondReceipt = await f.requests.cancel(second.requestId, f.owner)
    const armed = await f.arm(), runner = new RootMaintenanceRunner(f.options); await runner.start()
    f.writeOptions.beforeDirectorySync = async () => { throw Error("controlled ACK directory sync failure") }
    await assert.rejects(runner.continue(), error => error instanceof Error && error.message === "CONTINUE_UNCONFIRMED")
    assert.equal(f.continues, 0); assert.equal(f.migrations, 0)
    const uncertain = JSON.parse(await readFile(join(f.bootstrap, "root-migration-request.json"), "utf8"))
    assert.equal(uncertain.active.requestId, armed.requestId)
    assert.deepEqual(uncertain.results.map((result: {receiptId: string}) => result.receiptId), [secondReceipt.receiptId])
    assert.notEqual(firstReceipt.receiptId, secondReceipt.receiptId)
    f.writeOptions.beforeDirectorySync = undefined
    await runner.continue(); const durable = await f.requests.inspect()
    assert.equal(f.continues, 1); assert.equal(durable.active?.requestId, armed.requestId)
    assert.deepEqual(durable.results.map(result => result.receiptId), [secondReceipt.receiptId])
    assert.equal(await readFile(join(f.source, "drafts.json"), "utf8"), "independent local draft")
  } finally { f.writeOptions.beforeDirectorySync = undefined; await f.close() }
})

test("RMR72-08: actual pointer commit forbids cancellation and quit waits core release and durable completion without ACK", async () => {
  const f = await fixture(), entered = gate(), allow = gate(); let running: Promise<RootMaintenanceState> | undefined, quitting: Promise<void> | undefined
  try {
    await f.arm(); const create = f.options.createManager!
    f.options.createManager = input => create({ ...input, hook: async (phase, path) => { await input.hook?.(phase, path); if (phase === "pointer-written") { entered.resolve(); await allow.promise } } })
    const runner = new RootMaintenanceRunner(f.options); running = runner.start(); await entered.promise
    const pointer = await f.authority.resolve(); assert.ok(pointer.state === "existing"); assert.equal(pointer.pointer.root.path, f.target)
    assert.equal(runner.state().canCancel, false)
    await assert.rejects(runner.cancel(), /CANNOT_CANCEL/)
    quitting = runner.quit(); await Promise.resolve(); assert.equal(f.quits, 0)
    assert.equal(runner.state().canContinue, false)
    allow.resolve(); await Promise.all([running, quitting])
    assert.equal(f.quits, 1); assert.equal(f.continues, 0); assert.equal(f.migrations, 1)
    assert.equal((await f.requests.readResult())?.outcome.status, "cleanup-pending")
    const receipt=await f.requests.readResult(); assert.ok(receipt&&"pendingCount" in receipt.outcome); assert.equal(receipt.outcome.pendingCount,1)
    assert.equal((await f.requests.inspect()).active, null)
    assert.equal(await readFile(join(f.target, "drafts.json"), "utf8"), "independent local draft")
  } finally { allow.resolve(); await running?.catch(() => undefined); await quitting?.catch(() => undefined); await f.close() }
})

test("RMR72-09: quit reentered from prepared cancel notification must await the already accepted cancellation flight", async () => {
  const f = await fixture(), entered = gate(), allow = gate(); let cancelling: Promise<void> | undefined, quitting: Promise<void> | undefined
  try {
    const prepared = await f.prepare(), runner = new RootMaintenanceRunner(f.options); await runner.start()
    f.options.host.assertMaintenanceClosed = async () => { entered.resolve(); await allow.promise }
    runner.subscribe(state => { if (state.phase === "preparing" && !state.canCancel && !quitting) quitting = runner.quit() })
    cancelling = runner.cancel(); await entered.promise; await Promise.resolve()
    assert.ok(quitting)
    assert.equal(f.quits, 0, "exit must wait the accepted cancel flight even after canCancel became false")
    const before = JSON.parse(await readFile(join(f.bootstrap, "root-migration-request.json"), "utf8"))
    assert.equal(before.active.requestId, prepared.requestId)
    allow.resolve(); await Promise.all([cancelling, quitting])
    assert.equal(f.quits, 1); assert.equal((await f.requests.inspect()).active, null)
    assert.equal((await f.requests.readResult())?.outcome.status, "cancelled")
  } finally { allow.resolve(); await cancelling?.catch(() => undefined); await quitting?.catch(() => undefined); await f.close() }
})

test("RMR72-10: quit accepting prepared cancellation shares one handoff with a synchronous quit observer", async () => {
  const f = await fixture(), entered = gate(), allow = gate(); let outer: Promise<void> | undefined, nested: Promise<void> | undefined
  try {
    const prepared = await f.prepare(), runner = new RootMaintenanceRunner(f.options); await runner.start()
    f.options.host.assertMaintenanceClosed = async () => { entered.resolve(); await allow.promise }
    let observed = false
    runner.subscribe(state => {
      if (state.phase === "preparing" && !state.canCancel && !observed) { observed = true; nested = runner.quit() }
    })
    outer = runner.quit(); await entered.promise; assert.ok(nested)
    assert.equal(f.quits, 0)
    allow.resolve(); await Promise.all([outer, nested])
    assert.equal(f.quits, 1, "synchronous quit reentry must not call the actual exit callback twice")
    assert.equal(nested, outer)
    assert.equal((await f.requests.inspect()).active, null)
    assert.equal((await f.requests.readResult())?.requestId, prepared.requestId)
    assert.equal((await f.requests.readResult())?.outcome.status, "cancelled")
  } finally { allow.resolve(); await outer?.catch(() => undefined); await nested?.catch(() => undefined); await f.close() }
})
