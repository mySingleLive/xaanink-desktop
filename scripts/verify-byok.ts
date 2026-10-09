/** Authorized live verification. Credentials enter only via non-echoing
 * stdin/environment; no repository/vault persistence or raw HTTP logging. */
import { createInterface } from "node:readline/promises"
import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import type { LanguageModelV4 } from "@ai-sdk/provider"
import sharp from "sharp"
import { ModelGateway } from "../desktop/core/model-authorization"
import { ModelService } from "../desktop/main/model-service"
import { ModelConfigurationService } from "../desktop/main/model-configuration"
import { generateMainImage } from "../desktop/main/image-generation"
import { PROVIDER_PRESETS, type ConfigurationDraft, type CatalogEntry, type ConfigurationProviderId } from "../desktop/shared/model-catalog"
import { testOutputBudget } from "../desktop/shared/provider-capabilities"
import { configureModelTransport, localModelRecord } from "../desktop/service/models"
import { instantiateModel } from "../src/lib/ai/provider"
import type { PublicModel } from "../desktop/core/settings"

type Credential = { provider: ConfigurationProviderId; key?: string; env?: string }
type Row = { provider: string; modelId?: string; kind?: string; phase: string; ok: boolean; status?: number; code?: string; at: string; durationMs?: number; usage?: unknown; textPresent?: boolean; decoded?: boolean; mimeType?: string; width?: number; height?: number; source?: string; permission?: string; available?: boolean }
async function main() {
const rows: Row[] = [], catalogs: unknown[] = []
const startedAt = new Date().toISOString()
const input = createInterface({ input: process.stdin, terminal: false })
console.log("credential-input-ready")
let credentials: Credential[]
try { credentials = JSON.parse(await new Promise<string>((resolve, reject) => { input.once("line", resolve); input.once("close", () => reject(Error("Missing credential input"))) })) } catch { throw Error("Invalid credential input") } finally { input.close() }
if (!Array.isArray(credentials) || credentials.length !== 6 || new Set(credentials.map(c => c.provider)).size !== 6 || credentials.some(c => !["openai", "deepseek", "zai", "moonshot", "minimax", "bytedance"].includes(c.provider))) throw Error("Invalid verification scope")
for (const c of credentials) if (!c.key && c.env) {
  c.key = process.env[c.env]
  if (!c.key) { try { c.key = execFileSync("launchctl", ["getenv", c.env], { encoding: "utf8" }).trim() } catch {} }
}
const secrets = credentials.map(c => c.key).filter((key): key is string => !!key)
;(globalThis as typeof globalThis & { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false
const selected = process.argv.find(arg => arg.startsWith("--providers="))?.split("=")[1].split(",")
const onlyCatalog = process.argv.includes("--catalog-only")
const requestedModels = process.argv.find(arg => arg.startsWith("--models="))?.slice(9).split(",")
if (onlyCatalog && requestedModels) throw Error("Catalog and model selection are mutually exclusive")
if (requestedModels && (!requestedModels.length || requestedModels.some(id => !/^[A-Za-z0-9._/-]{1,200}$/.test(id)))) throw Error("Invalid model selection")
const matchedModels = new Set<string>()
if (selected && (!selected.length || selected.some(id => !credentials.some(c => c.provider === id)))) throw Error("Invalid provider selection")
const safeWrite = (value: unknown) => {
  const text = JSON.stringify(value)
  if (secrets.some(secret => text.includes(secret))) throw Error("Sensitive output rejected")
  return text
}
const record = (row: Row) => { safeWrite(row); rows.push(row); console.log(safeWrite({ event: "case", ...row })) }
const knownCodes = new Set(["AUTHENTICATION_FAILED", "PERMISSION_DENIED", "QUOTA_EXCEEDED", "RATE_LIMITED", "MODEL_UNAVAILABLE", "OUTPUT_TRUNCATED", "TIMEOUT", "CANCELLED", "NETWORK_ERROR", "INVALID_RESPONSE", "AUTHORIZATION_REVOKED", "IMAGE_HTTP_401", "IMAGE_HTTP_402", "IMAGE_HTTP_403", "IMAGE_HTTP_429", "IMAGE_RESPONSE_INVALID", "IMAGE_PROVIDER_FAILED", "IMAGE_RESOURCE_REJECTED", "IMAGE_TIMEOUT", "IMAGE_GENERATION_UNSUPPORTED"])
function failureCode(error: unknown, status?: number) {
  const detail = error as { code?: unknown; responseBody?: unknown }
  let remoteCode = detail?.code
  if (typeof detail?.responseBody === "string" && detail.responseBody.length <= 65536) { try { remoteCode = JSON.parse(detail.responseBody)?.error?.code ?? remoteCode } catch {} }
  if (["credit_balance_exhausted", "insufficient_quota", "1008", "1113"].includes(String(remoteCode))) return "QUOTA_EXCEEDED"
  if (remoteCode === "ModelNotOpen") return "PERMISSION_DENIED"
  const code = (error as { code?: unknown })?.code
  if (typeof code === "string" && knownCodes.has(code)) return code
  return status === 401 ? "AUTHENTICATION_FAILED" : status === 402 ? "QUOTA_EXCEEDED" : status === 403 ? "PERMISSION_DENIED" : status === 404 ? "MODEL_UNAVAILABLE" : status === 429 ? "RATE_LIMITED" : "INVALID_RESPONSE"
}
function publicModel(draft: ConfigurationDraft, entry: CatalogEntry): PublicModel {
  return { id: randomUUID(), provider: draft.provider, name: entry.id, modelId: entry.id, protocol: draft.protocol, endpoint: draft.endpoint, kind: draft.kind, contextWindow: entry.contextWindow ?? 0, thinkingLevels: entry.thinkingLevels ?? [], defaultThinking: entry.defaultThinking ?? "default", enabled: true, authRevision: 1, keyMask: "" }
}
async function production(draft: ConfigurationDraft, entry: CatalogEntry, key: string, providerLabel = draft.provider) {
  let status: number | undefined
  const model = publicModel(draft, entry), started = Date.now()
  const gateway = new ModelGateway({ keyFor: async () => key, fetch: async (url, init) => { const r = await fetch(url, init); status = r.status; return r } })
  gateway.replace(model); const lease = gateway.begin(model.id, model.kind)
  const service = new ModelService({} as never, gateway)
  configureModelTransport(async (method, value) => { if (method === "model.assert") return service.assertAuthorization(value) as never; throw Error("Unexpected model transport") })
  const base = { provider: providerLabel, modelId: entry.id, kind: draft.kind, phase: draft.kind === "TEXT" ? "sdk" : "image-decode", at: new Date().toISOString(), source: entry.source }
  try {
    if (draft.kind === "IMAGE") {
      const image = await generateMainImage({ model, lease, gateway, prompt: "A single black dot on a plain white background.", signal: AbortSignal.timeout(300000) })
      const metadata = await sharp(image.bytes).metadata()
      record({ ...base, ok: true, decoded: true, mimeType: image.mimeType, width: metadata.width, height: metadata.height, status, durationMs: Date.now() - started })
    } else {
      const resolved = instantiateModel(localModelRecord(model), { fetch: (url, init) => gateway.fetch(lease, String(url), init), thinkingEffort: entry.thinkingLevels?.[0] })
      const adapter = resolved.model as LanguageModelV4
      const response = await adapter.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "Reply only with OK." }] }], maxOutputTokens: testOutputBudget(draft.provider, entry.id), providerOptions: resolved.providerOptions, abortSignal: AbortSignal.timeout(300000) })
      let textPresent = false, finished = false, truncated = false, usage: { inputTokens?: number; outputTokens?: number } | undefined
      for await (const part of response.stream) {
        if (part.type === "error") throw part.error
        if (part.type === "text-delta" && part.delta.trim()) textPresent = true
        if (part.type === "finish") { finished = true; truncated = part.finishReason.unified === "length"; usage = { inputTokens: part.usage.inputTokens.total, outputTokens: part.usage.outputTokens.total } }
      }
      const ok = textPresent && finished && !truncated
      record({ ...base, ok, textPresent, usage, ...(ok ? {} : { code: truncated ? "OUTPUT_TRUNCATED" : "INVALID_RESPONSE" }), status, durationMs: Date.now() - started })
    }
  } catch (error) { record({ ...base, ok: false, status, code: failureCode(error, status), durationMs: Date.now() - started }) }
  finally { gateway.finish(lease); gateway.remove(model.id); await service.close() }
}
async function configuration(draft: ConfigurationDraft, label = draft.provider, expectedCode?: string) {
  let status: number | undefined
  const fetcher: typeof fetch = async (url, init) => { const r = await fetch(url, init); status = r.status; return r }
  const service = new ModelConfigurationService({ repository: { read: async () => ({ models: [] }) as never, keyFor: async () => { throw Error("No saved credentials in live verification") } }, gateway: new ModelGateway({ keyFor: async () => "", fetch: fetcher }), fetch: fetcher })
  try {
    const result = await service.test("live", randomUUID(), draft, { authorizeCharge: true })
    record({ provider: label, modelId: draft.modelId, kind: draft.kind, phase: expectedCode ? "expected-rejection" : "configuration", ok: expectedCode ? !result.ok && result.code === expectedCode : result.ok, status, at: new Date().toISOString(), ...(!result.ok ? { code: result.code } : { durationMs: result.durationMs, usage: result.usage }) })
  } finally { await service.close() }
}
try {
  for (const credential of credentials) {
    if (selected && !selected.includes(credential.provider)) continue
    const preset = PROVIDER_PRESETS.find(p => p.id === credential.provider)!
    for (const kind of ["TEXT", "IMAGE"] as const) {
      const endpoint = kind === "TEXT" ? preset.textEndpoint : preset.imageEndpoint
      if (!endpoint) continue
      const draft: ConfigurationDraft = { provider: credential.provider, kind, protocol: preset.protocol!, endpoint, apiKey: credential.key ?? "" }
      let status: number | undefined
      const fetcher: typeof fetch = async (url, init) => { const r = await fetch(url, init); status = r.status; return r }
      const service = new ModelConfigurationService({ repository: { read: async () => ({ models: [] }) as never, keyFor: async () => { throw Error("No stored Key") } }, gateway: new ModelGateway({ keyFor: async () => "", fetch: fetcher }), fetch: fetcher })
      const catalog = await service.discover("live", randomUUID(), draft); await service.close()
      catalogs.push({ provider: credential.provider, kind, ...catalog })
      record({ provider: credential.provider, kind, phase: "catalog", ok: catalog.ok, status, at: new Date().toISOString(), ...(!catalog.ok ? { code: catalog.code } : {}) })
      if (!catalog.ok || onlyCatalog) continue
      if (!catalog.models.some(m => m.available !== false)) record({ provider: credential.provider, kind, phase: "catalog-coverage", ok: false, code: "NO_AVAILABLE_MODELS", at: new Date().toISOString() })
      for (const entry of catalog.models) {
        if (requestedModels && !requestedModels.includes(entry.id)) continue
        matchedModels.add(entry.id)
        if (entry.available === false) { await configuration({ ...draft, modelId: entry.id }, credential.provider, "MODEL_UNAVAILABLE"); continue }
        await configuration({ ...draft, modelId: entry.id })
        await production({ ...draft, modelId: entry.id }, entry, credential.key!)
      }
    }
  }
  // All builtin batches settle before any custom request starts.
  if (!onlyCatalog && !selected && !requestedModels) {
    const openai = credentials.find(c => c.provider === "openai")
    const deepseek = credentials.find(c => c.provider === "deepseek")
    const custom = (protocol: "openai" | "anthropic", endpoint: string, kind: "TEXT" | "IMAGE", modelId: string, key: string): ConfigurationDraft => ({ provider: "custom", kind, protocol, endpoint, modelId, apiKey: key })
    const configs = [
      openai?.key ? custom("openai", "https://api.openai.com/v1", "TEXT", "gpt-4.1-mini", openai.key) : undefined,
      deepseek?.key ? custom("anthropic", "https://api.deepseek.com/anthropic", "TEXT", "deepseek-flash", deepseek.key) : undefined,
      openai?.key ? custom("openai", "https://api.openai.com/v1", "IMAGE", "gpt-image-2.5-flare", openai.key) : undefined,
    ]
    for (const draft of configs) if (draft) {
      await configuration(draft, "custom")
      await production(draft, { id: draft.modelId!, name: draft.modelId!, kind: draft.kind, permission: "unknown", source: "用户明确授权的自定义端点" }, draft.apiKey)
    }
    if (openai?.key) {
      await configuration(custom("openai", "https://api.openai.com/v1", "TEXT", "gpt-4.1-mini", "byok-invalid-public-test-key"), "custom", "AUTHENTICATION_FAILED")
      await configuration(custom("openai", "https://api.openai.com/v1", "TEXT", "byok-model-does-not-exist", openai.key), "custom", "MODEL_UNAVAILABLE")
    }
  }
} finally {
  if (requestedModels && !onlyCatalog) for (const id of requestedModels) if (!matchedModels.has(id)) record({ provider: "selected-scope", modelId: id, phase: "coverage", ok: false, code: "MODEL_NOT_IN_CATALOG", at: new Date().toISOString() })
  const report = { startedAt, completedAt: new Date().toISOString(), mode: onlyCatalog ? "catalog-only" : selected || requestedModels ? "scoped" : "full", scope: selected ?? credentials.map(c => c.provider), requestedModelIds: requestedModels, credentialPersistence: false, automaticPaidRetries: 0, catalogs, results: rows, passed: rows.length > 0 && rows.every(r => r.ok) }
  const text = safeWrite(report)
  await mkdir("docs/evidence/byok", { recursive: true })
  const path = `docs/evidence/byok/real-${startedAt.replace(/[^0-9]/g, "")}.json`
  await writeFile(path, text + "\n")
  credentials.forEach(c => { c.key = "" }); secrets.fill("")
  console.log(JSON.stringify({ event: "complete", path, cases: rows.length, failed: rows.filter(r => !r.ok).length }))
  if (!report.passed) process.exitCode = 1
}
}
void main().catch(() => { console.error("Verification runner failed before completion; no successful acceptance is recorded."); process.exitCode = 1 })
