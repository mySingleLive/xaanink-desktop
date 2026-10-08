import assert from "node:assert/strict"
import { test } from "node:test"
import { AutosaveController } from "../../src/lib/autosave-controller"
import { DesktopSaveCoordinator, type DesktopDraftSnapshot } from "../../src/lib/desktop/save-coordinator"

function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes }); return { promise, resolve } }
async function tick() { for (let n = 0; n < 24; n++) await Promise.resolve() }

test("SAVE50-REVIEW01: synchronous saving subscribers share one flush and one durable write", async () => {
  const coordinator = new DesktopSaveCoordinator({ checkpointDelayMs: null }), gate = deferred()
  let writes = 0, entered = false, nested: Promise<DesktopDraftSnapshot> | undefined
  const releaseWriter = coordinator.configurePersistence(async () => { writes++; await gate.promise })
  const unsubscribe = coordinator.subscribe(state => {
    if (state.status === "saving" && !entered) { entered = true; nested = coordinator.flushAll() }
  })
  const outer = coordinator.flushAll()
  try {
    await tick()
    assert.equal(entered, true)
    assert.equal(writes, 1, "the shared flight must be installed before notifying synchronous subscribers")
    gate.resolve()
    const [a, b] = await Promise.all([outer, nested!])
    assert.equal(a.revision, b.revision)
    assert.equal(writes, 1)
  } finally { gate.resolve(); await Promise.allSettled([outer, ...(nested ? [nested] : [])]); unsubscribe(); releaseWriter() }
})

test("SAVE50-REVIEW02: the default 800ms checkpoint journals paused input without resuming or approving it", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const coordinator = new DesktopSaveCoordinator(), written: DesktopDraftSnapshot[] = []
  let saves = 0
  const controller = new AutosaveController<string>(async () => { saves++ }, 60000)
  const release = coordinator.register(controller), releaseWriter = coordinator.configurePersistence(async snapshot => { written.push(snapshot) })
  try {
    controller.pause(); controller.schedule("暂停核验期间的作者输入")
    context.mock.timers.tick(799); await tick(); assert.equal(written.length, 0)
    context.mock.timers.tick(1); await tick()
    assert.equal(written.length, 1, "a recovery journal must include the drafts most likely to need recovery")
    assert.equal(saves, 0, "checkpointing is not a business save or approval")
    const draft = written[0].autosaves[0].draft
    assert.equal(draft.paused, true); assert.equal(draft.pending?.value, "暂停核验期间的作者输入")
    assert.equal(controller.dirty, true)
    await assert.rejects(coordinator.flushAll(), { code: "AUTOSAVE_FLUSH_FAILED" }, "a checkpoint acknowledgement cannot confirm close or unpause the source")
    assert.equal(saves, 0)
  } finally { releaseWriter(); release(); controller.dispose(); context.mock.timers.reset() }
})

test("SAVE50-REVIEW03: checkpoint preserves both failed and newer pending operations without retrying either save", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const coordinator = new DesktopSaveCoordinator(), written: DesktopDraftSnapshot[] = []
  const attempted: Array<{ value: string; operationId: string }> = []
  const controller = new AutosaveController<string>(async (value, attempt) => { attempted.push({ value, operationId: attempt.operationId }); throw new Error("isolated unconfirmed save") }, 60000)
  const release = coordinator.register(controller), releaseWriter = coordinator.configurePersistence(async snapshot => { written.push(snapshot) })
  try {
    controller.schedule("未确认的原请求")
    await assert.rejects(controller.flush())
    controller.schedule("失败后继续输入的正文")
    context.mock.timers.tick(800); await tick()
    assert.equal(written.length, 1)
    const draft = written[0].autosaves[0].draft
    assert.equal(draft.failed?.value, "未确认的原请求")
    assert.equal(draft.failed?.operationId, attempted[0].operationId)
    assert.equal(draft.pending?.value, "失败后继续输入的正文")
    assert.notEqual(draft.pending?.operationId, draft.failed?.operationId)
    assert.deepEqual(attempted.map(attempt => attempt.value), ["未确认的原请求"])
    assert.equal(controller.dirty, true)
  } finally { releaseWriter(); release(); controller.dispose(); context.mock.timers.reset() }
})

