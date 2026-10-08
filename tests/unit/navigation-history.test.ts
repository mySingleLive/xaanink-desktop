import test from "node:test"
import assert from "node:assert/strict"
import { DesktopNavigationHistory, type DesktopNavigationTarget } from "../../src/lib/desktop/navigation-history"
const tab = (id: string): DesktopNavigationTarget => ({ kind: "tab", id })
const chat = (id: string, kind: "conversation" | "draft" = "conversation", accountId = "author"): DesktopNavigationTarget => ({ kind, id, accountId })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function fixture(limit?: number) {
  const closed = new Set<string>(), applied: DesktopNavigationTarget[] = []
  const history = new DesktopNavigationHistory({ available: target => !closed.has(target.id), apply: target => { applied.push(target); return true }, limit })
  return { history, closed, applied }
}
test("committed tab and conversation targets navigate both ways without recording a new visit", async () => {
  const f = fixture(); f.history.record(tab("a")); f.history.record(chat("chat-b")); f.history.record(tab("c"))
  assert.deepEqual(f.history.getSnapshot(), { canBack: true, canForward: false, pending: false })
  assert.equal(await f.history.go(-1), true); assert.deepEqual(f.applied, [chat("chat-b")])
  assert.equal(await f.history.go(-1), true); assert.deepEqual(f.applied.at(-1), tab("a"))
  assert.equal(await f.history.go(-1), false)
  assert.equal(await f.history.go(1), true); assert.deepEqual(f.applied.at(-1), chat("chat-b"))
  assert.equal(await f.history.go(1), true); assert.equal(await f.history.go(1), false)
})
test("repeat activation and rename do not add duplicate entries; a new committed view truncates the forward branch", async () => {
  const f = fixture(); f.history.record(tab("a")); f.history.record(tab("a")); f.history.record(tab("b")); f.history.record(tab("b"))
  await f.history.go(-1); f.history.record(tab("c"))
  assert.equal(f.history.getSnapshot().canForward, false); await f.history.go(-1)
  assert.deepEqual(f.applied, [tab("a"), tab("a")]); assert.equal(await f.history.go(-1), false)
})
test("closed/deleted targets are skipped and cannot produce a same-view ghost step", async () => {
  const f = fixture(); for (const id of ["a", "b", "a", "c"]) f.history.record(tab(id))
  f.closed.add("b"); f.history.refresh(); await f.history.go(-1)
  assert.deepEqual(f.applied, [tab("a")]); assert.equal(f.history.getSnapshot().canBack, false)
  await f.history.go(1); assert.deepEqual(f.applied.at(-1), tab("c"))
})
test("failed and thrown navigation leave the pointer and forward branch unchanged", async () => {
  let throws = false
  const h = new DesktopNavigationHistory({ available: () => true, apply: () => { if (throws) throw Error("draft flush failed"); return false } })
  h.record(tab("a")); h.record(tab("b")); assert.equal(await h.go(-1), false)
  assert.deepEqual(h.getSnapshot(), { canBack: true, canForward: false, pending: false })
  throws = true; await assert.rejects(h.go(-1), /draft flush failed/)
  assert.deepEqual(h.getSnapshot(), { canBack: true, canForward: false, pending: false })
})
test("pending navigation disables both buttons and duplicate commands do not run a second apply", async () => {
  const gate = deferred<boolean>(); let calls = 0
  const h = new DesktopNavigationHistory({ available: () => true, apply: () => { calls++; return gate.promise } })
  h.record(tab("a")); h.record(tab("b")); const move = h.go(-1)
  assert.deepEqual(h.getSnapshot(), { canBack: false, canForward: false, pending: true })
  assert.equal(await h.go(-1), false); assert.equal(calls, 1); gate.resolve(true); assert.equal(await move, true)
  assert.equal(h.getSnapshot().canForward, true)
})
test("actual target observation during apply acknowledges the existing historical position", async () => {
  let h!: DesktopNavigationHistory
  h = new DesktopNavigationHistory({ available: () => true, apply: target => { h.record(target); return true } })
  h.record(tab("a")); h.record(tab("b")); h.record(tab("c")); await h.go(-1); await h.go(-1)
  assert.equal(h.getSnapshot().canBack, false); assert.equal(h.getSnapshot().canForward, true)
  await h.go(1); await h.go(1); assert.equal(h.getSnapshot().canForward, false)
})
test("external navigation invalidates and aborts a pending move; a late success never changes the new pointer", async () => {
  const gate = deferred<boolean>(); let signal!: AbortSignal; const applied: DesktopNavigationTarget[] = []
  const h = new DesktopNavigationHistory({ available: () => true, apply: (target, current) => { applied.push(target); signal = current; return applied.length === 1 ? gate.promise : true } })
  h.record(tab("a")); h.record(tab("b")); const old = h.go(-1); h.record(tab("c"))
  assert.equal(signal.aborted, true); gate.resolve(true); assert.equal(await old, false)
  assert.equal(h.getSnapshot().canForward, false); await h.go(-1); assert.deepEqual(applied.at(-1), tab("b"))
})
test("an unavailable destination after waiting is not committed, even if an adapter reports success", async () => {
  const gate = deferred<boolean>(); let available = true
  const h = new DesktopNavigationHistory({ available: target => target.id !== "a" || available, apply: () => gate.promise })
  h.record(tab("a")); h.record(tab("b")); const move = h.go(-1); available = false; h.refresh(); gate.resolve(true)
  assert.equal(await move, false); assert.equal(h.getSnapshot().canBack, false)
})
test("first save promotes a draft to its conversation without a phantom history entry", async () => {
  const f = fixture(); const draft = chat("draft-a", "draft")
  f.history.record(tab("a")); f.history.record(draft); f.history.record(tab("b")); f.history.replace(draft, chat("saved-a"))
  await f.history.go(-1); assert.deepEqual(f.applied.at(-1), chat("saved-a"))
  await f.history.go(-1); assert.deepEqual(f.applied.at(-1), tab("a"))
})
test("promotion deduplicates adjacent identities and keeps the current cursor aligned", async () => {
  const f = fixture(); const draft = chat("draft-a", "draft")
  f.history.record(tab("a")); f.history.record(chat("saved-a")); f.history.record(draft)
  f.history.replace(draft, chat("saved-a")); await f.history.go(-1)
  assert.deepEqual(f.applied, [tab("a")]); assert.equal(f.history.getSnapshot().canBack, false)
})
test("history is bounded and targets/snapshots cannot be mutated by callers", async () => {
  const f = fixture(3); const first = tab("a"); f.history.record(first); first.id = "mutated"
  for (const id of ["b", "c", "d"]) f.history.record(tab(id))
  assert.ok(Object.isFrozen(f.history.getSnapshot())); await f.history.go(-1); await f.history.go(-1)
  assert.deepEqual(f.applied, [tab("c"), tab("b")]); assert.equal(await f.history.go(-1), false)
})
test("reset/dispose abort pending IO and old completion cannot recreate history", async () => {
  for (const action of ["reset", "dispose"] as const) {
    const gate = deferred<boolean>(); let signal!: AbortSignal
    const h = new DesktopNavigationHistory({ available: () => true, apply: (_, current) => { signal = current; return gate.promise } })
    h.record(tab("a")); h.record(tab("b")); const old = h.go(-1); h[action]()
    assert.equal(signal.aborted, true); gate.resolve(true); assert.equal(await old, false)
    assert.deepEqual(h.getSnapshot(), { canBack: false, canForward: false, pending: false })
    if (action === "dispose") { h.record(tab("a")); h.record(tab("b")); assert.equal(await h.go(-1), false) }
  }
})
test("snapshot subscription changes only when state changes and invalid limits are rejected", () => {
  const f = fixture(); let count = 0; const release = f.history.subscribe(() => { count++ })
  f.history.record(tab("a")); f.history.record(tab("a")); const before = count; f.history.record(tab("b")); assert.equal(count, before + 1)
  const snapshot = f.history.getSnapshot(); f.history.refresh(); assert.equal(snapshot, f.history.getSnapshot())
  release(); f.history.reset(); assert.equal(count, before + 1)
  assert.throws(() => fixture(1), /limit/); assert.throws(() => fixture(2.5), /limit/)
})
