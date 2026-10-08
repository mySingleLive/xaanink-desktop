import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { transformSync } from "esbuild"
import * as jsxRuntime from "react/jsx-runtime"
import * as history from "../../src/lib/desktop/navigation-history"
import * as runtime from "../../src/lib/desktop/navigation-runtime"
import { useTabsStore, type Tab } from "../../src/stores/tabs"
import { useChatStore } from "../../src/stores/chat"
function controlledWindow() {
  const window = new EventTarget(), document = { querySelector: () => null as unknown }, cleanup: Array<() => void> = [], commands: Record<string, any> = {}
  const deps: Record<string, unknown> = {
    react: { useEffect: (effect: () => () => void) => cleanup.push(effect()), useSyncExternalStore: (_s: unknown, read: () => unknown) => read() },
    "react/jsx-runtime": jsxRuntime,
    "@/stores/tabs": { useTabsStore }, "@/stores/chat": { useChatStore },
    "@/lib/desktop/navigation-history": history, "@/lib/desktop/navigation-runtime": runtime,
    "@/lib/desktop/use-command-target": { useDesktopCommands: (value: unknown) => Object.assign(commands, value) },
    "@/stores/desktop": { useDesktopStore: (read: (state: unknown) => unknown) => read({ bootstrap: { platform: "darwin" } }) },
    "lucide-react": { ArrowLeft: () => null, ArrowRight: () => null, Menu: () => null, PanelLeft: () => null }, "sonner": { toast: { error() {} } },
  }
  function load<T>(path: string) {
    const module = { exports: {} as T }
    const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), { loader: "tsx", format: "cjs", jsx: "automatic" }).code
    new Function("module", "exports", "require", "window", "document", code)(module, module.exports, (name: string) => { if (name in deps) return deps[name]; throw Error(`Unexpected dependency ${name}`) }, window, document)
    return module.exports
  }
  const navigation = load<{ DesktopNavigation(): null }>("../../src/components/desktop/DesktopNavigation.tsx")
  const controls = load<{ SidebarWindowControls(options: {}): any }>("../../src/components/desktop/WindowControls.tsx")
  navigation.DesktopNavigation()
  return { window, document, commands, controls, dispose: () => { while (cleanup.length) cleanup.pop()!() } }
}
const tab = (id: string): Tab => ({ id, type: "theme", novelId: "novel", title: id })
function setup() {
  useTabsStore.setState({ tabs: [tab("a"), tab("b")], activeTabId: "a", activationNonce: 0 })
  useChatStore.setState({ accountId: "author", conversationId: "chat-a", draftId: "draft-a", recoveryStatus: "ready", chatFocusNonce: 0 })
}
async function settle() { for (let n = 0; n < 8; n++) await Promise.resolve() }
function arrow(f: ReturnType<typeof controlledWindow>, label: string) { return f.controls.SidebarWindowControls({}).props.children.find((child: any) => child?.props?.["aria-label"] === label) }
test("mount has one current view, arrows reflect boundaries, and actual event moves the original Tab store", async () => {
  setup(); const f = controlledWindow()
  try {
    assert.equal(arrow(f, "后退").props.disabled, true); assert.equal(arrow(f, "前进").props.disabled, true)
    useTabsStore.getState().activateTab("b"); assert.equal(arrow(f, "后退").props.disabled, false)
    arrow(f, "后退").props.onClick(); await settle()
    assert.equal(useTabsStore.getState().activeTabId, "a"); assert.equal(arrow(f, "后退").props.disabled, true)
    assert.equal(arrow(f, "前进").props.disabled, false)
    await f.commands["view.forward"].run(); assert.equal(useTabsStore.getState().activeTabId, "b")
    assert.equal(f.commands["view.forward"].enabled(), false)
  } finally { f.dispose() }
})
test("committed chat focus uses its async adapter; repeated focus is not a new history step", async () => {
  setup(); const f = controlledWindow(), calls: string[] = []
  const release = runtime.registerDesktopChatNavigation({ accountId: "author", available: target => target.accountId === "author", navigate: async target => {
    calls.push(target.id); useChatStore.setState({ conversationId: target.id, recoveryStatus: "ready" }); return true
  } })
  try {
    useChatStore.getState().requestChatFocus(); useChatStore.getState().requestChatFocus()
    useTabsStore.getState().activateTab("b"); await f.commands["view.back"].run(); assert.deepEqual(calls, ["chat-a"])
    await f.commands["view.back"].run(); assert.equal(useTabsStore.getState().activeTabId, "a")
    assert.equal(f.commands["view.back"].enabled(), false)
  } finally { release(); f.dispose() }
})
test("modal/recording blocks top-arrow requests and closed tabs cannot be reopened from history", async () => {
  setup(); const f = controlledWindow()
  try {
    useTabsStore.getState().activateTab("b"); f.document.querySelector = () => ({})
    arrow(f, "后退").props.onClick(); await settle(); assert.equal(useTabsStore.getState().activeTabId, "b")
    f.document.querySelector = () => null; useTabsStore.getState().closeTab("a")
    assert.equal(arrow(f, "后退").props.disabled, true)
    assert.equal(useTabsStore.getState().tabs.length, 1)
  } finally { f.dispose() }
})
test("failed chat loading that restores the same view does not append a ghost entry or truncate forward history", async () => {
  setup(); const f = controlledWindow()
  const release = runtime.registerDesktopChatNavigation({ accountId: "author", available: () => true, navigate: async () => {
    useChatStore.setState({ recoveryStatus: "restoring" }); useChatStore.setState({ recoveryStatus: "ready" }); return false
  } })
  try {
    useChatStore.getState().requestChatFocus()
    useTabsStore.getState().activateTab("b")
    useChatStore.setState({ conversationId: "chat-b", draftId: "draft-b" })
    useTabsStore.getState().activateTab("a")
    assert.equal(await runtime.navigateDesktopHistory(-1), false)
    assert.equal(runtime.desktopNavigationSnapshot().canForward, false)
    useChatStore.getState().requestChatFocus()
    await runtime.navigateDesktopHistory(-1)
    assert.equal(useTabsStore.getState().activeTabId, "a", "the failed chat load must leave the preceding tab A in history")
  } finally { release(); f.dispose() }
})
test("initial asynchronous session restoration does not invent a visit behind the initial Tab", () => {
  setup(); useChatStore.setState({ recoveryStatus: "restoring" })
  const f = controlledWindow()
  try {
    useChatStore.setState({ recoveryStatus: "ready" })
    assert.deepEqual(runtime.desktopNavigationSnapshot(), { canBack: false, canForward: false, pending: false })
  } finally { f.dispose() }
})
test("returning from chat to an already-selected Tab emits the layout activation signal", async () => {
  setup(); const f = controlledWindow()
  try {
    useChatStore.getState().requestChatFocus()
    const nonce = useTabsStore.getState().activationNonce
    assert.equal(await runtime.navigateDesktopHistory(-1), true)
    assert.equal(useTabsStore.getState().activeTabId, "a")
    assert.equal(useTabsStore.getState().activationNonce, nonce + 1, "DashboardShell uses activationNonce to reopen a hidden content pane")
    assert.equal(runtime.desktopNavigationSnapshot().canBack, false)
  } finally { f.dispose() }
})
