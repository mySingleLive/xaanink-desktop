import { z } from "zod"
import { ModelGateway, ModelAuthorizationError, type ModelLease } from "../core/model-authorization"
import type { ModelRepository } from "./model-repository"
import { generateMainImage, waitImageOperation } from "./image-generation"
import type { ImageGenerationHeader } from "../shared/image-generation"
import { freezeTaskDefaults } from "../shared/task-defaults"
const selectionSchema = z.object({ role: z.enum(["text", "review", "image"]), id: z.string().min(1).max(200).nullable().optional(), intent: z.enum(["invoke", "selection"]).optional() }).strict()
const networkSchema = z.object({ id: z.uuid(), modelId: z.uuid(), authRevision: z.number().int().positive(), kind: z.enum(["TEXT", "IMAGE"]), url: z.url().max(4096), method: z.enum(["GET", "POST"]), headers: z.record(z.string().max(100), z.string().max(2048)), body: z.string().max(16 * 1024 * 1024).optional() }).strict()
const imageSchema = z.object({ id: z.uuid(), modelId: z.uuid(), authRevision: z.number().int().positive(), prompt: z.string().min(1).max(128000), sizes: z.array(z.string().regex(/^\d{2,5}x\d{2,5}$/)).max(8).optional(), watermark: z.boolean().optional() }).strict()
interface Transfer { imageAbort?: AbortController; canceled: boolean; pending: Promise<void>; lease?: ModelLease; reader?: ReadableStreamDefaultReader<Uint8Array>; remainder?: Uint8Array; reading: boolean }
/** Trusted worker calls this service; credentials and HTTP ownership remain in main. */
export class ModelService {
  private readonly transfers = new Map<string, Transfer>()
  private closing = false
  constructor(private readonly repository: ModelRepository, private readonly gateway: ModelGateway) {}
  get activeCount() { return this.transfers.size }
  resume() { this.closing = false }
  async defaults() {
    const state = await this.repository.read()
    return freezeTaskDefaults(state.settings.agent, state.revision)
  }
  async resolve(value: unknown) {
    const selection = selectionSchema.parse(value)
    const state = await this.repository.read()
    const kind = selection.role === "image" ? "IMAGE" : "TEXT"
    const id = selection.id === undefined ? state.settings.agent[selection.role === "image" ? "imageModelId" : selection.role === "review" ? "reviewModelId" : "textModelId"] : selection.id
    if (!id) throw new ModelAuthorizationError(state.models.some(model => model.kind === kind) ? "MODEL_NOT_SELECTED" : "MODEL_NOT_CONFIGURED")
    const model = state.models.find(model => model.id === id)
    if (!model) throw new ModelAuthorizationError("MODEL_NOT_FOUND")
    if (!model.enabled) throw new ModelAuthorizationError("MODEL_DISABLED")
    if (model.kind !== kind) throw new ModelAuthorizationError("MODEL_KIND_MISMATCH")
    // Resolving a usable record must also prove its main-only credential is
    // available. No key or raw vault diagnostic is returned to the worker.
    try { if (!(await this.repository.keyFor(model.id, model.authRevision))) throw new Error() }
    catch {
      const current = (await this.repository.read()).models.find(record => record.id === model.id)
      if (!current?.enabled || current.authRevision !== model.authRevision) throw new ModelAuthorizationError("AUTHORIZATION_REVOKED")
      throw new ModelAuthorizationError("MODEL_KEY_MISSING")
    }
    // A successful vault read can yield to a committed disable, delete or key
    // replacement just as a failed read can. Selection must not return stale
    // usable metadata; the gateway repeats this check at the HTTP boundary.
    const current = (await this.repository.read()).models.find(record => record.id === model.id)
    if (!current?.enabled || current.authRevision !== model.authRevision) throw new ModelAuthorizationError("AUTHORIZATION_REVOKED")
    return model
  }
  async start(value: unknown) {
    const input = networkSchema.parse(value)
    if (this.closing) throw new Error("模型服务正在关闭")
    if (this.transfers.has(input.id) || this.transfers.size >= 64) throw new Error("模型请求编号重复或请求过多")
    const settled = Promise.withResolvers<void>()
    const transfer: Transfer = { canceled: false, pending: settled.promise, reading: false }
    this.transfers.set(input.id, transfer)
    try {
      const model = await this.resolve({ id: input.modelId, role: input.kind === "TEXT" ? "text" : "image" })
      if (transfer.canceled || model.authRevision !== input.authRevision) throw new ModelAuthorizationError("AUTHORIZATION_REVOKED")
      if (input.method === "POST") {
        let payload: { model?: unknown }
        try { payload = JSON.parse(input.body ?? "") } catch { throw new Error("模型请求正文无效") }
        if (!payload || payload.model !== model.modelId) throw new ModelAuthorizationError("MODEL_REQUEST_MISMATCH")
      }
      transfer.lease = this.gateway.begin(input.modelId, input.kind)
      if (transfer.lease.authRevision !== input.authRevision) throw new ModelAuthorizationError("AUTHORIZATION_REVOKED")
      let response = await this.gateway.fetch(transfer.lease, input.url, { method: input.method, headers: input.headers, body: input.body })
      if (transfer.canceled) { await response.body?.cancel(); throw new ModelAuthorizationError("AUTHORIZATION_REVOKED") }
      // Error payloads may echo provider credentials. Preserve status, never their raw diagnostics.
      if (!response.ok) {
        await response.body?.cancel()
        response = Response.json({ error: { message: `模型接口请求失败（HTTP ${response.status}）`, code: `HTTP_${response.status}` } }, { status: response.status, headers: { ...(response.headers.has("retry-after") ? { "retry-after": response.headers.get("retry-after")! } : {}) } })
      }
      transfer.reader = (response.body ?? new ReadableStream<Uint8Array>({ start(controller) { controller.close() } })).getReader()
      return { id: input.id, status: response.status, headers: Object.fromEntries([...response.headers].filter(([name]) => ["content-type", "retry-after"].includes(name))) }
    } catch (error) {
      if (transfer.lease) this.gateway.finish(transfer.lease)
      if (this.transfers.get(input.id) === transfer) this.transfers.delete(input.id)
      throw error
    } finally { settled.resolve() }
  }
  async startImage(value: unknown): Promise<ImageGenerationHeader> {
    const input = imageSchema.parse(value)
    if (this.closing) throw new ModelAuthorizationError("MODEL_SERVICE_CLOSING")
    if (this.transfers.has(input.id) || this.transfers.size >= 64) throw new ModelAuthorizationError("MODEL_REQUEST_LIMIT")
    const settled = Promise.withResolvers<void>(), controller = new AbortController()
    const transfer: Transfer = { canceled: false, pending: settled.promise, reading: false, imageAbort: controller }
    this.transfers.set(input.id, transfer)
    const timer = setTimeout(() => controller.abort(new ModelAuthorizationError("IMAGE_TIMEOUT")), 180_000)
    timer.unref()
    try {
      const model = await waitImageOperation(this.resolve({ id: input.modelId, role: "image" }), controller.signal)
      if (transfer.canceled || model.authRevision !== input.authRevision) throw new ModelAuthorizationError("AUTHORIZATION_REVOKED")
      transfer.lease = this.gateway.begin(input.modelId, "IMAGE")
      if (transfer.lease.authRevision !== input.authRevision) throw new ModelAuthorizationError("AUTHORIZATION_REVOKED")
      const image = await waitImageOperation(generateMainImage({ model, lease: transfer.lease, gateway: this.gateway, prompt: input.prompt, sizes: input.sizes, watermark: input.watermark, signal: controller.signal }), AbortSignal.any([controller.signal, transfer.lease.signal]))
      if (transfer.canceled || transfer.lease.signal.aborted) throw new ModelAuthorizationError("AUTHORIZATION_REVOKED")
      transfer.reader = new ReadableStream<Uint8Array>({ start(target) { target.enqueue(image.bytes); target.close() } }).getReader()
      return { id: input.id, status: 200, headers: { "content-type": image.mimeType, "content-length": String(image.bytes.byteLength) } }
    } catch (cause) {
      if (transfer.lease) this.gateway.finish(transfer.lease)
      if (this.transfers.get(input.id) === transfer) this.transfers.delete(input.id)
      if (controller.signal.aborted && controller.signal.reason instanceof ModelAuthorizationError) throw controller.signal.reason
      throw cause
    } finally { clearTimeout(timer); settled.resolve() }
  }
  async read(value: unknown): Promise<{ done: boolean; bytes?: Uint8Array }> {
    const id = z.uuid().parse(value); const transfer = this.transfers.get(id)
    if (!transfer?.reader || transfer.canceled || transfer.reading) throw new Error("模型响应不可读取")
    transfer.reading = true
    try {
      const chunk = transfer.remainder ? { done: false, value: transfer.remainder } : await transfer.reader.read()
      if (transfer.canceled || transfer.lease?.signal.aborted) throw new ModelAuthorizationError("AUTHORIZATION_REVOKED")
      if (chunk.done) { await this.cancel(id); return { done: true } }
      transfer.remainder = chunk.value.byteLength > 65536 ? chunk.value.slice(65536) : undefined
      return { done: false, bytes: chunk.value.slice(0, 65536) }
    } catch (error) { await this.cancel(id); throw error }
    finally { transfer.reading = false }
  }
  async cancel(value: unknown) {
    const id = z.uuid().parse(value); const transfer = this.transfers.get(id)
    if (!transfer) return
    transfer.canceled = true
    transfer.imageAbort?.abort(new ModelAuthorizationError("IMAGE_CANCELLED"))
    if (transfer.lease) this.gateway.finish(transfer.lease)
    if (transfer.reader) {
      try { await transfer.reader.cancel() } finally { transfer.reader.releaseLock(); if (this.transfers.get(id) === transfer) this.transfers.delete(id) }
    }
    // A pending start retains its ID until its original promise settles.
  }
  async close() {
    this.closing = true
    const pending = [...this.transfers.values()].map(transfer => transfer.pending)
    await Promise.allSettled([...this.transfers.keys()].map(id => this.cancel(id)))
    await Promise.allSettled(pending)
  }
}
