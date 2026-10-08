import { desktopSaveCoordinator, type DesktopSaveCoordinator } from "./save-coordinator"
import { browserSessionStorage, chatSessionKey, chatSessionEntrySchema, chatSessionSnapshotSchema, type ChatSessionStorage } from "../chat-session"
import { useStagedChangesStore } from "../../stores/staged-changes"
import { useSceneUiStore } from "../../stores/scene-ui"
import { useChatStore } from "../../stores/chat"

const installations = new WeakMap<DesktopSaveCoordinator, { owners: Set<symbol>; release(): void }>()
/** Only application-owned draft stores. Data is a recovery snapshot; never
 * confirm a chip, mark a request sent, replay a request or approve a draft. */
export function installDesktopDraftSources(coordinator: DesktopSaveCoordinator = desktopSaveCoordinator, storage: ChatSessionStorage | null = browserSessionStorage()): () => void {
  let installed = installations.get(coordinator)
  if (!installed) {
    const releases: Array<() => void> = []
    try {
      releases.push(coordinator.registerSource("staged", { read() { const state = useStagedChangesStore.getState(); return { batches: state.batches, chips: state.chips } }, subscribe: listener => useStagedChangesStore.subscribe(listener) }))
      releases.push(coordinator.registerSource("scene", { read() { const state = useSceneUiStore.getState(); return { drafts: state.drafts, imageDrafts: state.imageDrafts, imageRequests: state.imageRequests, submissions: state.submissions, commitErrors: state.commitErrors } }, subscribe: listener => useSceneUiStore.subscribe(listener) }))
      releases.push(coordinator.registerSource("chat", {
        read() {
          const state = useChatStore.getState(), accountId = state.accountId
          if (!accountId) return { accountId: null, active: null, saved: null }
          if (!storage) throw new Error("CHAT_DRAFT_STORAGE_UNAVAILABLE")
          // One namespaced account key. Never enumerate sessionStorage or cache.
          const raw = storage.getItem(chatSessionKey(accountId))
          const saved = raw === null ? null : chatSessionSnapshotSchema.parse(JSON.parse(raw))
          const active = chatSessionEntrySchema.parse({ draftId: state.draftId, conversationId: state.conversationId, novelId: state.draftNovelId, draft: state.draft,
            pendingNovelTitle: state.pendingNovelTitle, pendingNovelPosition: state.pendingNovelPosition, novelCreationRequestId: state.novelCreationRequestId,
            modelChoice: state.modelChoice, modelChoiceExplicit: state.modelChoiceExplicit, mode: state.mode, modeExplicit: state.modeExplicit,
            queuedMessages: state.queuedMessages, wasRunning: state.isGenerating || state.creatingNovel || state.suspendedExecution, awaitingQuestion: !!state.pendingQuestion,
            pendingRequest: state.pendingRequest, action: state.draftAction })
          return { accountId, active, saved }
        }, subscribe: listener => useChatStore.subscribe(listener),
      }))
    } catch (error) { for (const release of releases.reverse()) release(); throw error }
    installed = { owners: new Set(), release() { for (const release of releases.reverse()) release() } }
    installations.set(coordinator, installed)
  }
  const current = installed, owner = Symbol("desktop-draft-sources")
  current.owners.add(owner)
  return () => { if (!current.owners.delete(owner) || current.owners.size) return; if (installations.get(coordinator) === current) installations.delete(coordinator); current.release() }
}
