import type { PublicModel } from "../core/settings"
import { ModelAuthorizationError, type ModelGateway, type ModelLease } from "../core/model-authorization"
import sharp from "sharp"
import { generateProviderImage, imageRatio } from "./image-provider-protocols"

export interface MainImageGeneration {
  model: PublicModel
  lease: ModelLease
  gateway: ModelGateway
  prompt: string
  sizes?: readonly string[]
  watermark?: boolean
  signal?: AbortSignal
  /** Controlled unit-test scheduler; RPC never accepts this dependency. */
  pollDelay?: (signal: AbortSignal) => Promise<void>
}
export interface GeneratedImage {
  bytes: Uint8Array
  mimeType: "image/png" | "image/jpeg" | "image/webp"
}

type Json = Record<string, unknown>
const error = (code: string): never => { throw new ModelAuthorizationError(code) }
const object = (value: unknown): Json => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return error("IMAGE_RESPONSE_INVALID")
  return value as Json
}
export function waitImageOperation<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void work.catch(() => undefined); return Promise.reject(signal.reason) }
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener("abort", abort)
    signal.addEventListener("abort", abort, { once: true })
    work.then(value => { cleanup(); signal.aborted ? reject(signal.reason) : resolve(value) }, reason => { cleanup(); reject(reason) })
  })
}
async function responseJson(response: Response, signal: AbortSignal): Promise<Json> {
  if (!response.ok) { void response.body?.cancel().catch(() => undefined); return error(`IMAGE_HTTP_${response.status}`) }
  if (!response.body) return error("IMAGE_RESPONSE_INVALID")
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const next = await waitImageOperation(reader.read(), signal)
      if (next.done) break
      length += next.value.byteLength
      if (length > 16 * 1024 * 1024) return error("IMAGE_RESPONSE_TOO_LARGE")
      chunks.push(next.value)
    }
    let value: unknown
    try { value = JSON.parse(Buffer.concat(chunks, length).toString("utf8")) } catch { return error("IMAGE_RESPONSE_INVALID") }
    const json = object(value)
    if (json.error || json.code || json.success === false) return error("IMAGE_PROVIDER_FAILED")
    return json
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock() }
}
async function decodeImage(base64: unknown, declaredMime?: unknown): Promise<GeneratedImage> {
  if (typeof base64 !== "string" || base64.length < 4 || base64.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return error("IMAGE_RESPONSE_INVALID")
  const bytes = Buffer.from(base64, "base64")
  if (bytes.length > 10 * 1024 * 1024 || bytes.toString("base64") !== base64) return error("IMAGE_RESPONSE_INVALID")
  return validateImage(bytes, declaredMime)
}
async function validateImage(bytes: Uint8Array, declaredMime?: unknown): Promise<GeneratedImage> {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) return error("IMAGE_RESPONSE_INVALID")
  let metadata: sharp.Metadata
  try {
    const decoded = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" })
    metadata = await decoded.metadata()
    await decoded.stats()
  } catch { return error("IMAGE_RESPONSE_INVALID") }
  const mimeType = metadata.format === "png" ? "image/png" : metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "webp" ? "image/webp" : undefined
  if (!mimeType || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1 || (declaredMime != null && declaredMime !== mimeType)) return error("IMAGE_RESPONSE_INVALID")
  return { bytes, mimeType }
}

