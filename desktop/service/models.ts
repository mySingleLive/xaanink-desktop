import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import type { PublicModel, Settings } from "../core/settings"
import type { AIModel } from "../../src/generated/prisma/client"
import { ContentError } from "../../src/lib/content-errors"
import { getDatabaseContext, LOCAL_AUTHOR_ID } from "./context"
import { restoreTaskDefaults, type TaskDefaults } from "../shared/task-defaults"

type Call = <T>(method: string, value?: unknown) => Promise<T>
let callMain: Call | undefined
const authorization = new AsyncLocalStorage<PublicModel>()
const snapshots = new WeakMap<AIModel, PublicModel>()
export function configureModelTransport(call: Call) { callMain = call }
function call<T>(method: string, value?: unknown) { if (!callMain) throw new Error("主进程模型通道未连接"); return callMain<T>(method, value) }
/** Background catalogs read public main metadata only. They must never call
 * model.resolve, decrypt local reference rows, or trigger invocation guidance. */
export async function listLocalModels(userId: string, kind: "TEXT" | "IMAGE") {
  getDatabaseContext()
  if (userId !== LOCAL_AUTHOR_ID) throw new ContentError("LOCAL_AUTHOR_REQUIRED", "无法读取其他用户的模型配置", 403)
  const state = await call<{ revision: number; settings: Settings; models: PublicModel[] }>("model.catalog")
  const labels: Record<string, string> = { low: "低", medium: "中", high: "高", max: "最高", default: "默认" }
  return { defaultModelId: state.settings.agent[kind === "TEXT" ? "textModelId" : "imageModelId"],
    models: state.models.filter(model => model.kind === kind && model.enabled).map(model => ({
      id: model.id, name: model.name, provider: model.provider, modelId: model.modelId, contextWindow: model.contextWindow,
      tier: "NORMAL" as const, free: false, thinkingEfforts: model.thinkingLevels.filter(value => value !== "default").map(value => ({ value, label: labels[value] ?? value })),
    })) }
}
export async function readLocalTaskDefaults(): Promise<TaskDefaults> {
  getDatabaseContext()
  const snapshot = restoreTaskDefaults(await call("model.defaults"))
  if (!snapshot) throw new ContentError("MODEL_UNAVAILABLE", "无法读取本地智能体配置，请重试", 428)
  return snapshot
}
export async function resolveLocalModel(userId: string, role: "text" | "review" | "image", id?: string | null, intent: "invoke" | "selection" = "invoke"): Promise<PublicModel> {
  getDatabaseContext()
  if (userId !== LOCAL_AUTHOR_ID) throw new ContentError("LOCAL_AUTHOR_REQUIRED", "无法使用其他用户的模型配置", 403)
  try { return await call<PublicModel>("model.resolve", { role, intent, ...(id !== undefined ? { id } : {}) }) }
  catch (error) {
    const code = error instanceof Error ? error.message : "MODEL_UNAVAILABLE"
    if (["MODEL_NOT_CONFIGURED", "MODEL_NOT_SELECTED", "MODEL_NOT_FOUND", "MODEL_DISABLED", "MODEL_KEY_MISSING", "MODEL_UNAVAILABLE", "MODEL_KIND_MISMATCH", "AUTHORIZATION_REVOKED"].includes(code)) throw new ContentError(code, code === "MODEL_NOT_CONFIGURED" ? "尚未配置模型，请前往设置添加模型" : code === "MODEL_NOT_SELECTED" ? "请先选择用于此任务的模型" : code === "MODEL_KEY_MISSING" ? "所选模型的密钥不可用，请在设置中重新配置" : code === "MODEL_KIND_MISMATCH" ? "所选模型类别与此任务不符，请重新选择" : "所选模型不可用，请在设置中检查", 428)
    throw error
  }
}
export function localModelRecord(model: PublicModel): AIModel {
  // This is the original prompt guard's budget, not an advertised provider capacity.
  // The immutable public snapshot retains 0 when capacity is unknown.
  const record: AIModel = { id: model.id, name: model.name, provider: model.provider, modelId: model.modelId, apiKeyEncrypted: "", baseUrl: model.endpoint, tier: "NORMAL", kind: model.kind, inputCostPer1k: model.inputCostPer1k ?? 0, outputCostPer1k: model.outputCostPer1k ?? 0, contextWindow: model.contextWindow || 16_000, free: false, enabled: false, createdAt: new Date(0), updatedAt: new Date(0) }
  snapshots.set(record, structuredClone(model))
  return record
}
export function snapshotForRecord(record: AIModel) {
  const snapshot = snapshots.get(record)
  if (!snapshot) throw new Error("模型缺少本次调用的授权快照")
  return structuredClone(snapshot)
}
export function bindModelFetch(model: PublicModel, fetcher: typeof fetch): typeof fetch {
  const snapshot = structuredClone(model)
  return (input, init) => authorization.run(snapshot, () => fetcher(input, init))
}
/** The worker's global fetch is this fail-closed entry. SDK adapters establish the scope. */
export const localModelFetch: typeof fetch = async (input, init) => {
  const model = authorization.getStore()
  if (!model) throw new Error("模型请求必须通过已授权的主进程出口")
  const request = new Request(input, init)
  request.signal.throwIfAborted()
  const id = randomUUID(); const failed = Promise.withResolvers<never>(); void failed.promise.catch(() => undefined)
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const cleanup = () => request.signal.removeEventListener("abort", abort)
  const abort = () => { const error = request.signal.reason ?? new DOMException("任务已取消", "AbortError"); failed.reject(error); controller?.error(error); cleanup(); void call("model.cancel", id).catch(() => undefined) }
  request.signal.addEventListener("abort", abort, { once: true })
  const wait = <T,>(promise: Promise<T>) => Promise.race([promise, failed.promise])
  try {
    const body = request.body ? await wait(request.text()) : undefined
    request.signal.throwIfAborted()
    const headers = await wait(call<{ status: number; headers: Record<string,string> }>("model.start", { id, modelId: model.id, authRevision: model.authRevision, kind: model.kind, url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body }))
    request.signal.throwIfAborted()
    const stream = new ReadableStream<Uint8Array>({
      start(value) { controller = value },
      async pull(target) {
        try {
          const frame = await wait(call<{ done: boolean; bytes?: Uint8Array }>("model.read", id))
          request.signal.throwIfAborted()
          if (frame.done) { cleanup(); target.close() } else target.enqueue(frame.bytes!)
        } catch (error) { cleanup(); target.error(error); void call("model.cancel", id).catch(() => undefined) }
      },
      async cancel() { cleanup(); await call("model.cancel", id) },
    })
    if (headers.status === 204 || headers.status === 304) { await stream.cancel(); return new Response(null, headers) }
    return new Response(stream, headers)
  } catch (error) { cleanup(); void call("model.cancel", id).catch(() => undefined); throw error }
}

