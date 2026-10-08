export interface ImageModelOption { id: string; name: string; modelId: string; provider: string }

/** "auto" is the old draft's sentinel. It now means only the author's saved
 * default, never the first/latest available model. Explicit stale IDs survive. */
export function imageModelSelection(models: ImageModelOption[], defaultModelId: string | null | undefined, value: string) {
  const defaultModel = models.find(model => model.id === defaultModelId)
  const defaultLabel = defaultModel ? `默认：${defaultModel.name}` : defaultModelId ? "默认模型不可用" : "尚未设置默认模型"
  const selected = value === "auto" ? defaultModel : models.find(model => model.id === value)
  return { selected, defaultModel, defaultLabel, label: value === "auto" ? defaultLabel : selected ? `${selected.name}（${selected.modelId}）` : "所选模型不可用" }
}
