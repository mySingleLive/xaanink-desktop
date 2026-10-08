import assert from "node:assert/strict"
import { test } from "node:test"

import { apiGet, apiSend } from "../../src/components/content/api"
import { AutosaveController } from "../../src/lib/autosave-controller"
import { buildSyntheticReceipt, firstControl } from "../../src/lib/staged-save"
import { registerStagedInterception, useStagedChangesStore } from "../../src/stores/staged-changes"

const url = "/api/novels/staged-fixture/chapters/chapter-fixture"
const batchKey = "chapter-content:chapter-fixture"
const current = Object.freeze({ id: "chapter-fixture", title: "受控章节", content: "当前数据库正文", version: 7, updatedAt: "2026-01-01T00:00:00.000Z" })
type Chapter = typeof current

test("STAGED-V01: staging content must retain committed version/time and leave the input snapshot unchanged", () => {
  const { chapter } = buildSyntheticReceipt({
    snapshot: current,
    body: { content: "仅暂存的作者草稿", expectedVersion: current.version, operationId: "11111111-1111-4111-8111-111111111111" },
    envelope: "chapter",
  }) as { chapter: Chapter }
  assert.equal(chapter.content, "仅暂存的作者草稿")
  assert.equal(current.content, "当前数据库正文")
  assert.deepEqual(
    { version: chapter.version, updatedAt: chapter.updatedAt },
    { version: current.version, updatedAt: current.updatedAt },
    "only a confirmed durable write may advance committed revision tokens",
  )
})

test("STAGED-V02: autosave stage followed by undo/pending and an unchanged GET must not create a version conflict", async t => {
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(new URL(String(input), "https://fixture.invalid"), init)
    calls.push(request.method)
    assert.equal(request.method, "GET", "stage one must never send a database PATCH")
    return Response.json({ chapter: current })
  }) as typeof fetch
  registerStagedInterception({ resolveBatch: () => ({ batchKey, label: "受控章节" }), snapshot: async () => current })
  useStagedChangesStore.setState({ batches: {}, chips: [], sendRequest: null })
  let versionRef: number = current.version
  const controller = new AutosaveController<string>(async (value, attempt) => {
    const result = await apiSend<{ chapter: Chapter }>(url, "PATCH", { content: value, expectedVersion: versionRef, operationId: attempt.operationId })
    // The actual ChapterContentEditor callback assigns both versionRef and baseVersion from this field.
    versionRef = result.chapter.version
  }, 60_000)
  t.after(() => {
    controller.dispose()
    registerStagedInterception(null)
    useStagedChangesStore.setState({ batches: {}, chips: [], sendRequest: null })
    globalThis.fetch = originalFetch
  })

  controller.schedule(current.content + "——追加草稿——")
  await controller.flush()
  assert.equal(controller.status, "saved")
  assert.equal(useStagedChangesStore.getState().batches[batchKey].changes.length, 1)
  assert.deepEqual(calls, [], "registered snapshot supplies the baseline without any HTTP write")
  controller.schedule(current.content) // Undo is a new pending edit, before its debounce flush.
  assert.equal(controller.status, "pending")
  const refreshed = await apiGet<{ chapter: Chapter }>(url)
  assert.deepEqual(calls, ["GET"])
  assert.equal(refreshed.chapter.content, current.content)
  assert.equal(
    versionRef,
    refreshed.chapter.version,
    "an unchanged durable GET cannot differ from the editor's committed base merely because of local staging",
  )
})

test("STAGED-V03: repeated draft stages preserve the first real precondition and send only the latest content", async t => {
  registerStagedInterception({ resolveBatch: () => ({ batchKey, label: "受控章节" }), snapshot: async () => current })
  useStagedChangesStore.setState({ batches: {}, chips: [], sendRequest: null })
  t.after(() => {
    registerStagedInterception(null)
    useStagedChangesStore.setState({ batches: {}, chips: [], sendRequest: null })
  })
  const first = await apiSend<{ chapter: Chapter }>(url, "PATCH", { content: "第一帧草稿", expectedVersion: current.version, operationId: "11111111-1111-4111-8111-111111111111" })
  await apiSend<{ chapter: Chapter }>(url, "PATCH", { content: "最新一帧草稿", expectedVersion: first.chapter.version, operationId: "22222222-2222-4222-8222-222222222222" })
  const changes = useStagedChangesStore.getState().batches[batchKey].changes
  assert.equal(changes.length, 1)
  assert.deepEqual(firstControl(changes[0].request.body), { expectedVersion: current.version, operationId: "11111111-1111-4111-8111-111111111111" })
  assert.equal((changes[0].request.body as { content: string }).content, "最新一帧草稿")
})

test("STAGED-V04: body revision fields cannot replace or invent authoritative snapshot tokens", () => {
  const body = Object.freeze({ content: "暂存草稿", version: 999, updatedAt: "2099-01-01T00:00:00.000Z" })
  const present = buildSyntheticReceipt({ snapshot: current, body, envelope: "chapter" }).chapter as Record<string, unknown>
  assert.equal(present.content, body.content)
  assert.equal(present.version, current.version)
  assert.equal(present.updatedAt, current.updatedAt)

  const absent = buildSyntheticReceipt({ snapshot: { id: current.id, content: current.content }, body, envelope: "chapter" }).chapter as Record<string, unknown>
  assert.equal(absent.content, body.content)
  assert.equal(Object.hasOwn(absent, "version"), false, "missing durable metadata cannot be invented from a form/request body")
  assert.equal(Object.hasOwn(absent, "updatedAt"), false)
  assert.equal(body.version, 999)
  assert.equal(body.updatedAt, "2099-01-01T00:00:00.000Z", "filtering the derived data must not mutate the original body")
})
