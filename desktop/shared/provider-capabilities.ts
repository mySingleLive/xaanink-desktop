import openai from "./openai-capabilities.json"
import lifecycle from "./openai-lifecycle.json"
import type { ConfigurationKind, ConfigurationProviderId } from "./model-catalog"
export const OPENAI_LIFECYCLE_SOURCE = lifecycle.source
export interface OfficialCapability {
  id: string; kind: ConfigurationKind | "OTHER"; source: string
  contextWindow?: number; maxOutputTokens?: number; thinkingLevels?: string[]; defaultThinking?: string
  wire?: "chat" | "responses"; streaming?: boolean; deprecated?: boolean; shutdownDate?: string; notes?: string[]; subscriptionOnly?: boolean; completionLimit?: boolean; testEffort?: string; accessProgram?: "daybreak_red"
}
const capabilities = new Map<string, Map<string, OfficialCapability>>()
const add = (provider: string, value: OfficialCapability) => {
  if (!capabilities.has(provider)) capabilities.set(provider, new Map())
  capabilities.get(provider)!.set(value.id, value)
}
// Exact public facts fetched from official pages on 2026-10-09. Unknown
// names never inherit abilities by prefix, date or fine-tune spelling.
const openaiPriorities = new Map<string, number>()
for (const model of openai.models) {
  const levels = model.efforts?.match(/\b(?:none|minimal|low|medium|high|xhigh|max)\b/g) ?? []
  const defaultEffort = model.efforts?.match(/\b(none|minimal|low|medium|high|xhigh|max)\s*\(default\)/)?.[1]
  const thinkingLevels = [...new Set(levels)].filter(level => !["none", "minimal"].includes(level))
  const kind = model.output === "text" ? model.kind as OfficialCapability["kind"] : model.kind === "IMAGE" ? "IMAGE" : "OTHER"
  for (const id of model.ids) {
    // A model's own page wins over aliases listed on another model's page.
    const priority = id === model.model ? 2 : 1
    if ((openaiPriorities.get(id) ?? 0) >= priority) continue
    openaiPriorities.set(id, priority)
    add("openai", { id, kind, source: model.source, contextWindow: model.contextWindow, maxOutputTokens: model.maxOutputTokens,
    ...(thinkingLevels.length ? { thinkingLevels, defaultThinking: thinkingLevels.includes(defaultEffort ?? "") ? defaultEffort : "default" } : {}),
    completionLimit: model.reasoning || ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"].includes(model.model ?? ""), testEffort: levels[0], wire: model.responses && (!model.chat || !model.chatTools) ? "responses" : "chat", streaming: model.streaming, deprecated: model.deprecated,
    ...(model.deprecated ? { notes: ["官网已标记弃用，请留意供应商下线时间"] } : {}),
    })
  }
}
for (const id of ["gpt-oss-120b", "gpt-oss-20b"]) add("openai", { ...officialModel("openai", id)!, kind: "OTHER", source: "https://help.openai.com/en/articles/11870455-openai-open-weight-models-gpt-oss", notes: ["开放权重模型，OpenAI 官方 API 不提供托管调用"] })
add("openai", { ...officialModel("openai", "gpt-3.5-turbo-instruct")!, kind: "OTHER", source: "https://developers.openai.com/api/docs/models/gpt-3.5-turbo-instruct", notes: ["仅支持旧版 Completions，不能用于对话 API"] })
for (const id of ["computer-use-preview", "computer-use-preview-2025-03-11"]) add("openai", { ...officialModel("openai", id)!, kind: "OTHER", notes: ["设备控制专用模型"] })
for (const model of openai.models) {
  const dates = lifecycle.models as Record<string, string>
  for (const id of model.ids) {
    const prior = officialModel("openai", id)!
    const shutdownDate = dates[id] ?? (id === model.model ? dates[model.defaultSnapshot ?? ""] : undefined)
    if (shutdownDate) add("openai", { ...prior, shutdownDate, deprecated: true, notes: [...(prior.notes ?? []), `官网弃用公告：${shutdownDate} 下线`] })
  }
}
add("openai", { ...officialModel("openai", "gpt-5.6-cyber")!, accessProgram: "daybreak_red", notes: ["需要官方单独批准与项目开通 Daybreak Red，普通 Key 可能无权限"] })
function ids(provider: string, names: string[], kind: OfficialCapability["kind"], source: string, extra: Partial<OfficialCapability> = {}) {
  for (const id of names) add(provider, { id, kind, source, ...extra })
}
ids("deepseek", ["deepseek-flash", "deepseek-v4-pro"], "TEXT", "https://api-docs.deepseek.com/quick_start/pricing/", { thinkingLevels: ["low", "high", "max"], defaultThinking: "high", testEffort: "low" })
ids("deepseek", ["deepseek-chat", "deepseek-reasoner"], "OTHER", "https://api-docs.deepseek.com/quick_start/pricing/", { deprecated: true })
ids("moonshot", ["kimi-k3", "kimi-k2.6", "kimi-k2.7-code", "kimi-k2.7-code-highspeed"], "TEXT", "https://platform.kimi.com/docs/openapi.json")
add("moonshot", { ...officialModel("moonshot", "kimi-k3")!, thinkingLevels: ["low", "high", "max"], defaultThinking: "max", testEffort: "low" })
const zai = "https://docs.bigmodel.cn/cn/guide/start/model-overview"
ids("zai", ["glm-5.3", "glm-5.3-flash", "glm-5.3-flashx", "glm-5.2", "glm-5.1", "glm-5", "glm-5-turbo", "glm-4.7", "glm-4.7-flash", "glm-4.7-flashx", "glm-4.6", "glm-4.5", "glm-4.5-air", "glm-4.5-airx", "glm-4.5-flash", "glm-4-long", "glm-4-flashx-250414", "glm-4-flash-250414", "glm-5v-turbo", "glm-4.6v", "glm-4.6v-flash", "glm-4.1v-thinking-flashx", "glm-4.1v-thinking-flash", "glm-4v-flash"], "TEXT", zai)
for (const id of ["glm-5.3", "glm-5.3-flash", "glm-5.3-flashx"]) add("zai", { ...officialModel("zai", id)!, thinkingLevels: ["low", "high", "max"], defaultThinking: "max", testEffort: "low" })
add("zai", { ...officialModel("zai", "glm-5.2")!, thinkingLevels: ["high", "max"], defaultThinking: "max", testEffort: "high" })
add("zai", { ...officialModel("zai", "glm-4v-flash")!, maxOutputTokens: 1024, contextWindow: 16000 })
ids("zai", ["glm-image", "cogview-4-250304", "cogview-3-flash"], "IMAGE", zai)
const mini = "https://platform.minimax.cn/docs/api-reference/text-openai-api"
ids("minimax", ["MiniMax-M3"], "TEXT", mini, { contextWindow: 1000000 })
ids("minimax", ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2.1-highspeed", "MiniMax-M2"], "TEXT", mini, { contextWindow: 204800 })
add("minimax", { id: "MiniMax-M3.1-Flash-Preview", kind: "TEXT", source: mini, contextWindow: 1000000, thinkingLevels: ["low", "medium", "high", "xhigh", "max"], defaultThinking: "max", subscriptionOnly: true, notes: ["仅通过 M Plan 订阅或官方 Code 提供，普通 API Key 不支持"], testEffort: "low" })
ids("minimax", ["image-01"], "IMAGE", "https://platform.minimax.cn/docs/api-reference/image-generation-t2i")
ids("xiaomi", ["mimo-v2.6-flash", "mimo-v2.6-pro", "mimo-v2.6-pro-ultraspeed", "mimo-v2.5-pro", "mimo-v2.5"], "TEXT", "https://mimo.mi.com/docs/en-US/api/model/list-models")
ids("xiaomi", ["mimo-v2.5-tts", "mimo-v2.5-tts-voiceclone", "mimo-v2.5-tts-voicedesign", "mimo-v2.5-asr"], "OTHER", "https://mimo.mi.com/docs/en-US/api/model/list-models")
const google = "https://ai.google.dev/gemini-api/docs/models"
ids("google", ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview", "gemini-3-flash-preview"], "TEXT", google)
ids("google", ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"], "TEXT", google, { notes: ["官网限定过去已活跃使用此型号的账户访问，新 Key 可能没有权限"] })
ids("google", ["gemini-nano-banana-2.1", "gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"], "IMAGE", "https://ai.google.dev/gemini-api/docs/image-generation")
export function officialModel(provider: string, id: string): OfficialCapability | undefined { return capabilities.get(provider)?.get(id) }
export function officialModels(provider: ConfigurationProviderId): OfficialCapability[] { return [...(capabilities.get(provider)?.values() ?? [])] }
export function testOutputBudget(provider: string, id: string) { return Math.min((officialModel(provider, id) ?? (provider === "custom" ? officialModel("openai", id) : undefined))?.maxOutputTokens ?? Infinity, provider === "custom" && !officialModel("openai", id) ? 1024 : 2048) }
export function openaiUsesCompletionLimit(id: string) {
  const model = officialModel("openai", id)
  return model?.completionLimit === true
}
export const LEGACY_OFFICIAL_ENDPOINTS: Partial<Record<ConfigurationProviderId, readonly string[]>> = {
  zai: ["https://api.z.ai/api/paas/v4"], minimax: ["https://api.minimax.io/v1", "https://api.minimaxi.com/v1"],
}
