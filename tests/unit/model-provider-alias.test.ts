import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { localModelRecord, snapshotForRecord } from "../../desktop/service/models"
import { instantiateModel } from "../../src/lib/ai/provider"
import { thinkingEffortOptionsFor } from "../../src/lib/ai/thinking-effort"
import type { PublicModel } from "../../desktop/core/settings"

for (const [provider, canonical, modelId, endpoint] of [
  ["moonshot", "kimi", "kimi-k3", "https://api.moonshot.cn/v1"],
  ["zai", "zhipu", "glm-5.3", "https://api.z.ai/api/paas/v4"],
  ["alibaba", "qwen", "qwen-fixture", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
] as const) {
  test(`provider preset ${provider} retains ${canonical} SDK/capability semantics without rewriting stored identity or endpoint`, () => {
    const supported=thinkingEffortOptionsFor(provider,modelId).map(option=>option.value)
    const model: PublicModel = { id: randomUUID(), provider, modelId, protocol: "openai", endpoint, name: "公开夹具", kind: "TEXT", contextWindow: 0, enabled: true, authRevision: 1, keyMask: "••••••••", thinkingLevels: supported, defaultThinking: supported.includes("high")?"high":"default" }
    const record = localModelRecord(model)
    const actual = instantiateModel(record)
    const expected = instantiateModel(localModelRecord({ ...model, provider: canonical }))
    assert.deepEqual(actual.providerOptions, expected.providerOptions, "configured thinking must survive a supplier-ID alias")
    assert.deepEqual(thinkingEffortOptionsFor(provider, modelId), thinkingEffortOptionsFor(canonical, modelId))
    assert.equal((actual.model as { provider: string }).provider, (expected.model as { provider: string }).provider)
    assert.equal(record.provider, provider)
    assert.equal(record.baseUrl, endpoint)
    assert.equal(snapshotForRecord(record).provider, provider)
    assert.equal(snapshotForRecord(record).protocol, "openai")
    assert.equal(snapshotForRecord(record).endpoint, endpoint)
    // Supplier aliases must never replace an author's explicitly selected protocol.
    const explicit = instantiateModel(localModelRecord({ ...model, protocol: "anthropic" }))
    assert.match((explicit.model as { provider: string }).provider, /anthropic/)
  })
}
