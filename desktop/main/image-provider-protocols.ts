import { ModelAuthorizationError } from '../core/model-authorization'
import type { PublicModel } from '../core/settings'
import type { GeneratedImage } from './image-generation'

type Json = Record<string, unknown>
interface Context {
  model: PublicModel; prompt: string; sizes?: readonly string[]; watermark?: boolean
  request(path: string, body?: Json, headers?: Record<string, string>): Promise<Json>
  download(receipt: Json, url: unknown): Promise<GeneratedImage>
  decode(base64: unknown): Promise<GeneratedImage>
  delay(): Promise<void>
}
const fail = (code: string): never => { throw new ModelAuthorizationError(code) }
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : fail('IMAGE_RESPONSE_INVALID')
const exactOne = (value: unknown): Json => Array.isArray(value) && value.length === 1 ? object(value[0]) : fail('IMAGE_RESPONSE_INVALID')
function dimensions(value: string) { return value.split('x').map(Number) as [number, number] }
export function imageRatio(sizes?: readonly string[]): string {
  if (!sizes?.[0]) return '1:1'
  const [width, height] = dimensions(sizes[0]); let a = width, b = height
  while (b) { const next = a % b; a = b; b = next }
  const ratio = `${width / a}:${height / a}`
  return ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'].includes(ratio) ? ratio : '1:1'
}
function sized(sizes: readonly string[] | undefined, valid: (width: number, height: number) => boolean, fallback?: string) {
  return sizes?.find(value => valid(...dimensions(value))) ?? fallback
}
function area(min: number, max: number, minSide = 1, maxSide = 8192, maxRatio = 8) {
  return (width: number, height: number) => width >= minSide && height >= minSide && width <= maxSide && height <= maxSide && width * height >= min && width * height <= max && width / height <= maxRatio && height / width <= maxRatio
}
function nearest(sizes: readonly string[] | undefined, choices: readonly string[]): string {
  const first = sizes?.find(size => choices.includes(size)); if (first) return first
  const [width, height] = dimensions(sizes?.[0] ?? '1024x1024'), target = width / height
  return [...choices].sort((a, b) => { const [aw, ah] = dimensions(a), [bw, bh] = dimensions(b); return Math.abs(Math.log(aw / ah / target)) - Math.abs(Math.log(bw / bh / target)) })[0]
}
function usageCount(json: Json, fields: readonly string[]) {
  const usage = json.usage == null ? {} : object(json.usage)
  for (const field of fields) if (usage[field] != null && usage[field] !== 1) fail('IMAGE_RESPONSE_INVALID')
}
async function dataImage(ctx: Context, json: Json, images: unknown): Promise<GeneratedImage> {
  const image = exactOne(images)
  if (image.error || image.code || image.respect_moderation === false) return fail('IMAGE_PROVIDER_FAILED')
  return image.b64_json != null ? ctx.decode(image.b64_json) : ctx.download(json, image.url)
}
function choiceImages(output: Json): Json[] {
  if (!Array.isArray(output.choices) || output.finished === false) return fail('IMAGE_RESPONSE_INVALID')
  const images: Json[] = []
  for (const item of output.choices) {
    const choice = object(item), message = object(choice.message)
    if (choice.finish_reason != null && choice.finish_reason !== 'stop' || !Array.isArray(message.content)) return fail('IMAGE_RESPONSE_INVALID')
    for (const item of message.content) { const content = object(item); if (content.image != null) images.push({ url: content.image }) }
  }
  return images
}
function taskId(value: unknown): string {
  return typeof value === 'string' && value.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ? value : fail('IMAGE_RESPONSE_INVALID')
}
async function poll(ctx: Context, id: string, path: string, protocol: 'alibaba' | 'tencent' | 'vidu'): Promise<Json> {
  for (let attempt = 0; attempt < 60; attempt++) {
    await ctx.delay()
    const json = await ctx.request(path + encodeURIComponent(id)), output = protocol === 'alibaba' ? object(json.output) : json
    if (protocol === 'vidu' ? output.task_id != null && output.task_id !== id : output.task_id !== id) return fail('IMAGE_RESPONSE_INVALID')
    if (protocol === 'vidu' && output.model != null && output.model !== ctx.model.modelId) return fail('IMAGE_RESPONSE_INVALID')
    const status = protocol === 'alibaba' ? output.task_status : protocol === 'vidu' ? output.state : output.status
    if (status === (protocol === 'alibaba' ? 'SUCCEEDED' : protocol === 'vidu' ? 'success' : 'completed')) return json
    if (['FAILED', 'CANCELED', 'failed', 'cancelled', 'incomplete'].includes(String(status))) return fail('IMAGE_PROVIDER_FAILED')
    if (!(protocol === 'alibaba' ? ['PENDING', 'RUNNING'] : protocol === 'vidu' ? ['created', 'queueing', 'processing'] : ['queued', 'in_progress']).includes(String(status))) return fail('IMAGE_RESPONSE_INVALID')
  }
  return fail('IMAGE_TIMEOUT')
}
const qwenFlexible = new Set(['qwen-image-3.0-pro', 'qwen-image-3.0', 'qwen-image-2.1-pro', 'qwen-image-2.0-pro', 'qwen-image-2.0-pro-2026-06-22', 'qwen-image-2.0-pro-2026-04-22', 'qwen-image-2.0-pro-2026-03-03', 'qwen-image-2.0', 'qwen-image-2.0-2026-03-03'])
const qwenFixed = new Set(['qwen-image-max', 'qwen-image-max-2025-12-30', 'qwen-image-plus', 'qwen-image-plus-2026-01-09', 'qwen-image'])
const wanLegacy = new Set(['wan2.5-t2i-preview', 'wan2.2-t2i-flash', 'wan2.2-t2i-plus', 'wanx2.1-t2i-turbo', 'wanx2.1-t2i-plus', 'wanx2.0-t2i-turbo'])
const kling = new Set(['kling/kling-v3-image-generation', 'kling/kling-v3-omni-image-generation'])
const aliVidu = new Set(['vidu/vidu-image_reference2image', 'vidu/vidu-image-pro_reference2image', 'vidu/vidu-image-lite_reference2image', 'vidu/viduq3-fast_reference2image', 'vidu/viduq2-pro_reference2image', 'vidu/viduq2-fast_reference2image'])
const viduClassicSizes = ['1024x1024', '720x1440', '1440x720', '1024x768', '768x1024', '1920x1088', '1088x1920', '1536x1024', '1024x1536', '1920x816', '816x1920', '2048x2048', '1088x2160', '2160x1088', '2736x2048', '2048x2736', '2560x1440', '1440x2560', '3072x2048', '2048x3072', '2560x1104', '1104x2560']
const viduQSizes = ['1024x1024', '768x1376', '848x1264', '896x1200', '928x1152', '1152x928', '1200x896', '1264x848', '1376x768', '1584x672']
const viduQ2KSizes = ['2048x2048', '1536x2752', '1696x2528', '1792x2400', '1856x2304', '2304x1856', '2400x1792', '2528x1696', '2752x1536', '3168x1344']
const wand = new Set(['wand-vega-image-lite', 'wand-vega-image-flash', 'wand-vega-image-pro'])
const byteSingle = new Set(['doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-flash-260915'])
const byteSequential = new Set(['doubao-seedream-5-0-260128', 'doubao-seedream-5-0-lite-260128', 'doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828'])

