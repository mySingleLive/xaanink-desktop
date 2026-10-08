import { test } from "node:test"
import assert from "node:assert/strict"
import { ModelAuthorizationError } from "../../desktop/core/model-authorization"
import { modelFailureNotice } from "../../desktop/main/model-guidance"
test("model guidance: actual AI invocation preserves its required role and exact configuration failure", () => {
  for (const role of ["text","review","image"] as const) for (const code of ["MODEL_NOT_CONFIGURED","MODEL_NOT_SELECTED","MODEL_NOT_FOUND","MODEL_DISABLED","MODEL_KEY_MISSING","MODEL_KIND_MISMATCH","MODEL_UNAVAILABLE","AUTHORIZATION_REVOKED"]) {
    assert.deepEqual(modelFailureNotice(new ModelAuthorizationError(code),{role}),{type:"model-required",role,code})
  }
})
test("model guidance: selection validation and unrelated errors do not open an AI-first-use prompt", () => {
  assert.equal(modelFailureNotice(new ModelAuthorizationError("MODEL_DISABLED"),{role:"text",intent:"selection"}),null)
  assert.equal(modelFailureNotice(new Error("MODEL_NOT_CONFIGURED"),{role:"image"}),null)
  assert.equal(modelFailureNotice(new ModelAuthorizationError("API_KEY_IS_SECRET"),{role:"image"}),null)
  assert.equal(modelFailureNotice(new ModelAuthorizationError("MODEL_DISABLED"),{role:"bad"}),null)
  assert.equal(modelFailureNotice(new ModelAuthorizationError("MODEL_DISABLED"),null),null)
})