/** Semantic IMAGE transport: the worker receives verified bytes, never a provider URL. */
export async function generateLocalImage(model: PublicModel, prompt: string, options: { sizes?: readonly string[]; watermark?: boolean; signal?: AbortSignal } = {}): Promise<Buffer> {
  if (model.kind !== 'IMAGE') throw new Error('MODEL_KIND_MISMATCH')
  const signal = options.signal ?? AbortSignal.timeout(180_000)
  signal.throwIfAborted()
  const id = randomUUID(), failed = Promise.withResolvers<never>()
  void failed.promise.catch(() => undefined)
  const abort = () => {
    failed.reject(signal.reason ?? new DOMException('任务已取消', 'AbortError'))
    void call('model.cancel', id).catch(() => undefined)
  }
  signal.addEventListener('abort', abort, { once: true })
  const wait = <T,>(promise: Promise<T>) => Promise.race([promise, failed.promise])
  try {
    const header = await wait(call<{ id: string; status: number; headers: Record<string, string> }>('model.image.start', {
      id, modelId: model.id, authRevision: model.authRevision, prompt, ...(options.sizes ? { sizes: [...options.sizes] } : {}), ...(options.watermark !== undefined ? { watermark: options.watermark } : {})
    }))
    signal.throwIfAborted()
    if (header.id !== id || header.status !== 200 || !['image/png', 'image/jpeg', 'image/webp'].includes(header.headers['content-type'])) throw new Error('IMAGE_RESPONSE_INVALID')
    const chunks: Uint8Array[] = []; let length = 0
    for (;;) {
      const frame = await wait(call<{ done: boolean; bytes?: Uint8Array }>('model.read', id))
      signal.throwIfAborted()
      if (frame.done) break
      if (!(frame.bytes instanceof Uint8Array) || !frame.bytes.length || frame.bytes.length > 65536) throw new Error('IMAGE_RESPONSE_INVALID')
      length += frame.bytes.length
      if (length > 10 * 1024 * 1024) throw new Error('IMAGE_RESPONSE_TOO_LARGE')
      chunks.push(frame.bytes)
    }
    if (!length || header.headers['content-length'] !== String(length)) throw new Error('IMAGE_RESPONSE_INVALID')
    signal.throwIfAborted()
    return Buffer.concat(chunks, length)
  } finally {
    signal.removeEventListener('abort', abort)
    void call('model.cancel', id).catch(() => undefined)
  }
}
