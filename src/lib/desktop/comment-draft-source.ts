import { z } from "zod"
import { commentDraftStoreFor, commentDraftSchema, commentDraftStorageKey, type DraftStorage } from "../comment-drafts"
import type { DesktopSaveCoordinator } from "./save-coordinator"
export function installCommentDraftSource(coordinator: DesktopSaveCoordinator, accountId: string, storage: DraftStorage | null): () => void {
  const store = storage ? commentDraftStoreFor(accountId, () => storage) : null
  return coordinator.registerSource("comments", {
    read() {
      if (!store || !storage) throw new Error("COMMENT_DRAFT_STORAGE_UNAVAILABLE")
      const raw = storage.getItem(commentDraftStorageKey(accountId))
      const retained = store.retainedSnapshotForCheckpoint()
      if (retained) return { accountId, rows: retained }
      if (raw !== null) z.array(commentDraftSchema).parse(JSON.parse(raw))
      return { accountId, rows: store.snapshot() }
    },
    subscribe: listener => store?.subscribe(listener) ?? (() => {}),
  })
}
