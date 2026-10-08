import test from "node:test"
import assert from "node:assert/strict"
import { useTabsStore, type Tab } from "../../src/stores/tabs"
import { registerSceneLeaveGuard, useSceneUiStore } from "../../src/stores/scene-ui"
const tab = (id: string): Tab => ({ id, novelId: "novel", type: "theme", title: id })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
function setup() { useTabsStore.setState({ tabs: [tab("a"), tab("b")], activeTabId: "a", activationNonce: 0, panelFocus: null, subTabs: {} }) }
test("navigation reuses normal activation and preserves content subviews/draft storage", async () => {
  setup(); useTabsStore.getState().setSubTab("a", "preview")
  const drafts = useSceneUiStore.getState().drafts
  assert.equal(await useTabsStore.getState().activateTabForNavigation("b", new AbortController().signal), true)
  assert.equal(useTabsStore.getState().activeTabId, "b"); assert.equal(useTabsStore.getState().activationNonce, 1)
  assert.equal(useTabsStore.getState().subTabs.a, "preview"); assert.equal(useSceneUiStore.getState().drafts, drafts)
})
test("scene leave guard is awaited once before committing", async () => {
  setup(); const gate = deferred(); let flushes = 0
  const release = registerSceneLeaveGuard("a", () => { flushes++; return gate.promise })
  try {
    const move = useTabsStore.getState().activateTabForNavigation("b", new AbortController().signal)
    assert.equal(flushes, 1); assert.equal(useTabsStore.getState().activeTabId, "a")
    gate.resolve(); assert.equal(await move, true); assert.equal(flushes, 1); assert.equal(useTabsStore.getState().activeTabId, "b")
  } finally { release() }
})
test("aborted or closed target after flush never activates", async () => {
  for (const mode of ["cancel", "remove"] as const) {
    setup(); const gate = deferred(); const controller = new AbortController(); const release = registerSceneLeaveGuard("a", () => gate.promise)
    try {
      const move = useTabsStore.getState().activateTabForNavigation("b", controller.signal)
      if (mode === "cancel") controller.abort()
      else useTabsStore.setState(state => ({ tabs: state.tabs.filter(t => t.id !== "b") }))
      gate.resolve(); assert.equal(await move, false); assert.equal(useTabsStore.getState().activeTabId, "a")
    } finally { release() }
  }
})
test("A to B to A invalidates an old guard even when the final active ID matches the source", async () => {
  setup(); const gate = deferred(); const release = registerSceneLeaveGuard("a", () => gate.promise)
  try {
    const move = useTabsStore.getState().activateTabForNavigation("b", new AbortController().signal)
    release(); useTabsStore.getState().activateTab("b"); useTabsStore.getState().activateTab("a")
    gate.resolve(); assert.equal(await move, false); assert.equal(useTabsStore.getState().activeTabId, "a")
    assert.equal(useTabsStore.getState().activationNonce, 2)
  } finally { release() }
})
test("guard failure is observable and keeps the old authoritative tab and unsaved draft", async () => {
  setup(); const failure = new Error("compare draft before leaving"); const release = registerSceneLeaveGuard("a", async () => { throw failure })
  try {
    await assert.rejects(useTabsStore.getState().activateTabForNavigation("b", new AbortController().signal), error => error === failure)
    assert.equal(useTabsStore.getState().activeTabId, "a"); assert.equal(useTabsStore.getState().activationNonce, 0)
  } finally { release() }
})
test("pre-aborted/missing/current targets never flush a draft; the selected target still signals content reopening", async () => {
  setup(); let flushes = 0; const release = registerSceneLeaveGuard("a", async () => { flushes++ })
  try {
    const controller = new AbortController(); controller.abort()
    assert.equal(await useTabsStore.getState().activateTabForNavigation("b", controller.signal), false)
    assert.equal(await useTabsStore.getState().activateTabForNavigation("missing", new AbortController().signal), false)
    assert.equal(await useTabsStore.getState().activateTabForNavigation("a", new AbortController().signal), true)
    assert.equal(flushes, 0); assert.equal(useTabsStore.getState().activationNonce, 1)
  } finally { release() }
})
