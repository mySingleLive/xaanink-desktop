import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import fs from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DataRootManager, type RootPointer } from "../../desktop/core/data-root"
import { DirectoryAuthority } from "../../desktop/main/directory-authority"
import { RootMigrationRequests, RootMigrationRequestError, MAX_ROOT_MIGRATION_REQUEST_BYTES, type RootMigrationRequestOptions } from "../../desktop/main/root-migration-request"
import { directoryIdentity } from "../../desktop/core/root-ownership"
const isCode = (code: string) => (error: unknown) => error instanceof RootMigrationRequestError && error.code === code
function gate() { let resolve!: () => void; return { promise: new Promise<void>(done => { resolve = done }), get resolve() { return resolve } } }
async function fixture() {
  const base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "xuanxiang-review66-"))), bootstrap = join(base, "boot"), source = join(base, "original"), target = join(base, "selected")
  for (const path of [bootstrap, source, target]) await fs.mkdir(path)
  const pointer: RootPointer = { schemaVersion: 1, revision: 3, rootId: randomUUID(), migrationId: randomUUID(), root: await directoryIdentity(source) }
  const owner = randomUUID(), path = join(bootstrap, "root-migration-request.json")
  await fs.writeFile(join(source, "xuanxiang-app.json"), JSON.stringify({ schemaVersion: 1, app: "Xuanxiangxiezuo-Desktop", id: pointer.rootId, phase: "ready", inboxReady: true }))
  await fs.writeFile(join(source, "drafts.json"), "真实隔离作者草稿：不得移动或覆盖")
  await fs.writeFile(join(bootstrap, "data-root.json"), JSON.stringify(pointer))
  const manager = new DataRootManager(bootstrap, source), grants = new DirectoryAuthority(), grant = await grants.issue(target, "data-root", owner), proof = await grants.consume(grant.id, "data-root", owner)
  let owned = true, closed = true, locked = true
  const options: RootMigrationRequestOptions = { resolveSource: () => manager.resolve(), assertOwner(nonce) { if (!owned || nonce !== owner) throw Error("expired") }, assertStableLock() { if (!locked) throw Error("not held") }, assertClosed() { if (!closed) throw Error("business DB remains open") }, writeOptions: {} }
  const ledger = new RootMigrationRequests(bootstrap, options)
  return { base, bootstrap, source, target, pointer, owner, path, manager, proof, options, ledger, setOwned(v: boolean) { owned = v }, setClosed(v: boolean) { closed = v }, setLocked(v: boolean) { locked = v },
    async armed() { const request = await ledger.prepare(owner, proof); return ledger.arm(owner, request.requestId) },
    async cleanup() { await ledger.flush(); await fs.rm(base, { recursive: true, force: true }) } }
}
/** Pause an actual record leaf lstat inside before-rename CAS. No fake inode,
 * file bytes, pointer, or close proof is supplied by this scheduling hook. */
function interveneDuringRecordCas(t: TestContext, f: Awaited<ReturnType<typeof fixture>>, mutate: () => Promise<void>) {
  let enabled = false, calls = 0, fired = false
  f.options.writeOptions!.beforeRename = async () => { enabled = true }
  const actual = fs.lstat
  t.mock.method(fs, "lstat", async (path: Parameters<typeof fs.lstat>[0], options?: Parameters<typeof fs.lstat>[1]) => {
    const stat = await actual(path, options)
    if (enabled && path === f.path && ++calls === 2) { await mutate(); fired = true }
    return stat
  })
  syncBuiltinESMExports()
  return { get fired() { return fired }, restore() { t.mock.restoreAll(); syncBuiltinESMExports() } }
}

