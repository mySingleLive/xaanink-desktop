import type { AIModel } from "@/generated/prisma/client"
import { decrypt } from "@/lib/crypto"
import { catalogModelAvailable, getOpenRouterCatalog, isKimiModel, isOpenRouterModel, type OpenRouterCatalogModel } from "./openrouter"

const TEXT_PROVIDERS = new Set(["openai", "anthropic", "deepseek", "qwen", "zhipu", "openai-compatible"])

/** 用户列表与所有解析入口共用；不让只隐藏 UI 的模型仍能直调。 */
export async function availableTextModels(records: AIModel[], catalog?: Map<string, OpenRouterCatalogModel>): Promise<AIModel[]> {
  const eligible = records.filter(record => {
    if (!record.enabled || record.kind !== "TEXT" || isKimiModel(record) || !TEXT_PROVIDERS.has(record.provider)) return false
    try { return !!decrypt(record.apiKeyEncrypted).trim() } catch { return false }
  })
  const directory = catalog ?? (eligible.some(isOpenRouterModel) ? await getOpenRouterCatalog() : undefined)
  return eligible.flatMap(record => {
    if (!isOpenRouterModel(record)) return [record]
    const model = directory?.get(record.modelId)
    if (!catalogModelAvailable(model, record.free)) return []
    return [{ ...record, contextWindow: Math.min(record.contextWindow, model!.context_length) }]
  })
}
