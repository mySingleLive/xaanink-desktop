import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { ModelService } from "../../desktop/main/model-service"
import { ModelGateway } from "../../desktop/core/model-authorization"
import type { ModelRepository } from "../../desktop/main/model-repository"
import { defaultState, type PublicModel } from "../../desktop/core/settings"
import { freezeTaskDefaults, modelIdForRole } from "../../desktop/shared/task-defaults"

function fixture() {
  const text = randomUUID(); const review = randomUUID(); const image = randomUUID()
  const model = (id: string, kind: "TEXT" | "IMAGE"): PublicModel => ({ id, name: "fixture", provider: "custom", modelId: "fixture", protocol: "openai", endpoint: "https://fixture.invalid/v1", kind, enabled: true, authRevision: 1, keyMask: "••••••••", contextWindow: 0, thinkingLevels: ["low", "high"], defaultThinking: "default" })
  const state = { revision: 7, settings: structuredClone(defaultState.settings), models: [model(text, "TEXT"), model(review, "TEXT"), model(image, "IMAGE")] }
  state.settings.agent = { textModelId: text, mode: "plan", thinking: "high", reviewModelId: review, imageModelId: image }
  let key = "main-private-fixture-key"; let requests = 0; let keyFailure: (() => void) | undefined
  const repository = { read: async () => structuredClone(state), keyFor: async () => { keyFailure?.(); return key } } as unknown as ModelRepository
  const gateway = new ModelGateway({ keyFor: async () => key, fetch: async () => { requests++; throw Error("must not fetch") } })
  const service = new ModelService(repository, gateway)
  return { state, text, review, image, service, setKey: (value: string) => { key = value }, setKeyFailure: (run: () => void) => { keyFailure = run }, requests: () => requests }
}
test("DEFAULT-01: all five task defaults are a detached immutable snapshot of one committed revision", async () => {
  const f = fixture()
  const snapshot = freezeTaskDefaults(f.state.settings.agent, f.state.revision)
  assert.equal(snapshot.version, 1); assert.equal(snapshot.revision, 7); assert.equal(snapshot.mode, "plan"); assert.equal(snapshot.thinking, "high")
  assert.equal(snapshot.textModelId, f.text); assert.equal(snapshot.reviewModelId, f.review); assert.equal(snapshot.imageModelId, f.image)
  f.state.settings.agent.textModelId = randomUUID(); f.state.settings.agent.mode = "standard"; f.state.settings.agent.thinking = "low"
  assert.equal(snapshot.textModelId, f.text); assert.equal(snapshot.mode, "plan"); assert.equal(snapshot.thinking, "high")
  assert.throws(() => { (snapshot as { textModelId: string | null }).textModelId = null }, TypeError)
})
test("DEFAULT-02: explicit IDs win, explicit null remains unselected, and each role has its own frozen default", () => {
  const f = fixture(); const snapshot = freezeTaskDefaults(f.state.settings.agent, 7)
  const explicit = randomUUID()
  assert.equal(modelIdForRole(snapshot, "text", explicit), explicit)
  assert.equal(modelIdForRole(snapshot, "text", null), null)
  assert.equal(modelIdForRole(snapshot, "text"), f.text)
  assert.equal(modelIdForRole(snapshot, "review"), f.review)
  assert.equal(modelIdForRole(snapshot, "image"), f.image)
})
test("DEFAULT-03: main emits only committed keyless defaults and old snapshots survive settings changes", async () => {
  const f = fixture(); const before = await f.service.defaults()
  f.state.settings.agent.textModelId = randomUUID(); f.state.settings.agent.mode = "standard"; f.state.revision++
  const next = await f.service.defaults()
  assert.equal(before.textModelId, f.text); assert.equal(before.mode, "plan"); assert.equal(before.revision, 7)
  assert.equal(next.textModelId, f.state.settings.agent.textModelId); assert.equal(next.revision, 8)
  assert.equal(JSON.stringify(before).includes("main-private-fixture-key"), false); assert.equal(f.requests(), 0)
})
test("DEFAULT-04: absent and disabled explicit records are accurately blocked instead of falling back", async () => {
  const f = fixture()
  await assert.rejects(f.service.resolve({ role: "text", id: randomUUID() }), /MODEL_NOT_FOUND/)
  f.state.models[0].enabled = false
  await assert.rejects(f.service.resolve({ role: "text", id: f.text }), /MODEL_DISABLED/)
  assert.equal(f.requests(), 0)
})
test("DEFAULT-05: a missing main-only credential fails before any model request", async () => {
  const f = fixture(); f.setKey("")
  await assert.rejects(f.service.resolve({ role: "text", id: f.text }), /MODEL_KEY_MISSING/)
  assert.equal(f.requests(), 0)
})
test("DEFAULT-06: text/review/image selection is explicit and kind mismatch or null never picks another record", async () => {
  const f = fixture()
  assert.equal((await f.service.resolve({ role: "text" })).id, f.text)
  assert.equal((await f.service.resolve({ role: "review" })).id, f.review)
  assert.equal((await f.service.resolve({ role: "image" })).id, f.image)
  await assert.rejects(f.service.resolve({ role: "text", id: f.image }), /MODEL_KIND_MISMATCH/)
  await assert.rejects(f.service.resolve({ role: "text", id: null }), /MODEL_NOT_SELECTED/)
  f.state.settings.agent.reviewModelId = null
  await assert.rejects(f.service.resolve({ role: "review" }), /MODEL_NOT_SELECTED/)
  assert.equal(f.requests(), 0)
})
test("DEFAULT-23: revocation while main checks the key is accurately blocked without leaking vault diagnostics", async () => {
  const f = fixture()
  f.setKeyFailure(() => { f.state.models[0].authRevision++; throw Error("private-vault-fixture-diagnostic") })
  await assert.rejects(f.service.resolve({ role: "text", id: f.text }), error => {
    assert.equal((error as Error).message, "AUTHORIZATION_REVOKED")
    assert.equal(JSON.stringify(error).includes("private-vault-fixture"), false)
    return true
  })
  assert.equal(f.requests(), 0)
})
