/** Main/worker startup barrier only. No renderer or arbitrary error content. */
export const ROOT_STARTUP_BYTES = 64 * 1024
const HEADER_BYTES = Int32Array.BYTES_PER_ELEMENT * 4
const VERSION = 1
export const rootStartupErrorCodes = [
  "BOOTSTRAP_UNAVAILABLE", "METADATA_UNSAFE", "POINTER_INVALID", "JOURNAL_INVALID", "JOURNAL_CHANGED",
  "ROOT_UNAVAILABLE", "ROOT_MARKER_INVALID", "ROOT_PATH_INVALID", "POINTER_REQUIRED", "POINTER_ALREADY_EXISTS",
  "POINTER_CHANGED", "POINTER_REVISION_EXHAUSTED", "MIGRATION_BUSY", "MIGRATION_RECOVERY_REQUIRED", "MIGRATION_CANCELLED",
  "ROOT_OVERLAP", "TARGET_NOT_EMPTY", "TARGET_UNAVAILABLE", "TARGET_UNSAFE", "TARGET_CHANGED", "INSUFFICIENT_SPACE",
  "SOURCE_NOT_CLOSED", "SOURCE_UNSAFE", "SOURCE_CHANGED", "OWNERSHIP_INVALID", "OWNERSHIP_INCOMPLETE", "CATALOG_INVALID",
  "WORK_PATH_PROTECTED", "VERIFY_FAILED", "NEW_ROOT_VERIFY_FAILED", "ROOT_INITIALIZATION_FAILED", "ROOT_STARTUP_FAILED",
  "ROOT_STARTUP_TIMEOUT", "ROOT_STARTUP_ENVELOPE_INVALID",
] as const
export type RootStartupErrorCode = typeof rootStartupErrorCodes[number]
export type RootStartupResult = { version: 1; status: "ready"; root: string } | { version: 1; status: "failed"; code: RootStartupErrorCode }
export class RootStartupError extends Error {
  constructor(readonly code: RootStartupErrorCode) { super(code); this.name = "RootStartupError" }
}
export function isRootStartupErrorCode(value: unknown): value is RootStartupErrorCode {
  return typeof value === "string" && (rootStartupErrorCodes as readonly string[]).includes(value)
}
export function createRootStartupBuffer(): SharedArrayBuffer { return new SharedArrayBuffer(ROOT_STARTUP_BYTES) }
function header(buffer: SharedArrayBuffer) {
  if (!(buffer instanceof SharedArrayBuffer) || buffer.byteLength !== ROOT_STARTUP_BYTES) throw new RootStartupError("ROOT_STARTUP_ENVELOPE_INVALID")
  return new Int32Array(buffer, 0, 4)
}
function validResult(value: unknown, status: number): value is RootStartupResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  if (result.version !== VERSION) return false
  if (status === 1) return result.status === "ready" && Object.keys(result).sort().join(",") === "root,status,version" && typeof result.root === "string" && result.root.length <= 4096 && /^(?:\/|[a-zA-Z]:[\\/]|\\\\)/.test(result.root) && !/[\x00-\x1f]/.test(result.root)
  return status === 2 && result.status === "failed" && Object.keys(result).sort().join(",") === "code,status,version" && isRootStartupErrorCode(result.code)
}
/** Single worker writer. Status is the final atomic publication, after bytes. */
export function publishRootStartup(buffer: SharedArrayBuffer, result: RootStartupResult): void {
  const words = header(buffer), status = result.status === "ready" ? 1 : 2
  if (Atomics.load(words, 0) !== 0 || !validResult(result, status)) throw new RootStartupError("ROOT_STARTUP_ENVELOPE_INVALID")
  const bytes = new TextEncoder().encode(JSON.stringify(result))
  if (bytes.length > buffer.byteLength - HEADER_BYTES) throw new RootStartupError("ROOT_STARTUP_ENVELOPE_INVALID")
  new Uint8Array(buffer, HEADER_BYTES).set(bytes)
  Atomics.store(words, 1, VERSION); Atomics.store(words, 2, bytes.length); Atomics.store(words, 3, 0)
  Atomics.store(words, 0, status); Atomics.notify(words, 0)
}
export function readRootStartup(buffer: SharedArrayBuffer): RootStartupResult | null {
  const words = header(buffer), status = Atomics.load(words, 0)
  if (status === 0) return null
  const length = Atomics.load(words, 2)
  if ((status !== 1 && status !== 2) || Atomics.load(words, 1) !== VERSION || Atomics.load(words, 3) !== 0 || length <= 0 || length > buffer.byteLength - HEADER_BYTES) throw new RootStartupError("ROOT_STARTUP_ENVELOPE_INVALID")
  let value: unknown
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(buffer, HEADER_BYTES, length))) }
  catch { throw new RootStartupError("ROOT_STARTUP_ENVELOPE_INVALID") }
  if (!validResult(value, status)) throw new RootStartupError("ROOT_STARTUP_ENVELOPE_INVALID")
  return value
}
/** Call before main's first await; never during interactive window work. */
export function waitRootStartup(buffer: SharedArrayBuffer, timeoutMs = 45_000): RootStartupResult {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 120_000) throw new RootStartupError("ROOT_STARTUP_ENVELOPE_INVALID")
  const words = header(buffer)
  if (Atomics.wait(words, 0, 0, timeoutMs) === "timed-out") return { version: 1, status: "failed", code: "ROOT_STARTUP_TIMEOUT" }
  return readRootStartup(buffer) ?? { version: 1, status: "failed", code: "ROOT_STARTUP_ENVELOPE_INVALID" }
}
