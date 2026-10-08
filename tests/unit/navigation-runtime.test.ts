import test from "node:test"
import assert from "node:assert/strict"
import { DesktopNavigationHistory } from "../../src/lib/desktop/navigation-history"
import { desktopChatNavigation, desktopNavigationSnapshot, mountDesktopNavigation, navigateDesktopHistory, registerDesktopChatNavigation, subscribeDesktopChatNavigation, subscribeDesktopNavigation } from "../../src/lib/desktop/navigation-runtime"
test("window bridge starts disabled and a single mounted owner publishes state and handles navigation", async () => {
  assert.deepEqual(desktopNavigationSnapshot(), { canBack: false, canForward: false, pending: false })
  assert.equal(await navigateDesktopHistory(-1), false)
  let changes = 0; const release = subscribeDesktopNavigation(() => { changes++ })
  const applied: string[] = [], h = new DesktopNavigationHistory({ available: () => true, apply: target => { applied.push(target.id); return true } })
  const unmount = mountDesktopNavigation(h)
  try {
    assert.throws(() => mountDesktopNavigation(h), /already mounted/)
    h.record({ kind: "tab", id: "a" }); h.record({ kind: "tab", id: "b" })
    assert.equal(desktopNavigationSnapshot().canBack, true)
    assert.equal(await navigateDesktopHistory(-1), true); assert.deepEqual(applied, ["a"])
  } finally { unmount(); unmount(); release() }
  assert.ok(changes >= 3); assert.equal(desktopNavigationSnapshot().canBack, false)
})
test("late chat adapter cleanup cannot unregister a newer owner", () => {
  let changes = 0; const release = subscribeDesktopChatNavigation(() => { changes++ })
  const first = { accountId: "first", available: () => true, navigate: async () => true }, next = { ...first, accountId: "next" }
  const a = registerDesktopChatNavigation(first), b = registerDesktopChatNavigation(next)
  a(); assert.equal(desktopChatNavigation(), next); b(); assert.equal(desktopChatNavigation(), null)
  assert.equal(changes, 3); release()
})
test("unmount aborts pending navigation and returns the singleton to a stable idle snapshot", async () => {
  let finish!: (value: boolean) => void, signal!: AbortSignal
  const h = new DesktopNavigationHistory({ available: () => true, apply: (_, current) => { signal = current; return new Promise<boolean>(resolve => { finish = resolve }) } })
  const unmount = mountDesktopNavigation(h)
  h.record({ kind: "tab", id: "a" }); h.record({ kind: "tab", id: "b" }); const old = navigateDesktopHistory(-1)
  unmount(); assert.equal(signal.aborted, true); const idle = desktopNavigationSnapshot(); finish(true)
  assert.equal(await old, false); assert.equal(desktopNavigationSnapshot(), idle)
})
