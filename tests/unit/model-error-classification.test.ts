import assert from "node:assert/strict"
import { test } from "node:test"
import { classifyError, classifyWireError, isRetryableNetworkError } from "../../src/lib/ai/error-classification"
test("DESK-M13: sanitized model network failures retain retry semantics through RPC/SDK wrappers", () => {
  const error = new Error("SDK transport failed", { cause: new Error("MODEL_NETWORK_ERROR") })
  assert.equal(classifyError(error).category, "network")
  assert.equal(isRetryableNetworkError(error), true)
  const revoked = new Error("SDK request failed", { cause: new Error("AUTHORIZATION_REVOKED") })
  assert.equal(classifyError(revoked).category, "model_unavailable")
  assert.equal(classifyError(revoked).retryScope, "none")
})
test("DEFAULT-13: every precise model configuration error survives SDK causes and wire classification without retry", () => {
  for (const code of ["MODEL_NOT_CONFIGURED", "MODEL_NOT_SELECTED", "MODEL_NOT_FOUND", "MODEL_DISABLED", "MODEL_KEY_MISSING", "MODEL_KIND_MISMATCH", "MODEL_THINKING_UNSUPPORTED", "AUTHORIZATION_REVOKED"]) {
    const wrapped = new Error("SDK request failed", { cause: new Error(code) })
    assert.equal(classifyError(wrapped).category, "model_unavailable", code)
    assert.equal(classifyError(wrapped).code, code)
    assert.equal(classifyError(wrapped).retryScope, "none")
    assert.equal(isRetryableNetworkError(wrapped), false)
    assert.equal(classifyWireError(code).category, "model_unavailable")
    assert.equal(classifyWireError(code).retryScope, "none")
  }
})
