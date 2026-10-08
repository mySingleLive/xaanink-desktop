import assert from "node:assert/strict"
import { test } from "node:test"
import { WorkspaceDraftSource, workspaceLayoutSchema, workspaceTabSchema, type WorkspaceLayout } from "../../src/lib/desktop/workspace-draft-source"
import { TAB_TYPES, buildTabId, useTabsStore } from "../../src/stores/tabs"
const layout: WorkspaceLayout = { version: 1, narrowPane: "content", contentVisible: true, sidebarVisible: true, chatVisible: false, sizes: { sidebar: 25, chat: 0, content: 75 }, lastContentSize: 50, lastSidebarSize: 25, lastChatSize: 50 }
test("REC51-W01: current source uses actual tab store and one canonical 29 type catalog", () => {
  const previous = useTabsStore.getState(), source = new WorkspaceDraftSource(), tab = { id: buildTabId("theme", "n1"), type: "theme" as const, novelId: "n1", title: "题材" }
  try { useTabsStore.setState({ tabs: [tab], activeTabId: tab.id, subTabs: { [tab.id]: "details" } }); const saved = source.read(); assert.deepEqual(saved.tabs, [tab]); assert.equal(saved.activeTabId, tab.id); assert.equal(saved.subTabs[tab.id], "details"); assert.equal(TAB_TYPES.length, 29); assert.equal(new Set(TAB_TYPES).size, 29) } finally { useTabsStore.setState(previous) }
})
test("REC51-W02: layout restore waits for actual shell adapter and preserves state through detach", () => {
  const previous = useTabsStore.getState(), source = new WorkspaceDraftSource(), calls: WorkspaceLayout[] = []; let changed!: () => void, current = layout
  try { source.restore({ version: 1, tabs: [], activeTabId: null, subTabs: {}, layout }); assert.equal(source.layoutPending, true); const release = source.registerLayoutAdapter({ read: () => current, apply: value => { calls.push(value); current = value }, subscribe: listener => { changed = listener; return () => {} } }); assert.deepEqual(calls, [layout]); assert.equal(source.layoutPending, false); current = { ...layout, narrowPane: "sidebar" }; changed(); release(); assert.deepEqual(source.read().layout, current) } finally { useTabsStore.setState(previous) }
})
test("REC51-W03: invalid layout/identity is rejected rather than guessed, normalization cannot activate another entity", () => {
  assert.equal(workspaceLayoutSchema.safeParse({ ...layout, sizes: { sidebar: -1, chat: 0, content: 101 } }).success, false)
  assert.equal(workspaceLayoutSchema.safeParse({ ...layout, contentVisible: false, sidebarVisible: false }).success, false)
  assert.equal(workspaceTabSchema.safeParse({ id: "chapter-content:wrong", type: "chapter-content", novelId: "n1", refId: "c1", title: "章" }).success, false)
  assert.equal(workspaceTabSchema.safeParse({ id: "setting:undefined:n1", type: "setting", novelId: "n1", title: "设定" }).success, false)
  assert.equal(workspaceTabSchema.safeParse({ id: "chapter-candidate:c1", type: "chapter-candidate", refId: "c1", novelId: "n1", title: "候选" }).success, false)
})
test("REC51-W04: old adapter disposer never detaches newly mounted owner; capture uses latest owner", () => {
  const source = new WorkspaceDraftSource(), old = source.registerLayoutAdapter({ read: () => layout, apply() {}, subscribe: () => () => {} }), next = { ...layout, narrowPane: "chat" as const }, release = source.registerLayoutAdapter({ read: () => next, apply() {}, subscribe: () => () => {} })
  try { old(); assert.deepEqual(source.read().layout, next) } finally { release() }
})