test("SAVE50-REVIEW04: an in-flight pure checkpoint cannot satisfy a concurrent paused close request", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const coordinator = new DesktopSaveCoordinator(), gate = deferred(), written: DesktopDraftSnapshot[] = []
  let saves = 0
  const controller = new AutosaveController<string>(async () => { saves++ }, 60000)
  const release = coordinator.register(controller), releaseWriter = coordinator.configurePersistence(async snapshot => { written.push(snapshot); await gate.promise })
  try {
    controller.pause(); controller.schedule("冲突草稿仍须作者处理")
    context.mock.timers.tick(800); await tick()
    assert.equal(written.length, 1)
    const close = coordinator.flushAll().then(() => ({ closed: true, error: undefined }), error => ({ closed: false, error }))
    gate.resolve()
    const result = await close
    assert.equal(result.closed, false, "durable recovery data is not a successful business flush")
    assert.equal(result.error?.code, "AUTOSAVE_FLUSH_FAILED")
    assert.equal(saves, 0)
    assert.equal(controller.dirty, true)
  } finally { gate.resolve(); await tick(); releaseWriter(); release(); controller.dispose(); context.mock.timers.reset() }
})

test("SAVE50-REVIEW05: unreadable sources preserve detached cached data but never overwrite a valid durable journal", async () => {
  const coordinator = new DesktopSaveCoordinator({ checkpointDelayMs: null })
  const value = { draft: { text: "上一份完整可读草稿" } }, written: DesktopDraftSnapshot[] = []
  let broken = false
  const releaseSource = coordinator.registerSource("owned", { read: () => { if (broken) throw new Error("private directory and credentials"); return value } })
  const releaseWriter = coordinator.configurePersistence(async snapshot => { written.push(snapshot) })
  try {
    await coordinator.flushAll(); assert.equal(written.length, 1)
    broken = true
    const exported = coordinator.exportSnapshot()
    assert.deepEqual(exported.issues, [{ source: "owned", code: "DRAFT_SOURCE_UNREADABLE" }])
    assert.deepEqual(exported.sources.owned, value)
    ;(exported.sources.owned as typeof value).draft.text = "污染导出副本"
    assert.deepEqual(coordinator.exportSnapshot().sources.owned, value)
    assert.equal(JSON.stringify(exported).includes("credentials"), false)
    await assert.rejects(coordinator.flushAll(), { code: "DRAFT_SOURCE_UNREADABLE" })
    assert.equal(written.length, 1, "available fallback exports are not complete current durable snapshots")
  } finally { releaseWriter(); releaseSource() }
})

test("SAVE50-REVIEW06: checkpoint and close journal writes are serialized and cannot finish on an older pending revision", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const coordinator = new DesktopSaveCoordinator(), gate = deferred(), written: DesktopDraftSnapshot[] = [], saved: string[] = []
  let writing = 0, maximumConcurrent = 0
  const controller = new AutosaveController<string>(async value => { saved.push(value) }, 60000)
  const release = coordinator.register(controller), releaseWriter = coordinator.configurePersistence(async snapshot => {
    maximumConcurrent = Math.max(maximumConcurrent, ++writing); written.push(snapshot)
    try { if (written.length === 1) await gate.promise } finally { writing-- }
  })
  let close: Promise<DesktopDraftSnapshot> | undefined
  try {
    controller.schedule("检查点捕获的旧输入"); context.mock.timers.tick(800); await tick()
    assert.equal(written.length, 1); assert.equal(saved.length, 0)
    controller.schedule("关闭必须确认的新输入")
    close = coordinator.flushAll()
    await tick(); assert.deepEqual(saved, ["关闭必须确认的新输入"])
    assert.equal(maximumConcurrent, 1, "close cannot write over a still-pending checkpoint")
    gate.resolve(); const confirmed = await close; await tick()
    assert.equal(maximumConcurrent, 1)
    assert.equal(confirmed.autosaves[0].draft.latest?.value, "关闭必须确认的新输入")
    assert.equal(confirmed.autosaves[0].draft.pending, null)
    assert.equal(written.at(-1)?.autosaves[0].draft.latest?.value, "关闭必须确认的新输入")
    for (let n = 1; n < written.length; n++) assert.ok(written[n].revision >= written[n - 1].revision)
  } finally { gate.resolve(); if (close) await Promise.allSettled([close]); await tick(); releaseWriter(); release(); controller.dispose(); context.mock.timers.reset() }
})

