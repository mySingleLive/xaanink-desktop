import { lookup as systemLookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import { Agent } from 'undici'
import { ModelAuthorizationError } from './model-authorization'

export interface ImageResourceOptions {
  /** Controlled test transport only; production uses a DNS-pinned undici dispatcher. */
  fetch?: typeof fetch
  lookup?: (hostname: string) => Promise<readonly LookupAddress[]>
}
const fail = (code: string): never => { throw new ModelAuthorizationError(code) }
const privateV4 = new BlockList()
for (const [address, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) privateV4.addSubnet(address, bits, 'ipv4')
const publicV6 = new BlockList(); publicV6.addSubnet('2000::', 3, 'ipv6')
const privateV6 = new BlockList()
for (const [address, bits] of [['2001::', 32], ['2001:db8::', 32], ['2002::', 16]] as const) privateV6.addSubnet(address, bits, 'ipv6')
function publicAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return !privateV4.check(address, 'ipv4')
  if (version !== 6) return false
  const mapped = /^::ffff:(.*)$/i.exec(address)
  if (mapped) {
    if (isIP(mapped[1]) === 4) return publicAddress(mapped[1])
    const halves = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(mapped[1])
    if (!halves) return false
    const a = parseInt(halves[1], 16), b = parseInt(halves[2], 16)
    return publicAddress(`${a >>> 8}.${a & 255}.${b >>> 8}.${b & 255}`)
  }
  return publicV6.check(address, 'ipv6') && !privateV6.check(address, 'ipv6')
}
function abortable<T>(work: Promise<T>, signal: AbortSignal, late?: (value: T) => void): Promise<T> {
  if (signal.aborted) { void work.then(value => late?.(value), () => undefined); return Promise.reject(signal.reason) }
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    work.then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) { late?.(value); reject(signal.reason) } else resolve(value) }, cause => { signal.removeEventListener('abort', abort); reject(cause) })
  })
}

/** Main-only transport. The caller must hold a gateway-issued one-use IMAGE grant. */
type ResourceInput = { signal: AbortSignal; check: () => void; selfHostedOrigin?: string; options?: ImageResourceOptions }
export async function fetchImageResource(url: URL, input: ResourceInput): Promise<Uint8Array> {
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(new ModelAuthorizationError('IMAGE_RESOURCE_TIMEOUT')), 30_000)
  timer.unref()
  try { return await fetchResourceInDeadline(url, { ...input, signal: AbortSignal.any([input.signal, timeout.signal]) }) }
  finally { clearTimeout(timer) }
}
async function fetchResourceInDeadline(url: URL, input: ResourceInput): Promise<Uint8Array> {
  const { signal, check } = input
  const selfHosted = input.selfHostedOrigin === url.origin
  if (url.username || url.password || url.hash || url.href.length > 8192 || (url.protocol !== 'https:' && !selfHosted)) return fail('IMAGE_RESOURCE_REJECTED')
  if (selfHosted && !['http:', 'https:'].includes(url.protocol)) return fail('IMAGE_RESOURCE_REJECTED')
  check(); signal.throwIfAborted()
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await abortable((input.options?.lookup ?? (name => systemLookup(name, { all: true })))(hostname), signal)
  check(); signal.throwIfAborted()
  if (!addresses.length || addresses.length > 32 || addresses.some(entry => !isIP(entry.address) || entry.family !== isIP(entry.address) || (!selfHosted && !publicAddress(entry.address)))) return fail('IMAGE_RESOURCE_REJECTED')
  const agent = input.options?.fetch ? undefined : new Agent({ connect: { lookup: (_hostname, options, callback) => {
    try { check(); signal.throwIfAborted() } catch { callback(new Error("IMAGE_RESOURCE_REJECTED"), "", 4); return }
    // Resolve exactly once. The TLS servername and HTTP Host remain the original host.
    const chosen = addresses.find(entry => !options.family || options.family === entry.family)
    if (!chosen) { callback(new Error('IMAGE_RESOURCE_REJECTED'), '', 4); return }
    if (options.all) callback(null, addresses.map(entry => ({ ...entry })))
    else callback(null, chosen.address, chosen.family)
  } } })
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    check(); signal.throwIfAborted()
    const init: RequestInit & { dispatcher?: Agent } = { method: 'GET', redirect: 'manual', credentials: 'omit', headers: new Headers(), signal, ...(agent ? { dispatcher: agent } : {}) }
    const response = await abortable((input.options?.fetch ?? fetch)(url.href, init), signal, response => { void response.body?.cancel().catch(() => undefined) })
    check(); signal.throwIfAborted()
    if (response.status >= 300 && response.status < 400) { void response.body?.cancel().catch(() => undefined); return fail('IMAGE_RESOURCE_REDIRECT_REJECTED') }
    if (!response.ok || !response.body) { void response.body?.cancel().catch(() => undefined); return fail('IMAGE_RESOURCE_FAILED') }
    const declared = response.headers.get('content-length')
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > 10 * 1024 * 1024)) { void response.body.cancel().catch(() => undefined); return fail('IMAGE_RESOURCE_TOO_LARGE') }
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []; let count = 0
    for (;;) {
      check(); signal.throwIfAborted()
      const chunk = await abortable(reader.read(), signal)
      check(); signal.throwIfAborted()
      if (chunk.done) break
      count += chunk.value.byteLength
      if (count > 10 * 1024 * 1024) return fail('IMAGE_RESOURCE_TOO_LARGE')
      chunks.push(chunk.value)
    }
    if (!count) return fail('IMAGE_RESOURCE_FAILED')
    return Uint8Array.from(Buffer.concat(chunks, count))
  } catch (cause) {
    check(); signal.throwIfAborted()
    if (cause instanceof ModelAuthorizationError) throw cause
    return fail('IMAGE_RESOURCE_FAILED')
  } finally {
    if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock() }
    if (agent) void agent.destroy().catch(() => undefined)
  }
}
