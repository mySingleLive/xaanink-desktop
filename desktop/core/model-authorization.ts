import { fetchImageResource, type ImageResourceOptions } from "./image-resource"

export type ModelKind = "TEXT" | "IMAGE"
export interface AuthorizedModel { id: string; authRevision: number; endpoint: string; kind: ModelKind; enabled: boolean; protocol?: "openai" | "anthropic" | "google" }
export interface ModelLease { modelId: string; authRevision: number; requestId: string; kind: ModelKind; signal: AbortSignal }
export class ModelAuthorizationError extends Error { constructor(readonly code: string) { super(code); this.name = "ModelAuthorizationError" } }
export interface ModelGatewayOptions { keyFor: (id: string, revision: number) => Promise<string>; fetch: typeof fetch; imageResource?: ImageResourceOptions }

export interface ImageResourceGrant { readonly kind: "authorized-image-resource" }

export function validateModelEndpoint(value: string) {
  let url: URL
  try { url = new URL(value) } catch { throw new ModelAuthorizationError("ENDPOINT_NOT_AUTHORIZED") }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.hash) {
    throw new ModelAuthorizationError("ENDPOINT_NOT_AUTHORIZED")
  }
  const credentialParameters = new Set(["key", "apikey", "token", "accesstoken", "authtoken", "secret", "clientsecret", "password", "credential", "credentials", "authorization", "signature", "auth", "xamzcredential", "xamzsignature", "xamzsecuritytoken"])
  for (const name of url.searchParams.keys()) {
    if (credentialParameters.has(name.toLowerCase().replace(/[-_]/g, ""))) throw new ModelAuthorizationError("ENDPOINT_NOT_AUTHORIZED")
  }
  return url
}
function requestUrl(value: string, base: string) {
  const url = validateModelEndpoint(value); const allowed = validateModelEndpoint(base)
  const prefix = allowed.pathname.replace(/\/+$/, "")
  if (url.origin !== allowed.origin || (url.pathname !== prefix && !url.pathname.startsWith(prefix + "/")) ||
    /%(?:2f|5c|00)/i.test(url.pathname) || url.pathname.includes("\\")) throw new ModelAuthorizationError("ENDPOINT_NOT_AUTHORIZED")
  return url
}

/** Own this gateway at the final HTTP boundary, alongside the main-process vault.
 * Publish changes only after the model repository's durable commit succeeds.
 */
