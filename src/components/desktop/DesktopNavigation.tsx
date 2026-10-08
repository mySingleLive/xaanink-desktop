"use client"
import { useEffect } from "react"
import { useTabsStore } from "@/stores/tabs"
import { useChatStore } from "@/stores/chat"
import { toast } from "sonner"
import { DesktopNavigationHistory, type ChatNavigationTarget } from "@/lib/desktop/navigation-history"
import { desktopChatNavigation, mountDesktopNavigation, navigateDesktopHistory, subscribeDesktopChatNavigation } from "@/lib/desktop/navigation-runtime"
import { useDesktopCommands } from "@/lib/desktop/use-command-target"
import { desktopNavigationSnapshot } from "@/lib/desktop/navigation-runtime"

export function DesktopNavigation() {
  useDesktopCommands({
    "view.back": { enabled: () => desktopNavigationSnapshot().canBack, run: async () => { await navigateDesktopHistory(-1) } },
    "view.forward": { enabled: () => desktopNavigationSnapshot().canForward, run: async () => { await navigateDesktopHistory(1) } },
  })
  useEffect(() => {
    const history = new DesktopNavigationHistory({
      available: target => target.kind === "tab" ? useTabsStore.getState().tabs.some(tab => tab.id === target.id) : !!desktopChatNavigation()?.available(target),
      apply: (target, signal) => target.kind === "tab" ? useTabsStore.getState().activateTabForNavigation(target.id, signal) : desktopChatNavigation()?.navigate(target, signal) ?? false,
    })
    const unmount = mountDesktopNavigation(history)
    const tabs = useTabsStore.getState(), chat = useChatStore.getState()
    let accountId = chat.accountId
    let lastChat: ChatNavigationTarget | null = null
    let lastDraftId = ""
    let hasView = false
    const recordTab = () => {
      const state = useTabsStore.getState()
      if (state.activeTabId && state.tabs.some(tab => tab.id === state.activeTabId)) { history.record({ kind: "tab", id: state.activeTabId }); hasView = true }
    }
    const recordChat = (focus = false) => {
      const state = useChatStore.getState()
      if (state.accountId !== accountId) { history.reset(); accountId = state.accountId; lastChat = null; lastDraftId = ""; hasView = false; recordTab(); focus = false }
      if (state.recoveryStatus !== "ready" || !state.accountId || !state.conversationId && !state.draftId) return
      const target: ChatNavigationTarget = { kind: state.conversationId ? "conversation" : "draft", id: state.conversationId ?? state.draftId, accountId: state.accountId }
      const same = lastChat?.kind === target.kind && lastChat.id === target.id && lastChat.accountId === target.accountId
      if (!same && lastChat?.kind === "draft" && target.kind === "conversation" && lastDraftId === state.draftId) history.replace(lastChat, target)
      else if (focus || !same && (lastChat || !hasView)) { history.record(target); hasView = true }
      lastChat = target; lastDraftId = state.draftId
    }
    if (tabs.activeTabId) recordTab()
    recordChat()
    const releaseTabs = useTabsStore.subscribe((state, previous) => {
      if (state.activeTabId !== previous.activeTabId || state.activationNonce !== previous.activationNonce) { if (state.activeTabId) recordTab(); else recordChat(true) }
      history.refresh()
    })
    const releaseChat = useChatStore.subscribe((state, previous) => {
      recordChat(state.chatFocusNonce !== previous.chatFocusNonce)
      history.refresh()
    })
    const releaseAdapter = subscribeDesktopChatNavigation(() => { history.cancel(); history.refresh() })
    const navigate = (event: Event) => {
      const direction = (event as CustomEvent<unknown>).detail
      if (direction !== -1 && direction !== 1 || document.querySelector('[role="dialog"][aria-modal="true"],[data-desktop-recording="true"]')) return
      void history.go(direction).catch(error => toast.error(error instanceof Error ? error.message : "无法切换视图，草稿已保留"))
    }
    window.addEventListener("desktop:navigate", navigate)
    return () => { window.removeEventListener("desktop:navigate", navigate); releaseTabs(); releaseChat(); releaseAdapter(); unmount() }
  }, [])
  return null
}
