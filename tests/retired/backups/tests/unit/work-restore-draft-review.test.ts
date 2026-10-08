import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { WorkRestoreDraftBarrier } from "../../desktop/main/work-restore-draft-barrier"
import { WorkRestoreCommit } from "../../desktop/main/work-restore-commit"
import { DraftJournal } from "../../desktop/main/draft-journal"
import type { DraftSnapshot } from "../../desktop/shared/drafts"
import type { DesktopBridge } from "../../desktop/shared/ipc"
import type { CloseReply } from "../../desktop/shared/close"
import { DesktopDraftSession } from "../../src/lib/desktop/draft-session"
import { DesktopSaveCoordinator } from "../../src/lib/desktop/save-coordinator"

// Real isolated files, atomic rename and injected fsync failures. Closed/owner
// gates are deliberately controlled; this does not prove an Electron DB close.
const owner = async () => {}
async function fixture(run: (root: string, identity: { workId: string; candidateId: string; revision: number }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "xx-review78-"))
  try { await run(root, { workId: randomUUID(), candidateId: randomUUID(), revision: 0 }) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test("R78-01 uncertain begin cannot authorize activation on retry until the same durable barrier is synced", { timeout: 5000 }, async () => fixture(async (root, identity) => {
  let syncs = 0, activations = 0, syncsAtActivation = 0
  const barrier = new WorkRestoreDraftBarrier(root, { beforeDirectorySync: async () => { if (++syncs === 1) throw Error("injected fsync denied") } })
  const commit = new WorkRestoreCommit(identity, { barrier, assertOwner: owner, assertClosed: owner, closeReopenedData: owner, activate: async () => { syncsAtActivation = syncs; activations++ } })
  await assert.rejects(commit.finish(), /无法确认目录同步/)
  assert.equal((await new WorkRestoreDraftBarrier(root).inspect())?.outcome.status, "pending")
  const result = await commit.finish()
  assert.equal(result.status, "activated")
  assert.equal(activations, 1)
  assert.ok(syncsAtActivation >= 2, `durable begin must be confirmed before activation, actual sync attempts: ${syncsAtActivation}`)
}))

test("R78-02 an existing pending barrier from a previous process is an unknown result, never authority to re-run activation", { timeout: 5000 }, async () => fixture(async (root, identity) => {
  const original = new WorkRestoreDraftBarrier(root)
  const active = await original.begin({ workId: identity.workId, candidateId: identity.candidateId }, owner)
  let activations = 0
  const restarted = new WorkRestoreCommit(identity, { barrier: new WorkRestoreDraftBarrier(root), assertOwner: owner, assertClosed: owner, closeReopenedData: owner, activate: async () => { activations++ } })
  await assert.rejects(restarted.finish())
  assert.equal(activations, 0)
  assert.deepEqual(await new WorkRestoreDraftBarrier(root).inspect(), active)
}))

test("R78-03 owner expiry during the final async disk CAS cannot publish a new barrier after authorization is gone", { timeout: 5000 }, async () => fixture(async (root, identity) => {
  let finalGuard = false, valid = true
  const assertOwner = async () => {
    if (!valid) throw Error("owner expired")
    if (finalGuard) queueMicrotask(() => { valid = false })
  }
  const barrier = new WorkRestoreDraftBarrier(root, { beforeRename: async () => { finalGuard = true } })
  await assert.rejects(barrier.begin({ workId: identity.workId, candidateId: identity.candidateId }, assertOwner), /owner expired/)
  assert.equal(await new WorkRestoreDraftBarrier(root).inspect(), null, "expired owner must not leave a newly committed active barrier")
}))

test("R78-04 known persisted terminal outcome is reused without activation, and reopened data is closed before ready", { timeout: 5000 }, async () => fixture(async (root, identity) => {
  const barrier = new WorkRestoreDraftBarrier(root), active = await barrier.begin({ workId: identity.workId, candidateId: identity.candidateId }, owner)
  await barrier.settle(active.token, { status: "failed", message: "verified original pointer retained" }, owner)
  let activations = 0, closes = 0
  const commit = new WorkRestoreCommit(identity, { barrier: new WorkRestoreDraftBarrier(root), assertOwner: owner, assertClosed: owner, activate: async () => { activations++ }, closeReopenedData: async () => { closes++ } })
  assert.deepEqual(await commit.finish(), { status: "failed", message: "verified original pointer retained" })
  assert.equal(activations, 0); assert.equal(closes, 1); assert.equal(commit.ready, true)
  await commit.finish(); assert.equal(closes, 1)
}))

test("R78-05 exact real journal digest/session/owner confirmation is required before clearing the barrier", { timeout: 5000 }, async () => fixture(async (root, identity) => {
  const barrier = new WorkRestoreDraftBarrier(root), active = await barrier.begin({ workId: identity.workId, candidateId: identity.candidateId }, owner)
  const journal = new DraftJournal(root), release = journal.activate("first-window")
  const snapshot: DraftSnapshot = { version: 1, revision: 1, createdAt: new Date().toISOString(), autosaves: [], sources: { recovery: { version: 1, items: [] } }, issues: [] }
  const receipt = await journal.persist("first-window", snapshot)
  await assert.rejects(barrier.acknowledge(active.token, () => journal.confirm("first-window", { ...receipt, digest: "b".repeat(64) })))
  assert.deepEqual(await barrier.inspect(), active)
  release(); journal.activate("different-window")
  await assert.rejects(barrier.acknowledge(active.token, () => journal.confirm("first-window", receipt)))
  assert.deepEqual(await new WorkRestoreDraftBarrier(root).inspect(), active)
}))

test("R78-06 settle directory-sync failure is retried durably without ever executing activation twice", { timeout: 5000 }, async () => fixture(async (root, identity) => {
  let syncs = 0, activations = 0, closes = 0
  const barrier = new WorkRestoreDraftBarrier(root, { beforeDirectorySync: async () => { if (++syncs === 2) throw Error("injected settle fsync denied") } })
  const commit = new WorkRestoreCommit(identity, { barrier, assertOwner: owner, assertClosed: owner, activate: async () => { activations++ }, closeReopenedData: async () => { closes++ } })
  await assert.rejects(commit.finish(), /无法确认目录同步/)
  assert.equal(commit.ready, false); assert.equal(activations, 1); assert.equal(closes, 0)
  assert.equal((await new WorkRestoreDraftBarrier(root).inspect())?.outcome.status, "activated")
  assert.deepEqual(await commit.finish(), { status: "activated" }); assert.equal(activations, 1); assert.equal(closes, 1)
}))

test("R78-07 malformed/oversized barrier metadata is rejected and retained without opening a clean restore operation", { timeout: 5000 }, async () => fixture(async (root, identity) => {
  const path = join(root, "restore-draft-barrier.json"), bytes = Buffer.from("x".repeat(16385))
  await writeFile(path, bytes)
  const barrier = new WorkRestoreDraftBarrier(root)
  await assert.rejects(barrier.inspect()); await assert.rejects(barrier.begin({ workId: identity.workId, candidateId: identity.candidateId }, owner))
  assert.deepEqual(await readFile(path), bytes)
}))

test("R78-08 a failed close of data reopened by activation can be retried while the engines remain open, without reactivating", { timeout: 5000 }, async () => fixture(async (root, identity) => {
  let closed = true, closes = 0, activations = 0
  const commit = new WorkRestoreCommit(identity, {
    barrier: new WorkRestoreDraftBarrier(root), assertOwner: owner,
    assertClosed: async () => { if (!closed) throw Error("actual reopened engine remains open") },
    activate: async () => { activations++; closed = false },
    closeReopenedData: async () => { if (++closes === 1) throw Error("first re-close failed"); closed = true },
  })
  await assert.rejects(commit.finish(), /first re-close failed/)
  assert.equal(commit.ready, false); assert.equal(closed, false)
  assert.deepEqual(await commit.finish(), { status: "activated" })
  assert.equal(activations, 1); assert.equal(closes, 2); assert.equal(closed, true); assert.equal(commit.ready, true)
}))

test("R78-09 another Commit using the same in-memory barrier cannot claim the first operation's pending activation", { timeout: 5000 }, async () => fixture(async (root, identity) => {
  const barrier = new WorkRestoreDraftBarrier(root), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  let calls = 0
  const first = new WorkRestoreCommit(identity, { barrier, assertOwner: owner, assertClosed: owner, closeReopenedData: owner, activate: async () => { calls++; entered.resolve(); await release.promise } })
  const work = first.finish()
  try {
    await entered.promise
    const other = new WorkRestoreCommit(identity, { barrier, assertOwner: owner, assertClosed: owner, closeReopenedData: owner, activate: async () => { calls++ } })
    await assert.rejects(other.finish())
    assert.equal(calls, 1)
  } finally { release.resolve(); await work }
}))

test("R78-10 lost recovery ACK leaves the real barrier for restart while a later saved close only confirms the journal", { timeout: 5000 }, async () => fixture(async (root, identity) => {
  const barrier = new WorkRestoreDraftBarrier(root), active = await barrier.begin({ workId: identity.workId, candidateId: identity.candidateId }, owner)
  await barrier.settle(active.token, { status: "activated" }, owner)
  const journal = new DraftJournal(root), release = journal.activate("window"), coordinator = new DesktopSaveCoordinator({ checkpointDelayMs: null }), sessionId = randomUUID(), replies: CloseReply[] = []
  let confirms = 0
  const bridge = {
    readDraft: async () => null, markDraftReady: owner,
    persistDraft: async (_session: string, value: DraftSnapshot) => journal.persist("window", value),
    replyClose: async (_session: string, _id: string, reply: CloseReply) => { replies.push(reply); return true },
  } as unknown as DesktopBridge
  const session = new DesktopDraftSession(bridge, coordinator, {
    restore: () => undefined, installSources: () => coordinator.registerSource("recovery", { read: () => ({ version: 1, items: [] }) }),
    closing: () => {}, flushSettings: owner,
    restoreBarrier: { confirm: async () => { confirms++; throw Error("lost barrier ACK; current protection remains") } },
  })
  try {
    await assert.rejects(session.initialize(sessionId), /lost barrier ACK/)
    await session.handle({ type: "prepare-close", id: randomUUID(), sessionId, action: "flush", retryFailures: false })
    assert.equal(confirms, 1); assert.equal(replies[0]?.status, "saved")
    if (replies[0]?.status === "saved") await journal.confirm("window", replies[0].receipt)
    assert.equal((await new WorkRestoreDraftBarrier(root).inspect())?.token, active.token)
  } finally { session.dispose(); release() }
}))

test("R78-11 the real post-cleanup receipt clears the barrier only after two durable snapshots and blocks close while its ACK is in flight", { timeout: 5000 }, async () => fixture(async (root, identity) => {
  const barrier = new WorkRestoreDraftBarrier(root), active = await barrier.begin({ workId: identity.workId, candidateId: identity.candidateId }, owner)
  const journal = new DraftJournal(root), releaseOwner = journal.activate("window"), coordinator = new DesktopSaveCoordinator({ checkpointDelayMs: null }), sessionId = randomUUID()
  const entered = Promise.withResolvers<void>(), releaseAck = Promise.withResolvers<void>(), snapshots: DraftSnapshot[] = [], replies: CloseReply[] = []
  let caches: unknown = { draft: "pre-restore cached author text" }, archived: unknown = caches, clears = 0
  const bridge = {
    readDraft: async () => null, markDraftReady: owner,
    persistDraft: async (_session: string, value: DraftSnapshot) => { const receipt = await journal.persist("window", value); snapshots.push(structuredClone(value)); return receipt },
    replyClose: async (_session: string, _id: string, reply: CloseReply) => { replies.push(reply); return true },
  } as unknown as DesktopBridge
  const session = new DesktopDraftSession(bridge, coordinator, {
    restore: () => () => { assert.equal(snapshots.length, 1); caches = null; clears++ },
    installSources: () => { const one = coordinator.registerSource("recovery", { read: () => ({ version: 1, items: [archived] }) }), two = coordinator.registerSource("chat", { read: () => caches }); return () => { one(); two() } },
    closing: () => {}, flushSettings: owner,
    restoreBarrier: { confirm: async receipt => {
      assert.equal(snapshots.length, 2); assert.equal(clears, 1)
      assert.equal(snapshots[0].sources.chat !== null, true); assert.equal(snapshots[1].sources.chat, null)
      assert.deepEqual(snapshots[1].sources.recovery, snapshots[0].sources.recovery)
      entered.resolve(); await releaseAck.promise
      await barrier.acknowledge(active.token, () => journal.confirm("window", receipt))
    } },
  })
  const init = session.initialize(sessionId)
  try {
    await entered.promise
    const close = session.handle({ type: "prepare-close", id: randomUUID(), sessionId, action: "flush", retryFailures: false })
    await new Promise(setImmediate); assert.equal(replies.length, 0); assert.equal((await barrier.inspect())?.token, active.token)
    releaseAck.resolve(); await init; await close
    assert.equal(await new WorkRestoreDraftBarrier(root).inspect(), null)
    assert.equal(replies[0]?.status, "saved")
  } finally { releaseAck.resolve(); await init.catch(() => {}); session.dispose(); releaseOwner() }
}))
