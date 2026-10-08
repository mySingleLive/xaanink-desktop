import assert from "node:assert/strict"
import { test } from "node:test"
import { CommentDraftStore, commentDraftKey, commentDraftStorageKey, commentDraftStoreFor } from "../../src/lib/comment-drafts"
import { installCommentDraftSource } from "../../src/lib/desktop/comment-draft-source"
import { DesktopSaveCoordinator } from "../../src/lib/desktop/save-coordinator"
import { DesktopRecoveryStore, restoreDesktopDraft } from "../../src/lib/desktop/draft-recovery"
function fixture() { const accountId = crypto.randomUUID(), map = new Map<string,string>(), reads: string[] = [], storage = { getItem(key: string) { reads.push(key); return map.get(key) ?? null }, setItem(key: string, value: string) { map.set(key, value) }, removeItem(key: string) { map.delete(key) } }; return { accountId, map, reads, storage } }
const target = { novelId: "n1", targetType: "CHAPTER_CONTENT", targetId: "c1" }, anchor = { quote: "原文", startOffset: 2, endOffset: 4, prefix: "前", suffix: "后" }
function row() { return { key: commentDraftKey(target, anchor, "thread1"), target, anchor, threadId: "thread1", content: "尚未发布的评论", updatedAt: 100 } }
test("REC51-C01: snapshot owns the same comment store as UI, retains full anchor/thread identity and emits source changes", () => {
  const f = fixture(), coordinator = new DesktopSaveCoordinator({ checkpointDelayMs: null }), release = installCommentDraftSource(coordinator, f.accountId, f.storage), store = commentDraftStoreFor(f.accountId, () => f.storage)!
  try { const before = coordinator.exportSnapshot().revision; store.set(target, anchor, "thread1", "尚未发布"); const source = coordinator.exportSnapshot().sources.comments as { accountId: string; rows: Array<ReturnType<typeof row>> }; assert.equal(source.accountId, f.accountId); assert.equal(source.rows.length, 1); assert.deepEqual(source.rows[0].anchor, anchor); assert.equal(source.rows[0].threadId, "thread1"); assert.equal(source.rows[0].key, commentDraftKey(target, anchor, "thread1")); assert.ok(coordinator.exportSnapshot().revision > before); assert.ok(f.reads.every(key => key === commentDraftStorageKey(f.accountId))) } finally { release() }
})
test("REC51-C02: restore writes only owned comment key and preserves original timestamp/anchor without publication", async () => {
  const f = fixture(), recovery = new DesktopRecoveryStore(), saved = row(), snapshot = { version: 1 as const, revision: 1, createdAt: "2026-10-07T00:00:00Z", autosaves: [], sources: { comments: { accountId: f.accountId, rows: [saved] } }, issues: [] }, originalFetch = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw Error("no publication") }
  try { const result = await restoreDesktopDraft(snapshot, { restoreSession: true, accountId: f.accountId, storage: f.storage, recovery, verifyTarget: () => true }); assert.equal(result.applied.comments, 1); assert.deepEqual(JSON.parse(f.map.get(commentDraftStorageKey(f.accountId))!), [saved]); assert.deepEqual(commentDraftStoreFor(f.accountId, () => f.storage)?.snapshot(), [saved]); assert.equal(calls, 0) } finally { globalThis.fetch = originalFetch }
})
test("REC51-C03: invalid key/other account/unavailable target are retained with no implicit identity normalization", async () => {
  for (const kind of ["key", "owner", "target"]) { const f = fixture(), recovery = new DesktopRecoveryStore(), saved = { ...row(), ...(kind === "key" ? { key: "wrong" } : {}) }, snapshot = { version: 1 as const, revision: 1, createdAt: "2026-10-07T00:00:00Z", autosaves: [], sources: { comments: { accountId: kind === "owner" ? "other" : f.accountId, rows: [saved] } }, issues: [] }
    const result = await restoreDesktopDraft(snapshot, { restoreSession: true, accountId: f.accountId, storage: f.storage, recovery, verifyTarget: () => kind !== "target" }); assert.equal(result.applied.comments, 0); assert.equal(result.retained, 1); assert.equal(f.map.has(commentDraftStorageKey(f.accountId)), false); assert.ok(JSON.stringify(recovery.read()).includes(saved.content))
  }
})
test("REC51-C04: persistence failure keeps recoverable input and cannot announce successful restoration", async () => {
  const f = fixture(), recovery = new DesktopRecoveryStore(), snapshot = { version: 1 as const, revision: 1, createdAt: "2026-10-07T00:00:00Z", autosaves: [], sources: { comments: { accountId: f.accountId, rows: [row()] } }, issues: [] }
  const result = await restoreDesktopDraft(snapshot, { restoreSession: true, accountId: f.accountId, storage: { ...f.storage, setItem() { throw Error("disk quota") } }, recovery, verifyTarget: () => true }); assert.equal(result.applied.comments, 0); assert.equal(result.retained, 1); assert.ok(JSON.stringify(recovery.read()).includes(row().content))
})
test("REC51-C05: current conflicting comment remains visible and recovery keeps older incoming input; independent snapshots cannot mutate store", () => {
  const f = fixture(), store = new CommentDraftStore(f.accountId, () => f.storage); store.set(target, anchor, "thread1", "当前新的未发布输入"); const result = store.restore([row()]); assert.equal(store.get(row().key), "当前新的未发布输入"); assert.equal(result.retained.length, 1); const before = store.snapshot(); before[0].content = "mutated"; assert.equal(store.get(row().key), "当前新的未发布输入")
})
test("REC51-C06: unreadable owned comment storage blocks acknowledgement and preserves the original bytes", async () => {
  const f = fixture(), coordinator = new DesktopSaveCoordinator({ checkpointDelayMs: null }); f.map.set(commentDraftStorageKey(f.accountId), "broken original"); const release = installCommentDraftSource(coordinator, f.accountId, f.storage); let writes = 0; coordinator.configurePersistence(async () => { writes++ })
  try { await assert.rejects(coordinator.checkpointDrafts(), { code: "DRAFT_SOURCE_UNREADABLE" }); assert.equal(writes, 0); assert.equal(f.map.get(commentDraftStorageKey(f.accountId)), "broken original"); assert.ok(coordinator.exportSnapshot().issues.some(issue => issue.source === "comments")) } finally { release() }
})
