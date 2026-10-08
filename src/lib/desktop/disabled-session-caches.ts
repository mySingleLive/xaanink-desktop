import { chatSessionKey, emptyChatSession, type ChatSessionStorage } from "../chat-session"
import { commentDraftStoreFor } from "../comment-drafts"
import { useStagedChangesStore } from "../../stores/staged-changes"
import { useSceneUiStore } from "../../stores/scene-ui"
import { useTabsStore } from "../../stores/tabs"
import { useChatStore } from "../../stores/chat"
import type { WorkspaceDraftSource } from "./workspace-draft-source"
export interface DisabledCacheArchive { source: string; path: string; value: unknown }
interface Reset { assertCurrent(): void; commit(): void; cancel?(): void }
/** Capture only owned caches. The caller must persist these exact copies before
 * running afterCheckpoint. Every reset is guarded and retryable; no arbitrary
 * storage enumeration, deletion, request replay or draft approval occurs. */
export function prepareDisabledSessionCaches(accountId: string, storage: ChatSessionStorage | null, workspace: WorkspaceDraftSource, signal?: AbortSignal): { archives: DisabledCacheArchive[]; afterCheckpoint(): void } {
  const archives: DisabledCacheArchive[] = [], resets: Reset[] = []
  const freshChat = emptyChatSession()
  const assertActive = () => { if (signal?.aborted) throw new DOMException("恢复已取消", "AbortError") }
  assertActive()
  function dataReset<T>(source: string, read: () => T, clear: () => void, meaningful: (value: T) => boolean) {
    const value = structuredClone(read())
    if (!meaningful(value)) return
    archives.push({ source, path: "current-cache", value })
    const before = JSON.stringify(value); let after: string | null = null
    const assertCurrent = () => { if (JSON.stringify(read()) !== (after ?? before)) throw new Error("DRAFT_CHANGED_DURING_RECOVERY") }
    resets.push({ assertCurrent, commit() { assertCurrent(); if (after !== null) return; clear(); after = JSON.stringify(read()) } })
  }
  if (storage) {
    const key = chatSessionKey(accountId), raw = storage.getItem(key)
    if (raw !== null) {
      archives.push({ source: "chat", path: "owned-cache", value: raw })
      const serialized = JSON.stringify({ version: 1, activeKey: freshChat.draftId, drafts: { [freshChat.draftId]: freshChat } }); let committed = false
      const assertCurrent = () => { if (storage.getItem(key) !== (committed ? serialized : raw)) throw new Error("DRAFT_CHANGED_DURING_RECOVERY") }
      resets.push({ assertCurrent, commit() { assertCurrent(); if (!committed) { storage.setItem(key, serialized); committed = true } } })
    }
    const comments = commentDraftStoreFor(accountId, () => storage)!, reset = comments.prepareResetAfterCheckpoint()
    if (reset.raw !== null && reset.raw !== "[]" || reset.rows.length) { archives.push({ source: "comments", path: "owned-cache", value: { raw: reset.raw, rows: reset.rows } }); resets.push(reset) } else reset.cancel()
  }
  const chatFields = () => { const s = useChatStore.getState(); return { accountId: s.accountId, draftId: s.draftId, conversationId: s.conversationId, novelId: s.draftNovelId, draft: s.draft, pendingNovelTitle: s.pendingNovelTitle, pendingNovelPosition: s.pendingNovelPosition, novelCreationRequestId: s.novelCreationRequestId, queuedMessages: s.queuedMessages, pendingRequest: s.pendingRequest, action: s.draftAction, modelChoice: s.modelChoice, modelChoiceExplicit: s.modelChoiceExplicit, mode: s.mode, modeExplicit: s.modeExplicit } }
  dataReset("chat", chatFields, () => { useChatStore.setState({ draftId: freshChat.draftId, conversationId: null, draftNovelId: null, draft: "", pendingNovelTitle: null, pendingNovelPosition: null, novelCreationRequestId: null, queuedMessages: [], pendingRequest: null, draftAction: null, modelChoice: freshChat.modelChoice, modelChoiceExplicit: false, mode: "standard", modeExplicit: false, isGenerating: false, creatingNovel: false, suspendedExecution: false, pendingQuestion: null, pendingPlan: null, requestedConversationId: null, newConversationRequested: false, newConversationPayload: null, queuePaused: true, recoveryStatus: "restoring" }) }, s => s.accountId === accountId && !!(s.draft || s.conversationId || s.novelId || s.pendingNovelTitle || s.pendingNovelPosition || s.novelCreationRequestId || s.pendingRequest || s.queuedMessages.length || s.action || s.modelChoice.modelId !== null || s.modelChoice.effort !== null || s.modelChoiceExplicit || s.mode !== "standard" || s.modeExplicit))
  const sceneFields = () => {
    const state = useSceneUiStore.getState(), owned = <T>(rows: Record<string,T>) => Object.fromEntries(Object.entries(rows).filter(([key]) => key.startsWith(`${accountId}:`)))
    return { drafts: owned(state.drafts), imageDrafts: owned(state.imageDrafts), imageRequests: owned(state.imageRequests), submissions: Object.fromEntries(Object.entries(state.submissions).filter(([, row]) => row.accountId === accountId)), commitErrors: owned(state.commitErrors), action: state.action, reference: state.reference }
  }
  dataReset("scene", sceneFields, () => {
    const state = useSceneUiStore.getState(), other = <T>(rows: Record<string,T>) => Object.fromEntries(Object.entries(rows).filter(([key]) => !key.startsWith(`${accountId}:`)))
    useSceneUiStore.setState({ drafts: other(state.drafts), imageDrafts: other(state.imageDrafts), imageRequests: other(state.imageRequests), submissions: Object.fromEntries(Object.entries(state.submissions).filter(([, row]) => row.accountId !== accountId)), commitErrors: other(state.commitErrors), action: null, reference: null })
  }, value => !!(Object.keys(value.drafts).length || Object.keys(value.imageDrafts).length || Object.keys(value.imageRequests).length || Object.keys(value.submissions).length || Object.keys(value.commitErrors).length || value.action || value.reference))
  dataReset("staged", () => { const state = useStagedChangesStore.getState(); return { batches: state.batches, chips: state.chips, sendRequest: state.sendRequest } }, () => useStagedChangesStore.setState({ batches: {}, chips: [], sendRequest: null }), value => !!(Object.keys(value.batches).length || value.chips.length || value.sendRequest))
  dataReset("workspace", () => { const state = useTabsStore.getState(); return { ...workspace.read(), panelFocus: state.panelFocus } }, () => workspace.restore({ version: 1, tabs: [], activeTabId: null, subTabs: {}, layout: null }), value => !!(value.tabs.length || value.layout || value.panelFocus || Object.keys(value.subTabs).length))
  const cancel = () => { for (const reset of resets) reset.cancel?.() }
  signal?.addEventListener("abort", cancel, { once: true })
  return { archives, afterCheckpoint() {
    assertActive(); for (const reset of resets) reset.assertCurrent()
    // If a later storage write fails, earlier successful resets are idempotent.
    // The acknowledged recovery archive remains authoritative on retry.
    for (const reset of resets) { assertActive(); reset.commit() }
    cancel(); signal?.removeEventListener("abort", cancel)
  } }
}
