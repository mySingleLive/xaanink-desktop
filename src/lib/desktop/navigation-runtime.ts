import { DesktopNavigationHistory, type ChatNavigationTarget, type NavigationSnapshot } from "./navigation-history"
export interface DesktopChatNavigation {
  accountId: string
  available(target: ChatNavigationTarget): boolean
  navigate(target: ChatNavigationTarget, signal: AbortSignal): Promise<boolean>
}
const idle: NavigationSnapshot = Object.freeze({ canBack: false, canForward: false, pending: false })
let active: DesktopNavigationHistory | null = null
let chat: DesktopChatNavigation | null = null
const listeners = new Set<() => void>(), chatListeners = new Set<() => void>()
function changed() { for (const listener of listeners) listener() }
export function subscribeDesktopNavigation(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function desktopNavigationSnapshot() { return active?.getSnapshot() ?? idle }
export function desktopNavigationServerSnapshot() { return idle }
export function mountDesktopNavigation(history: DesktopNavigationHistory) {
  if (active) throw new Error("Desktop navigation is already mounted")
  active = history; const release = history.subscribe(changed); changed()
  return () => { if (active === history) { release(); active = null; history.dispose(); changed() } }
}
export function navigateDesktopHistory(direction: -1 | 1) { return active?.go(direction) ?? Promise.resolve(false) }
export function desktopChatNavigation() { return chat }
export function subscribeDesktopChatNavigation(listener: () => void) { chatListeners.add(listener); return () => { chatListeners.delete(listener) } }
export function registerDesktopChatNavigation(adapter: DesktopChatNavigation) {
  chat = adapter; for (const listener of chatListeners) listener()
  return () => { if (chat === adapter) { chat = null; for (const listener of chatListeners) listener() } }
}
