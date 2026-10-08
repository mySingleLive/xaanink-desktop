"use client"
import { useSceneUiStore } from "@/stores/scene-ui"
import { useStagedChangesStore } from "@/stores/staged-changes"
import { useChatStore } from "@/stores/chat"
import { useTabsStore } from "@/stores/tabs"
import { firstControl, stagedDataFields } from "@/lib/staged-save"
import type { StagedCommitReceipt } from "@/lib/services/staged-commit"

/** Only actual tool receipts release sent scene shadows; HTTP acceptance is not a save. */
export function applySceneCommitReceipt(raw: unknown) {
  if (!raw || typeof raw !== "object") return
  const receipt = raw as Partial<StagedCommitReceipt>
  if (!Array.isArray(receipt.committed) || !Array.isArray(receipt.conflicts) || !Array.isArray(receipt.errors)) return
  const accountId = useChatStore.getState().accountId
  const state = useSceneUiStore.getState()
  for (const [key, submission] of Object.entries(state.submissions)) {
    if (submission.accountId !== accountId) continue
    const {batch} = submission
    let remaining = [...batch.changes]
    for (const item of [...receipt.committed, ...receipt.conflicts, ...receipt.errors]) {
      if (item.targetKind !== "SCENE" || !item.operationId) continue
      const sent = remaining.find(c => c.targetKind === item.targetKind && c.targetId === item.targetId && c.op === item.op && firstControl(c.request.body).operationId === item.operationId)
      if (!sent) continue
      const committed = "committedId" in item
      const sceneKey = `${accountId}:${batch.novelId}:draft:${item.targetId}`
      if (committed) {
        state.setCommitError(sceneKey, null)
        const draft = useSceneUiStore.getState().drafts[sceneKey]
        const sentFields = stagedDataFields(sent.request.body)
        if (item.op === "delete" || draft && Object.entries(sentFields).every(([field, value]) => JSON.stringify(draft.value[field as keyof typeof draft.value]) === JSON.stringify(value))) state.setDraft(sceneKey, null)
        if (item.op === "delete") {
          remaining = remaining.filter(c => c.targetId !== item.targetId)
          useStagedChangesStore.getState().discardTarget(batch.novelId, item.targetId)
          useTabsStore.getState().closeSceneTabs(batch.novelId, item.targetId)
        } else remaining = remaining.filter(c => c !== sent)
      } else {
        state.setCommitError(sceneKey, item.message)
        // Restore the entire target, including edits superseded by an unsuccessful deletion.
        const failed = remaining.filter(c => c.targetId === item.targetId)
        const newer = Object.values(useStagedChangesStore.getState().batches).some(b => b.novelId === batch.novelId && b.changes.some(c => c.targetKind === "SCENE" && c.targetId === item.targetId))
        const draft = useSceneUiStore.getState().drafts[sceneKey]
        const modified = failed.find(c => c.op === "modify")
        const newerDraft = draft && modified && Object.entries(stagedDataFields(modified.request.body)).some(([field, value]) => JSON.stringify(draft.value[field as keyof typeof draft.value]) !== JSON.stringify(value))
        if (!newer && !newerDraft) for (const change of failed) useStagedChangesStore.getState().record(batch.batchKey, batch.novelId, batch.label, change)
        useStagedChangesStore.getState().confirm(batch.batchKey)
        remaining = remaining.filter(c => c.targetId !== item.targetId)
      }
    }
    if (remaining.length !== batch.changes.length) state.setSubmission(key, remaining.length ? {...submission, batch: {...batch, changes: remaining}} : null)
  }
}
