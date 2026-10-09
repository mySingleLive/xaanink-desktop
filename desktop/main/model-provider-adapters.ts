import { tencentTextSource, tencentImageSource, tencentViduSource, tencentWandSource, tencentSeedreamSource, tencentVisionSource, tencentText, tencentVision, tencentSeedream, tencentWand, tencentImage, byteSource, byteTextIds, byteSingleOnly, byteSequential } from "../shared/provider-model-ids"
import type { CatalogEntry, CatalogResult, ConfigurationDraft, ConfigurationErrorCode, ConnectionTestResult } from "../shared/model-catalog"

export class ProviderAdapterError extends Error { constructor(readonly code: ConfigurationErrorCode) { super(code) } }
type Json = Record<string, unknown>
const object = (v: unknown): Json => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new ProviderAdapterError("INVALID_RESPONSE"); return v as Json }
export interface ProviderAdapterContext {
  draft: ConfigurationDraft
  maxPages: number
  maxModels: number
  maxPolls: number
  delay(): Promise<void>
  request(path: string, body?: Json, headers?: Record<string, string>): Promise<Json>
  checkText(value: unknown, limit?: number): string
  entry(row: Json, id: string, source: string, permission: CatalogEntry["permission"]): CatalogEntry
}
const aliSource = "https://help.aliyun.com/zh/model-studio/list-models"
const aliImageSource = "https://help.aliyun.com/zh/model-studio/image-model"
// IMAGE means text-to-image in the approved product. These exact IDs are
// explicitly marked T2I unsupported in the official table; no prefix rule.
const aliEditOnly = new Set(["qwen-image-edit-max", "qwen-image-edit-max-2026-01-16", "qwen-image-edit-plus", "qwen-image-edit-plus-2025-12-15", "qwen-image-edit-plus-2025-10-30", "qwen-image-edit", "wan2.5-i2i-preview", "wanx2.1-imageedit"])
// Exact categories from the published tables, checked 2026-10-07. Unknown
// future IDs stay unclassified; strings are never matched by family/prefix.
const tencentOther = new Set(["hy-video-v1.5", "pixverse-video-v6.0", "kling-video-v3", "minimax-video-h3", "hy-3d-3.0", "hy-3d-3.1", "hy-3d-express", "kinfra-text-embedding-0.6b", "kinfra-text-embedding-4b", "kinfra-vl-embedding-2b", "kinfra-vl-embedding-8b"])
function finish(ctx: ProviderAdapterContext, models: Map<string, CatalogEntry>, unknown: Set<string>, sources: string[]): CatalogResult {
  return { ok: true, provider: ctx.draft.provider, kind: ctx.draft.kind, models: [...models.values()], complete: unknown.size === 0, unknownCapabilityIds: [...unknown], permission: "listed-unverified", sources, checkedAt: new Date().toISOString(), warnings: unknown.size ? ["授权目录含输出能力待确认型号；未按名称猜测，分类目录尚不完整"] : [] }
}
function insert(models: Map<string, CatalogEntry>, entry: CatalogEntry) {
  const prior = models.get(entry.id)
  if (prior && JSON.stringify(prior) !== JSON.stringify(entry)) throw new ProviderAdapterError("INVALID_RESPONSE")
  models.set(entry.id, entry)
}
export async function discoverAlibaba(ctx: ProviderAdapterContext): Promise<CatalogResult> {
  const models = new Map<string, CatalogEntry>(); const unknown = new Set<string>(); const seen = new Set<string>()
  let total: number | undefined; let count = 0; let excludedEdits = 0
  for (let page = 1; ; page++) {
    if (page > ctx.maxPages) throw new ProviderAdapterError("CATALOG_INCOMPLETE")
    const query = new URLSearchParams({ page_no: String(page), page_size: "100" })
    // Union of documented generation categories, followed by actual output
    // modality verification. No embedding/speech/video directory masquerades
    // as text generation just because its input is text.
    for (const capability of ctx.draft.kind === "IMAGE" ? ["IG"] : ["TG", "Reasoning", "VU"]) query.append("capabilities", capability)
    const response = await ctx.request("/models?" + query.toString())
    if (response.success !== true || response.code) throw new ProviderAdapterError("HTTP_ERROR")
    const output = object(response.output)
    if (!Number.isSafeInteger(output.total) || Number(output.total) < 0 || Number(output.total) > ctx.maxModels || output.page_no !== page || (total !== undefined && total !== output.total)) throw new ProviderAdapterError("CATALOG_INCOMPLETE")
    total = Number(output.total)
    if (!Array.isArray(output.models)) throw new ProviderAdapterError("INVALID_RESPONSE")
    count += output.models.length
    if (count > total || count > ctx.maxModels || (!output.models.length && count < total)) throw new ProviderAdapterError("CATALOG_INCOMPLETE")
    for (const raw of output.models) {
      const row = object(raw); const id = ctx.checkText(row.model)
      // Repeated IDs indicate paging drift. Never hide it with deduplication.
      if (seen.has(id)) throw new ProviderAdapterError("CATALOG_INCOMPLETE"); seen.add(id)
      const modalities = row.inference_metadata == null ? undefined : object(row.inference_metadata).response_modality
      if (!Array.isArray(modalities) || !modalities.length) { unknown.add(id); continue }
      if (modalities.length > 16 || modalities.some(v => !["Text", "Image", "Audio", "Video"].includes(String(v)))) throw new ProviderAdapterError("INVALID_RESPONSE")
      if (!modalities.includes(ctx.draft.kind === "TEXT" ? "Text" : "Image")) continue
      if (ctx.draft.kind === "IMAGE" && aliEditOnly.has(id)) { excludedEdits++; continue }
      const info = row.model_info == null ? {} : object(row.model_info)
      insert(models, ctx.entry({ name: row.name, context_window: info.context_window, max_output_tokens: info.max_output_tokens }, id, aliSource, "listed-unverified"))
    }
    if (count === total) break
  }
  const result = finish(ctx, models, unknown, [aliSource, "https://help.aliyun.com/zh/model-studio/base-url", ...(ctx.draft.kind === "IMAGE" ? [aliImageSource] : [])])
  if (excludedEdits) result.warnings.push(`已排除${excludedEdits}个官方确证仅支持图像编辑、不支持文生图的型号`)
  return result
}
export async function discoverTencent(ctx: ProviderAdapterContext): Promise<CatalogResult> {
  const response = await ctx.request("/models")
  checkBusiness(response)
  if (!Array.isArray(response.data) || response.has_more === true || response.next_cursor || response.nextPageToken) throw new ProviderAdapterError("CATALOG_INCOMPLETE")
  if (response.data.length > ctx.maxModels) throw new ProviderAdapterError("CATALOG_INCOMPLETE")
  const models = new Map<string, CatalogEntry>(); const unknown = new Set<string>()
  for (const raw of response.data) {
    const row = object(raw); const id = ctx.checkText(row.id)
    if (row.status !== "online" && row.status !== "pre-offline") { unknown.add(id); continue }
    const category = tencentText.has(id) || tencentVision.has(id) ? "TEXT" : tencentImage.has(id) ? "IMAGE" : tencentOther.has(id) ? "OTHER" : undefined
    if (!category) { unknown.add(id); continue }
    if (category === ctx.draft.kind) insert(models, ctx.entry(row, id, category === "TEXT" ? tencentVision.has(id) ? tencentVisionSource : tencentTextSource : id === "vidu-image-q2" ? tencentViduSource : tencentWand.has(id) ? tencentWandSource : tencentSeedream.has(id) ? tencentSeedreamSource : tencentImageSource, "listed-unverified"))
  }
  return finish(ctx, models, unknown, ctx.draft.kind === "TEXT" ? [tencentTextSource, tencentVisionSource] : ["https://intl.cloud.tencent.com/zh/document/product/1300/83707", tencentImageSource, tencentViduSource, tencentWandSource, tencentSeedreamSource])
}
export function parseUsage(raw: unknown, names: { input: string; output: string; total: string }, imagesGenerated?: number): ConnectionTestResult["usage"] {
  const usage = raw == null ? {} : object(raw); const result: NonNullable<ConnectionTestResult["usage"]> = {}
  for (const [key, value] of [["inputTokens", usage[names.input]], ["outputTokens", usage[names.output]], ["totalTokens", usage[names.total]]] as const) {
    if (value != null && (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000_000)) throw new ProviderAdapterError("INVALID_RESPONSE")
    if (value != null) result[key] = Number(value)
  }
  if (imagesGenerated !== undefined) result.imagesGenerated = imagesGenerated
  return Object.keys(result).length ? result : undefined
}
export async function testGoogleImage(ctx: ProviderAdapterContext): Promise<ConnectionTestResult["usage"]> {
  // Only 3.1 Flash Image documents 512px. Legacy 2.5 has fixed output
  // dimensions; omit a size override whose support is not established.
  const imageSize = ctx.draft.modelId === "gemini-3.1-flash-image" ? "512" : ctx.draft.modelId === "gemini-2.5-flash-image" ? undefined : "1K"
  const response = await ctx.request("/interactions", { model: ctx.draft.modelId, input: [{ type: "text", text: "Generate exactly one image: a single black dot on a plain white background." }], response_format: { type: "image", aspect_ratio: "1:1", ...(imageSize ? { image_size: imageSize } : {}), delivery: "inline" }, store: false, background: false, stream: false })
  if (response.error) throw new ProviderAdapterError("HTTP_ERROR")
  if (response.status !== "completed" || !Array.isArray(response.steps)) throw new ProviderAdapterError("INVALID_RESPONSE")
  const images: Json[] = []
  for (const raw of response.steps) {
    const step = object(raw); if (step.type !== "model_output") continue
    if (!Array.isArray(step.content)) throw new ProviderAdapterError("INVALID_RESPONSE")
    for (const rawContent of step.content) { const content = object(rawContent); if (content.type === "image") images.push(content) }
  }
  if (images.length !== 1 || !["image/png", "image/jpeg", "image/webp"].includes(String(images[0].mime_type)) || typeof images[0].data !== "string" || images[0].data.length < 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(images[0].data)) throw new ProviderAdapterError("INVALID_RESPONSE")
  return parseUsage(response.usage, { input: "total_input_tokens", output: "total_output_tokens", total: "total_tokens" }, 1)
}

