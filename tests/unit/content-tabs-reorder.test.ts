import test from "node:test"
import assert from "node:assert/strict"
import { useTabsStore, type Tab } from "../../src/stores/tabs"
import { registerSceneLeaveGuard } from "../../src/stores/scene-ui"

function setup() {
  const tabs: Tab[] = ["a", "b", "c"].map(id => ({ id, type: "theme", novelId: "isolated-tabs", title: id }))
  const subTabs = { a: "draft", b: "preview" }, panelFocus = { tabId: "a", settingId: "isolated-setting" }
  useTabsStore.setState({ tabs, activeTabId: "a", activationNonce: 7, subTabs, panelFocus })
  return { tabs, subTabs, panelFocus }
}
function move(id: string, destination: number) {
  const action = (useTabsStore.getState() as unknown as { moveTab?: (id: string, destination: number) => void }).moveTab
  assert.equal(typeof action, "function", "Approved ContentTabs requires a real store moveTab action")
  action!(id, destination)
}
const order = () => useTabsStore.getState().tabs.map(tab => tab.id)

test("TABS-store-01 selected/inactive reorder retains original objects and all panel state without leave guard", () => {
  const before = setup(); let flushes = 0, updates = 0
  const release = registerSceneLeaveGuard("a", async () => { flushes++ })
  const unsubscribe = useTabsStore.subscribe(() => { updates++ })
  try {
    move("a", 2); assert.deepEqual(order(), ["b", "c", "a"])
    move("c", 0); assert.deepEqual(order(), ["c", "b", "a"])
    const state = useTabsStore.getState()
    assert.equal(state.tabs[0], before.tabs[2]); assert.equal(state.tabs[1], before.tabs[1]); assert.equal(state.tabs[2], before.tabs[0])
    assert.equal(state.activeTabId, "a"); assert.equal(state.activationNonce, 7)
    assert.equal(state.subTabs, before.subTabs); assert.equal(state.panelFocus, before.panelFocus)
    assert.equal(flushes, 0); assert.equal(updates, 2)
  } finally { unsubscribe(); release() }
})
test("TABS-store-02 missing id, nonfinite/fractional index and same location produce no updates", () => {
  setup(); const before = useTabsStore.getState(); let updates = 0
  const unsubscribe = useTabsStore.subscribe(() => { updates++ })
  try {
    for (const destination of [NaN, Infinity, -Infinity, .5, 1.1]) move("a", destination)
    move("missing", 2); move("a", 0)
    assert.equal(useTabsStore.getState(), before); assert.equal(updates, 0)
  } finally { unsubscribe() }
})
test("TABS-store-03 finite out-of-range integers clamp to first/last and valid same-position clamp is a no-op", () => {
  setup(); move("a", 999); assert.deepEqual(order(), ["b", "c", "a"])
  move("a", -999); assert.deepEqual(order(), ["a", "b", "c"])
  const before = useTabsStore.getState(); move("a", -1); assert.equal(useTabsStore.getState(), before)
  useTabsStore.setState({ tabs: [], activeTabId: null }); const empty = useTabsStore.getState()
  move("a", 0); assert.equal(useTabsStore.getState(), empty)
})
test("TABS-store-04 closing selected tab uses its new left neighbor, retaining remaining subviews", () => {
  setup(); move("a", 2); useTabsStore.getState().closeTab("a")
  assert.deepEqual(order(), ["b", "c"]); assert.equal(useTabsStore.getState().activeTabId, "c")
  assert.deepEqual(useTabsStore.getState().subTabs, { b: "preview" })
  setup(); move("c", 0); useTabsStore.getState().activateTab("c"); useTabsStore.getState().closeTab("c")
  assert.deepEqual(order(), ["a", "b"]); assert.equal(useTabsStore.getState().activeTabId, "a")
})
