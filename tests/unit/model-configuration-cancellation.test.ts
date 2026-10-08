import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { setImmediate as tick } from "node:timers/promises"
import { ModelGateway } from "../../desktop/core/model-authorization"
import { ModelConfigurationService } from "../../desktop/main/model-configuration"
import type { ModelRepository } from "../../desktop/main/model-repository"
import type { ConfigurationDraft } from "../../desktop/shared/model-catalog"

test("sixteen completed cancellations cannot permanently exhaust configuration operations", async () => {
  const late = Promise.withResolvers<void>()
  let calls = 0
  const signals: AbortSignal[] = []
  const fetcher: typeof fetch = async (_url, init) => {
    calls++
    signals.push(init!.signal!)
    // Model a host adapter that ignores AbortSignal. Only the first sixteen
    // calls hang; a new request can succeed without waiting for them to settle.
    if (calls <= 16) await late.promise
    return new Response(JSON.stringify({ data: [{ id: "fixture-text", output_modalities: ["text"] }] }))
  }
  const repository = { read: async () => ({ models: [] }), keyFor: async () => "fixture-key" } as unknown as Pick<ModelRepository, "read" | "keyFor">
  const gateway = new ModelGateway({ keyFor: repository.keyFor, fetch: fetcher })
  const service = new ModelConfigurationService({ repository, gateway, fetch: fetcher, timeoutMs: 120_000 })
  const draft: ConfigurationDraft = { provider: "deepseek", kind: "TEXT", protocol: "openai", endpoint: "https://api.deepseek.com", apiKey: "fixture-key" }
  try {
    for (let i = 0; i < 16; i++) {
      const id = randomUUID()
      const pending = service.discover("fixture-owner", id, draft)
      await tick()
      service.cancel("fixture-owner", id)
      const result = await pending
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.code, "CANCELLED")
      assert.equal(signals[i].aborted, true)
    }
    const retry = await service.discover("fixture-owner", randomUUID(), draft)
    assert.equal(retry.ok, true, "a completed cancel must release the configuration operation slot")
    if (retry.ok) assert.deepEqual(retry.models.map(model => model.id), ["fixture-text"])
    assert.equal(calls, 17)
    late.resolve()
    await tick()
    // Old work may settle, but cannot resume paging or send another request.
    assert.equal(calls, 17)
  } finally { late.resolve(); await tick(); await service.close() }
})
