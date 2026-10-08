import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { createRootStartupBuffer, publishRootStartup, readRootStartup, waitRootStartup, RootStartupError, ROOT_STARTUP_BYTES } from "../../desktop/shared/root-startup"
import { startOwnedRoot } from "../../desktop/service/root-startup"
import { DataRootManager } from "../../desktop/core/data-root"
import { directoryIdentity } from "../../desktop/core/root-ownership"
const invalid = (error: unknown) => error instanceof RootStartupError && error.code === "ROOT_STARTUP_ENVELOPE_INVALID"
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "xuanxiang-root-envelope-"))), root = join(base, "root"), bootstrap = join(base, "boot")
  await mkdir(bootstrap)
  return { base, root, bootstrap, async close() { await rm(base, { recursive: true, force: true }) } }
}
async function readyRoot(root: string) {
  await mkdir(root)
  await writeFile(join(root, "xuanxiang-app.json"), JSON.stringify({ schemaVersion: 1, app: "Xuanxiangxiezuo-Desktop", id: randomUUID(), phase: "ready", inboxReady: true }))
}

test("ROOT11-U01 fresh barrier remains pending and is large enough for UTF8 path envelopes", () => {
  const buffer = createRootStartupBuffer()
  assert.equal(buffer.byteLength, ROOT_STARTUP_BYTES); assert.equal(readRootStartup(buffer), null)
  const words = new Int32Array(buffer, 0, 4), staged = new TextEncoder().encode('{"version":1,"status":"ready","root":"/未发布"}')
  new Uint8Array(buffer, 16).set(staged); Atomics.store(words, 1, 1); Atomics.store(words, 2, staged.length)
  assert.equal(readRootStartup(buffer), null, "bytes and length never authorize a root until status is atomically published")
})
test("ROOT11-U02 synchronous wait returns complete long UTF8 path after final publication", () => {
  const buffer = createRootStartupBuffer(), root = "/" + "作者".repeat(2047)
  const result = { version: 1, status: "ready", root } as const
  publishRootStartup(buffer, result)
  assert.deepEqual(waitRootStartup(buffer, 0), result); assert.deepEqual(readRootStartup(buffer), result)
  assert.ok(Atomics.load(new Int32Array(buffer, 0, 4), 2) > 4096, "envelope measures UTF8 bytes rather than path characters")
})
test("ROOT11-U03 safe failure envelope contains only code and rejects untrusted extras", () => {
  const buffer = createRootStartupBuffer()
  publishRootStartup(buffer, { version: 1, status: "failed", code: "JOURNAL_INVALID" })
  assert.deepEqual(waitRootStartup(buffer, 0), { version: 1, status: "failed", code: "JOURNAL_INVALID" })
  const unsafe = createRootStartupBuffer()
  assert.throws(() => publishRootStartup(unsafe, { version: 1, status: "failed", code: "JOURNAL_INVALID", cause: "sensitive key/path" } as never), invalid)
  assert.equal(readRootStartup(unsafe), null)
})
test("ROOT11-U04 already published envelope cannot be rewritten", () => {
  const buffer = createRootStartupBuffer(), result = { version: 1, status: "ready", root: "/canonical-root" } as const
  publishRootStartup(buffer, result)
  const snapshot = new Uint8Array(buffer).slice()
  assert.throws(() => publishRootStartup(buffer, { version: 1, status: "failed", code: "ROOT_STARTUP_FAILED" }), invalid)
  assert.deepEqual(new Uint8Array(buffer), snapshot); assert.deepEqual(readRootStartup(buffer), result)
})
test("ROOT11-U05 damaged headers, malformed UTF8 and contradictory payloads fail closed", () => {
  for (const [slot, bad] of [[0, 3], [1, 0], [2, -1], [2, ROOT_STARTUP_BYTES], [3, 1]]) {
    const buffer = createRootStartupBuffer(); publishRootStartup(buffer, { version: 1, status: "ready", root: "/root" })
    Atomics.store(new Int32Array(buffer, 0, 4), slot, bad); assert.throws(() => readRootStartup(buffer), invalid)
  }
  const corrupt = createRootStartupBuffer(); publishRootStartup(corrupt, { version: 1, status: "ready", root: "/root" })
  new Uint8Array(corrupt, 16, 1)[0] = 0xff; assert.throws(() => readRootStartup(corrupt), invalid)
  const mismatch = createRootStartupBuffer(); publishRootStartup(mismatch, { version: 1, status: "ready", root: "/root" })
  Atomics.store(new Int32Array(mismatch, 0, 4), 0, 2); assert.throws(() => readRootStartup(mismatch), invalid)
})
test("ROOT11-U06 invalid buffer, nonabsolute/oversized paths and unknown errors cannot publish success", () => {
  assert.throws(() => readRootStartup(new SharedArrayBuffer(4)), invalid)
  for (const root of ["relative/root", "/" + "a".repeat(4096), "/root\0bad"]) assert.throws(() => publishRootStartup(createRootStartupBuffer(), { version: 1, status: "ready", root }), invalid)
  assert.throws(() => publishRootStartup(createRootStartupBuffer(), { version: 1, status: "failed", code: "secret-key-unsafe" } as never), invalid)
})
test("ROOT11-U07 timeout does not mutate pending barrier or manufacture a fallback path", () => {
  const buffer = createRootStartupBuffer()
  assert.deepEqual(waitRootStartup(buffer, 0), { version: 1, status: "failed", code: "ROOT_STARTUP_TIMEOUT" })
  assert.equal(readRootStartup(buffer), null)
  for (const timeout of [-1, Infinity, NaN, 120001]) assert.throws(() => waitRootStartup(buffer, timeout), invalid)
})
test("ROOT11-U08 invalid journal prevents initialize callback entirely", async () => {
  const f = await fixture(); let opens = 0
  try {
    await writeFile(join(f.bootstrap, "root-migration.json"), JSON.stringify({ journal: {}, sha256: "bad" }))
    await assert.rejects(startOwnedRoot(f, async () => { opens++; return "db" }), error => error instanceof RootStartupError && error.code === "JOURNAL_INVALID")
    assert.equal(opens, 0); assert.deepEqual(await readdir(f.base), ["boot"])
  } finally { await f.close() }
})
test("ROOT11-U09 failing seed callback never adopts an initialized-looking root", async () => {
  const f = await fixture()
  try {
    await assert.rejects(startOwnedRoot(f, async root => { await readyRoot(root); throw Error("sensitive-key-in-seed-failure") }), error => error instanceof RootStartupError && error.message === "ROOT_INITIALIZATION_FAILED")
    assert.deepEqual(await readdir(f.bootstrap), [], "first pointer belongs after the entire original seed succeeds")
  } finally { await f.close() }
})
test("ROOT11-U10 even a typed failure with mutated message is normalized to its safe literal", async () => {
  const f = await fixture()
  try {
    const error = new RootStartupError("SOURCE_NOT_CLOSED"); error.message = "private filesystem path and API Key"
    await assert.rejects(startOwnedRoot(f, async () => { throw error }), caught => caught instanceof RootStartupError && caught.message === "SOURCE_NOT_CLOSED")
  } finally { await f.close() }
})
test("ROOT11-U11 changing pointer during initialization blocks ready without rewriting either root", async () => {
  const f = await fixture()
  try {
    await readyRoot(f.root); const manager = new DataRootManager(f.bootstrap, f.root), before = await manager.adopt(await directoryIdentity(f.root))
    const other = join(f.base, "other"); await readyRoot(other)
    const otherMarker = JSON.parse(await readFile(join(other, "xuanxiang-app.json"), "utf8"))
    const next = { ...before, revision: 2, rootId: otherMarker.id, root: await directoryIdentity(other) }
    await assert.rejects(startOwnedRoot(f, async root => { assert.equal(root, f.root); await writeFile(join(f.bootstrap, "data-root.json"), JSON.stringify(next)); return "db" }), error => error instanceof RootStartupError && error.code === "POINTER_CHANGED")
    assert.deepEqual(JSON.parse(await readFile(join(f.bootstrap, "data-root.json"), "utf8")), next)
  } finally { await f.close() }
})
test("ROOT11-U12 noncanonical bootstrap is rejected before Workspaces is permitted to open", async () => {
  const f = await fixture(); let opens = 0
  try {
    await assert.rejects(startOwnedRoot({ root: f.root, bootstrap: f.bootstrap + "/" }, async () => { opens++; return "db" }), error => error instanceof RootStartupError && error.code === "BOOTSTRAP_UNAVAILABLE")
    assert.equal(opens, 0); assert.deepEqual(await readdir(f.base), ["boot"])
  } finally { await f.close() }
})
