"use client"
import { create } from "zustand"
import type { Bootstrap, StateSnapshot, SettingsAction } from "@desktop/shared/ipc"
import type { Settings } from "@desktop/core/settings"
import type { ModelDraft } from "@desktop/main/model-repository"
export const useDesktopStore = create<{ bootstrap: Bootstrap | null; saving: number; error: string | null }>(() => ({ bootstrap: null, saving: 0, error: null }))
export function receiveDesktopState(state: StateSnapshot) {
  useDesktopStore.setState(current => current.bootstrap && state.revision >= current.bootstrap.revision ? { bootstrap: { ...current.bootstrap, ...state } } : {})
}
let writes: Promise<unknown> = Promise.resolve()
export async function flushDesktopSettings():Promise<void>{
  for(;;){const captured=writes;await captured;if(captured===writes)break}
  if(useDesktopStore.getState().error)throw new Error("设置尚未确认保存，请返回设置处理后重试")
}
export function updateDesktopSettings(update: (current: Settings) => Settings): Promise<StateSnapshot> {
  return mutateDesktopState(before => ({ type: "update", revision: before.revision, settings: update(structuredClone(before.settings)) }))
}
export function saveDesktopModel(draft: ModelDraft): Promise<StateSnapshot> {
  const model = structuredClone(draft)
  return mutateDesktopState(before => ({ type: "save-model", revision: before.revision, model }))
}
export function removeDesktopModel(id: string): Promise<StateSnapshot> {
  return mutateDesktopState(before => ({ type: "remove-model", revision: before.revision, id }))
}
export function saveDesktopProfile(sessionId: string, draft: Settings["user"], avatarDraftId?: string): Promise<StateSnapshot> {
  const user = structuredClone(draft)
  return mutateDesktopState(before => ({ type: "save-profile", revision: before.revision, sessionId, user, avatarDraftId }))
}
function mutateDesktopState(action: (before: Bootstrap) => SettingsAction): Promise<StateSnapshot> {
  useDesktopStore.setState(current => ({ saving: current.saving + 1, error: null }))
  const pending = writes.then(async () => {
    const before = useDesktopStore.getState().bootstrap
    try {
      if (!before || typeof window==="undefined" || !window.desktop) throw new Error("本地设置尚未就绪")
      const next = await window.desktop.settings(action(before))
      receiveDesktopState(next); useDesktopStore.setState({ error: null }); return next
    } catch (error) {
      useDesktopStore.setState({ error: error instanceof Error ? error.message : "设置保存失败" })
      const actual = await (typeof window!=="undefined"?window.desktop?.bootstrap?.():undefined)?.catch(() => null)
      if (actual) receiveDesktopState(actual)
      throw error
    }
  }).finally(() => useDesktopStore.setState(current => ({ saving: current.saving - 1 })))
  writes = pending.catch(() => undefined)
  return pending
}