export class ModelGateway {
  private records = new Map<string, AuthorizedModel>()
  private revisions = new Map<string, number>()
  private active = new Map<string, { lease: ModelLease; controller: AbortController }>()
  private imageReceipts = new WeakMap<Response, ModelLease>()
  private imageGrants = new WeakMap<ImageResourceGrant, { lease: ModelLease; url: URL; endpoint: string; expires: number; selfHosted: boolean }>()
  constructor(private readonly options: ModelGatewayOptions) {}
  replace(model: AuthorizedModel) {
    validateModelEndpoint(model.endpoint)
    const prior = this.records.get(model.id); const previousRevision = this.revisions.get(model.id) ?? 0
    if (!model.id || !Number.isSafeInteger(model.authRevision) || model.authRevision < 1 || model.authRevision < previousRevision ||
      (model.authRevision === previousRevision && JSON.stringify(prior) !== JSON.stringify(model))) throw new ModelAuthorizationError("INVALID_AUTHORIZATION_REVISION")
    this.records.set(model.id, structuredClone(model))
    this.revisions.set(model.id, model.authRevision)
    if (!prior || prior.authRevision !== model.authRevision) this.revoke(model.id)
  }
  remove(id: string) { this.records.delete(id); this.revoke(id) }
  private revoke(id: string) {
    // The record/revision is already invalid before cancellation can run callbacks.
    for (const entry of this.active.values()) if (entry.lease.modelId === id) {
      entry.controller.abort(new ModelAuthorizationError("AUTHORIZATION_REVOKED"))
      this.active.delete(entry.lease.requestId)
    }
  }
  begin(modelId: string, kind: ModelKind): ModelLease {
    if (!modelId) throw new ModelAuthorizationError([...this.records.values()].some(model => model.kind === kind) ? "MODEL_NOT_SELECTED" : "MODEL_NOT_CONFIGURED")
    const row = this.records.get(modelId)
    if (!row || !row.enabled) throw new ModelAuthorizationError("MODEL_UNAVAILABLE")
    if (row.kind !== kind) throw new ModelAuthorizationError("MODEL_KIND_MISMATCH")
    const controller = new AbortController()
    const lease = Object.freeze({ modelId, authRevision: row.authRevision, kind, requestId: crypto.randomUUID(), signal: controller.signal })
    this.active.set(lease.requestId, { lease, controller })
    return lease
  }
  private current(lease: ModelLease) {
    const entry = this.active.get(lease.requestId); const row = this.records.get(lease.modelId)
    if (entry?.lease !== lease || lease.signal.aborted || !row?.enabled || row.authRevision !== lease.authRevision || row.kind !== lease.kind) {
      throw new ModelAuthorizationError("AUTHORIZATION_REVOKED")
    }
    return row
  }
  finish(lease: ModelLease) {
    const entry = this.active.get(lease.requestId)
    if (entry?.lease !== lease) return
    this.active.delete(lease.requestId)
    entry.controller.abort(new ModelAuthorizationError("AUTHORIZATION_REVOKED"))
  }
  async authorizeImageResource(lease: ModelLease, receipt: Response, value: string, options: { allowSelfHosted?: boolean } = {}): Promise<ImageResourceGrant> {
    const model = this.current(lease)
    if (lease.kind !== "IMAGE" || this.imageReceipts.get(receipt) !== lease || !receipt.ok) throw new ModelAuthorizationError("IMAGE_RECEIPT_INVALID")
    let url: URL
    try { url = new URL(value) } catch { throw new ModelAuthorizationError("IMAGE_RESOURCE_REJECTED") }
    if (url.username || url.password || url.hash || url.href.length > 8192) throw new ModelAuthorizationError("IMAGE_RESOURCE_REJECTED")
    const key = await this.options.keyFor(lease.modelId, lease.authRevision)
    this.current(lease)
    if (!key) throw new ModelAuthorizationError("IMAGE_RESOURCE_REJECTED")
    // Signed resource URLs are valid; leaking this model's actual credential is not.
    // Inspect nested percent encoding without changing the authorized request URL.
    let decoded = url.href
    for (let depth = 0; depth < 4; depth++) {
      if (decoded.includes(key)) throw new ModelAuthorizationError("IMAGE_RESOURCE_REJECTED")
      let next: string
      try { next = decodeURIComponent(decoded) } catch { throw new ModelAuthorizationError("IMAGE_RESOURCE_REJECTED") }
      if (next === decoded) break
      decoded = next
      if (depth === 3 && /%[a-f0-9]{2}/i.test(decoded)) throw new ModelAuthorizationError("IMAGE_RESOURCE_REJECTED")
    }
    if (decoded.includes(key)) throw new ModelAuthorizationError("IMAGE_RESOURCE_REJECTED")
    const selfHosted = options.allowSelfHosted === true && url.origin === new URL(model.endpoint).origin
    if (url.protocol !== "https:" && !(selfHosted && url.protocol === "http:")) throw new ModelAuthorizationError("IMAGE_RESOURCE_REJECTED")
    const grant = Object.freeze({ kind: "authorized-image-resource" as const })
    this.imageGrants.set(grant, { lease, url, endpoint: model.endpoint, expires: Date.now() + 30_000, selfHosted })
    return grant
  }
  async readImageResource(lease: ModelLease, grant: ImageResourceGrant, externalSignal?: AbortSignal): Promise<Uint8Array> {
    const model = this.current(lease), value = this.imageGrants.get(grant)
    if (!value || value.lease !== lease || value.endpoint !== model.endpoint || value.expires < Date.now()) throw new ModelAuthorizationError("IMAGE_RESOURCE_GRANT_INVALID")
    this.imageGrants.delete(grant)
    const signal = externalSignal ? AbortSignal.any([lease.signal, externalSignal]) : lease.signal
    return fetchImageResource(value.url, { signal, check: () => { this.current(lease) }, selfHostedOrigin: value.selfHosted ? new URL(model.endpoint).origin : undefined, options: this.options.imageResource })
  }
  private certifyImageResponse(lease: ModelLease, response: Response): Response {
    if (lease.kind === "IMAGE") this.imageReceipts.set(response, lease)
    return response
  }
  async fetch(lease: ModelLease, input: string, init: RequestInit = {}): Promise<Response> {
    const model = this.current(lease)
    let url = requestUrl(input, model.endpoint)
    const key = await this.options.keyFor(lease.modelId, lease.authRevision)
    this.current(lease)
    if (!key) throw new ModelAuthorizationError("MODEL_KEY_MISSING")
    const headers = new Headers(init.headers)
    for (const name of ["authorization", "x-api-key", "x-goog-api-key", "cookie", "host", "proxy-authorization"]) headers.delete(name)
    if (model.protocol === "anthropic") {
      headers.set("x-api-key", key)
      if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01")
    } else if (model.protocol === "google") headers.set("x-goog-api-key", key)
    else headers.set("Authorization", `Bearer ${key}`)
    const signal = init.signal ? AbortSignal.any([lease.signal, init.signal]) : lease.signal
    for (let redirect = 0; redirect <= 3; redirect++) {
      // No await between this check and the final fetch invocation.
      this.current(lease); signal.throwIfAborted()
      let response: Response
      try { response = await this.options.fetch(url.href, { ...init, headers, signal, redirect: "manual", credentials: "omit" }) }
      catch { this.current(lease); signal.throwIfAborted(); throw new ModelAuthorizationError("MODEL_NETWORK_ERROR") }
      try { this.current(lease); signal.throwIfAborted() }
      catch (error) { await response.body?.cancel().catch(() => undefined); throw error }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        const location = response.headers.get("location")
        if (!location || redirect === 3) throw new ModelAuthorizationError("MODEL_REDIRECT_REJECTED")
        url = requestUrl(new URL(location, url).href, model.endpoint)
        // Do not replay a consumed stream or transform a generation POST into GET.
        if (init.body instanceof ReadableStream || ![307, 308].includes(response.status)) throw new ModelAuthorizationError("MODEL_REDIRECT_REJECTED")
        continue
      }
      if (!response.body) return this.certifyImageResponse(lease, response)
      const reader = response.body.getReader()
      let terminated = false
      let readerReleased = false
      const releaseReader = () => { if (!readerReleased) { readerReleased = true; reader.releaseLock() } }
      const cancelReader = async (reason?: unknown) => {
        try { await reader.cancel(reason) } finally { releaseReader() }
      }
      let onAbort: () => void
      const cleanup = () => signal.removeEventListener("abort", onAbort)
      const guarded = new ReadableStream<Uint8Array>({
        start: controller => {
          onAbort = () => {
            if (terminated) return
            terminated = true
            // error() also discards already queued chunks; checking only pull()
            // would permit stale buffered text to reach the renderer.
            controller.error(signal.reason ?? new ModelAuthorizationError("AUTHORIZATION_REVOKED"))
            cleanup()
            void cancelReader(signal.reason).catch(() => undefined)
          }
          signal.addEventListener("abort", onAbort, { once: true })
          if (signal.aborted) onAbort()
        },
        pull: async controller => {
          try {
            if (terminated) return
            this.current(lease); signal.throwIfAborted()
            const chunk = await reader.read()
            this.current(lease); signal.throwIfAborted()
            if (terminated) return
            if (chunk.done) { terminated = true; cleanup(); releaseReader(); controller.close() }
            else controller.enqueue(chunk.value)
          } catch (error) {
            if (!terminated) { terminated = true; controller.error(error) }
            cleanup(); await cancelReader().catch(() => undefined)
          }
        },
        cancel: reason => { terminated = true; cleanup(); return cancelReader(reason) },
      })
      return this.certifyImageResponse(lease, new Response(guarded, { status: response.status, statusText: response.statusText, headers: response.headers }))
    }
    throw new ModelAuthorizationError("MODEL_REDIRECT_REJECTED")
  }
}