/** Main-only generation; callers retain the lease until worker read completes. */
export async function generateMainImage(input: MainImageGeneration): Promise<GeneratedImage> {
  const { model, lease, gateway } = input
  if (model.kind !== "IMAGE" || lease.kind !== "IMAGE") return error("MODEL_KIND_MISMATCH")
  if (model.id !== lease.modelId || model.authRevision !== lease.authRevision || lease.signal.aborted) return error("AUTHORIZATION_REVOKED")
  if (!model.enabled) return error("MODEL_DISABLED")
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 128000) return error("IMAGE_REQUEST_INVALID")
  if (input.sizes && (input.sizes.length > 8 || input.sizes.some(size => !/^\d{2,5}x\d{2,5}$/.test(size)))) return error("IMAGE_REQUEST_INVALID")
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 180_000)
  timer.unref()
  const signal = AbortSignal.any([lease.signal, timeout.signal, ...(input.signal ? [input.signal] : [])])
  const receipts = new WeakMap<Json, Response>()
  const request = async (path: string, body?: Json, headers?: Record<string, string>): Promise<Json> => {
    signal.throwIfAborted()
    const url = new URL(model.endpoint)
    url.pathname = url.pathname.replace(/\/+$/, "") + path
    const response = await waitImageOperation(gateway.fetch(lease, url.href, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal }), signal)
    const json = await responseJson(response, signal)
    receipts.set(json, response)
    return json
  }
  const download = async (json: Json, value: unknown): Promise<GeneratedImage> => {
    if (typeof value !== "string") return error("IMAGE_RESPONSE_INVALID")
    const receipt = receipts.get(json)
    if (!receipt) return error("IMAGE_RECEIPT_INVALID")
    const grant = await waitImageOperation(gateway.authorizeImageResource(lease, receipt, value, { allowSelfHosted: ["custom", "openai-compatible"].includes(model.provider) }), signal)
    const bytes = await waitImageOperation(gateway.readImageResource(lease, grant, signal), signal)
    return waitImageOperation(validateImage(bytes), signal)
  }
  try {
    let image: GeneratedImage
    if (model.provider === "google") {
      const known = ["gemini-nano-banana-2.1", "gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"]
      if (!known.includes(model.modelId)) return error("IMAGE_GENERATION_UNSUPPORTED")
      const response = await request("/interactions", { model: model.modelId, input: [{ type: "text", text: input.prompt }],
        response_format: { type: "image", aspect_ratio: imageRatio(input.sizes), delivery: "inline", ...(model.modelId === "gemini-2.5-flash-image" ? {} : { image_size: "1K" }) }, store: false, background: false, stream: false })
      if (response.status !== "completed" || !Array.isArray(response.steps)) return error("IMAGE_RESPONSE_INVALID")
      const images: Json[] = []
      for (const value of response.steps) {
        const step = object(value)
        if (step.type !== "model_output") continue
        if (!Array.isArray(step.content)) return error("IMAGE_RESPONSE_INVALID")
        for (const raw of step.content) { const content = object(raw); if (content.type === "image") images.push(content) }
      }
      if (images.length !== 1) return error("IMAGE_RESPONSE_INVALID")
      image = await waitImageOperation(decodeImage(images[0].data, images[0].mime_type), signal)
    } else if (["openai", "custom", "openai-compatible"].includes(model.provider)) {
      if (model.protocol !== "openai") return error("IMAGE_GENERATION_UNSUPPORTED")
      const size = model.provider === "openai" ? input.sizes?.find(value => ["1024x1024", "1024x1536", "1536x1024"].includes(value)) : input.sizes?.[0]
      const response = await request("/images/generations", { model: model.modelId, prompt: input.prompt, n: 1, ...(size ? { size } : {}) })
      if (!Array.isArray(response.data) || response.data.length !== 1) return error("IMAGE_RESPONSE_INVALID")
      const entry = object(response.data[0])
      if (entry.error || entry.code) return error("IMAGE_PROVIDER_FAILED")
      image = entry.b64_json != null ? await waitImageOperation(decodeImage(entry.b64_json), signal) : await download(response, entry.url)
    } else image = await generateProviderImage({ model, prompt: input.prompt, sizes: input.sizes, watermark: input.watermark, request, download, decode: base64 => waitImageOperation(decodeImage(base64), signal), delay: async () => {
      signal.throwIfAborted()
      if (input.pollDelay) await waitImageOperation(input.pollDelay(signal), signal)
      else await new Promise<void>((resolve, reject) => {
        const complete = () => { signal.removeEventListener("abort", abort); resolve() }
        const timer = setTimeout(complete, model.provider === "alibaba" ? 5000 : 3000)
        const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason) }
        signal.addEventListener("abort", abort, { once: true })
      })
      signal.throwIfAborted()
    } })
    signal.throwIfAborted()
    return image
  } catch (cause) {
    if (lease.signal.aborted) return error("AUTHORIZATION_REVOKED")
    if (input.signal?.aborted) return error("IMAGE_CANCELLED")
    if (timeout.signal.aborted) return error("IMAGE_TIMEOUT")
    if (cause instanceof ModelAuthorizationError) throw cause
    return error("IMAGE_GENERATION_FAILED")
  } finally { clearTimeout(timer) }
}