/** Exact published protocol IDs; these do not claim account permission or infer a future ID's capability. */
export async function generateProviderImage(ctx: Context): Promise<GeneratedImage> {
  const { provider, modelId: model } = ctx.model, ratio = imageRatio(ctx.sizes)
  if (ctx.model.protocol !== 'openai') return fail('IMAGE_GENERATION_UNSUPPORTED')
  if (provider === 'xai') {
    const json = await ctx.request('/images/generations', { model, prompt: ctx.prompt, n: 1, aspect_ratio: ratio, resolution: ctx.sizes?.some(size => Math.max(...dimensions(size)) > 1024) ? '2k' : '1k', response_format: 'b64_json' })
    return dataImage(ctx, json, json.data)
  }
  if (provider === 'zai') {
    if (!['glm-image', 'cogview-4-250304'].includes(model)) return fail('IMAGE_GENERATION_UNSUPPORTED')
    const minimum = model === 'glm-image' ? 1024 : 512, multiple = model === 'glm-image' ? 32 : 16, maximum = model === 'glm-image' ? 2 ** 22 : 2 ** 21
    const size = sized(ctx.sizes, (w, h) => w >= minimum && h >= minimum && w <= 2048 && h <= 2048 && w % multiple === 0 && h % multiple === 0 && w * h <= maximum)
    const json = await ctx.request('/images/generations', { model, prompt: ctx.prompt, ...(size ? { size } : {}) })
    return dataImage(ctx, json, json.data)
  }
  if (provider === 'minimax') {
    if (model !== 'image-01') return fail('IMAGE_GENERATION_UNSUPPORTED')
    if ([...ctx.prompt].length > 1500) return fail('IMAGE_PROMPT_TOO_LONG')
    const json = await ctx.request('/image_generation', { model, prompt: ctx.prompt, n: 1, aspect_ratio: ratio, response_format: 'url', prompt_optimizer: false })
    if (object(json.base_resp).status_code !== 0) return fail('IMAGE_PROVIDER_FAILED')
    const metadata = object(json.metadata)
    if (!['1', 1].includes(metadata.success_count as string | number) || !['0', 0].includes(metadata.failed_count as string | number)) return fail('IMAGE_RESPONSE_INVALID')
    const images = object(json.data).image_urls
    if (!Array.isArray(images) || images.length !== 1) return fail('IMAGE_RESPONSE_INVALID')
    return ctx.download(json, images[0])
  }
  if (provider === 'bytedance') {
    if (!byteSingle.has(model) && !byteSequential.has(model)) return fail('IMAGE_GENERATION_UNSUPPORTED')
    const minimum = byteSingle.has(model) || model === 'doubao-seedream-4-0-250828' ? 921600 : 3686400
    const maximum = byteSingle.has(model) ? 4624220 : 16777216
    const size = sized(ctx.sizes, area(minimum, maximum, 1, 8192, 16), byteSingle.has(model) ? '1K' : '2K')
    const json = await ctx.request('/images/generations', { model, prompt: ctx.prompt, size, ...(byteSequential.has(model) ? { sequential_image_generation: 'disabled' } : {}), stream: false, response_format: 'url', watermark: ctx.watermark ?? false })
    usageCount(json, ['generated_images']); return dataImage(ctx, json, json.data)
  }
  if (provider === 'alibaba') {
    const promptLimit = model === 'z-image-turbo' ? 800 : model === 'wan2.6-image' ? 2000 : ['wan2.7-image', 'wan2.7-image-pro'].includes(model) ? 5000 : kling.has(model) ? 2500 : model === 'wan2.6-t2i' ? 2100 : model === 'wan2.5-t2i-preview' ? 2000 : model === 'wanx2.0-t2i-turbo' ? 800 : wanLegacy.has(model) ? 500 : undefined
    if (promptLimit != null && [...ctx.prompt].length > promptLimit) return fail('IMAGE_PROMPT_TOO_LONG')
    let json: Json, legacy = false
    const messages = [{ role: 'user', content: [{ text: ctx.prompt }] }]
    if (['wan2.7-image-pro', 'wan2.7-image', 'wan2.6-image'].includes(model) || kling.has(model) || aliVidu.has(model)) {
      let parameters: Json
      if (kling.has(model)) parameters = { n: 1, aspect_ratio: ['16:9', '9:16', '1:1'].includes(ratio) ? ratio : ratio === '2:3' || ratio === '3:4' ? '9:16' : ratio === '3:2' || ratio === '4:3' ? '16:9' : '1:1', resolution: '1k', watermark: ctx.watermark ?? false, ...(model === 'kling/kling-v3-omni-image-generation' ? { result_type: 'single' } : {}) }
      else if (aliVidu.has(model)) {
        const classic = ['vidu/vidu-image_reference2image', 'vidu/vidu-image-pro_reference2image', 'vidu/vidu-image-lite_reference2image'].includes(model)
        const choices = classic ? viduClassicSizes : model === 'vidu/viduq2-fast_reference2image' ? viduQSizes : [...viduQSizes, ...viduQ2KSizes]
        parameters = { n: 1, size: nearest(ctx.sizes, choices).replace('x', '*'), watermark: ctx.watermark ?? false }
      }
      else {
        const fallback = model === 'wan2.6-image' ? ratio === '2:3' ? '800x1200' : ratio === '3:2' ? '1200x800' : '1280x1280' : ratio === '2:3' ? '1024x1536' : ratio === '3:2' ? '1536x1024' : '1024x1024'
        const size = sized(ctx.sizes, area(768 ** 2, model === 'wan2.7-image-pro' ? 4096 ** 2 : model === 'wan2.6-image' ? 1280 ** 2 : 2048 ** 2, 1, 8192, model === 'wan2.6-image' ? 4 : 8), fallback)!.replace('x', '*')
        parameters = model === 'wan2.6-image' ? { n: 1, max_images: 1, size, enable_interleave: true, watermark: ctx.watermark ?? false } : { n: 1, size, enable_sequential: false, watermark: ctx.watermark ?? false }
      }
      json = await ctx.request('/services/aigc/image-generation/generation', { model, input: { messages }, parameters }, { 'X-DashScope-Async': 'enable' })
      const output = object(json.output), id = taskId(output.task_id)
      if (!['PENDING', 'RUNNING'].includes(String(output.task_status))) return fail('IMAGE_RESPONSE_INVALID')
      json = await poll(ctx, id, '/tasks/', 'alibaba')
    } else if (wanLegacy.has(model)) {
      legacy = true
      const min = model === 'wan2.5-t2i-preview' ? 1280 ** 2 : 512 ** 2
      const size = sized(ctx.sizes, area(min, 1440 ** 2, model === 'wan2.5-t2i-preview' ? 1 : 512, model === 'wan2.5-t2i-preview' ? 8192 : 1440, 4), model === 'wan2.5-t2i-preview' ? ratio === '2:3' ? '1088x1632' : ratio === '3:2' ? '1632x1088' : '1280x1280' : ratio === '2:3' ? '832x1248' : ratio === '3:2' ? '1248x832' : '1024x1024')!.replace('x', '*')
      json = await ctx.request('/services/aigc/text2image/image-synthesis', { model, input: { prompt: ctx.prompt }, parameters: { n: 1, size, prompt_extend: false } }, { 'X-DashScope-Async': 'enable' })
      const output = object(json.output), id = taskId(output.task_id)
      if (!['PENDING', 'RUNNING'].includes(String(output.task_status))) return fail('IMAGE_RESPONSE_INVALID')
      json = await poll(ctx, id, '/tasks/', 'alibaba')
    } else if (qwenFlexible.has(model) || qwenFixed.has(model) || ['z-image-turbo', 'wan2.6-t2i'].includes(model)) {
      const min = model === 'wan2.6-t2i' ? 1280 ** 2 : 512 ** 2
      const size = qwenFixed.has(model) ? nearest(ctx.sizes, ['1664x928', '1472x1104', '1328x1328', '1104x1472', '928x1664']) : sized(ctx.sizes, area(min, model === 'wan2.6-t2i' ? 1440 ** 2 : 2048 ** 2, 1, 8192, model === 'wan2.6-t2i' ? 4 : 8), model === 'wan2.6-t2i' ? ratio === '2:3' ? '1088x1632' : ratio === '3:2' ? '1632x1088' : '1280x1280' : '1024x1536')!
      json = await ctx.request('/services/aigc/multimodal-generation/generation', { model, input: { messages }, parameters: { ...(model === 'z-image-turbo' ? {} : { n: 1 }), size: size.replace('x', '*'), prompt_extend: false, ...(model === 'z-image-turbo' ? {} : { watermark: ctx.watermark ?? false }) } })
    } else return fail('IMAGE_GENERATION_UNSUPPORTED')
    const output = object(json.output)
    if (legacy && output.task_metrics != null) { const counts = object(output.task_metrics); if (counts.TOTAL !== 1 || counts.SUCCEEDED !== 1 || counts.FAILED !== 0) return fail('IMAGE_RESPONSE_INVALID') }
    usageCount(json, ['image_count', 'output_image_count'])
    return dataImage(ctx, json, legacy ? output.results : choiceImages(output))
  }
  if (provider === 'tencent') {
    let json: Json, images: unknown
    if (model === 'hy-image-v3') {
      if ([...ctx.prompt].length > 8192) return fail('IMAGE_PROMPT_TOO_LONG')
      const size = sized(ctx.sizes, area(512 ** 2, 1024 ** 2, 512, 2048), ratio === '2:3' ? '768x1280' : ratio === '3:2' ? '1280x768' : '1024x1024')
      json = await ctx.request('/wand/hunyuan-image/v3-generation', { model, prompt: ctx.prompt, size, revise: false }); images = json.data
    } else if (model === 'hy-image-v3.5-preview') {
      const size = sized(ctx.sizes, area(256 ** 2, 4096 ** 2, 256, 8192, 32))
      json = await ctx.request('/wand/hunyuan-image/v35-generation', { model, messages: [{ role: 'user', content: [{ type: 'text', text: ctx.prompt }] }], ...(size ? { size } : {}) })
      const choice = exactOne(json.choices), delta = object(choice.delta)
      if (delta.type !== 'image' || choice.finish_reason != null && choice.finish_reason !== 'stop') return fail('IMAGE_RESPONSE_INVALID')
      images = [object(delta.image)]
    } else if (wand.has(model)) {
      if ([...ctx.prompt].length > 2000) return fail('IMAGE_PROMPT_TOO_LONG')
      const size = nearest(ctx.sizes, ['1024x1024', '1080x1080', '2048x2048', '2160x2160', '1024x1536', '1080x1620', '1536x1024', '1620x1080', '1440x2160', '2160x1440', '1080x1440', '1440x1080', '1440x1920', '1920x1440', '2160x2880', '2880x2160', '720x1280', '1080x1920', '1440x2560', '1280x720', '1920x1080', '2560x1440', '1512x648', '2520x1080'])
      json = await ctx.request('/wand/vega-images/generations', { model, prompt: ctx.prompt, size })
      json = await poll(ctx, taskId(json.task_id), '/wand/vega-images/tasks/', 'tencent'); images = json.data
    } else if (model === 'vidu-image-q2') {
      if ([...ctx.prompt].length > 2000) return fail('IMAGE_PROMPT_TOO_LONG')
      json = await ctx.request('/wand/vidu-image/generation', { model, prompt: ctx.prompt, aspect_ratio: ratio, resolution: '1080p' })
      if (!['created', 'queueing', 'processing'].includes(String(json.state))) return fail('IMAGE_RESPONSE_INVALID')
      json = await poll(ctx, taskId(json.task_id), '/wand/vidu-image/tasks/', 'vidu'); images = json.creations
    } else if (['seedream-image-v5.0-pro', 'seedream-image-v5.0-lite'].includes(model)) {
      if ([...ctx.prompt].length > 600) return fail('IMAGE_PROMPT_TOO_LONG')
      const pro = model === 'seedream-image-v5.0-pro', size = sized(ctx.sizes, area(pro ? 921600 : 3686400, pro ? 4624220 : 4096 ** 2, 1, 8192, 16), pro ? '1K' : '2K')
      json = await ctx.request('/wand/si-image/generation', { model, prompt: ctx.prompt, size, response_format: 'url', watermark: ctx.watermark ?? false, ...(pro ? {} : { sequential_image_generation: 'disabled' }) }); images = json.data
    } else return fail('IMAGE_GENERATION_UNSUPPORTED')
    return dataImage(ctx, json, images)
  }
  return fail('IMAGE_GENERATION_UNSUPPORTED')
}