test("SAVE50-REVIEW07: input scheduled by a synchronous durable-ack subscriber is saved before close confirmation", async () => {
  const coordinator = new DesktopSaveCoordinator({ checkpointDelayMs: null }), saved: string[] = [], written: DesktopDraftSnapshot[] = []
  const controller = new AutosaveController<string>(async value => { saved.push(value) }, 60000)
  const release = coordinator.register(controller), releaseWriter = coordinator.configurePersistence(async snapshot => { written.push(snapshot) })
  let changed = false
  const unsubscribe = coordinator.subscribe(state => {
    if (state.status === "saved" && !changed) { changed = true; controller.schedule("确认回调中新输入") }
  })
  try {
    controller.schedule("第一次输入")
    const confirmed = await coordinator.flushAll()
    assert.deepEqual(saved, ["第一次输入", "确认回调中新输入"])
    assert.equal(controller.dirty, false)
    assert.equal(confirmed.autosaves[0].draft.latest?.value, "确认回调中新输入")
    assert.equal(written.at(-1)?.autosaves[0].draft.latest?.value, "确认回调中新输入")
  } finally { unsubscribe(); releaseWriter(); release(); controller.dispose() }
})

test("SAVE50-REVIEW08: a rejected paused close does not erase the pending recovery checkpoint", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const coordinator = new DesktopSaveCoordinator(), written: DesktopDraftSnapshot[] = []
  let saves = 0
  const controller = new AutosaveController<string>(async () => { saves++ }, 60000)
  const release = coordinator.register(controller), releaseWriter = coordinator.configurePersistence(async snapshot => { written.push(snapshot) })
  try {
    controller.pause(); controller.schedule("关闭被拒绝后仍需要崩溃保护的输入")
    await assert.rejects(coordinator.flushAll(), { code: "AUTOSAVE_FLUSH_FAILED" })
    context.mock.timers.tick(800); await tick()
    assert.equal(written.length, 1, "remaining in the window must not permanently cancel its recovery checkpoint")
    assert.equal(written[0].autosaves[0].draft.pending?.value, "关闭被拒绝后仍需要崩溃保护的输入")
    assert.equal(controller.dirty, true); assert.equal(saves, 0)
  } finally { releaseWriter(); release(); controller.dispose(); context.mock.timers.reset() }
})

test("SAVE50-REVIEW09: a pure journal error retains the draft and stops automatic retries until an explicit retry", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const coordinator = new DesktopSaveCoordinator()
  let writes = 0, saves = 0, fail = true
  const controller = new AutosaveController<string>(async () => { saves++ }, 60000)
  const release = coordinator.register(controller), releaseWriter = coordinator.configurePersistence(async () => {
    writes++; if (fail) throw new Error("private path and arbitrary credentials")
  })
  try {
    controller.pause(); controller.schedule("磁盘失败也不能丢弃的输入")
    context.mock.timers.tick(800); await tick()
    assert.equal(writes, 1); assert.equal(coordinator.getState().failure, "DURABLE_SAVE_FAILED")
    context.mock.timers.tick(8000); await tick()
    assert.equal(writes, 1, "a journal failure must not repeatedly retry itself")
    assert.equal(saves, 0); assert.equal(controller.dirty, true)
    assert.equal(coordinator.exportSnapshot().autosaves[0].draft.pending?.value, "磁盘失败也不能丢弃的输入")
    fail = false
    const retried = await coordinator.checkpointDrafts()
    assert.equal(writes, 2); assert.equal(retried.autosaves[0].draft.pending?.value, "磁盘失败也不能丢弃的输入")
    assert.equal(controller.dirty, true); assert.equal(saves, 0)
  } finally { releaseWriter(); release(); controller.dispose(); context.mock.timers.reset() }
})
