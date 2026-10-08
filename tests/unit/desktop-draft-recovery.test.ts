import assert from "node:assert/strict"
import { test } from "node:test"
import { DesktopRecoveryStore, restoreDesktopDraft } from "../../src/lib/desktop/draft-recovery"
import { WorkspaceDraftSource } from "../../src/lib/desktop/workspace-draft-source"
import { useStagedChangesStore } from "../../src/stores/staged-changes"
import { useSceneUiStore } from "../../src/stores/scene-ui"
import { useTabsStore, buildTabId } from "../../src/stores/tabs"
import { emptyChatSession, chatSessionKey, ChatSessionRepository } from "../../src/lib/chat-session"
import type { DesktopDraftSnapshot } from "../../src/lib/desktop/save-coordinator"
const scene = { id: "s1", novelId: "n1", name: "场景", parentId: null, version: 3, description: "旧稿", coordinates: "", attributes: [], backstory: "", entryMethod: "", exteriorDescription: "", interiorDescription: "", factionSettingId: null, factionId: null, factionNameSnapshot: null, exteriorImageUrl: null, interiorImageUrl: null, exteriorImageRevision: 0, interiorImageRevision: 0, createdAt: "2026-10-07T00:00:00Z", updatedAt: "2026-10-07T00:00:00Z" }
function batch(op: "modify" | "create" = "modify") { return { batchKey: "scene:s1", novelId: "n1", label: "场景", phase: "editing", revertNonce: 7, changes: [{ targetKind: op === "create" ? "WORLD" : "SCENE", targetId: op === "create" ? "staged-world-1" : "s1", targetLabel: "场景", novelId: "n1", op, request: { url: op === "create" ? "/api/novels/n1/worlds" : "/api/novels/n1/scenes/s1", method: op === "create" ? "POST" : "PATCH", body: { description: "作者未提交稿", expectedVersion: 3, operationId: "original-operation" } }, items: [{ key: "field", field: "description", fieldLabel: "介绍", summary: "修改介绍" }], updatedAt: 4 }] } }
function fixture(sources: Record<string, unknown> = {}, autosaves: DesktopDraftSnapshot["autosaves"] = []) {
  const staged = useStagedChangesStore.getState(), scenes = useSceneUiStore.getState(), tabs = useTabsStore.getState()
  useStagedChangesStore.setState({ batches: {}, chips: [], sendRequest: null }); useSceneUiStore.setState({ drafts: {}, imageDrafts: {}, imageRequests: {}, submissions: {}, commitErrors: {} }); useTabsStore.setState({ tabs: [], activeTabId: null, subTabs: {}, panelFocus: null })
  const data = new Map<string, string>(), reads: string[] = [], storage = { getItem(key: string) { reads.push(key); return data.get(key) ?? null }, setItem(key: string, value: string) { data.set(key, value) }, removeItem(key: string) { data.delete(key) } }
  const recovery = new DesktopRecoveryStore(), workspace = new WorkspaceDraftSource(), snapshot: DesktopDraftSnapshot = { version: 1, revision: 10, createdAt: "2026-10-07T00:00:00Z", autosaves, sources, issues: [] }
  const options = { restoreSession: true, accountId: "owner", storage, recovery, workspace, verifyTarget: () => true }
  return { snapshot, options, recovery, workspace, data, reads, storage, dispose() { useStagedChangesStore.setState(staged); useSceneUiStore.setState(scenes); useTabsStore.setState(tabs) } }
}
test("REC51-01: disabled restoration retains every owned source and unmatched autosave without writing stores or storage", async () => {
  const f = fixture({ staged: { batches: { "scene:s1": batch() }, chips: [] }, scene: { imageRequests: { r: { operationId: "never-send" } } }, chat: { accountId: "owner", active: emptyChatSession(), saved: null } }, [{ id: crypto.randomUUID(), draft: { revision: 2, status: "error", paused: true, pending: null, failed: null, inFlight: null, latest: { value: "保留稿", revision: 2, operationId: "stable" } } }])
  try { const result = await restoreDesktopDraft(f.snapshot, { ...f.options, restoreSession: false }); assert.equal(result.applied.staged, 0); assert.equal(result.retained, 4); assert.equal(f.data.size, 0); assert.deepEqual(useStagedChangesStore.getState().batches, {}); assert.ok(JSON.stringify(f.recovery.read()).includes("保留稿")); assert.ok(f.recovery.read().items.every(item => item.reason === "RESTORE_DISABLED")) } finally { f.dispose() }
})
test("REC51-02: valid staged author draft preserves baseline, operation, phase and revert nonce without confirmation or send", async () => {
  const saved = batch(), f = fixture({ staged: { batches: { [saved.batchKey]: saved }, chips: [] } }), originalFetch = globalThis.fetch; let calls = 0
  globalThis.fetch = async () => { calls++; throw Error("no replay") }
  try { const result = await restoreDesktopDraft(f.snapshot, f.options); assert.equal(result.applied.staged, 1); assert.deepEqual(useStagedChangesStore.getState().batches[saved.batchKey], saved); assert.equal(useStagedChangesStore.getState().sendRequest, null); assert.deepEqual(useStagedChangesStore.getState().chips, []); assert.equal(calls, 0) } finally { globalThis.fetch = originalFetch; f.dispose() }
})
test("REC51-03: malformed/off-allowlist or inconsistent staged target is retained, never made sendable", async () => {
  for (const patch of [{ request: { url: "https://attacker.invalid", method: "PATCH" } }, { targetId: "other-scene" }, { novelId: "other-novel" }]) {
    const b = batch(); Object.assign(b.changes[0], patch); const f = fixture({ staged: { batches: { [b.batchKey]: b }, chips: [] } })
    try { const result = await restoreDesktopDraft(f.snapshot, f.options); assert.equal(result.retained, 1); assert.equal(result.applied.staged, 0); assert.deepEqual(useStagedChangesStore.getState().batches, {}) } finally { f.dispose() }
  }
})
test("REC51-04: a create placeholder needs owned novel verification but no nonexistent-entity check", async () => {
  const saved = batch("create"), f = fixture({ staged: { batches: { [saved.batchKey]: saved }, chips: [] } }), targets: unknown[] = []
  try { const result = await restoreDesktopDraft(f.snapshot, { ...f.options, verifyTarget: target => { targets.push(target); return target.kind === "NOVEL" && target.novelId === "n1" } }); assert.equal(result.applied.staged, 1); assert.deepEqual(targets, [{ novelId: "n1", kind: "NOVEL" }]) } finally { f.dispose() }
})
test("REC51-05: owned chat active/saved drafts restore existing schema with explicit null and paused queue; pending HTTP body is quarantined", async () => {
  const prior = { ...emptyChatSession(), draftId: "previous", draft: "旧对话稿" }, active = { ...emptyChatSession(), draftId: "active", draft: "未发送", mode: "plan" as const, modeExplicit: true, modelChoiceExplicit: true, queuedMessages: [{ id: "q1", text: "等待", action: { kind: "review" as const, targetType: "CHAPTER_CONTENT" as const, targetId: "c1" } }], wasRunning: true, pendingRequest: { clientRequestId: "original", body: '{"message":"不能重发"}' } }
  const f = fixture({ chat: { accountId: "owner", active, saved: { version: 1, activeKey: prior.draftId, drafts: { [prior.draftId]: prior } } } })
  try { const result = await restoreDesktopDraft(f.snapshot, f.options), repo = new ChatSessionRepository("owner", f.storage), entry = repo.read().entry; assert.equal(result.applied.chat, 2); assert.equal(entry?.draftId, "active"); assert.equal(entry?.modelChoice.modelId, null); assert.equal(entry?.modelChoiceExplicit, true); assert.equal(entry?.mode, "plan"); assert.deepEqual(entry?.queuedMessages, active.queuedMessages); assert.equal(entry?.wasRunning, true); assert.equal(entry?.pendingRequest, null); assert.equal(repo.get("previous")?.draft, "旧对话稿"); assert.ok(JSON.stringify(f.recovery.read()).includes("不能重发")); assert.ok(f.reads.every(key => key === chatSessionKey("owner"))) } finally { f.dispose() }
})
test("REC51-06: other-account or unreadable existing owned chat storage is preserved without overwrite", async () => {
  for (const mismatch of [true, false]) { const f = fixture({ chat: { accountId: mismatch ? "other" : "owner", active: emptyChatSession(), saved: null } }); f.data.set(chatSessionKey("owner"), "original-invalid")
    try { const result = await restoreDesktopDraft(f.snapshot, f.options); assert.equal(result.applied.chat, 0); assert.equal(result.retained, 1); assert.equal(f.data.get(chatSessionKey("owner")), "original-invalid") } finally { f.dispose() }
  }
})
test("REC51-07: scene edit restores current account/version data but image requests/submissions stay inert in recovery", async () => {
  const key = "owner:n1:draft:s1", imageKey = "owner:n1:s1:exterior", draft = { value: { ...scene, description: "恢复作者稿" }, baseline: 3, operationId: "same-operation", saved: false }, f = fixture({ scene: { drafts: { [key]: draft }, imageDrafts: { [imageKey]: { prompt: "仅提示词", modelId: "deleted-model", revision: 7 } }, imageRequests: { [imageKey]: { operationId: "paid-original" } }, submissions: { original: { batch: batch() } }, commitErrors: { [key]: "尚待比较" } } })
  try { const result = await restoreDesktopDraft(f.snapshot, f.options); assert.equal(result.applied.scene, 2); assert.deepEqual(useSceneUiStore.getState().drafts[key], draft); assert.equal(useSceneUiStore.getState().imageDrafts[imageKey].modelId, "deleted-model"); assert.deepEqual(useSceneUiStore.getState().imageRequests, {}); assert.deepEqual(useSceneUiStore.getState().submissions, {}); assert.ok(JSON.stringify(f.recovery.read()).includes("paid-original")); assert.equal(useSceneUiStore.getState().commitErrors[key], "尚待比较") } finally { f.dispose() }
})
test("REC51-08: unknown or failed target retains exact draft while verifiable neighboring draft restores", async () => {
  const a = batch(), b = { ...batch(), batchKey: "other", novelId: "gone", changes: batch().changes.map(change => ({ ...change, novelId: "gone", request: { ...change.request, url: "/api/novels/gone/scenes/s1" } })) }, f = fixture({ staged: { batches: { [a.batchKey]: a, other: b }, chips: [] }, extension: { text: "未知来源仍保留" } })
  try { const result = await restoreDesktopDraft(f.snapshot, { ...f.options, verifyTarget: target => target.novelId !== "gone" }); assert.equal(result.applied.staged, 1); assert.equal(result.retained, 2); assert.deepEqual(useStagedChangesStore.getState().batches[a.batchKey], a); assert.ok(JSON.stringify(f.recovery.read()).includes("未知来源仍保留")) } finally { f.dispose() }
})
test("REC51-09: repeated recovery and recovery-source round trip never nests or duplicates retained data", async () => {
  const f = fixture({ scene: { imageRequests: { id: { operationId: "keep" } } } })
  try { await restoreDesktopDraft(f.snapshot, f.options); const before = f.recovery.read(); assert.equal(before.items.length, 1); await restoreDesktopDraft(f.snapshot, f.options); assert.deepEqual(f.recovery.read(), before); const next = { ...f.snapshot, createdAt: "2026-10-08T00:00:00Z", sources: { recovery: before } }; const other = new DesktopRecoveryStore(); await restoreDesktopDraft(next, { ...f.options, recovery: other }); assert.deepEqual(other.read(), before); const clone = other.read(); (clone.items[0].value as { id: { operationId: string } }).id.operationId = "mutated"; assert.deepEqual(other.read(), before) } finally { f.dispose() }
})
test("REC51-10: abort after awaited verification cannot apply a stale renderer owner draft", async () => {
  const saved = batch(), f = fixture({ staged: { batches: { [saved.batchKey]: saved }, chips: [] } }), controller = new AbortController(); let answer!: (yes: boolean) => void; const gate = new Promise<boolean>(resolve => { answer = resolve })
  try { const restore = restoreDesktopDraft(f.snapshot, { ...f.options, signal: controller.signal, verifyTarget: () => gate }); await Promise.resolve(); controller.abort(); answer(true); await assert.rejects(restore, { name: "AbortError" }); assert.deepEqual(useStagedChangesStore.getState().batches, {}); assert.equal(f.recovery.read().items.length, 0) } finally { f.dispose() }
})
test("REC51-11: missing verifier safely retains entity draft instead of inferring target identity", async () => {
  const saved = batch(), f = fixture({ staged: { batches: { [saved.batchKey]: saved }, chips: [] } })
  try { const { verifyTarget: _removed, ...options } = f.options; const result = await restoreDesktopDraft(f.snapshot, options); assert.equal(result.applied.staged, 0); assert.equal(result.retained, 1) } finally { f.dispose() }
})
test("REC51-12: workspace restores validated tabs/active/subviews without triggering focus or scene leave actions", async () => {
  const tab = { id: buildTabId("chapter-content", "n1", { refId: "c1" }), type: "chapter-content" as const, novelId: "n1", refId: "c1", title: "第一章" }, f = fixture({ workspace: { version: 1, tabs: [tab], activeTabId: tab.id, subTabs: { [tab.id]: "preview" }, layout: null } })
  try { const result = await restoreDesktopDraft(f.snapshot, f.options); assert.equal(result.applied.workspace, 1); assert.deepEqual(useTabsStore.getState().tabs, [tab]); assert.equal(useTabsStore.getState().activeTabId, tab.id); assert.equal(useTabsStore.getState().subTabs[tab.id], "preview"); assert.equal(useTabsStore.getState().panelFocus, null) } finally { f.dispose() }
})
test("REC51-13: cancelling a verifier that never settles rejects promptly without waiting for or applying its late answer", async () => {
  const saved = batch(), f = fixture({ staged: { batches: { [saved.batchKey]: saved }, chips: [] } }), controller = new AbortController(); let answer!: (yes: boolean) => void; const gate = new Promise<boolean>(resolve => { answer = resolve })
  try { const task = restoreDesktopDraft(f.snapshot, { ...f.options, signal: controller.signal, verifyTarget: () => gate }); await Promise.resolve(); controller.abort(); const rejected = await Promise.race([task.then(() => false, error => error.name === "AbortError"), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 30))]); assert.equal(rejected, true); assert.deepEqual(useStagedChangesStore.getState().batches, {}); assert.equal(f.recovery.read().items.length, 0); answer(true); await task.catch(() => {}) } finally { answer(true); f.dispose() }
})
test("REC51-14: newer scene cache/input keeps its identity and incoming conflicting draft remains exportable", async () => {
  const key = "owner:n1:draft:s1", incoming = { value: { ...scene, description: "较旧的durable输入" }, baseline: 3 }, current = { value: { ...scene, description: "更新的本地输入" }, baseline: 3 }, f = fixture({ scene: { drafts: { [key]: incoming } } }); useSceneUiStore.setState({ drafts: { [key]: current } })
  try { const result = await restoreDesktopDraft(f.snapshot, f.options); assert.equal(result.applied.scene, 0); assert.deepEqual(useSceneUiStore.getState().drafts[key], current); assert.equal(result.retained, 1); assert.ok(JSON.stringify(f.recovery.read()).includes(incoming.value.description)) } finally { f.dispose() }
})
test("REC51-15: newer owned session cache is preserved and the conflicting recovered chat remains exportable", async () => {
  const active = { ...emptyChatSession(), draftId: "same", draft: "durable旧稿" }, current = { ...active, draft: "缓存新稿" }, f = fixture({ chat: { accountId: "owner", active, saved: null } }); new ChatSessionRepository("owner", f.storage).save(current)
  try { const result = await restoreDesktopDraft(f.snapshot, f.options); assert.equal(result.applied.chat, 0); assert.equal(new ChatSessionRepository("owner", f.storage).read().entry?.draft, current.draft); assert.equal(result.retained, 1); assert.ok(JSON.stringify(f.recovery.read()).includes(active.draft)) } finally { f.dispose() }
})
test("REC51-16: when every tab was deleted, a visible content layout is retained instead of showing an empty recovered pane", async () => {
  const tab = { id: "chapter-content:c1", type: "chapter-content", novelId: "n1", refId: "c1", title: "已删除章" }, layout = { version: 1, narrowPane: "content", contentVisible: true, sidebarVisible: true, chatVisible: false, sizes: { sidebar: 25, chat: 0, content: 75 }, lastContentSize: 50, lastSidebarSize: 25, lastChatSize: 50 }, f = fixture({ workspace: { version: 1, tabs: [tab], activeTabId: tab.id, subTabs: {}, layout } })
  try { const result = await restoreDesktopDraft(f.snapshot, { ...f.options, verifyTarget: () => false }); assert.equal(result.applied.workspace, 0); assert.equal(result.layoutPending, false); assert.equal(f.workspace.read().layout, null); assert.deepEqual(useTabsStore.getState().tabs, []); assert.equal(result.retained, 2); assert.ok(JSON.stringify(f.recovery.read()).includes("contentVisible")) } finally { f.dispose() }
})
test("REC51-17: a main-validated unknown autosave payload is retained as invalid data without pretending it is a controller", async () => {
  const f = fixture(), raw = { script: "must not dispatch", draft: "未知格式仍保留" }, snapshot = { ...f.snapshot, autosaves: [{ id: crypto.randomUUID(), draft: raw }] }
  try { const result = await restoreDesktopDraft(snapshot, f.options); assert.equal(result.retained, 1); assert.equal(f.recovery.read().items[0].reason, "INVALID_DATA"); assert.deepEqual(f.recovery.read().items[0].value, raw) } finally { f.dispose() }
})
test("REC51-18: conflicting retained IDs cannot silently discard different input, exact round trips remain deduplicated", () => {
  const recovery = new DesktopRecoveryStore(), item = { id: "same-origin", source: "autosaves", path: "same", reason: "AUTOSAVE_UNMATCHED" as const, createdAt: "2026-10-07T00:00:00Z", value: "旧输入" }, changed = { ...item, value: "新输入" }
  recovery.retain([item, changed]); assert.equal(recovery.read().items.length, 2); assert.deepEqual(recovery.read().items.map(item => item.value), ["旧输入", "新输入"]); recovery.retain([item, changed, ...recovery.read().items]); assert.equal(recovery.read().items.length, 2)
})
