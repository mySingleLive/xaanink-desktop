import assert from "node:assert/strict"
import { test } from "node:test"

// Initialize a real Zustand persist adapter against an isolated localStorage
// before importing its stores. No browser, disk or user storage is involved.
const local = new Map<string, string>()
const localStorage = { get length() { return local.size }, key: (index: number) => [...local.keys()][index] ?? null, clear() { local.clear() }, getItem: (key: string) => local.get(key) ?? null, setItem(key: string, value: string) { local.set(key, value) }, removeItem(key: string) { local.delete(key) } }
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: localStorage })
Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } })
const { restoreDesktopDraft, DesktopRecoveryStore, installRecoveryDraftSource } = require("../../src/lib/desktop/draft-recovery") as typeof import("../../src/lib/desktop/draft-recovery")
const { WorkspaceDraftSource } = require("../../src/lib/desktop/workspace-draft-source") as typeof import("../../src/lib/desktop/workspace-draft-source")
const { DesktopSaveCoordinator } = require("../../src/lib/desktop/save-coordinator") as typeof import("../../src/lib/desktop/save-coordinator")
const { installDesktopDraftSources } = require("../../src/lib/desktop/draft-sources") as typeof import("../../src/lib/desktop/draft-sources")
const { installCommentDraftSource } = require("../../src/lib/desktop/comment-draft-source") as typeof import("../../src/lib/desktop/comment-draft-source")
const { chatSessionKey, emptyChatSession, ChatSessionRepository } = require("../../src/lib/chat-session") as typeof import("../../src/lib/chat-session")
const { commentDraftStoreFor, commentDraftStorageKey } = require("../../src/lib/comment-drafts") as typeof import("../../src/lib/comment-drafts")
const { useChatStore } = require("../../src/stores/chat") as typeof import("../../src/stores/chat")
const { useSceneUiStore } = require("../../src/stores/scene-ui") as typeof import("../../src/stores/scene-ui")
const { useStagedChangesStore } = require("../../src/stores/staged-changes") as typeof import("../../src/stores/staged-changes")
const { useTabsStore } = require("../../src/stores/tabs") as typeof import("../../src/stores/tabs")

function fixture() {
  const accountId = crypto.randomUUID(), foreign = crypto.randomUUID(), session = new Map<string, string>()
  let failClear = false
  const storage = { getItem: (key: string) => session.get(key) ?? null, setItem(key: string, value: string) { if (failClear && key === commentDraftStorageKey(accountId) && value === "[]") { failClear = false; throw Error("quota") } session.set(key, value) }, removeItem(key: string) { session.delete(key) } }
  const before = { chat: useChatStore.getState(), scene: useSceneUiStore.getState(), staged: useStagedChangesStore.getState(), tabs: useTabsStore.getState() }
  const old = { ...emptyChatSession(), draft: "首个ACK前不能清的聊天" }
  new ChatSessionRepository(accountId, storage).save(old)
  useChatStore.setState({ accountId, draftId: old.draftId, draft: old.draft, conversationId: null, draftNovelId: null, pendingNovelTitle: null, pendingNovelPosition: null, pendingRequest: null, queuedMessages: [], draftAction: null, modelChoice: { modelId: null, effort: null }, modelChoiceExplicit: false, mode: "standard", modeExplicit: false })
  useSceneUiStore.setState({ drafts: {}, imageDrafts: { [`${accountId}:n:s:exterior`]: { prompt: "本地未发送图像稿", modelId: "deleted" }, [`${foreign}:n:s:exterior`]: { prompt: "异账号保留", modelId: "foreign" } }, imageRequests: {}, submissions: {}, commitErrors: {}, action: null, reference: null })
  useStagedChangesStore.setState({ batches: {}, chips: [], sendRequest: null }); useTabsStore.setState({ tabs: [], activeTabId: null, subTabs: {}, panelFocus: null })
  const comments = commentDraftStoreFor(accountId, () => storage)!
  comments.set({ novelId: "n", targetType: "CHAPTER_CONTENT", targetId: "c" }, undefined, undefined, "首个ACK前不能清的评论")
  session.set(chatSessionKey(foreign), "foreign bytes"); session.set(commentDraftStorageKey(foreign), "foreign comments")
  const recovery = new DesktopRecoveryStore(), workspace = new WorkspaceDraftSource()
  return { accountId, foreign, session, storage, comments, old, recovery, workspace, failNextCommentClear() { failClear = true },
    options: { restoreSession: false, accountId, storage, recovery, workspace },
    dispose() { useChatStore.setState(before.chat); useSceneUiStore.setState(before.scene); useStagedChangesStore.setState(before.staged); useTabsStore.setState(before.tabs) },
  }
}

