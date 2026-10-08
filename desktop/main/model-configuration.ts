import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import type { ModelRepository } from "./model-repository"
import { ModelGateway, ModelAuthorizationError, validateModelEndpoint, type ModelLease } from "../core/model-authorization"
import { PROVIDER_PRESETS, type CatalogEntry, type CatalogResult, type ConfigurationDraft, type ConfigurationFailure, type ConfigurationErrorCode, type ConnectionTestResult } from "../shared/model-catalog"
import { discoverAlibaba, discoverTencent, discoverByteDanceSnapshot, testGoogleImage, testAlibabaImage, testTencentImage, testByteDanceImage, ProviderAdapterError, type ProviderAdapterContext } from "./model-provider-adapters"
export interface ModelConfigurationOptions {
  repository: Pick<ModelRepository, "read" | "keyFor">
  gateway: ModelGateway
  fetch: typeof fetch
  timeoutMs?: number
  maxPages?: number
  maxModels?: number
  maxResponseBytes?: number
  maxOperations?: number
  pollIntervalMs?: number
  maxPolls?: number
}
class ConfigurationError extends Error { constructor(readonly code: ConfigurationErrorCode, readonly status?: number) { super(code) } }
const messages: Record<ConfigurationErrorCode, string> = {
  INVALID_DRAFT: "模型草稿格式或供应商端点不符合要求", KEY_REQUIRED: "请为当前供应商和端点输入 API Key",
  SAVED_SCOPE_MISMATCH: "供应商、协议、地址或类别已变化，请重新输入 API Key", AUTHORIZATION_REVOKED: "原模型授权已失效，请重新读取配置",
  OPERATION_DUPLICATE: "此操作仍在执行或取消中", OPERATION_LIMIT: "正在执行的配置操作过多，请稍后再试",
  CANCELLED: "操作已取消", TIMEOUT: "供应商响应超时，请稍后再试", NETWORK_ERROR: "供应商连接失败或重定向不被允许",
  AUTHENTICATION_FAILED: "供应商拒绝了此 API Key", PERMISSION_DENIED: "此 Key 无权访问所选资源", HTTP_ERROR: "供应商未能完成请求",
  UNSUPPORTED_DISCOVERY: "此供应商完整目录适配尚未完成，不能把部分示例当成全部可用模型",
  UNSUPPORTED_TEST: "此模型的单次最小调用适配尚未完成，未发送付费请求", CATALOG_INCOMPLETE: "目录分页或数量超过边界，未返回截断目录",
  INVALID_RESPONSE: "供应商未返回有效的目录或模型输出", RESPONSE_TOO_LARGE: "供应商响应超过大小上限",
  CHARGE_AUTHORIZATION_REQUIRED: "测试会调用当前模型并产生费用，需用户主动发起",
}
function fail(code: ConfigurationErrorCode, status?: number): ConfigurationFailure { return { ok: false, code, message: messages[code], ...(status === undefined ? {} : { status }) } }
type Json = Record<string, unknown>
function object(value: unknown): Json { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConfigurationError("INVALID_RESPONSE"); return value as Json }
function positive(value: unknown): number | undefined { return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 100_000_000 ? Number(value) : undefined }
function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.length > 16 || value.some(v => typeof v !== "string" || !v || v.length > 30 || /[\x00-\x1f]/.test(v))) throw new ConfigurationError("INVALID_RESPONSE")
  return [...new Set(value as string[])]
}
function bounded(value: number | undefined, fallback: number, min: number, max: number) { const n = value ?? fallback; if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error("配置服务边界参数无效"); return n }
const sources = {
  openai: "https://developers.openai.com/api/reference/resources/models/methods/list", openaiCapabilities: "https://developers.openai.com/api/docs/models/all",
  anthropic: "https://platform.claude.com/docs/en/api/http/models/list", google: "https://ai.google.dev/api/models", googleCapabilities: "https://ai.google.dev/gemini-api/docs/models", googleImage: "https://ai.google.dev/gemini-api/docs/image-generation",
  xai: "https://docs.x.ai/developers/rest-api-reference/inference/models", deepseek: "https://api-docs.deepseek.com/api/list-models/",
  moonshot: "https://platform.kimi.com/docs/openapi.json", xiaomi: "https://mimo.mi.com/docs/en-US/api/model/list-models", xiaomiCapabilities: "https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/structured-output",
  minimaxText: "https://platform.minimax.io/docs/api-reference/text-openai-api", minimaxImage: "https://platform.minimax.io/docs/api-reference/image-generation-t2i", zaiImage: "https://docs.z.ai/api-reference/image/generate-image",
  zaiText: "https://docs.z.ai/api-reference/llm/chat-completion",
}
// Exact official capability annotations, checked 2026-10-07. This snapshot
// never replaces the Key's live catalog. No prefix/date/fine-tune guessing.
const openaiTextIds = new Set(["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini", "gpt-5.2", "gpt-5.2-pro", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5-pro", "o3-pro", "o3", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"])
const openaiImageIds = new Set(["gpt-image-2.5-sunburst", "gpt-image-2.5-sunburst-2026-09-08", "gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1.5", "chatgpt-image-latest", "gpt-image-1-mini", "gpt-image-1"])
const googleTextIds = new Set(["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"])
const googleImageIds = new Set(["gemini-nano-banana-2.1", "gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"])
const moonshotTextIds = new Set(["kimi-k3", "kimi-k2.6", "kimi-k2.7-code", "kimi-k2.7-code-highspeed"])
const xiaomiTextIds = new Set(["mimo-v2.6-flash", "mimo-v2.6-pro", "mimo-v2.6-pro-ultraspeed", "mimo-v2.5-pro", "mimo-v2.5"])
interface Operation {
  owner: string; id: string; token: string; draft: ConfigurationDraft; controller: AbortController; reason?: ConfigurationErrorCode
  key: string; secrets: Set<string>; gateway?: ModelGateway; lease?: ModelLease; savedLease?: ModelLease
  base: string; protocol: "openai" | "anthropic" | "google"; removeListeners: (() => void)[]; timer?: ReturnType<typeof setTimeout>
}
/** Main-process-only operations. No method writes the repository. */
export class ModelConfigurationService {
  private readonly active = new Map<string, Operation>()
  get activeCount() { return this.active.size }
  // Cancelled IDs consume no live quota and retain no draft/Key/Promise. This
  // bounded replay guard is cleared on real completion or service shutdown.
  private readonly retired = new Map<string, string>()
  private closed = false
  private readonly timeoutMs: number; private readonly maxPages: number; private readonly maxModels: number
  private readonly maxResponseBytes: number; private readonly maxOperations: number
  private readonly pollIntervalMs: number; private readonly maxPolls: number
  constructor(private readonly options: ModelConfigurationOptions) {
    this.timeoutMs = bounded(options.timeoutMs, 120_000, 1, 300_000); this.maxPages = bounded(options.maxPages, 20, 1, 100)
    this.maxModels = bounded(options.maxModels, 4096, 1, 10000); this.maxResponseBytes = bounded(options.maxResponseBytes, 16 * 1024 * 1024, 256, 64 * 1024 * 1024)
    this.maxOperations = bounded(options.maxOperations, 16, 1, 64)
    this.pollIntervalMs = bounded(options.pollIntervalMs, 3000, 1, 30_000); this.maxPolls = bounded(options.maxPolls, 100, 1, 200)
  }
  discover(owner: string, operationId: string, draft: ConfigurationDraft, signal?: AbortSignal): Promise<CatalogResult | ConfigurationFailure> { return this.execute(owner, operationId, draft, signal, op => this.discoverCatalog(op)) }
  test(owner: string, operationId: string, draft: ConfigurationDraft, options: { authorizeCharge: boolean }, signal?: AbortSignal): Promise<ConnectionTestResult | ConfigurationFailure> {
    if (options?.authorizeCharge !== true) return Promise.resolve(fail("CHARGE_AUTHORIZATION_REQUIRED"))
    if (typeof draft?.modelId !== "string" || !draft.modelId.trim()) return Promise.resolve(fail("INVALID_DRAFT"))
    return this.execute(owner, operationId, draft, signal, op => this.testConnection(op))
  }
  cancel(owner: string, id: string) { const op = this.active.get(this.operationKey(owner, id)); if (op) this.abort(op, "CANCELLED") }
  cancelOwner(owner: string) { for (const op of this.active.values()) if (op.owner === owner) this.abort(op, "CANCELLED") }
  async close() {
    this.closed = true; for (const op of this.active.values()) this.abort(op, "CANCELLED")
    // Untrusted fetch may ignore cancellation forever; final HTTP guards still
    // prevent its late work, while application shutdown remains bounded.
    this.active.clear(); this.retired.clear()
  }
  private operationKey(owner: string, id: string) { return `${owner}\0${id}` }
  private assertCurrent(op: Operation) { if (op.controller.signal.aborted || this.closed) throw new ConfigurationError(op.reason ?? "CANCELLED") }
  private abort(op: Operation, code: ConfigurationErrorCode) {
    if (op.controller.signal.aborted) return
    op.reason = code; op.controller.abort(new ConfigurationError(code)); op.key = ""; op.draft.apiKey = ""
    clearTimeout(op.timer); for (const remove of op.removeListeners) remove(); op.removeListeners.length = 0; op.secrets.clear()
    const key = this.operationKey(op.owner, op.id)
    if (this.active.get(key) === op) {
      this.active.delete(key); this.retired.set(key, op.token)
      while (this.retired.size > this.maxOperations * 32) this.retired.delete(this.retired.keys().next().value!)
    }
    if (op.gateway && op.lease) op.gateway.finish(op.lease)
    if (op.savedLease) this.options.gateway.finish(op.savedLease)
  }
  private checkText(op: Operation, value: unknown, limit = 200): string {
    if (typeof value !== "string" || !value.trim() || value.length > limit || /[\x00-\x1f\x7f]/.test(value) || [...op.secrets].some(key => value.includes(key))) throw new ConfigurationError("INVALID_RESPONSE")
    return value.trim()
  }
  private validateDraft(input: ConfigurationDraft): ConfigurationDraft {
    if (!input || typeof input !== "object") throw new ConfigurationError("INVALID_DRAFT")
    const { id, provider, kind, protocol, endpoint, apiKey, modelId } = input
    if (!PROVIDER_PRESETS.some(p => p.id === provider) || !["TEXT", "IMAGE"].includes(kind) || !["openai", "anthropic"].includes(protocol) || typeof endpoint !== "string" || endpoint.length > 2048 || typeof apiKey !== "string" || apiKey.length > 8192 || /[\x00-\x1f\x7f]/.test(apiKey) || (id !== undefined && (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) || (modelId !== undefined && (typeof modelId !== "string" || modelId.length > 200 || /[\x00-\x1f\x7f]/.test(modelId)))) throw new ConfigurationError("INVALID_DRAFT")
    try { const url = validateModelEndpoint(endpoint); if (url.search) throw Error("query") } catch { throw new ConfigurationError("INVALID_DRAFT") }
    return { id, provider, kind, protocol, endpoint, apiKey: apiKey.trim(), modelId: modelId?.trim() }
  }
  private async execute<T extends CatalogResult | ConnectionTestResult>(owner: string, id: string, input: ConfigurationDraft, signal: AbortSignal | undefined, action: (op: Operation) => Promise<T>): Promise<T | ConfigurationFailure> {
    if (this.closed) return fail("CANCELLED")
    if (typeof owner !== "string" || !owner || owner.length > 128 || owner.includes("\0") || typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return fail("INVALID_DRAFT")
    const key = this.operationKey(owner, id)
    if (this.active.has(key) || this.retired.has(key)) return fail("OPERATION_DUPLICATE")
    if (this.active.size >= this.maxOperations) return fail("OPERATION_LIMIT")
    let draft: ConfigurationDraft
    try { draft = this.validateDraft(input) } catch { return fail("INVALID_DRAFT") }
    const op: Operation = { owner, id, token: randomUUID(), draft, controller: new AbortController(), key: "", secrets: new Set(), base: draft.endpoint, protocol: draft.protocol, removeListeners: [] }
    this.active.set(key, op); if (draft.apiKey) op.secrets.add(draft.apiKey)
    const timer = op.timer = setTimeout(() => this.abort(op, "TIMEOUT"), this.timeoutMs)
    if (signal) {
      const aborted = () => this.abort(op, "CANCELLED")
      signal.addEventListener("abort", aborted, { once: true }); op.removeListeners.push(() => signal.removeEventListener("abort", aborted)); if (signal.aborted) aborted()
    }
    let onAbort!: () => void
    const aborted = new Promise<ConfigurationFailure>(resolve => {
      onAbort = () => resolve(fail(op.reason ?? "CANCELLED")); op.controller.signal.addEventListener("abort", onAbort, { once: true }); if (op.controller.signal.aborted) onAbort()
    })
    const work = (async () => {
      try {
        this.assertCurrent(op); await this.prepareAuthorization(op); this.assertCurrent(op)
        const result = await action(op); this.assertCurrent(op)
        if ([...op.secrets].some(secret => JSON.stringify(result).includes(JSON.stringify(secret).slice(1, -1)))) throw new ConfigurationError("INVALID_RESPONSE")
        return result
      } catch (error) {
        if (op.controller.signal.aborted) return fail(op.reason ?? "CANCELLED")
        if (error instanceof ConfigurationError) return fail(error.code, error.status)
        if (error instanceof ProviderAdapterError) return fail(error.code)
        if (error instanceof ModelAuthorizationError && error.code === "AUTHORIZATION_REVOKED") return fail("AUTHORIZATION_REVOKED")
        return fail("NETWORK_ERROR")
      } finally {
        clearTimeout(timer); op.controller.signal.removeEventListener("abort", onAbort)
        for (const remove of op.removeListeners) remove()
        if (op.gateway && op.lease) op.gateway.finish(op.lease)
        if (op.savedLease) this.options.gateway.finish(op.savedLease)
        op.key = ""; op.draft.apiKey = ""; op.secrets.clear(); if (this.active.get(key) === op) this.active.delete(key)
        if (this.retired.get(key) === op.token) this.retired.delete(key)
      }
    })()
    return Promise.race([work, aborted])
  }
  private async prepareAuthorization(op: Operation) {
    const draft = op.draft
    if (!draft.apiKey) {
      if (!draft.id) throw new ConfigurationError("KEY_REQUIRED")
      const state = await this.options.repository.read(); this.assertCurrent(op)
      const prior = state.models.find(m => m.id === draft.id)
      if (!prior?.enabled) throw new ConfigurationError("AUTHORIZATION_REVOKED")
      if (prior.provider !== draft.provider || prior.protocol !== draft.protocol || prior.endpoint !== draft.endpoint || prior.kind !== draft.kind) throw new ConfigurationError("SAVED_SCOPE_MISMATCH")
      try { op.savedLease = this.options.gateway.begin(prior.id, prior.kind) } catch { throw new ConfigurationError("AUTHORIZATION_REVOKED") }
      if (op.savedLease.authRevision !== prior.authRevision) throw new ConfigurationError("AUTHORIZATION_REVOKED")
      const revoked = () => this.abort(op, "AUTHORIZATION_REVOKED")
      op.savedLease.signal.addEventListener("abort", revoked, { once: true }); op.removeListeners.push(() => op.savedLease!.signal.removeEventListener("abort", revoked)); if (op.savedLease.signal.aborted) revoked()
    } else op.key = draft.apiKey
    if (draft.provider !== "custom") {
      const preset = PROVIDER_PRESETS.find(p => p.id === draft.provider)!
      const expected = draft.kind === "TEXT" ? preset.textEndpoint : preset.imageEndpoint
      // Other addresses use explicit custom credentials. No old record changes.
      if (!expected || preset.protocol !== draft.protocol || draft.endpoint.replace(/\/+$/, "") !== expected.replace(/\/+$/, "")) throw new ConfigurationError("INVALID_DRAFT")
    }
    // Explicit native Google Models mapping outside the TEXT compatibility
    // prefix, on the same documented vendor origin and Key family.
    if (draft.provider === "google") { op.base = "https://generativelanguage.googleapis.com/v1beta"; op.protocol = "google" }
    if (draft.provider === "alibaba") op.base = "https://dashscope.aliyuncs.com/api/v1"
    this.useGateway(op, op.base, op.protocol)
  }
  private useGateway(op: Operation, base: string, protocol: Operation["protocol"]) {
    this.assertCurrent(op); if (op.gateway && op.lease) op.gateway.finish(op.lease)
    op.gateway = new ModelGateway({
      keyFor: async () => {
        this.assertCurrent(op)
        if (op.savedLease) {
          op.savedLease.signal.throwIfAborted(); let key: string
          try { key = await this.options.repository.keyFor(op.savedLease.modelId, op.savedLease.authRevision) } catch { throw new ConfigurationError("AUTHORIZATION_REVOKED") }
          this.assertCurrent(op); op.savedLease.signal.throwIfAborted(); op.secrets.add(key); return key
        }
        return op.key
      },
      fetch: (url, init) => {
        // Synchronous saved authority check at every actual HTTP, including
        // redirect hops. An async Key read cannot reopen a revocation race.
        this.assertCurrent(op); op.savedLease?.signal.throwIfAborted()
        return this.options.fetch(url, { ...init, signal: AbortSignal.any([op.controller.signal, ...(init?.signal ? [init.signal] : [])]) })
      },
    })
    const id = randomUUID(); op.gateway.replace({ id, authRevision: 1, endpoint: base, kind: op.draft.kind, enabled: true, protocol }); op.lease = op.gateway.begin(id, op.draft.kind); op.base = base; op.draft.apiKey = ""
  }
  private async request(op: Operation, path: string, body?: Json, headers?: Record<string, string>): Promise<Json> {
    this.assertCurrent(op)
    const response = await op.gateway!.fetch(op.lease!, op.base.replace(/\/+$/, "") + path, { signal: op.controller.signal, method: body ? "POST" : "GET", headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
    this.assertCurrent(op)
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new ConfigurationError(response.status === 401 ? "AUTHENTICATION_FAILED" : response.status === 403 ? "PERMISSION_DENIED" : "HTTP_ERROR", response.status) }
    const length = response.headers.get("content-length")
    if (length && Number(length) > this.maxResponseBytes) { void response.body?.cancel().catch(() => undefined); throw new ConfigurationError("RESPONSE_TOO_LARGE") }
    if (!response.body) throw new ConfigurationError("INVALID_RESPONSE")
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0
    try {
      for (;;) { this.assertCurrent(op); const chunk = await reader.read(); this.assertCurrent(op); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > this.maxResponseBytes) throw new ConfigurationError("RESPONSE_TOO_LARGE"); chunks.push(chunk.value) }
      try { return object(JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"))) } catch { throw new ConfigurationError("INVALID_RESPONSE") }
    } finally { void reader.cancel().catch(() => undefined); reader.releaseLock() }
  }
  private entry(op: Operation, row: Json, id: string, source: string, permission: CatalogEntry["permission"]): CatalogEntry {
    const name = this.checkText(op, row.display_name ?? row.displayName ?? row.name ?? id, 200)
    const contextWindow = positive(row.context_window ?? row.context_length ?? row.inputTokenLimit ?? row.max_input_tokens); const maxOutputTokens = positive(row.max_output_tokens ?? row.outputTokenLimit ?? row.max_tokens)
    const effort = row.effort && typeof row.effort === "object" ? object(row.effort) : undefined
    const capabilities = row.capabilities && typeof row.capabilities === "object" ? object(row.capabilities) : undefined
    const anthropicEffort = capabilities?.effort && typeof capabilities.effort === "object" ? object(capabilities.effort) : undefined
    const thinkingLevels = stringList(effort?.supported_levels ?? capabilities?.reasoning_effort) ?? (anthropicEffort?.supported === true ? ["low", "medium", "high", "xhigh", "max"].filter(level => (anthropicEffort[level] as Json | undefined)?.supported === true) : undefined)
    const suppliedDefault = effort?.default_level ?? capabilities?.default_reasoning_effort; const defaultThinking = typeof suppliedDefault === "string" && thinkingLevels?.includes(suppliedDefault) ? suppliedDefault : undefined
    const entry: CatalogEntry = { id, name, kind: op.draft.kind, permission, source, ...(contextWindow ? { contextWindow } : {}), ...(maxOutputTokens ? { maxOutputTokens } : {}), ...(thinkingLevels?.length ? { thinkingLevels } : {}), ...(defaultThinking ? { defaultThinking } : {}) }
    if (op.draft.provider === "moonshot" && id === "kimi-k3") { entry.thinkingLevels = ["low", "high", "max"]; entry.defaultThinking = "max" }
    if (op.draft.provider === "zai" && id === "glm-5.3") { entry.thinkingLevels = ["low", "high", "max"]; entry.defaultThinking = "max" }
    return entry
  }
  private staticCatalog(op: Operation): CatalogResult | undefined {
    const { provider, kind } = op.draft; let ids: string[]; let source: string
    if (provider === "zai" && kind === "IMAGE") { ids = ["glm-image", "cogview-4-250304"]; source = sources.zaiImage }
    else if (provider === "zai" && kind === "TEXT") { ids = ["glm-5.3", "glm-5.2", "glm-5.1", "glm-5", "glm-4.7", "glm-4.7-flash", "glm-4.7-flashx", "glm-4.6", "glm-4.5", "glm-4.5-air", "glm-4.5-x", "glm-4.5-airx", "glm-4.5-flash", "glm-4-32b-0414-128k"]; source = sources.zaiText }
    else if (provider === "minimax") { ids = kind === "IMAGE" ? ["image-01"] : ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2.1-highspeed", "MiniMax-M2"]; source = kind === "IMAGE" ? sources.minimaxImage : sources.minimaxText }
    else return undefined
    if (ids.length > this.maxModels) throw new ConfigurationError("CATALOG_INCOMPLETE")
    return { ok: true, provider, kind, models: ids.map(id => this.entry(op, {}, id, source, "unknown")), complete: false, unknownCapabilityIds: [], permission: "unknown", sources: [source], checkedAt: new Date().toISOString(), warnings: ["官方接口文档型号快照（2026-10-07），非此 Key 的完整授权目录；计划与权限须逐模型验证"] }
  }
  private classify(op: Operation, row: Json, id: string): { kinds?: string[]; source: string } {
    switch (op.draft.provider) {
      case "anthropic": return { kinds: ["text"], source: sources.anthropic }
      case "openai": return { kinds: openaiTextIds.has(id) ? ["text"] : openaiImageIds.has(id) ? ["image"] : undefined, source: sources.openaiCapabilities }
      case "google": return { kinds: googleTextIds.has(id) ? ["text"] : googleImageIds.has(id) ? ["image", "text"] : undefined, source: googleImageIds.has(id) ? sources.googleImage : sources.googleCapabilities }
      case "xai": return { kinds: stringList(row.output_modalities) ?? (op.draft.kind === "IMAGE" ? ["image"] : ["text"]), source: sources.xai }
      case "deepseek": return { kinds: stringList(row.output_modalities), source: sources.deepseek }
      case "moonshot": return { kinds: moonshotTextIds.has(id) ? ["text"] : undefined, source: sources.moonshot }
      case "xiaomi": return { kinds: xiaomiTextIds.has(id) ? ["text"] : undefined, source: sources.xiaomiCapabilities }
      case "custom": return { kinds: op.draft.protocol === "anthropic" ? ["text"] : stringList(row.output_modalities), source: "用户授权的自定义目录接口" }
      default: throw new ConfigurationError("UNSUPPORTED_DISCOVERY")
    }
  }
  private async discoverCatalog(op: Operation): Promise<CatalogResult> {
    if (op.draft.provider === "alibaba") return discoverAlibaba(this.adapterContext(op))
    if (op.draft.provider === "tencent") return discoverTencent(this.adapterContext(op))
    if (op.draft.provider === "bytedance") return discoverByteDanceSnapshot(this.adapterContext(op))
    const snapshot = this.staticCatalog(op); if (snapshot) return snapshot
    const { provider, protocol, kind } = op.draft
    if (!["anthropic", "openai", "google", "xai", "deepseek", "moonshot", "xiaomi", "custom"].includes(provider) || (protocol === "anthropic" && kind === "IMAGE")) throw new ConfigurationError("UNSUPPORTED_DISCOVERY")
    const anthropic = provider === "anthropic" || (provider === "custom" && protocol === "anthropic"); const google = provider === "google"
    const path = google ? "/models" : anthropic ? (new URL(op.base).pathname.replace(/\/+$/, "").endsWith("/v1") ? "/models" : "/v1/models") : provider === "xai" ? (kind === "IMAGE" ? "/image-generation-models" : "/language-models") : "/models"
    const models = new Map<string, CatalogEntry>(); const unknown = new Set<string>(); const evidence = new Set<string>(); const cursors = new Set<string>(); let cursor = ""; let count = 0
    for (let page = 0; ; page++) {
      if (page >= this.maxPages) throw new ConfigurationError("CATALOG_INCOMPLETE")
      const query = new URLSearchParams(); if (google) { query.set("pageSize", "1000"); if (cursor) query.set("pageToken", cursor) }; if (anthropic) { query.set("limit", "1000"); if (cursor) query.set("after_id", cursor) }
      const response = await this.request(op, path + (query.size ? "?" + query.toString() : "")); const rows = google || provider === "xai" ? response.models : response.data
      if (!Array.isArray(rows)) throw new ConfigurationError("INVALID_RESPONSE")
      count += rows.length; if (count > this.maxModels) throw new ConfigurationError("CATALOG_INCOMPLETE")
      for (const raw of rows) {
        const row = object(raw); const id = this.checkText(op, google ? this.checkText(op, row.name).replace(/^models\//, "") : row.id)
        const capability = this.classify(op, row, id); evidence.add(capability.source); if (!capability.kinds) { unknown.add(id); continue }; if (!capability.kinds.includes(kind.toLowerCase())) continue
        const entry = this.entry(op, google ? { ...row, name: undefined } : row, id, capability.source, "listed-unverified"); const prior = models.get(id)
        if (prior && JSON.stringify(prior) !== JSON.stringify(entry)) throw new ConfigurationError("INVALID_RESPONSE")
        models.set(id, entry)
        if (provider === "xai" && row.aliases !== undefined) {
          if (!Array.isArray(row.aliases)) throw new ConfigurationError("INVALID_RESPONSE")
          count += row.aliases.length; if (count > this.maxModels) throw new ConfigurationError("CATALOG_INCOMPLETE")
          for (const value of row.aliases) {
            const alias = this.checkText(op, value); const aliasEntry = { ...entry, id: alias, name: alias }; const priorAlias = models.get(alias)
            if (priorAlias && JSON.stringify(priorAlias) !== JSON.stringify(aliasEntry)) throw new ConfigurationError("INVALID_RESPONSE")
            models.set(alias, aliasEntry)
          }
        }
      }
      let next = ""
      if (google && response.nextPageToken != null && response.nextPageToken !== "") next = this.checkText(op, response.nextPageToken, 2048)
      else if (anthropic) { if (typeof response.has_more !== "boolean") throw new ConfigurationError("INVALID_RESPONSE"); if (response.has_more) next = this.checkText(op, response.last_id, 2048) }
      else if (response.has_more === true || response.nextPageToken || response.next_cursor) throw new ConfigurationError("CATALOG_INCOMPLETE")
      if (!next) break
      if (cursors.has(next)) throw new ConfigurationError("CATALOG_INCOMPLETE")
      cursors.add(next); cursor = next
    }
    evidence.add(provider === "custom" ? "用户授权的自定义目录接口" : sources[provider as "openai" | "anthropic" | "google" | "xai" | "deepseek" | "moonshot" | "xiaomi"])
    return { ok: true, provider, kind, models: [...models.values()], complete: unknown.size === 0, unknownCapabilityIds: [...unknown], permission: "listed-unverified", sources: [...evidence], checkedAt: new Date().toISOString(), warnings: unknown.size ? ["目录含尚未确认输出能力的型号，未按名称猜测分类；当前分类目录不完整"] : [] }
  }
  private async testConnection(op: Operation): Promise<ConnectionTestResult> {
    const started = performance.now(); const { provider, kind, modelId, protocol, endpoint } = op.draft; let path: string; let body: Json
    if (["google", "alibaba", "tencent", "bytedance"].includes(provider) && kind === "IMAGE") {
      if (provider === "google" && !googleImageIds.has(modelId!)) throw new ConfigurationError("UNSUPPORTED_TEST")
      const adapter = provider === "google" ? testGoogleImage : provider === "alibaba" ? testAlibabaImage : provider === "tencent" ? testTencentImage : testByteDanceImage
      const usage = await adapter(this.adapterContext(op))
      return { ok: true, modelId: modelId!, kind, verifiedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), scope: "single-model", ...(usage ? { usage } : {}) }
    }
    if (kind === "TEXT") {
      // No invented thinking mode/tool/capacity metadata for unknown models.
      this.useGateway(op, endpoint, protocol)
      path = protocol === "anthropic" ? (new URL(endpoint).pathname.replace(/\/+$/, "").endsWith("/v1") ? "/messages" : "/v1/messages") : "/chat/completions"
      // Ark max_tokens ordinarily bounds only the final answer, excluding
      // reasoning. max_completion_tokens bounds the whole short test; the
      // official translation model explicitly does not support that field.
      const totalOutputLimit = ["openai", "moonshot", "xiaomi", "alibaba"].includes(provider) || (provider === "bytedance" && modelId !== "doubao-seed-translation-250915")
      body = { model: modelId, messages: [{ role: "user", content: "Reply only with OK." }], stream: false, ...(totalOutputLimit ? { max_completion_tokens: 256 } : { max_tokens: 256 }) }
    } else {
      if (protocol !== "openai" || !["openai", "xai", "zai", "minimax", "custom"].includes(provider)) throw new ConfigurationError("UNSUPPORTED_TEST")
      if ((provider === "minimax" && modelId !== "image-01") || (provider === "zai" && !["glm-image", "cogview-4-250304"].includes(modelId!))) throw new ConfigurationError("UNSUPPORTED_TEST")
      path = provider === "minimax" ? "/image_generation" : "/images/generations"
      body = { model: modelId, prompt: "A single black dot on a plain white background.", ...(provider === "zai" ? { size: modelId === "glm-image" ? "1280x1280" : "1024x1024", quality: "standard" } : { n: 1 }), ...(provider === "minimax" ? { response_format: "url", aspect_ratio: "1:1", prompt_optimizer: false } : {}) }
    }
    const response = await this.request(op, path, body)
    if (response.error || response.code || (response.base_resp && object(response.base_resp).status_code !== 0)) throw new ConfigurationError("HTTP_ERROR")
    if (kind === "TEXT") {
      const content = protocol === "anthropic" ? response.content : Array.isArray(response.choices) ? (object(response.choices[0] ?? {}).message as Json | undefined)?.content : undefined
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter(v => v && typeof v === "object" && (v as Json).type === "text").map(v => (v as Json).text).filter(v => typeof v === "string").join("") : ""
      if (!text.trim()) throw new ConfigurationError("INVALID_RESPONSE")
    } else {
      const images = provider === "minimax" ? object(response.data ?? {}).image_urls : response.data
      if (!Array.isArray(images) || images.length !== 1) throw new ConfigurationError("INVALID_RESPONSE")
      const image: Json = provider === "minimax" ? { url: images[0] } : object(images[0]); let validUrl = false
      if (typeof image.url === "string") { try { const url = new URL(image.url); validUrl = url.protocol === "https:" && !url.username && !url.password } catch {} }
      const validBase64 = typeof image.b64_json === "string" && image.b64_json.length >= 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(image.b64_json)
      if (!validUrl && !validBase64) throw new ConfigurationError("INVALID_RESPONSE")
    }
    return { ok: true, modelId: modelId!, kind, verifiedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), scope: "single-model" }
  }
  private adapterContext(op: Operation): ProviderAdapterContext {
    return { draft: op.draft, maxPages: this.maxPages, maxModels: this.maxModels, maxPolls: this.maxPolls, delay: async () => { this.assertCurrent(op); await delay(this.pollIntervalMs, undefined, { signal: op.controller.signal }); this.assertCurrent(op) }, request: (path, body, headers) => this.request(op, path, body, headers), checkText: (value, limit) => this.checkText(op, value, limit), entry: (row, id, source, permission) => this.entry(op, row, id, source, permission) }
  }
}
