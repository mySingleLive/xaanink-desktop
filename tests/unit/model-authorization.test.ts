import assert from "node:assert/strict"
import { test } from "node:test"
import { ModelGateway, ModelAuthorizationError } from "../../desktop/core/model-authorization"

const row = { id: "local-model", authRevision: 1, endpoint: "https://model.test/v1", kind: "TEXT" as const, enabled: true }
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { resolve, promise } }
const blocked = (code: string) => (error: unknown) => error instanceof ModelAuthorizationError && error.code === code

test("DESK-A03/M14: missing, unselected, disabled and wrong-category selections have no fallback", () => {
  const gateway = new ModelGateway({ keyFor: async () => "fixture", fetch: async () => { throw new Error("must not send") } })
  assert.throws(() => gateway.begin("", "TEXT"), blocked("MODEL_NOT_CONFIGURED"))
  gateway.replace(row)
  assert.throws(() => gateway.begin("", "IMAGE"), blocked("MODEL_NOT_CONFIGURED"))
  assert.throws(() => gateway.begin("", "TEXT"), blocked("MODEL_NOT_SELECTED"))
  assert.throws(() => gateway.begin("absent", "TEXT"), blocked("MODEL_UNAVAILABLE"))
  assert.throws(() => gateway.begin(row.id, "IMAGE"), blocked("MODEL_KIND_MISMATCH"))
  gateway.replace({ ...row, authRevision: 2, enabled: false })
  assert.throws(() => gateway.begin(row.id, "TEXT"), blocked("MODEL_UNAVAILABLE"))
})

test("NET-01: authorization is checked after asynchronous key access, before every actual HTTP send", async () => {
  const key = deferred<string>(); const entered = deferred<void>(); let sent = 0
  const gateway = new ModelGateway({ keyFor: async () => { entered.resolve(); return key.promise }, fetch: async () => { sent++; return new Response("ok") } })
  gateway.replace(row); const lease = gateway.begin(row.id, "TEXT")
  const request = gateway.fetch(lease, "https://model.test/v1/chat/completions")
  await entered.promise
  gateway.replace({ ...row, authRevision: 2 })
  key.resolve("old-public-fixture-key")
  await assert.rejects(request, blocked("AUTHORIZATION_REVOKED"))
  assert.equal(lease.signal.aborted, true)
  assert.equal(sent, 0)
})

test("DESK-M13: failed draft save does not replace committed authorization; committed revision revokes old lease", async () => {
  const sent: string[] = []
  const gateway = new ModelGateway({ keyFor: async (_id, rev) => `fixture-${rev}`, fetch: async (_url, init) => { sent.push(new Headers(init?.headers).get("Authorization")!); return new Response("ok") } })
  gateway.replace(row); const old = gateway.begin(row.id, "TEXT")
  // Unsaved/cancelled/failed drafts never call replace. Old task stays usable.
  assert.equal(await (await gateway.fetch(old, "https://model.test/v1/chat/completions")).text(), "ok")
  gateway.replace({ ...row, authRevision: 2 })
  await assert.rejects(gateway.fetch(old, "https://model.test/v1/chat/completions"), blocked("AUTHORIZATION_REVOKED"))
  const next = gateway.begin(row.id, "TEXT")
  await gateway.fetch(next, "https://model.test/v1/chat/completions")
  assert.deepEqual(sent, ["Bearer fixture-1", "Bearer fixture-2"])
})

test("NET-01: queued retry, deleted model, cancelled draft and finished request cannot send", async () => {
  let sent = 0
  const gateway = new ModelGateway({ keyFor: async () => "fixture", fetch: async () => { sent++; return new Response("ok") } })
  gateway.replace(row); const revoked = gateway.begin(row.id, "TEXT"); gateway.remove(row.id)
  await assert.rejects(gateway.fetch(revoked, "https://model.test/v1/models"), blocked("AUTHORIZATION_REVOKED"))
  gateway.replace({ ...row, authRevision: 2 }); const finished = gateway.begin(row.id, "TEXT"); gateway.finish(finished)
  await assert.rejects(gateway.fetch(finished, "https://model.test/v1/models"), blocked("AUTHORIZATION_REVOKED"))
  assert.equal(sent, 0)
})

