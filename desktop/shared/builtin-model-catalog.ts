import { officialModel, officialModels } from "./provider-capabilities"
import { byteSource, byteTextIds, byteSingleOnly, byteSequential, tencentText, tencentVision, tencentImage, tencentTextSource, tencentVisionSource, tencentImageSource, tencentSeedream, tencentWand, tencentSeedreamSource, tencentWandSource, tencentViduSource } from "./provider-model-ids"
import type { CatalogEntry, CatalogResult, ConfigurationKind, ConfigurationProviderId } from "./model-catalog"

// Public API IDs, checked on official pages 2026-10-09. No account/key data.
const anthropicSource = "https://platform.claude.com/docs/en/models/overview"
const anthropicLifecycleSource = "https://platform.claude.com/docs/en/about-claude/model-deprecations"
const anthropicActive = ["claude-fable-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5-20251101", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"]
const anthropicRestricted = ["claude-mythos-5-1", "claude-mythos-5", "claude-mythos-preview"]
const anthropicRetired = new Set(["claude-opus-4-1-20250805", "claude-opus-4-20250514", "claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219", "claude-3-5-haiku-20241022", "claude-3-haiku-20240307", "claude-3-5-sonnet-20240620", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-2.0", "claude-2.1", "claude-3-sonnet-20240229", "claude-1.0", "claude-1.1", "claude-1.2", "claude-1.3", "claude-instant-1.0", "claude-instant-1.1", "claude-instant-1.2"])
const anthropicSonnet45Retirement = Date.parse("2026-11-30T00:00:00Z")
const aliTextSource = "https://help.aliyun.com/zh/model-studio/text-generation-model"
const aliImageSource = "https://help.aliyun.com/zh/model-studio/image-model"
const aliText = ["qwen3.8-max", "qwen3.8-max-0902", "qwen3.8-flash", "qwen3.7-plus", "qwen3.7-plus-2026-05-26", "qwen3.7-flash", "qwen3.7-flash-2026-07-15", "deepseek-v4-pro", "deepseek-v4-flash", "glm-5.2", "kimi-k2.7-code", "MiniMax-M3", "mimo-v2.5-pro", "qwen3.7-max", "qwen3.7-max-preview", "qwen3.7-max-2026-06-08", "qwen3.7-max-2026-05-20", "qwen3.7-max-2026-05-17", "qwen3.6-max-preview", "qwen3.6-plus", "qwen3.6-plus-2026-04-02", "qwen3.6-flash", "qwen3.6-flash-2026-04-16", "qwen3.5-plus", "qwen3.5-plus-2026-02-15", "qwen3.5-flash", "qwen3.5-flash-2026-02-23", "qwen3.5-397b-a17b", "qwen3.5-122b-a10b", "qwen3.5-27b", "qwen3.5-35b-a3b", "qwen3-max", "qwen3-max-2026-01-23", "qwen3-max-preview", "qwen3-max-2025-09-23", "qwen3-235b-a22b", "qwen3-235b-a22b-thinking-2507", "qwen3-235b-a22b-instruct-2507", "qwen3-next-80b-a3b-thinking", "qwen3-next-80b-a3b-instruct", "qwen3-32b", "qwen3-30b-a3b", "qwen3-30b-a3b-thinking-2507", "qwen3-30b-a3b-instruct-2507", "qwen3-14b", "qwen3-8b", "qwen3-coder-plus", "qwen3-coder-plus-2025-09-23", "qwen3-coder-plus-2025-07-22", "qwen3-coder-flash", "qwen3-coder-flash-2025-07-28", "qwen3-coder-next", "qwen3-coder-480b-a35b-instruct", "qwen3-coder-30b-a3b-instruct", "qwen-mt-plus", "qwen-mt-turbo", "qwen-mt-flash", "qwen-mt-lite", "qwen-long", "qwen-long-2025-01-25", "qwen-long-latest", "qwen-plus-character", "qwen-plus-character-ja", "qwen-flash-character", "qwen2.5-omni-7b", "qwen-plus", "qwen-max", "qwen-flash", "qwen-turbo", "qwq-plus", "qvq-max", "qwen-omni-turbo", "glm-5.1", "glm-5", "glm-4.7", "glm-4.5", "glm-4.5-air", "MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1", "kimi-k2.5", "kimi-k2-thinking", "Moonshot-Kimi-K2-Instruct", "deepseek-v3.2", "deepseek-v3.2-exp", "deepseek-v3.1", "deepseek-v3", "deepseek-r1", "deepseek-r1-0528", "deepseek-r1-distill-llama-70b", "deepseek-r1-distill-qwen-32b", "deepseek-r1-distill-qwen-14b", "deepseek-r1-distill-qwen-7b", "deepseek-r1-distill-qwen-1.5b", "deepseek-r1-distill-llama-8b"]
const aliImage = ["qwen-image-3.0-pro", "qwen-image-3.0", "wan2.7-image-pro", "wan2.7-image", "z-image-turbo", "wan2.6-t2i", "wan2.6-image", "wan2.5-t2i-preview", "wan2.2-t2i-plus", "wan2.2-t2i-flash", "wan2.1-t2i-plus", "wan2.1-t2i-turbo", "qwen-image-2.0-pro", "qwen-image-2.0-pro-2026-06-22", "qwen-image-2.0-pro-2026-04-22", "qwen-image-2.0-pro-2026-03-03", "qwen-image-2.0", "qwen-image-2.0-2026-03-03", "qwen-image-max", "qwen-image-max-2025-12-30", "qwen-image-plus", "qwen-image-plus-2026-01-09", "qwen-image"]
const aliEditOnly = new Set(["qwen-image-edit-max", "qwen-image-edit-max-2026-01-16", "qwen-image-edit-plus", "qwen-image-edit-plus-2025-12-15", "qwen-image-edit-plus-2025-10-30", "qwen-image-edit", "wan2.5-i2i-preview", "wanx2.1-imageedit"])
const row = (id: string, kind: ConfigurationKind, source: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({ id, name: id, kind, permission: "unknown", source, ...extra })

export function excludedBuiltinModel(provider: ConfigurationProviderId, kind: ConfigurationKind, id: string, now = Date.now()) {
  const known = officialModel(provider, id)
  if (provider === "anthropic" && (kind !== "TEXT" || anthropicRetired.has(id) || id === "claude-sonnet-4-5-20250929" && now >= anthropicSonnet45Retirement)) return true
  return !!known && (known.kind !== kind || !!known.shutdownDate && Date.parse(known.shutdownDate) <= now) || provider === "alibaba" && kind === "IMAGE" && aliEditOnly.has(id)
}
export function builtinModels(provider: ConfigurationProviderId, kind: ConfigurationKind): CatalogEntry[] {
  const known = officialModels(provider).filter(model => model.kind === kind && !excludedBuiltinModel(provider, kind, model.id))
    .map(model => row(model.id, kind, model.source, { contextWindow: model.contextWindow, maxOutputTokens: model.maxOutputTokens, thinkingLevels: model.thinkingLevels ? [...model.thinkingLevels] : undefined, defaultThinking: model.defaultThinking, notes: model.notes ? [...model.notes] : undefined, ...(model.subscriptionOnly ? { available: false } : {}) }))
  if (known.length) return known
  if (provider === "anthropic" && kind === "TEXT") return [
    ...["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"].map(id => row(id, kind, anthropicSource, { contextWindow: 1000000, maxOutputTokens: 128000 })),
    ...anthropicActive.map(id => row(id, kind, anthropicLifecycleSource)),
    ...anthropicRestricted.map(id => row(id, kind, anthropicLifecycleSource, { available: false, notes: ["需供应商单独授权；查询确认当前 Key 权限后启用"] })),
    ...(!excludedBuiltinModel(provider, kind, "claude-sonnet-4-5-20250929") ? [row("claude-sonnet-4-5-20250929", kind, anthropicLifecycleSource, { notes: ["官网已弃用，计划于 2026-11-30 下线"] })] : []),
  ]
  if (provider === "xai") return kind === "TEXT" ? [row("grok-4.7", kind, "https://docs.x.ai/developers/models/grok-4.7", { contextWindow: 500000, thinkingLevels: ["low", "medium", "high", "xhigh"], defaultThinking: "high" })] : [row("grok-imagine-image-2.0", kind, "https://docs.x.ai/developers/models/grok-imagine-image-2.0")]
  if (provider === "alibaba") return (kind === "TEXT" ? aliText : aliImage).map(id => row(id, kind, kind === "TEXT" ? aliTextSource : aliImageSource))
  if (provider === "bytedance") return (kind === "TEXT" ? byteTextIds : [...byteSingleOnly, ...byteSequential]).map(id => row(id, kind, byteSource))
  if (provider === "tencent") return (kind === "TEXT" ? [...tencentText, ...tencentVision] : [...tencentImage]).map(id => row(id, kind, kind === "TEXT" ? tencentVision.has(id) ? tencentVisionSource : tencentTextSource : tencentSeedream.has(id) ? tencentSeedreamSource : tencentWand.has(id) ? tencentWandSource : id === "vidu-image-q2" ? tencentViduSource : tencentImageSource))
  return []
}

/** Public candidates remain unknown unless the current authenticated result
 * supplies that exact ID. Missing live entries never gain an account grant. */
export function modelChoices(provider: ConfigurationProviderId, kind: ConfigurationKind, catalog: CatalogResult | null): CatalogEntry[] {
  const choices = new Map(builtinModels(provider, kind).map(entry => [entry.id, entry]))
  if (catalog?.provider === provider && catalog.kind === kind) for (const entry of catalog.models) {
    if (entry.kind !== kind || excludedBuiltinModel(provider, kind, entry.id)) continue
    const prior = choices.get(entry.id)
    choices.set(entry.id, { ...prior, ...entry, ...(prior?.available === false && entry.available !== true ? { available: false } : {}) })
  }
  return [...choices.values()]
}
