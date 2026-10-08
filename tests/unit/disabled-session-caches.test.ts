import assert from "node:assert/strict"
import { test } from "node:test"
import { restoreDesktopDraft, DesktopRecoveryStore } from "../../src/lib/desktop/draft-recovery"
import { WorkspaceDraftSource } from "../../src/lib/desktop/workspace-draft-source"
import { DesktopSaveCoordinator } from "../../src/lib/desktop/save-coordinator"
import { installDesktopDraftSources } from "../../src/lib/desktop/draft-sources"
import { installRecoveryDraftSource } from "../../src/lib/desktop/draft-recovery"
import { installCommentDraftSource } from "../../src/lib/desktop/comment-draft-source"
import { ChatSessionRepository, chatSessionKey, emptyChatSession } from "../../src/lib/chat-session"
import { commentDraftStoreFor, commentDraftStorageKey } from "../../src/lib/comment-drafts"
import { useChatStore } from "../../src/stores/chat"
import { useSceneUiStore } from "../../src/stores/scene-ui"
import { useStagedChangesStore } from "../../src/stores/staged-changes"
import { useTabsStore } from "../../src/stores/tabs"
function fixture() {
  const accountId = crypto.randomUUID(), map = new Map<string,string>(), writes: string[] = [], reads: string[] = [], storage = { getItem(key: string) { reads.push(key); return map.get(key) ?? null }, setItem(key: string, value: string) { writes.push(key); map.set(key, value) }, removeItem(key: string) { map.delete(key) } }, saved = { ...emptyChatSession(), draft: "旧聊天不应自动打开" }; new ChatSessionRepository(accountId, storage).save(saved)
  const scene = useSceneUiStore.getState(), staged = useStagedChangesStore.getState(), tabs = useTabsStore.getState(), chat = useChatStore.getState()
  useSceneUiStore.setState({ drafts: {}, imageDrafts: { [`${accountId}:n:s:exterior`]: { prompt: "旧图像输入", modelId: "old" } }, imageRequests: {}, submissions: {}, commitErrors: {}, action: null, reference: null }); useStagedChangesStore.setState({ batches: {}, chips: [] }); useTabsStore.setState({ tabs: [], activeTabId: null, subTabs: {}, panelFocus: null }); useChatStore.setState({ accountId })
  const recovery = new DesktopRecoveryStore(), workspace = new WorkspaceDraftSource(), options = { restoreSession: false, accountId, storage, recovery, workspace }; map.set("foreign-cache", "not owned")
  const comment = commentDraftStoreFor(accountId, () => storage)!; comment.set({ novelId: "n", targetType: "CHAPTER_CONTENT", targetId: "c" }, undefined, undefined, "旧评论输入")
  return { accountId, map, writes, reads, storage, saved, comment, recovery, workspace, options, dispose() { useSceneUiStore.setState(scene); useStagedChangesStore.setState(staged); useTabsStore.setState(tabs); useChatStore.setState(chat) } }
}
test("REC51-D01: no journal still archives owned old caches; they change only after caller durable ACK", async () => {
  const f = fixture()
  try { const result = await restoreDesktopDraft(null, f.options); assert.equal(result.requiresCheckpoint, true); assert.equal(new ChatSessionRepository(f.accountId, f.storage).read().entry?.draft, f.saved.draft); assert.ok(f.comment.snapshot().length); assert.ok(Object.keys(useSceneUiStore.getState().imageDrafts).length); assert.ok(JSON.stringify(f.recovery.read()).includes("旧评论输入")); assert.ok(JSON.stringify(f.recovery.read()).includes("旧图像输入")); result.afterCheckpoint?.(); assert.equal(new ChatSessionRepository(f.accountId, f.storage).read().entry?.draft, ""); assert.equal(f.comment.snapshot().length, 0); assert.deepEqual(useSceneUiStore.getState().imageDrafts, {}); assert.equal(f.map.get("foreign-cache"), "not owned"); assert.ok(f.reads.every(key => [chatSessionKey(f.accountId), commentDraftStorageKey(f.accountId)].includes(key))) } finally { f.dispose() }
})
test("REC51-D02: newer cache input invalidates the entire reset before any old input is cleared", async () => {
  const f = fixture()
  try { const result = await restoreDesktopDraft(null, f.options); f.comment.set({ novelId: "n", targetType: "CHAPTER_CONTENT", targetId: "c" }, undefined, undefined, "新增不能清"); assert.throws(() => result.afterCheckpoint?.(), /DRAFT_CHANGED_DURING_RECOVERY/); assert.equal(new ChatSessionRepository(f.accountId, f.storage).read().entry?.draft, f.saved.draft); assert.equal(f.comment.snapshot()[0].content, "新增不能清"); assert.ok(Object.keys(useSceneUiStore.getState().imageDrafts).length) } finally { f.dispose() }
})
test("REC51-D03: first checkpoint retains broken owned comment bytes and second checkpoint records fresh state without repeating old archives", async () => {
  const f = fixture(), coordinator = new DesktopSaveCoordinator({ checkpointDelayMs: null }), releases: Array<() => void> = [], snapshots: unknown[] = []; f.map.set(commentDraftStorageKey(f.accountId), "broken original comment")
  try { const result = await restoreDesktopDraft(null, f.options); releases.push(installDesktopDraftSources(coordinator, f.storage), installRecoveryDraftSource(coordinator, f.recovery), installCommentDraftSource(coordinator, f.accountId, f.storage)); coordinator.configurePersistence(async snapshot => { snapshots.push(snapshot) }); await coordinator.checkpointDrafts(); assert.equal(snapshots.length, 1); assert.ok(JSON.stringify(snapshots[0]).includes("broken original comment")); assert.equal(f.map.get(commentDraftStorageKey(f.accountId)), "broken original comment"); result.afterCheckpoint?.(); await coordinator.checkpointDrafts(); assert.equal(snapshots.length, 2); assert.equal(f.map.get(commentDraftStorageKey(f.accountId)), "[]"); assert.equal(f.comment.snapshot().length, 0); const retained = f.recovery.read(); result.afterCheckpoint?.(); assert.deepEqual(f.recovery.read(), retained) } finally { for (const release of releases.reverse()) release(); f.dispose() }
})
test("REC51-D04: aborting an archived old owner forbids later cache clearing even after persistence completed", async () => {
  const f = fixture(), controller = new AbortController()
  try { const result = await restoreDesktopDraft(null, { ...f.options, signal: controller.signal }); controller.abort(); assert.throws(() => result.afterCheckpoint?.(), { name: "AbortError" }); assert.equal(new ChatSessionRepository(f.accountId, f.storage).read().entry?.draft, f.saved.draft); assert.ok(f.comment.snapshot().length) } finally { f.dispose() }
})
test("REC51-D05: repeated failed startup capture deduplicates unchanged copies but retains a changed later cache", async () => {
  const f = fixture()
  try { await restoreDesktopDraft(null, f.options); const first = f.recovery.read().items.length; await new Promise(resolve => setTimeout(resolve, 2)); await restoreDesktopDraft(null, f.options); assert.equal(f.recovery.read().items.length, first); new ChatSessionRepository(f.accountId, f.storage).save({ ...f.saved, draft: "再次启动前的新缓存" }); await restoreDesktopDraft(null, f.options); assert.equal(f.recovery.read().items.length, first + 1); assert.ok(JSON.stringify(f.recovery.read()).includes("再次启动前的新缓存")); assert.ok(JSON.stringify(f.recovery.read()).includes(f.saved.draft)) } finally { f.dispose() }
})
