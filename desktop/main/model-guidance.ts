import type { ModelRequiredNotice } from "../shared/ipc"
import { ModelAuthorizationError } from "../core/model-authorization"
const codes = new Set(["MODEL_NOT_CONFIGURED","MODEL_NOT_SELECTED","MODEL_NOT_FOUND","MODEL_DISABLED","MODEL_KEY_MISSING","MODEL_KIND_MISMATCH","MODEL_UNAVAILABLE","AUTHORIZATION_REVOKED"])
export function modelFailureNotice(error: unknown, input: unknown): ModelRequiredNotice | null {
  if (!(error instanceof ModelAuthorizationError) || !codes.has(error.code) || !input || typeof input !== "object") return null
  const value = input as { role?: unknown; intent?: unknown }
  if (value.intent !== undefined && value.intent !== "invoke") return null
  if (value.role !== "text" && value.role !== "review" && value.role !== "image") return null
  return {type:"model-required",role:value.role,code:error.code as ModelRequiredNotice["code"]}
}
