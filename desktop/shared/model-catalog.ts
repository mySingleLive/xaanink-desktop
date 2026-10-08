/** Public configuration contracts. Keys occur only in caller-owned drafts;
 * catalog/test results never contain credentials or provider response bodies.
 */
export type ConfigurationKind = "TEXT" | "IMAGE"
export type ConfigurationProtocol = "openai" | "anthropic"
export type PresetProviderId = "openai" | "anthropic" | "google" | "xai" | "deepseek" | "moonshot" | "zai" | "xiaomi" | "alibaba" | "minimax" | "tencent" | "bytedance"
export type ConfigurationProviderId = PresetProviderId | "custom"
export interface ProviderPreset {
  id: ConfigurationProviderId
  name: string
  protocol?: ConfigurationProtocol
  textEndpoint?: string
  imageEndpoint?: string
  sources: readonly string[]
}
export interface ConfigurationDraft {
  id?: string
  provider: ConfigurationProviderId
  kind: ConfigurationKind
  protocol: ConfigurationProtocol
  endpoint: string
  apiKey: string
  modelId?: string
}
export interface CatalogEntry {
  id: string
  name: string
  kind: ConfigurationKind
  contextWindow?: number
  maxOutputTokens?: number
  thinkingLevels?: string[]
  defaultThinking?: string
  permission: "listed-unverified" | "unknown"
  source: string
}
export type ConfigurationErrorCode = "INVALID_DRAFT" | "KEY_REQUIRED" | "SAVED_SCOPE_MISMATCH" | "AUTHORIZATION_REVOKED" | "OPERATION_DUPLICATE" | "OPERATION_LIMIT" | "CANCELLED" | "TIMEOUT" | "NETWORK_ERROR" | "AUTHENTICATION_FAILED" | "PERMISSION_DENIED" | "HTTP_ERROR" | "UNSUPPORTED_DISCOVERY" | "UNSUPPORTED_TEST" | "CATALOG_INCOMPLETE" | "INVALID_RESPONSE" | "RESPONSE_TOO_LARGE" | "CHARGE_AUTHORIZATION_REQUIRED"
export interface ConfigurationFailure {
  ok: false
  code: ConfigurationErrorCode
  message: string
  status?: number
}
export interface CatalogResult {
  ok: true
  provider: ConfigurationProviderId
  kind: ConfigurationKind
  models: CatalogEntry[]
  complete: boolean
  unknownCapabilityIds: string[]
  permission: "listed-unverified" | "unknown"
  sources: string[]
  checkedAt: string
  warnings: string[]
}
export interface ConnectionTestResult {
  ok: true
  modelId: string
  kind: ConfigurationKind
  verifiedAt: string
  durationMs: number
  /** A single model test never validates a whole provider catalog. */
  scope: "single-model"
  /** Only numeric counters actually returned by the provider; never raw output. */
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; imagesGenerated?: number }
}
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: "openai", name: "OpenAI", protocol: "openai", textEndpoint: "https://api.openai.com/v1", imageEndpoint: "https://api.openai.com/v1", sources: ["https://developers.openai.com/api/reference/resources/models/methods/list"] },
  { id: "anthropic", name: "Anthropic", protocol: "anthropic", textEndpoint: "https://api.anthropic.com", sources: ["https://platform.claude.com/docs/en/api/http/models"] },
  { id: "google", name: "Google", protocol: "openai", textEndpoint: "https://generativelanguage.googleapis.com/v1beta/openai", imageEndpoint: "https://generativelanguage.googleapis.com/v1beta", sources: ["https://ai.google.dev/api/models", "https://ai.google.dev/gemini-api/docs/image-generation"] },
  { id: "xai", name: "xAI", protocol: "openai", textEndpoint: "https://api.x.ai/v1", imageEndpoint: "https://api.x.ai/v1", sources: ["https://docs.x.ai/developers/rest-api-reference/inference/models"] },
  { id: "deepseek", name: "深度求索", protocol: "openai", textEndpoint: "https://api.deepseek.com", sources: ["https://api-docs.deepseek.com/api/list-models/"] },
  { id: "moonshot", name: "月之暗面", protocol: "openai", textEndpoint: "https://api.moonshot.cn/v1", sources: ["https://moonshotai.github.io/kimi-cli/zh/configuration/providers.html", "https://platform.kimi.com/docs/openapi.json"] },
  { id: "zai", name: "智谱", protocol: "openai", textEndpoint: "https://api.z.ai/api/paas/v4", imageEndpoint: "https://api.z.ai/api/paas/v4", sources: ["https://docs.z.ai/guides/overview/quick-start", "https://docs.z.ai/api-reference/image/generate-image"] },
  { id: "xiaomi", name: "Xiaomi", protocol: "openai", textEndpoint: "https://api.xiaomimimo.com/v1", sources: ["https://mimo.mi.com/docs/en-US/api/model/list-models", "https://platform.xiaomimimo.com/docs/en-US/usage-guide/passing-back-reasoning_content"] },
  { id: "alibaba", name: "阿里巴巴", protocol: "openai", textEndpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", imageEndpoint: "https://dashscope.aliyuncs.com/api/v1", sources: ["https://help.aliyun.com/en/model-studio/base-url", "https://help.aliyun.com/zh/model-studio/text-to-image"] },
  { id: "minimax", name: "MiniMax", protocol: "openai", textEndpoint: "https://api.minimax.io/v1", imageEndpoint: "https://api.minimax.io/v1", sources: ["https://platform.minimax.io/docs/api-reference/text-openai-api", "https://platform.minimax.io/docs/api-reference/image-generation-t2i"] },
  { id: "tencent", name: "腾讯", protocol: "openai", textEndpoint: "https://tokenhub.tencentmaas.com/v1", imageEndpoint: "https://tokenhub-intl.tencentcloudmaas.com/v1", sources: ["https://cloud.tencent.com/document/product/1729/131925", "https://intl.cloud.tencent.com/zh/document/product/1300/83708"] },
  { id: "bytedance", name: "字节跳动", protocol: "openai", textEndpoint: "https://ark.cn-beijing.volces.com/api/v3", imageEndpoint: "https://ark.cn-beijing.volces.com/api/v3", sources: ["https://docs.volcengine.com/docs/ark/model-list?lang=zh", "https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh"] },
  { id: "custom", name: "自定义供应商", sources: [] },
]
export function presetsFor(kind: ConfigurationKind): ProviderPreset[] {
  return PROVIDER_PRESETS.filter(preset => preset.id === "custom" || !!(kind === "TEXT" ? preset.textEndpoint : preset.imageEndpoint)).map(preset => ({ ...preset, sources: [...preset.sources] }))
}
