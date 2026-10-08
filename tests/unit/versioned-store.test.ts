import assert from "node:assert/strict"
import { mock, test } from "node:test"
import crypto from "node:crypto"
import { syncBuiltinESMExports } from "node:module"
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { CommitDurabilityError, RevisionConflict, VersionedStore } from "../../desktop/core/versioned-store"

const schema = z.object({ penName: z.string().min(1), theme: z.enum(["paper", "ink", "system"]) }).strict()
const defaults = { penName: "作者", theme: "paper" as const }
async function fixture(run: (path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-settings-"))
  try { await run(join(root, "settings.json")) } finally { await rm(root, { recursive: true, force: true }) }
}

test("DESK-S08: acknowledged settings survive a fresh repository and detached reads cannot mutate state", () => fixture(async path => {
  const first = new VersionedStore(path, defaults, schema.parse)
  const state = await first.read(); state.value.penName = "not saved"
  assert.equal((await first.read()).value.penName, "作者")
  const saved = await first.update(0, { penName: "云客", theme: "ink" })
  assert.equal(saved.revision, 1)
  const second = new VersionedStore(path, defaults, schema.parse)
  assert.deepEqual(await second.read(), saved)
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { schemaVersion: 1, ...saved })
}))

test("DESK-S08: two edits based on one revision cannot silently overwrite each other", () => fixture(async path => {
  const store = new VersionedStore(path, defaults, schema.parse)
  const results = await Promise.allSettled([
    store.update(0, { penName: "甲", theme: "ink" }), store.update(0, { penName: "乙", theme: "system" }),
  ])
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1)
  const failed = results.find(r => r.status === "rejected") as PromiseRejectedResult
  assert.ok(failed.reason instanceof RevisionConflict)
  assert.deepEqual((await store.read()).value, { penName: "甲", theme: "ink" })
}))

test("DESK-S08: failed replacement leaves prior durable state and revision authoritative", () => fixture(async path => {
  let fail = false
  const store = new VersionedStore(path, defaults, schema.parse, { beforeRename: async () => { if (fail) throw new Error("disk fixture") } })
  const saved = await store.update(0, { penName: "旧稿", theme: "paper" })
  const before = await readFile(path, "utf8")
  fail = true
  await assert.rejects(store.update(1, { penName: "新稿", theme: "ink" }), /disk fixture/)
  assert.deepEqual(await store.read(), saved)
  assert.equal(await readFile(path, "utf8"), before)
  assert.deepEqual(await readdir(join(path, "..")), ["settings.json"])
  fail = false
  assert.equal((await store.update(1, { penName: "恢复", theme: "system" })).revision, 2)
}))

test("DESK-G03: corrupt/unknown schema data never silently becomes default settings", () => fixture(async path => {
  for (const text of ["{broken", JSON.stringify({ schemaVersion: 99, revision: 3, value: defaults }), JSON.stringify({ schemaVersion: 1, revision: -1, value: defaults })]) {
    await writeFile(path, text)
    await assert.rejects(new VersionedStore(path, defaults, schema.parse).read())
    assert.equal(await readFile(path, "utf8"), text)
  }
}))

test("DESK-S08: invalid draft is rejected without modifying stored values", () => fixture(async path => {
  const store = new VersionedStore(path, defaults, schema.parse)
  await assert.rejects(store.update(0, { penName: "", theme: "paper" }))
  assert.deepEqual(await store.read(), { revision: 0, value: defaults })
}))

test("DESK-S08: failure after rename reports committed state; reread and retry use the new revision", () => fixture(async path => {
  let fail = false
  const store = new VersionedStore(path, defaults, schema.parse, { beforeDirectorySync: async () => { if (fail) throw new Error("directory sync failed") } })
  await store.update(0, { penName: "旧", theme: "paper" }); fail = true
  await assert.rejects(store.update(1, { penName: "新", theme: "ink" }), error => error instanceof CommitDurabilityError && error.committed)
  assert.deepEqual(await store.read(), { revision: 2, value: { penName: "新", theme: "ink" } })
  assert.equal(JSON.parse(await readFile(path, "utf8")).revision, 2)
  assert.deepEqual(await readdir(join(path, "..")), ["settings.json"])
  fail = false
  await assert.rejects(store.update(1, { penName: "陈旧", theme: "paper" }), RevisionConflict)
  assert.equal((await store.update(2, { penName: "确认", theme: "ink" })).revision, 3)
}))

test("DESK-S08: failure to exclusively create a temp file must not delete another file", () => fixture(async path => {
  const store = new VersionedStore(path, defaults, schema.parse)
  const saved = await store.update(0, { penName: "原始", theme: "paper" })
  const temporary = join(path, "..", ".00000000-0000-4000-8000-000000000000.tmp")
  await writeFile(temporary, "foreign fixture content")
  const fixed = mock.method(crypto, "randomUUID", () => "00000000-0000-4000-8000-000000000000")
  syncBuiltinESMExports()
  try {
    await assert.rejects(store.update(1, { penName: "新", theme: "ink" }), { code: "EEXIST" })
    assert.equal(await readFile(temporary, "utf8"), "foreign fixture content")
    assert.deepEqual(await store.read(), saved)
  } finally { fixed.mock.restore(); syncBuiltinESMExports() }
}))
