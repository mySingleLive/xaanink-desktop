import assert from "node:assert/strict"
import { test } from "node:test"
import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, readFile, writeFile, rename, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { DraftJournal, validateDraftSnapshot } from "../../desktop/main/draft-journal"
import type { DraftSnapshot } from "../../desktop/shared/drafts"
import { CommitDurabilityError } from "../../desktop/core/versioned-store"

function snapshot(revision = 1): DraftSnapshot {
  return { version: 1, revision, createdAt: new Date().toISOString(), autosaves: [{ id: randomUUID(), draft: { text: "本地待恢复草稿" } }], sources: { chat: { draft: "本地草稿" } }, issues: [] }
}
test("J51-01: a file replacement after rename but before directory sync cannot be acknowledged as the written snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-j51-file-"))
  let replaced: DraftSnapshot | undefined
  const journal = new DraftJournal(root, { beforeDirectorySync: async () => {
    const record = JSON.parse(await readFile(join(root, "drafts.json"), "utf8"))
    record.snapshot.sources.chat = { draft: "外部待恢复修改" }
    record.digest = createHash("sha256").update(JSON.stringify(record.snapshot)).digest("hex")
    replaced = record.snapshot
    const other = join(root, "external-replacement.json")
    await writeFile(other, JSON.stringify(record), { mode: 0o600 }); await rename(other, join(root, "drafts.json"))
  } })
  const release = journal.activate("window-a")
  try {
    await assert.rejects(journal.persist("window-a", snapshot()), /变化|校验|保存|确认/)
    assert.deepEqual(await journal.read(), replaced)
  } finally { release(); await rm(root, { recursive: true, force: true }) }
})
test("J51-02: changing the owned root after rename cannot return a durability acknowledgment from a different directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-j51-root-")), moved = root + "-moved"
  const journal = new DraftJournal(root, { beforeDirectorySync: async () => { await rename(root, moved); await mkdir(root) } })
  const release = journal.activate("window-a"), input = snapshot()
  try {
    await assert.rejects(journal.persist("window-a", input), /目录|变化|保存|确认/)
    assert.deepEqual(JSON.parse(await readFile(join(moved, "drafts.json"), "utf8")).snapshot, input)
    await assert.rejects(journal.read(), /目录|变化/)
  } finally { release(); await rm(root, { recursive: true, force: true }); await rm(moved, { recursive: true, force: true }) }
})
test("J51-03: deferred root validation must reject a later operation without an unhandled constructor rejection", () => {
  const moduleUrl = new URL("../../desktop/main/draft-journal.ts", import.meta.url).href
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    const module = await import(${JSON.stringify(moduleUrl)});
    const Journal = module.DraftJournal ?? module.default.DraftJournal;
    const journal = new Journal(${JSON.stringify(join(tmpdir(), "xuanxiang-missing-" + randomUUID()))});
    await new Promise(resolve => setTimeout(resolve, 30));
    try { await journal.read(); process.exitCode=2 } catch { process.exitCode=0 }
  `], { encoding: "utf8", timeout: 10000 })
  assert.equal(child.status, 0, child.stderr)
})
test("J51-04: owner revocation after physical rename must reject the old call and preserve an inert recovery snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-j51-owner-"))
  let journal!: DraftJournal
  journal = new DraftJournal(root, { beforeDirectorySync: async () => { journal.activate("window-b") } })
  const release = journal.activate("window-a"), input = snapshot()
  try { await assert.rejects(journal.persist("window-a", input), /窗口/); assert.deepEqual(await journal.read(), input) }
  finally { release(); await rm(root, { recursive: true, force: true }) }
})
test("J51-05: restoring an older acknowledged envelope cannot bypass an unresolved directory-sync failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-j51-uncertain-"))
  let fail = false, syncs = 0
  const journal = new DraftJournal(root, { beforeDirectorySync: async () => { syncs++; if (fail) throw Error("controlled sync failure") } })
  const release = journal.activate("window-a"), original = snapshot()
  try {
    await journal.persist("window-a", original)
    const firstBytes = await readFile(join(root, "drafts.json"), "utf8")
    fail = true; await assert.rejects(journal.persist("window-a", snapshot(2)), CommitDurabilityError)
    await writeFile(join(root, "drafts.json"), firstBytes)
    await assert.rejects(journal.persist("window-a", original), CommitDurabilityError)
    assert.equal(syncs, 3)
    assert.deepEqual(await journal.read(), original)
  } finally { release(); await rm(root, { recursive: true, force: true }) }
})
test("J51-06: a queued close confirmation cannot cross a same-ID owner reactivation while it waits", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-j51-confirm-"))
  let blocked = false, reached!: () => void, unblock!: () => void
  const boundary = new Promise<void>(resolve => { reached = resolve }), gate = new Promise<void>(resolve => { unblock = resolve })
  const journal = new DraftJournal(root, { beforeRename: async () => { if (blocked) { reached(); await gate } } })
  const release = journal.activate("window-a")
  try {
    const first = snapshot(), receipt = await journal.persist("window-a", first)
    blocked = true
    const writing = journal.persist("window-a", snapshot(2)), writeRejected = assert.rejects(writing, /窗口/)
    await boundary
    const confirmation = journal.confirm("window-a", receipt), rejected = assert.rejects(confirmation, /确认|窗口/)
    journal.activate("window-a"); unblock()
    await writeRejected; await rejected; assert.deepEqual(await journal.read(), first)
  } finally { unblock(); release(); await rm(root, { recursive: true, force: true }) }
})
test("J51-07: partial export accepts workspace/recovery/UUID diagnostics but cannot overwrite complete recovery data", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-j51-sources-")), journal = new DraftJournal(root), release = journal.activate("window-a")
  try {
    const before = snapshot(), receipt = await journal.persist("window-a", before)
    const partial = { ...snapshot(2), sources: { workspace: { tabs: ["content"] }, recovery: { preserved: true } }, issues: [{ source: randomUUID(), code: "DRAFT_SOURCE_UNREADABLE" as const }] }
    const validated = validateDraftSnapshot(partial)
    assert.deepEqual(validated, partial)
    partial.sources.workspace.tabs.push("changed-after-validation")
    assert.deepEqual(validated.sources.workspace, { tabs: ["content"] })
    await assert.rejects(journal.persist("window-a", validated), /读取/)
    assert.deepEqual(await journal.read(), before); await journal.confirm("window-a", receipt)
    assert.throws(() => validateDraftSnapshot({ ...partial, issues: [{ source: "unregistered-name", code: "DRAFT_SOURCE_UNREADABLE" }] }))
  } finally { release(); await rm(root, { recursive: true, force: true }) }
})
