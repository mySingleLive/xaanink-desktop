import assert from "node:assert/strict"
import { test } from "node:test"
import { DesktopRecoveryStore, restoreDesktopDraft } from "../../src/lib/desktop/draft-recovery"
import { WorkspaceDraftSource } from "../../src/lib/desktop/workspace-draft-source"
import { ChatSessionRepository, chatSessionKey, emptyChatSession } from "../../src/lib/chat-session"
import { commentDraftKey, commentDraftStorageKey } from "../../src/lib/comment-drafts"
import { useChatStore } from "../../src/stores/chat"
import { useSceneUiStore } from "../../src/stores/scene-ui"
import { useStagedChangesStore } from "../../src/stores/staged-changes"
import { useTabsStore } from "../../src/stores/tabs"
import type { DraftSnapshot } from "../../desktop/shared/drafts"

function fixture(sources: DraftSnapshot["sources"]) {
  const accountId = crypto.randomUUID(), map = new Map<string, string>(), writes: string[] = []
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem(key: string, value: string) { writes.push(key); map.set(key, value) }, removeItem(key: string) { map.delete(key) } }
  const before = { chat: useChatStore.getState(), scene: useSceneUiStore.getState(), staged: useStagedChangesStore.getState(), tabs: useTabsStore.getState() }
  useStagedChangesStore.setState({ batches: {}, chips: [], sendRequest: null })
  useSceneUiStore.setState({ drafts: {}, imageDrafts: {}, imageRequests: {}, submissions: {}, commitErrors: {}, action: null, reference: null })
  useTabsStore.setState({ tabs: [], activeTabId: null, subTabs: {}, panelFocus: null })
  const recovery = new DesktopRecoveryStore(), workspace = new WorkspaceDraftSource()
  const snapshot: DraftSnapshot = { version: 1, revision: 4, createdAt: "2026-10-07T00:00:00Z", autosaves: [], sources, issues: [] }
  return { accountId, map, writes, storage, snapshot, recovery, workspace,
    options: { restoreSession: true, accountId, storage, recovery, workspace, verifyTarget: () => true },
    dispose() { useChatStore.setState(before.chat); useSceneUiStore.setState(before.scene); useStagedChangesStore.setState(before.staged); useTabsStore.setState(before.tabs) },
  }
}