test("NET-02: endpoint/path/redirect escape is rejected without sending a credential elsewhere", async () => {
  const urls: string[] = []
  const gateway = new ModelGateway({ keyFor: async () => "public-fixture", fetch: async (input, init) => {
    urls.push(String(input)); assert.equal(init?.redirect, "manual")
    return new Response(null, { status: 307, headers: { Location: "https://unrelated.test/steal" } })
  } })
  gateway.replace(row); const lease = gateway.begin(row.id, "TEXT")
  for (const url of ["https://other.test/v1", "https://model.test/outside", "https://user:pass@model.test/v1/chat", "http://model.test/v1", "https://model.test/v1/../other", "https://model.test/v1/models?api_key=old-key", "https://model.test/v1/models?AccessToken=secret", "https://model.test/v1/models?%6bey=secret"]) {
    await assert.rejects(gateway.fetch(lease, url), blocked("ENDPOINT_NOT_AUTHORIZED"))
  }
  assert.equal(urls.length, 0)
  await assert.rejects(gateway.fetch(lease, "https://model.test/v1/chat/completions"), blocked("ENDPOINT_NOT_AUTHORIZED"))
  assert.deepEqual(urls, ["https://model.test/v1/chat/completions"])
})

test("NET-01: a response or delayed stream chunk after revocation cannot be consumed", async () => {
  const delivery = deferred<Response>()
  const gateway = new ModelGateway({ keyFor: async () => "fixture", fetch: () => delivery.promise })
  gateway.replace(row); const lease = gateway.begin(row.id, "TEXT")
  const pending = gateway.fetch(lease, "https://model.test/v1/chat/completions")
  await new Promise(resolve => setImmediate(resolve)); gateway.remove(row.id)
  delivery.resolve(new Response("late result"))
  await assert.rejects(pending, blocked("AUTHORIZATION_REVOKED"))

  let source!: ReadableStreamDefaultController<Uint8Array>
  const streaming = new ModelGateway({ keyFor: async () => "fixture", fetch: async () => new Response(new ReadableStream({ start(c) { source = c } })) })
  streaming.replace(row); const current = streaming.begin(row.id, "TEXT")
  const response = await streaming.fetch(current, "https://model.test/v1/chat/completions")
  const reader = response.body!.getReader(); const chunk = reader.read()
  const outcome = chunk.then(value => ({ value }), error => ({ error }))
  streaming.remove(row.id)
  const immediate = await Promise.race([outcome, new Promise<null>(resolve => setTimeout(() => resolve(null), 80))])
  if (!immediate) source.close()
  await outcome
  assert.ok(immediate && "error" in immediate && blocked("AUTHORIZATION_REVOKED")(immediate.error), "revoked reader must settle without server activity")
})

test("NET-01: revocation actively ends a stalled response reader without waiting for the server", async () => {
  let cancelled = false
  let source!: ReadableStreamDefaultController<Uint8Array>
  const gateway = new ModelGateway({ keyFor: async () => "fixture", fetch: async () => new Response(new ReadableStream({ start(c) { source = c }, cancel() { cancelled = true } })) })
  gateway.replace(row); const lease = gateway.begin(row.id, "TEXT")
  const response = await gateway.fetch(lease, "https://model.test/v1/chat/completions")
  const result = response.body!.getReader().read().then(value => ({ value }), error => ({ error }))
  gateway.remove(row.id)
  const immediate = await Promise.race([result, new Promise<null>(resolve => setTimeout(() => resolve(null), 80))])
  if (!immediate) source.close()
  await result
  assert.ok(immediate && "error" in immediate && blocked("AUTHORIZATION_REVOKED")(immediate.error), "revoked stream is hanging")
  assert.equal(cancelled, true)
})

test("NET-01: revocation discards a previously prefetched response chunk", async () => {
  const gateway = new ModelGateway({ keyFor: async () => "fixture", fetch: async () => new Response("prefetched") })
  gateway.replace(row); const lease = gateway.begin(row.id, "TEXT")
  const response = await gateway.fetch(lease, "https://model.test/v1/chat/completions")
  await new Promise(resolve => setImmediate(resolve))
  gateway.remove(row.id)
  await assert.rejects(response.body!.getReader().read(), blocked("AUTHORIZATION_REVOKED"))
})

test("NET-01: abort, finish, error and consumer cancellation release the underlying stream lock", async () => {
  for (const ending of ["remove", "finish", "cancel", "error"] as const) {
    let source!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(c) { source = c } })
    const gateway = new ModelGateway({ keyFor: async () => "fixture", fetch: async () => new Response(body) })
    gateway.replace(row); const lease = gateway.begin(row.id, "TEXT")
    const response = await gateway.fetch(lease, "https://model.test/v1/chat/completions")
    if (ending === "cancel") await response.body!.cancel()
    else {
      const result = response.body!.getReader().read()
      const assertion = assert.rejects(result)
      if (ending === "error") source.error(new Error("fixture stream failure"))
      else if (ending === "finish") gateway.finish(lease)
      else gateway.remove(row.id)
      await assertion
    }
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(body.locked, false, ending)
  }
})
