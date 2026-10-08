import type { AIModel } from "@/generated/prisma/client"

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
export const OPENROUTER_AUTO_MODEL = "openrouter/auto"
export const OPENROUTER_FREE_CANDIDATES = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3.5-lightning:free",
] as const

type ModelIdentity = Pick<AIModel, "provider" | "modelId" | "name">
export function isKimiModel(record: ModelIdentity): boolean {
  return /kimi|moonshot/i.test(record.provider) || /kimi|moonshot/i.test(record.modelId) || /kimi|moonshot/i.test(record.name)
}

export function isOpenRouterModel(record: Pick<AIModel, "provider" | "baseUrl">): boolean {
  return record.provider === "openai-compatible" && record.baseUrl?.replace(/\/+$/, "") === OPENROUTER_BASE_URL
}

export function isOpenRouterAuto(record: Pick<AIModel, "provider" | "baseUrl" | "modelId">): boolean {
  return isOpenRouterModel(record) && record.modelId === OPENROUTER_AUTO_MODEL
}

export interface OpenRouterCatalogModel {
  id: string
  name: string
  context_length: number
  architecture: { output_modalities: string[] }
  supported_parameters: string[]
  pricing: Record<string, string>
  expiration_date?: string | null
}

export function catalogModelAvailable(model: OpenRouterCatalogModel | undefined, free: boolean, now = Date.now()): boolean {
  if (!model || !Number.isInteger(model.context_length) || model.context_length <= 0 ||
    !model.architecture?.output_modalities?.includes("text") || !model.supported_parameters?.includes("tools")) return false
  if (model.expiration_date && (!Number.isFinite(Date.parse(model.expiration_date)) || Date.parse(model.expiration_date) <= now)) return false
  if (!free) return true
  if (model.pricing?.prompt === undefined || model.pricing?.completion === undefined) return false
  return Object.values(model.pricing).every(price => typeof price === "string" && price.trim() !== "" && Number(price) === 0)
}

/** 有限缓存：避免菜单/解析反复访问目录；过期及冷启动故障均不开放未经核验的模型。 */
export function createOpenRouterCatalog(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  let cached: { at: number; models: Map<string, OpenRouterCatalogModel> } | undefined
  let pending: Promise<Map<string, OpenRouterCatalogModel>> | undefined
  let failedAt: number | undefined
  const freshMs = 5 * 60_000, graceMs = 15 * 60_000
  const fallback = () => cached && now() - cached.at < graceMs ? cached.models : new Map<string, OpenRouterCatalogModel>()
  return async (): Promise<Map<string, OpenRouterCatalogModel>> => {
    if (cached && now() - cached.at < freshMs) return cached.models
    if (failedAt !== undefined && now() - failedAt < 30_000) return fallback()
    if (pending) return pending
    pending = (async () => {
      try {
        const response = await fetcher(`${OPENROUTER_BASE_URL}/models`, { signal: AbortSignal.timeout(5000), cache: "no-store" })
        if (!response.ok) throw new Error("目录不可用")
        const body = await response.json() as { data?: OpenRouterCatalogModel[] }
        if (!Array.isArray(body.data) || !body.data.length || body.data.some(model => typeof model?.id !== "string")) throw new Error("目录格式无效")
        const models = new Map(body.data.map(model => [model.id, model]))
        cached = { at: now(), models }; failedAt = undefined
        return models
      } catch {
        failedAt = now()
        return fallback()
      } finally { pending = undefined }
    })()
    return pending
  }
}

// 运行时 fetch 保持可注入（隔离验收预加载），不捕获环境密钥。
export const getOpenRouterCatalog = createOpenRouterCatalog((input, init) => fetch(input, init))

/** 适配器只加路由约束，不做重试；现有请求层共享预算仍是唯一来源。 */
export function openRouterFetch(record: Pick<AIModel, "free" | "modelId">, fetcher: typeof fetch, sessionId?: string): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== "string" || init.method?.toUpperCase() !== "POST") return fetcher(input, init)
    const body = JSON.parse(init.body) as Record<string, unknown>
    const provider = body.provider && typeof body.provider === "object" ? body.provider : {}
    body.provider = { ...provider, require_parameters: true, allow_fallbacks: true,
      ...(record.free ? { max_price: { prompt: 0, completion: 0, request: 0 } } : {}) }
    if (record.modelId === OPENROUTER_AUTO_MODEL) {
      body.plugins = [{ id: "auto-router", excluded_models: ["moonshotai/*", "*/*kimi*", "*/*moonshot*"] }]
    }
    const headers = new Headers(init.headers)
    headers.set("X-OpenRouter-Title", "XaanInk")
    if (sessionId) headers.set("x-session-id", sessionId)
    return fetcher(input, { ...init, headers, body: JSON.stringify(body) })
  }
}