test("REC54-01: a newer owned chat cache written during later target verification cannot be overwritten by the captured old chat", async () => {
  const f = fixture({}), entry = { ...emptyChatSession(), draftId: "same-draft", draft: "durable旧稿" }
  f.snapshot.sources = { chat: { accountId: f.accountId, active: entry, saved: null }, workspace: { version: 1, tabs: [{ id: "chapter-content:c1", type: "chapter-content", novelId: "n1", refId: "c1", title: "第一章" }], activeTabId: "chapter-content:c1", subTabs: {}, layout: null } }
  let answer!: (value: boolean) => void, entered!: () => void
  const gate = new Promise<boolean>(resolve => { answer = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  try {
    const task = restoreDesktopDraft(f.snapshot, { ...f.options, verifyTarget: () => { entered(); return gate } })
    await started
    new ChatSessionRepository(f.accountId, f.storage).save({ ...entry, draft: "校验期间新增输入" })
    const current = f.map.get(chatSessionKey(f.accountId))!
    answer(true); const summary = await task
    assert.equal(f.map.get(chatSessionKey(f.accountId)), current)
    assert.equal(new ChatSessionRepository(f.accountId, f.storage).read().entry?.draft, "校验期间新增输入")
    assert.equal(summary.applied.chat, 0)
    assert.ok(f.recovery.read().items.some(item => item.source === "chat" && JSON.stringify(item.value).includes(entry.draft)))
  } finally { answer?.(true); f.dispose() }
})

test("REC54-02: request, queue-action and unknown autosave metadata remain data without executing or becoming scene consumers", async () => {
  const f = fixture({}), request = { clientRequestId: "original-no-retry", body: JSON.stringify({ approve: true, url: "/api/paid-image", text: "不能重放" }) }
  const active = { ...emptyChatSession(), draft: "作者输入", modelChoice: { modelId: null, effort: null }, modelChoiceExplicit: true, mode: "plan" as const, modeExplicit: true, pendingRequest: request, queuedMessages: [{ id: "queued", text: "待用户决定", action: { kind: "review" as const, targetType: "CHAPTER_CONTENT" as const, targetId: "c1" } }] }
  f.snapshot.sources = { chat: { accountId: f.accountId, active, saved: null }, scene: { imageRequests: { r: { operationId: "paid-once", prompt: "不生成" } }, submissions: { s: { url: "/api/approve", approve: true } } } }
  const unknown = { controllerId: "not-an-owner", command: "approve", draft: "未知作者文字", request }
  f.snapshot.autosaves = [{ id: crypto.randomUUID(), draft: unknown }]
  const fetchBefore = globalThis.fetch; let calls = 0
  globalThis.fetch = async () => { calls++; throw Error("no replay") }
  try {
    const summary = await restoreDesktopDraft(f.snapshot, f.options), restored = new ChatSessionRepository(f.accountId, f.storage).read().entry
    assert.equal(calls, 0); assert.equal(summary.applied.chat, 1)
    assert.equal(restored?.pendingRequest, null); assert.equal(restored?.wasRunning, true)
    assert.deepEqual(restored?.queuedMessages, active.queuedMessages)
    assert.deepEqual(restored?.modelChoice, active.modelChoice); assert.equal(restored?.modelChoiceExplicit, true)
    assert.equal(restored?.mode, "plan"); assert.equal(restored?.modeExplicit, true)
    assert.deepEqual(useSceneUiStore.getState().imageRequests, {}); assert.deepEqual(useSceneUiStore.getState().submissions, {})
    assert.equal(useStagedChangesStore.getState().sendRequest, null)
    const retained = f.recovery.read().items
    assert.ok(retained.some(item => item.reason === "EXECUTION_METADATA" && JSON.stringify(item.value) === JSON.stringify(request)))
    assert.ok(retained.some(item => item.reason === "INVALID_DATA" && JSON.stringify(item.value) === JSON.stringify(unknown)))
  } finally { globalThis.fetch = fetchBefore; f.dispose() }
})

test("REC54-03: mismatched account and invalid comment identity preserve original bytes and drafts without target guessing", async () => {
  const f = fixture({}), target = { novelId: "n", targetType: "CHAPTER_CONTENT", targetId: "c" }, content = "跨账号不能注入"
  const invalid = { key: "wrong-identity", target, content: "坏身份也保留", updatedAt: 1 }
  const foreign = { key: commentDraftKey(target), target, content, updatedAt: 1 }
  const chat = { ...emptyChatSession(), draft: "异账号聊天" }
  f.map.set(commentDraftStorageKey(f.accountId), "unreadable original bytes")
  f.map.set(chatSessionKey(f.accountId), "bad-original-chat")
  try {
    let queries = 0
    f.snapshot.sources = { chat: { accountId: "foreign", active: chat, saved: null }, comments: { accountId: f.accountId, rows: [invalid] } }
    const first = await restoreDesktopDraft(f.snapshot, { ...f.options, verifyTarget: () => { queries++; return true } })
    f.snapshot.sources = { comments: { accountId: "foreign", rows: [foreign] } }
    const second = await restoreDesktopDraft(f.snapshot, { ...f.options, verifyTarget: () => { queries++; return true } })
    assert.equal(first.applied.chat + first.applied.comments + second.applied.comments, 0); assert.equal(queries, 0)
    assert.ok(f.writes.every(key => key.startsWith(commentDraftStorageKey(f.accountId) + ":unreadable:")), "the original comment store may preserve an unreadable backup, but cannot overwrite an owned draft or a foreign key")
    assert.equal(f.map.get(commentDraftStorageKey(f.accountId)), "unreadable original bytes")
    assert.equal(f.map.get(chatSessionKey(f.accountId)), "bad-original-chat")
    const items = f.recovery.read().items
    assert.ok(items.some(item => item.reason === "INVALID_DATA" && JSON.stringify(item.value) === JSON.stringify(invalid)))
    assert.ok(items.some(item => item.reason === "ACCOUNT_MISMATCH" && JSON.stringify(item.value).includes(content)))
    assert.ok(items.some(item => item.reason === "ACCOUNT_MISMATCH" && JSON.stringify(item.value).includes(chat.draft)))
  } finally { f.dispose() }
})

test("REC54-04: aborting a later target check discards earlier prepared chat commits and cannot apply the old owner's late reply", async () => {
  const f = fixture({}), active = { ...emptyChatSession(), draft: "旧owner未应用的稿" }, controller = new AbortController()
  f.snapshot.sources = { chat: { accountId: f.accountId, active, saved: null }, workspace: { version: 1, tabs: [{ id: "chapter-content:c1", type: "chapter-content", novelId: "n1", refId: "c1", title: "第一章" }], activeTabId: "chapter-content:c1", subTabs: {}, layout: null } }
  const sentinel = { id: "preexisting", source: "chat", path: "old", reason: "AUTOSAVE_UNMATCHED" as const, createdAt: f.snapshot.createdAt, value: "已有可导出数据" }
  f.recovery.retain([sentinel]); const retained = f.recovery.read()
  let answer!: (value: boolean) => void, entered!: () => void
  const gate = new Promise<boolean>(resolve => { answer = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  try {
    const task = restoreDesktopDraft(f.snapshot, { ...f.options, signal: controller.signal, verifyTarget: () => { entered(); return gate } })
    const rejected = assert.rejects(task, { name: "AbortError" }); await started; controller.abort(); await rejected
    answer(true); await Promise.resolve()
    assert.equal(f.map.has(chatSessionKey(f.accountId)), false); assert.deepEqual(f.writes, [])
    assert.deepEqual(useTabsStore.getState().tabs, []); assert.deepEqual(f.recovery.read(), retained)
  } finally { answer?.(true); f.dispose() }
})