test("REC54-D01: the first durable ACK archives session/local caches before clearing; the second records fresh state without touching foreign bytes", async () => {
  const f = fixture(), coordinator = new DesktopSaveCoordinator({ checkpointDelayMs: null }), releases: Array<() => void> = []
  let ack!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { ack = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  try {
    const summary = await restoreDesktopDraft(null, f.options), oldChat = f.session.get(chatSessionKey(f.accountId)), oldComment = f.session.get(commentDraftStorageKey(f.accountId)), oldScene = local.get("scene-workspace-v1")
    assert.ok(oldScene?.includes("本地未发送图像稿"), "exercise the real isolated Zustand localStorage persistence")
    releases.push(installDesktopDraftSources(coordinator, f.storage), installRecoveryDraftSource(coordinator, f.recovery), installCommentDraftSource(coordinator, f.accountId, f.storage))
    const snapshots: unknown[] = []
    coordinator.configurePersistence(async snapshot => { snapshots.push(structuredClone(snapshot)); if (snapshots.length === 1) { entered(); await gate } })
    const first = coordinator.checkpointDrafts(); await started
    assert.equal(f.session.get(chatSessionKey(f.accountId)), oldChat); assert.equal(f.session.get(commentDraftStorageKey(f.accountId)), oldComment); assert.equal(local.get("scene-workspace-v1"), oldScene)
    assert.ok(JSON.stringify(snapshots[0]).includes(f.old.draft)); assert.ok(JSON.stringify(snapshots[0]).includes("首个ACK前不能清的评论")); assert.ok(JSON.stringify(snapshots[0]).includes("本地未发送图像稿"))
    ack(); await first; summary.afterCheckpoint?.(); await coordinator.checkpointDrafts()
    assert.equal(new ChatSessionRepository(f.accountId, f.storage).read().entry?.draft, "")
    assert.equal(f.comments.snapshot().length, 0); assert.equal(f.session.get(commentDraftStorageKey(f.accountId)), "[]")
    assert.equal(Object.keys(useSceneUiStore.getState().imageDrafts).filter(key => key.startsWith(f.accountId + ":")).length, 0)
    assert.ok(local.get("scene-workspace-v1")?.includes("异账号保留")); assert.equal(local.get("scene-workspace-v1")?.includes("本地未发送图像稿"), false)
    assert.equal(f.session.get(chatSessionKey(f.foreign)), "foreign bytes"); assert.equal(f.session.get(commentDraftStorageKey(f.foreign)), "foreign comments")
    assert.equal(snapshots.length, 2); assert.ok(JSON.stringify(snapshots[1]).includes(f.old.draft), "old data remains in the recovery archive")
  } finally { ack?.(); for (const release of releases.reverse()) release(); f.dispose() }
})

test("REC54-D02: an empty-text explicit old model/mode selection is reset after archive ACK and cannot leak into the fresh active journal", async () => {
  const f = fixture(), coordinator = new DesktopSaveCoordinator({ checkpointDelayMs: null }), releases: Array<() => void> = []
  try {
    const choice = { modelId: "revoked-old-model", effort: "high" }
    useChatStore.setState({ draft: "", modelChoice: choice, modelChoiceExplicit: true, mode: "plan", modeExplicit: true })
    new ChatSessionRepository(f.accountId, f.storage).save({ ...f.old, draft: "", modelChoice: choice, modelChoiceExplicit: true, mode: "plan", modeExplicit: true })
    const summary = await restoreDesktopDraft(null, f.options)
    releases.push(installDesktopDraftSources(coordinator, f.storage), installRecoveryDraftSource(coordinator, f.recovery), installCommentDraftSource(coordinator, f.accountId, f.storage))
    coordinator.configurePersistence(async () => {}); await coordinator.checkpointDrafts(); summary.afterCheckpoint?.(); await coordinator.checkpointDrafts()
    const current = useChatStore.getState(), source = coordinator.exportSnapshot().sources.chat as { active: { modelChoice: unknown; modelChoiceExplicit?: boolean; mode?: string; modeExplicit?: boolean } }
    assert.deepEqual(current.modelChoice, { modelId: null, effort: null }); assert.equal(current.modelChoiceExplicit, false); assert.equal(current.mode, "standard"); assert.equal(current.modeExplicit, false)
    assert.deepEqual(source.active.modelChoice, { modelId: null, effort: null }); assert.equal(source.active.modelChoiceExplicit, false); assert.equal(source.active.mode, "standard"); assert.equal(source.active.modeExplicit, false)
    assert.ok(JSON.stringify(f.recovery.read()).includes("revoked-old-model"), "discard preference does not destroy old selection metadata before the durable archive")
  } finally { for (const release of releases.reverse()) release(); f.dispose() }
})

test("REC54-D03: a partial cache-clear write failure preserves the archive and retries remaining stages without dropping any foreign cache", async () => {
  const f = fixture()
  try {
    const summary = await restoreDesktopDraft(null, f.options), archive = f.recovery.read()
    f.failNextCommentClear(); assert.throws(() => summary.afterCheckpoint?.(), /quota/)
    assert.ok(f.comments.snapshot().some(row => row.content.includes("不能清的评论")))
    assert.ok(useSceneUiStore.getState().imageDrafts[`${f.accountId}:n:s:exterior`])
    assert.deepEqual(f.recovery.read(), archive)
    summary.afterCheckpoint?.(); summary.afterCheckpoint?.()
    assert.equal(f.comments.snapshot().length, 0); assert.equal(useSceneUiStore.getState().imageDrafts[`${f.accountId}:n:s:exterior`], undefined)
    assert.equal(f.session.get(chatSessionKey(f.foreign)), "foreign bytes"); assert.equal(f.session.get(commentDraftStorageKey(f.foreign)), "foreign comments")
    assert.deepEqual(f.recovery.read(), archive)
  } finally { f.dispose() }
})

test("REC54-D04: newer persisted scene input during the archive write invalidates all cleanup before any chat/comment cache is cleared", async () => {
  const f = fixture(), coordinator = new DesktopSaveCoordinator({ checkpointDelayMs: null }), releases: Array<() => void> = []
  let ack!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { ack = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  try {
    const summary = await restoreDesktopDraft(null, f.options), chat = f.session.get(chatSessionKey(f.accountId)), comment = f.session.get(commentDraftStorageKey(f.accountId))
    releases.push(installDesktopDraftSources(coordinator, f.storage), installRecoveryDraftSource(coordinator, f.recovery), installCommentDraftSource(coordinator, f.accountId, f.storage))
    let writes = 0; coordinator.configurePersistence(async () => { if (++writes === 1) { entered(); await gate } })
    const first = coordinator.checkpointDrafts(); await started
    useSceneUiStore.getState().setImageDraft(`${f.accountId}:n:s:exterior`, { prompt: "ACK期间更新的输入", modelId: "new" })
    ack(); await first
    assert.throws(() => summary.afterCheckpoint?.(), /DRAFT_CHANGED_DURING_RECOVERY/)
    assert.equal(f.session.get(chatSessionKey(f.accountId)), chat); assert.equal(f.session.get(commentDraftStorageKey(f.accountId)), comment)
    assert.equal(useSceneUiStore.getState().imageDrafts[`${f.accountId}:n:s:exterior`].prompt, "ACK期间更新的输入")
    assert.ok(local.get("scene-workspace-v1")?.includes("ACK期间更新的输入"))
  } finally { ack?.(); for (const release of releases.reverse()) release(); f.dispose() }
})

test("REC54-D05: a rejected first archive writer cannot authorize any session or persisted scene cleanup", async () => {
  const f = fixture(), coordinator = new DesktopSaveCoordinator({ checkpointDelayMs: null }), releases: Array<() => void> = []
  try {
    const summary = await restoreDesktopDraft(null, f.options), chat = f.session.get(chatSessionKey(f.accountId)), comment = f.session.get(commentDraftStorageKey(f.accountId)), scene = local.get("scene-workspace-v1")
    releases.push(installDesktopDraftSources(coordinator, f.storage), installRecoveryDraftSource(coordinator, f.recovery), installCommentDraftSource(coordinator, f.accountId, f.storage))
    coordinator.configurePersistence(async () => { throw Error("durable writer rejected") })
    let cleaned = false
    await assert.rejects((async () => { await coordinator.checkpointDrafts(); summary.afterCheckpoint?.(); cleaned = true })(), { code: "DURABLE_SAVE_FAILED" })
    assert.equal(cleaned, false); assert.equal(coordinator.getState().durableRevision, null)
    assert.equal(f.session.get(chatSessionKey(f.accountId)), chat); assert.equal(f.session.get(commentDraftStorageKey(f.accountId)), comment); assert.equal(local.get("scene-workspace-v1"), scene)
    assert.ok(JSON.stringify(f.recovery.read()).includes(f.old.draft))
  } finally { for (const release of releases.reverse()) release(); f.dispose() }
})