// Full TEXT section of the official public document (LibraryID 82379,
// DocumentID 1330310), updated 2026-09-28T03:59:13Z, checked 2026-10-07.
// Retiring versions remain listed until the publisher actually removes them.
export async function discoverByteDance(ctx: ProviderAdapterContext): Promise<CatalogResult> {
  const response = await ctx.request("/models"); checkBusiness(response)
  if (!Array.isArray(response.data)) throw new ProviderAdapterError("INVALID_RESPONSE")
  if (response.data.length > ctx.maxModels || response.has_more === true || response.next_cursor) throw new ProviderAdapterError("CATALOG_INCOMPLETE")
  const ids = ctx.draft.kind === "TEXT" ? byteTextIds : [...byteSingleOnly, ...byteSequential]
  const current = new Set([...byteTextIds, ...byteSingleOnly, ...byteSequential])
  const models = new Map<string, CatalogEntry>(), unknown = new Set<string>(), excluded = new Set<string>()
  const signatures = new Map<string, string>()
  for (const raw of response.data) {
    const row = object(raw), id = ctx.checkText(row.id)
    if (!current.has(id)) { unknown.add(id); continue }
    const modalities = row.modalities == null ? {} : object(row.modalities)
    const outputs = modalities.output_modalities
    const tasks = row.task_type
    for (const values of [outputs, tasks]) if (values != null && (!Array.isArray(values) || values.length > 32 || !values.every(v => typeof v === "string"))) throw new ProviderAdapterError("INVALID_RESPONSE")
    const limits = row.token_limits == null ? {} : object(row.token_limits)
    for (const value of [limits.context_window, limits.max_output_token_length]) if (value != null && (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000_000)) throw new ProviderAdapterError("INVALID_RESPONSE")
    const signature = JSON.stringify({ outputs: Array.isArray(outputs) ? [...new Set(outputs)].sort() : null, tasks: Array.isArray(tasks) ? [...new Set(tasks)].sort() : null, context: limits.context_window ?? null, output: limits.max_output_token_length ?? null })
    const prior = signatures.get(id)
    if (prior && prior !== signature) throw new ProviderAdapterError("INVALID_RESPONSE")
    if (prior) continue
    signatures.set(id, signature)
    if (!ids.includes(id)) continue
    if (Array.isArray(outputs) && !outputs.includes(ctx.draft.kind === "TEXT" ? "text" : "image")) { excluded.add(id); continue }
    if (ctx.draft.kind === "IMAGE" && Array.isArray(row.task_type) && !row.task_type.includes("TextToImage")) { excluded.add(id); continue }
    insert(models, ctx.entry({ context_window: limits.context_window, max_output_tokens: limits.max_output_token_length }, id, byteSource, "listed-unverified"))
  }
  for (const id of ids) {
    if (models.has(id) || excluded.has(id)) continue
    if (models.size >= ctx.maxModels) throw new ProviderAdapterError("CATALOG_INCOMPLETE")
    models.set(id, ctx.entry({}, id, byteSource, "unknown"))
  }
  const result = finish(ctx, models, unknown, [byteSource, "https://docs.volcengine.com/docs/ark/model-deprecation-notice?lang=zh"])
  result.complete = result.complete && !result.models.some(m => m.permission === "unknown")
  result.warnings.push("当前官方型号表（2026-09-28）与推理 Key 目录合并；历史/未确认型号不作为新配置推荐，列出不等于有调用权限")
  return result
}
function checkBusiness(response: Json) { if (response.error || response.code || response.success === false) throw new ProviderAdapterError("HTTP_ERROR") }
function oneImage(images: unknown): void {
  if (!Array.isArray(images) || images.length !== 1) throw new ProviderAdapterError("INVALID_RESPONSE")
  const image = object(images[0]); let validUrl = false
  if (typeof image.url === "string") { try { const url = new URL(image.url); validUrl = url.protocol === "https:" && !url.username && !url.password } catch {} }
  const validBase64 = typeof image.b64_json === "string" && image.b64_json.length >= 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(image.b64_json)
  if (image.error || image.code || (!validUrl && !validBase64)) throw new ProviderAdapterError("INVALID_RESPONSE")
}
function choiceImages(output: Json): Json[] {
  if (!Array.isArray(output.choices)) throw new ProviderAdapterError("INVALID_RESPONSE")
  const images: Json[] = []
  for (const raw of output.choices) {
    const choice = object(raw); const message = object(choice.message)
    if (!Array.isArray(message.content) || (choice.finish_reason != null && choice.finish_reason !== "stop")) throw new ProviderAdapterError("INVALID_RESPONSE")
    for (const rawContent of message.content) { const content = object(rawContent); if (content.image != null) images.push({ url: content.image }) }
  }
  return images
}
function countedUsage(response: Json, imageCountField: string | string[], names = { input: "input_tokens", output: "output_tokens", total: "total_tokens" }): ConnectionTestResult["usage"] {
  const usage = response.usage == null ? {} : object(response.usage)
  for (const field of Array.isArray(imageCountField) ? imageCountField : [imageCountField]) {
    if (usage[field] != null && usage[field] !== 1) throw new ProviderAdapterError("INVALID_RESPONSE")
  }
  return parseUsage(usage, names, 1)
}
function taskId(ctx: ProviderAdapterContext, raw: unknown): string {
  const id = ctx.checkText(raw, 200)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) throw new ProviderAdapterError("INVALID_RESPONSE")
  return id
}
async function pollTask(ctx: ProviderAdapterContext, id: string, path: string, provider: "alibaba" | "tencent" | "vidu"): Promise<Json> {
  for (let i = 0; i < ctx.maxPolls; i++) {
    await ctx.delay()
    const response = await ctx.request(path + encodeURIComponent(id)); checkBusiness(response)
    const output = provider === "alibaba" ? object(response.output) : response
    // Vidu's documented final response omits task_id. The request path is
    // bound to the validated submit ID; any optional echo must still match.
    if (provider === "vidu" ? output.task_id != null && output.task_id !== id : output.task_id !== id) throw new ProviderAdapterError("INVALID_RESPONSE")
    if (provider === "vidu" && output.model != null && output.model !== ctx.draft.modelId) throw new ProviderAdapterError("INVALID_RESPONSE")
    const status = provider === "alibaba" ? output.task_status : provider === "vidu" ? output.state : output.status
    if (status === (provider === "alibaba" ? "SUCCEEDED" : provider === "vidu" ? "success" : "completed")) return response
    if (["FAILED", "CANCELED", "failed", "cancelled", "incomplete"].includes(String(status))) throw new ProviderAdapterError("HTTP_ERROR")
    if (!(provider === "alibaba" ? ["PENDING", "RUNNING"] : provider === "vidu" ? ["created", "queueing", "processing"] : ["queued", "in_progress"]).includes(String(status))) throw new ProviderAdapterError("INVALID_RESPONSE")
  }
  throw new ProviderAdapterError("TIMEOUT")
}
const prompt = "Generate exactly one image: a single black dot on a plain white background."
const aliSmallQwen = new Set(["qwen-image-3.0-pro", "qwen-image-3.0", "qwen-image-2.1-pro", "qwen-image-2.0-pro", "qwen-image-2.0-pro-2026-06-22", "qwen-image-2.0-pro-2026-04-22", "qwen-image-2.0-pro-2026-03-03", "qwen-image-2.0", "qwen-image-2.0-2026-03-03"])
const aliLegacyQwen = new Set(["qwen-image-max", "qwen-image-max-2025-12-30", "qwen-image-plus", "qwen-image-plus-2026-01-09", "qwen-image"])
const aliLegacyWan = new Set(["wan2.5-t2i-preview", "wan2.2-t2i-flash", "wan2.2-t2i-plus", "wanx2.1-t2i-turbo", "wanx2.1-t2i-plus", "wanx2.0-t2i-turbo"])
export async function testAlibabaImage(ctx: ProviderAdapterContext): Promise<ConnectionTestResult["usage"]> {
  const model = ctx.draft.modelId!; let response: Json; let legacy = false
  if (["wan2.7-image-pro", "wan2.7-image", "wan2.6-image"].includes(model)) {
    const parameters = model === "wan2.6-image" ? { n: 1, max_images: 1, size: "768*768", enable_interleave: true } : { n: 1, size: "768*768", enable_sequential: false, thinking_mode: false }
    response = await ctx.request("/services/aigc/image-generation/generation", { model, input: { messages: [{ role: "user", content: [{ text: prompt }] }] }, parameters }, { "X-DashScope-Async": "enable" })
    checkBusiness(response); const output = object(response.output); const id = taskId(ctx, output.task_id)
    if (output.task_status !== "PENDING" && output.task_status !== "RUNNING") throw new ProviderAdapterError("INVALID_RESPONSE")
    response = await pollTask(ctx, id, "/tasks/", "alibaba")
  } else if (aliLegacyWan.has(model)) {
    legacy = true
    response = await ctx.request("/services/aigc/text2image/image-synthesis", { model, input: { prompt }, parameters: { n: 1, size: model === "wan2.5-t2i-preview" ? "1280*1280" : "512*512", prompt_extend: false } }, { "X-DashScope-Async": "enable" })
    checkBusiness(response); const output = object(response.output); const id = taskId(ctx, output.task_id)
    if (output.task_status !== "PENDING" && output.task_status !== "RUNNING") throw new ProviderAdapterError("INVALID_RESPONSE")
    response = await pollTask(ctx, id, "/tasks/", "alibaba")
  } else if (aliSmallQwen.has(model) || aliLegacyQwen.has(model) || model === "z-image-turbo" || model === "wan2.6-t2i") {
    response = await ctx.request("/services/aigc/multimodal-generation/generation", { model, input: { messages: [{ role: "user", content: [{ text: prompt }] }] }, parameters: { ...(model === "z-image-turbo" ? {} : { n: 1 }), size: model === "wan2.6-t2i" ? "1280*1280" : aliLegacyQwen.has(model) ? "1328*1328" : "512*512", prompt_extend: false } })
  } else throw new ProviderAdapterError("UNSUPPORTED_TEST")
  checkBusiness(response); const output = object(response.output)
  if (legacy && output.task_metrics != null) {
    const metrics = object(output.task_metrics)
    if (metrics.TOTAL !== 1 || metrics.SUCCEEDED !== 1 || metrics.FAILED !== 0) throw new ProviderAdapterError("INVALID_RESPONSE")
  }
  oneImage(legacy ? output.results : choiceImages(output)); return countedUsage(response, ["image_count", "output_image_count"])
}
export async function testTencentImage(ctx: ProviderAdapterContext): Promise<ConnectionTestResult["usage"]> {
  const model = ctx.draft.modelId!; let response: Json; let images: unknown
  if (model === "hy-image-v3") {
    response = await ctx.request("/wand/hunyuan-image/v3-generation", { model, prompt, size: "512x512", revise: false }); checkBusiness(response); images = response.data
  } else if (model === "hy-image-v3.5-preview") {
    response = await ctx.request("/wand/hunyuan-image/v35-generation", { model, messages: [{ role: "user", content: [{ type: "text", text: prompt }] }], size: "256x256" }); checkBusiness(response)
    if (!Array.isArray(response.choices) || response.choices.length !== 1) throw new ProviderAdapterError("INVALID_RESPONSE")
    const choice = object(response.choices[0]); const delta = object(choice.delta); if (delta.type !== "image" || (choice.finish_reason != null && choice.finish_reason !== "stop")) throw new ProviderAdapterError("INVALID_RESPONSE")
    images = [object(delta.image)]
  } else if (tencentWand.has(model)) {
    response = await ctx.request("/wand/vega-images/generations", { model, prompt, size: "1024x1024" }); checkBusiness(response)
    const id = taskId(ctx, response.task_id); response = await pollTask(ctx, id, "/wand/vega-images/tasks/", "tencent"); images = response.data
  } else if (model === "vidu-image-q2") {
    response = await ctx.request("/wand/vidu-image/generation", { model, prompt, aspect_ratio: "1:1", resolution: "1080p" }); checkBusiness(response)
    if (response.state !== "created" && response.state !== "queueing" && response.state !== "processing") throw new ProviderAdapterError("INVALID_RESPONSE")
    const id = taskId(ctx, response.task_id); response = await pollTask(ctx, id, "/wand/vidu-image/tasks/", "vidu"); images = response.creations
  } else if (tencentSeedream.has(model)) {
    response = await ctx.request("/wand/si-image/generation", { model, prompt, size: model === "seedream-image-v5.0-pro" ? "1K" : "2K", response_format: "url", ...(model === "seedream-image-v5.0-lite" ? { sequential_image_generation: "disabled" } : {}) }); checkBusiness(response); images = response.data
  } else throw new ProviderAdapterError("UNSUPPORTED_TEST")
  oneImage(images); return parseUsage(response.tokenhub_usage ?? response.usage, { input: "input_tokens", output: "output_tokens", total: "total_tokens" }, 1)
}
export async function testByteDanceImage(ctx: ProviderAdapterContext): Promise<ConnectionTestResult["usage"]> {
  const model = ctx.draft.modelId!
  if (!byteSingleOnly.has(model) && !byteSequential.has(model)) throw new ProviderAdapterError("UNSUPPORTED_TEST")
  const response = await ctx.request("/images/generations", { model, prompt, size: byteSingleOnly.has(model) ? "1K" : "2K", ...(byteSequential.has(model) ? { sequential_image_generation: "disabled" } : {}), stream: false, response_format: "url" })
  checkBusiness(response); oneImage(response.data); return countedUsage(response, "generated_images", { input: "input_tokens", output: "output_tokens", total: "total_tokens" })
}