test("MR66-01 authority drift during the record CAS must retain prepared and reject arm", async t => {
  const f = await fixture(); let timing: ReturnType<typeof interveneDuringRecordCas> | undefined
  try {
    const prepared = await f.ledger.prepare(f.owner, f.proof), before = await fs.readFile(f.path)
    timing = interveneDuringRecordCas(t, f, () => fs.writeFile(join(f.bootstrap, "data-root.json"), JSON.stringify({ ...f.pointer, revision: 4 })))
    let caught: unknown; try { await f.ledger.arm(f.owner, prepared.requestId) } catch (error) { caught = error }
    assert.equal(timing.fired, true, "real filesystem race was reached")
    assert.ok(isCode("SOURCE_CHANGED")(caught), "arm accepted a source revision changed after validation while awaiting its record CAS")
    assert.deepEqual(await fs.readFile(f.path), before); assert.equal((await f.ledger.inspect()).active?.phase, "prepared")
    assert.equal(await fs.readFile(join(f.source, "drafts.json"), "utf8"), "真实隔离作者草稿：不得移动或覆盖")
  } finally { timing?.restore(); await f.cleanup() }
})
test("MR66-02 target identity replacement during record CAS must retain prepared and preserve foreign files", async t => {
  const f = await fixture(); let timing: ReturnType<typeof interveneDuringRecordCas> | undefined
  try {
    const prepared = await f.ledger.prepare(f.owner, f.proof), before = await fs.readFile(f.path)
    timing = interveneDuringRecordCas(t, f, async () => { await fs.rename(f.target, f.target + "-old"); await fs.mkdir(f.target); await fs.writeFile(join(f.target, "foreign.txt"), "replacement owner bytes") })
    let caught: unknown; try { await f.ledger.arm(f.owner, prepared.requestId) } catch (error) { caught = error }
    assert.equal(timing.fired, true)
    assert.ok(isCode("TARGET_CHANGED")(caught), "arm accepted replacement target identity during the final record CAS")
    assert.deepEqual(await fs.readFile(f.path), before); assert.equal(await fs.readFile(join(f.target, "foreign.txt"), "utf8"), "replacement owner bytes")
  } finally { timing?.restore(); await f.cleanup() }
})
test("MR66-03 ambiguous commit cannot adopt a same-byte foreign inode replaced inside the sync hook", async () => {
  const f = await fixture(); let replaced = false
  try {
    f.options.writeOptions!.beforeDirectorySync = async () => {
      const original = await fs.lstat(f.path, { bigint: true }), replacement = f.path + ".foreign"
      await fs.writeFile(replacement, await fs.readFile(f.path)); await fs.rename(replacement, f.path)
      assert.notEqual((await fs.lstat(f.path, { bigint: true })).ino, original.ino); replaced = true
      throw Error("simulated sync failure after foreign inode replacement")
    }
    await assert.rejects(f.ledger.prepare(f.owner, f.proof), isCode("DURABILITY_UNCONFIRMED"))
    assert.equal(replaced, true)
    const foreignBytes = await fs.readFile(f.path); delete f.options.writeOptions!.beforeDirectorySync
    await assert.rejects(f.ledger.inspect(), isCode("RECORD_CHANGED"), "uncertain commit must not learn the foreign inode as its own successful commit")
    assert.deepEqual(await fs.readFile(f.path), foreignBytes)
  } finally { await f.cleanup() }
})
test("MR66-04 actual executing sync ambiguity remains executing across reopen and cannot auto-replay", async () => {
  const f = await fixture()
  try {
    const armed = await f.armed()
    f.options.writeOptions!.beforeDirectorySync = async () => { throw Error("isolated failure") }
    await assert.rejects(f.ledger.startArmed(armed.requestId), isCode("DURABILITY_UNCONFIRMED"))
    const disk = JSON.parse(await fs.readFile(f.path, "utf8")); assert.equal(disk.active.phase, "executing")
    delete f.options.writeOptions!.beforeDirectorySync
    const restarted = new RootMigrationRequests(f.bootstrap, f.options)
    assert.equal(await restarted.loadArmed(), null)
    await assert.rejects(restarted.startArmed(armed.requestId), isCode("NOT_ARMED"))
    await assert.rejects(restarted.finish(armed.requestId, randomUUID(), { status: "rollback-pending", migrationId: randomUUID(), root: f.pointer, pending: ["private recovery entry"] }), isCode("REQUEST_MISMATCH"))
    const complete = await restarted.finish(armed.requestId, disk.active.executionNonce, { status: "rollback-pending", migrationId: randomUUID(), root: f.pointer, pending: ["private recovery entry"] })
    assert.equal(complete.outcome.status, "rollback-pending"); assert.equal((await restarted.inspect()).active, null)
    assert.equal((await fs.readFile(f.path, "utf8")).includes("private recovery entry"), false)
    assert.equal(await restarted.acknowledgeResult(complete.requestId, complete.receiptId), true)
    assert.equal(await restarted.readResult(), null)
  } finally { await f.cleanup() }
})
test("MR66-05 old cancellation and result ACK never consume a newer active request", async () => {
  const f = await fixture()
  try {
    const first = await f.ledger.prepare(f.owner, f.proof), cancelled = await f.ledger.cancel(first.requestId, f.owner)
    const second = await f.ledger.prepare(f.owner, f.proof)
    f.setOwned(false)
    const observed = (await f.ledger.readResult())!; observed.ownerNonce = randomUUID(); observed.source.root.path = "/wrong-return-copy"
    const repeat = f.ledger.cancel(first.requestId, f.owner), ack = f.ledger.acknowledgeResult(first.requestId, cancelled.receiptId), late = f.ledger.cancel(first.requestId, f.owner)
    void late.catch(() => undefined)
    assert.deepEqual(await repeat, cancelled); assert.equal(await ack, true); await assert.rejects(late, isCode("REQUEST_MISMATCH"))
    assert.equal((await f.ledger.inspect()).active?.requestId, second.requestId)
    assert.equal(await f.ledger.acknowledgeResult(first.requestId, cancelled.receiptId), false)
    assert.equal((await f.ledger.inspect()).active?.ownerNonce, f.owner)
  } finally { await f.cleanup() }
})
test("MR66-06 replacement while retrying directory sync cannot erase or adopt the foreign record", async () => {
  const f = await fixture(), entered = gate(), allow = gate(); let pending: Promise<unknown> | undefined
  try {
    f.options.writeOptions!.beforeDirectorySync = async () => { throw Error("isolated sync failure") }
    await assert.rejects(f.ledger.prepare(f.owner, f.proof), isCode("DURABILITY_UNCONFIRMED"))
    f.options.writeOptions!.beforeDirectorySync = async () => { entered.resolve(); await allow.promise }
    pending = f.ledger.inspect(); void pending.catch(() => undefined); await entered.promise
    const foreign = f.path + ".foreign", bytes = await fs.readFile(f.path)
    await fs.writeFile(foreign, bytes); await fs.rename(foreign, f.path); allow.resolve()
    await assert.rejects(pending, isCode("RECORD_CHANGED")); pending = undefined
    assert.deepEqual(await fs.readFile(f.path), bytes)
  } finally { allow.resolve(); await pending?.catch(() => undefined); await f.cleanup() }
})
test("MR66-07 losing the actual source cannot turn execution into a guessed failure result", async () => {
  const f = await fixture()
  try {
    const armed = await f.armed(), execution = await f.ledger.startArmed(armed.requestId), before = await fs.readFile(f.path)
    await fs.rename(f.source, f.source + "-disconnected")
    const result = { status: "rollback-pending" as const, migrationId: randomUUID(), root: f.pointer, pending: [] }
    await assert.rejects(f.ledger.finish(execution.requestId, execution.executionNonce, result), isCode("SOURCE_UNAVAILABLE"))
    await assert.rejects(f.ledger.fail(execution.requestId, "RECOVERY_REQUIRED", execution.executionNonce), isCode("SOURCE_UNAVAILABLE"))
    assert.deepEqual(await fs.readFile(f.path), before); assert.equal((await f.ledger.inspect()).active?.phase, "executing")
    assert.equal(await fs.readFile(join(f.source + "-disconnected", "drafts.json"), "utf8"), "真实隔离作者草稿：不得移动或覆盖")
  } finally { await f.cleanup() }
})
test("MR66-08 a real record growing after open is bounded and never silently truncated or replaced", async t => {
  const f = await fixture(); let grew = false
  try {
    await f.ledger.prepare(f.owner, f.proof)
    const before = await fs.readFile(f.path), actualOpen = fs.open
    t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await actualOpen(...args)
      if (args[0] === f.path) {
        const actualRead = handle.read.bind(handle) as (...readArgs: unknown[]) => Promise<unknown>
        t.mock.method(handle, "read", async (...readArgs: unknown[]) => {
          if (!grew) { await fs.appendFile(f.path, Buffer.alloc(MAX_ROOT_MIGRATION_REQUEST_BYTES + 1, 0x20)); grew = true }
          return actualRead(...readArgs)
        })
      }
      return handle
    })
    syncBuiltinESMExports()
    await assert.rejects(f.ledger.inspect(), isCode("RECORD_UNSAFE")); assert.equal(grew, true)
    const external = await fs.readFile(f.path); assert.ok(external.length > MAX_ROOT_MIGRATION_REQUEST_BYTES)
    assert.deepEqual(external.subarray(0, before.length), before)
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.cleanup() }
})
test("MR66-09 maximum pending-count result persists only bounded metadata and requires precise receipt ACK", async () => {
  const f = await fixture()
  try {
    const armed = await f.armed(), execution = await f.ledger.startArmed(armed.requestId), migrationId = randomUUID()
    const result = { status: "rollback-pending" as const, migrationId, root: f.pointer, pending: Array<string>(25002).fill("private text is not part of the durable result") }
    const completion = await f.ledger.finish(execution.requestId, execution.executionNonce, result)
    assert.deepEqual(completion.outcome, { status: "rollback-pending", migrationId, root: f.pointer, pendingCount: 25002 })
    assert.deepEqual(await f.ledger.finish(execution.requestId, execution.executionNonce, { ...result, pending: Array<string>(25002).fill("another non-persisted inventory name") }), completion)
    assert.equal((await fs.readFile(f.path, "utf8")).includes("private text"), false)
    assert.equal(await f.ledger.acknowledgeResult(completion.requestId, randomUUID()), false)
    assert.deepEqual(await f.ledger.readResult(), completion)
    assert.equal(await f.ledger.acknowledgeResult(completion.requestId, completion.receiptId), true)
    assert.equal(await f.ledger.readResult(), null)
  } finally { await f.cleanup() }
})
test("MR66-10 replacing the writer temporary inode cannot authorize a request or delete foreign temporary bytes", async () => {
  const f = await fixture(); let replaced: string | undefined, bytes: Buffer | undefined
  try {
    f.options.writeOptions!.beforeRename = async () => {
      const temporary = (await fs.readdir(f.bootstrap)).filter(name => name.startsWith(".root-migration-request-") && name.endsWith(".tmp"))
      assert.equal(temporary.length, 1, "this operation has a single real wx temporary")
      replaced = join(f.bootstrap, temporary[0]); bytes = await fs.readFile(replaced)
      const inode = (await fs.lstat(replaced, { bigint: true })).ino
      const foreign = replaced + ".replacement"; await fs.writeFile(foreign, bytes); await fs.rename(foreign, replaced)
      assert.notEqual((await fs.lstat(replaced, { bigint: true })).ino, inode)
    }
    await assert.rejects(f.ledger.prepare(f.owner, f.proof), isCode("RECORD_CHANGED"))
    assert.ok(replaced); assert.ok(bytes); assert.deepEqual(await fs.readFile(replaced), bytes, "cleanup may not unlink the externally replaced inode")
    await assert.rejects(fs.readFile(f.path), { code: "ENOENT" })
    assert.equal(await fs.readFile(join(f.source, "drafts.json"), "utf8"), "真实隔离作者草稿：不得移动或覆盖")
  } finally { await f.cleanup() }
})
