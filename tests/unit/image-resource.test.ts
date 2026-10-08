import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { ModelGateway } from '../../desktop/core/model-authorization'

const key = 'test-secret-main-only-8361'
function fixture(endpoint = 'https://api.fixture.invalid/v1', fetchResource: typeof fetch = async () => new Response(new Uint8Array([1, 2, 3]))) {
  const gateway = new ModelGateway({ keyFor: async () => key, fetch: async () => Response.json({ data: [{ url: 'https://cdn.fixture.invalid/image?signature=allowed' }] }),
    imageResource: { fetch: fetchResource, lookup: async () => [{ address: '8.8.8.8', family: 4 }] } })
  const record = { id: randomUUID(), authRevision: 1, endpoint, kind: 'IMAGE' as const, enabled: true }
  gateway.replace(record)
  const lease = gateway.begin(record.id, 'IMAGE')
  const receipt = () => gateway.fetch(lease, endpoint + '/images/generations', { method: 'POST' })
  return { gateway, lease, record, receipt }
}

test('IMG14-R01: only the original IMAGE receipt can grant a one-use resource download; no Key or Cookie reaches the CDN', async () => {
  let call: { url: string; init?: RequestInit } | undefined
  const f = fixture(undefined, async (url, init) => { call = { url: String(url), init }; return new Response(new Uint8Array([7, 9])) })
  try {
    await assert.rejects(f.gateway.authorizeImageResource(f.lease, Response.json({}), 'https://cdn.fixture.invalid/image'), /IMAGE_RECEIPT_INVALID/)
    const receipt = await f.receipt()
    const grant = await f.gateway.authorizeImageResource(f.lease, receipt, 'https://cdn.fixture.invalid/image?signature=allowed')
    assert.deepEqual(await f.gateway.readImageResource(f.lease, grant), new Uint8Array([7, 9]))
    assert.equal(call?.url, 'https://cdn.fixture.invalid/image?signature=allowed')
    assert.equal(new Headers(call?.init?.headers).get('authorization'), null)
    assert.equal(new Headers(call?.init?.headers).get('cookie'), null)
    assert.equal(call?.init?.redirect, 'manual'); assert.equal(call?.init?.method, 'GET')
    await assert.rejects(f.gateway.readImageResource(f.lease, grant), /IMAGE_RESOURCE_GRANT_INVALID/)
  } finally { f.gateway.finish(f.lease) }
})

test('IMG14-R02: a receipt URL containing the actual Key, credentials or private address is rejected before resource HTTP', async () => {
  let calls = 0
  const f = fixture(undefined, async () => { calls++; return new Response('unexpected') })
  try {
    const receipt = await f.receipt()
    for (const url of ['https://cdn.fixture.invalid/image?echo=' + key, 'https://user:password@cdn.fixture.invalid/image', 'http://cdn.fixture.invalid/image', 'https://127.0.0.1/image']) {
      await assert.rejects(async () => { const grant = await f.gateway.authorizeImageResource(f.lease, receipt, url); await f.gateway.readImageResource(f.lease, grant) }, /IMAGE_RESOURCE_REJECTED/)
    }
    assert.equal(calls, 0)
  } finally { f.gateway.finish(f.lease) }
})

test('IMG14-R03: custom self-hosted resources are allowed only on their exactly authorized origin', async () => {
  let calls = 0
  const f = fixture('http://127.0.0.1:18123/v1', async () => { calls++; return new Response(new Uint8Array([3])) })
  try {
    const receipt = await f.receipt()
    const grant = await f.gateway.authorizeImageResource(f.lease, receipt, 'http://127.0.0.1:18123/out/1', { allowSelfHosted: true })
    assert.deepEqual(await f.gateway.readImageResource(f.lease, grant), new Uint8Array([3]))
    await assert.rejects(async () => { const other = await f.gateway.authorizeImageResource(f.lease, receipt, 'http://127.0.0.1:18124/out/1', { allowSelfHosted: true }); await f.gateway.readImageResource(f.lease, other) }, /IMAGE_RESOURCE_REJECTED/)
    assert.equal(calls, 1)
  } finally { f.gateway.finish(f.lease) }
})

test('IMG14-R04: resources reject redirects and enforce a ten-MiB bound instead of returning partial content', async () => {
  let response = new Response(null, { status: 302, headers: { location: 'https://other.invalid/image' } })
  const f = fixture(undefined, async () => response)
  try {
    const receipt = await f.receipt()
    let grant = await f.gateway.authorizeImageResource(f.lease, receipt, 'https://cdn.fixture.invalid/image')
    await assert.rejects(f.gateway.readImageResource(f.lease, grant), /IMAGE_RESOURCE_REDIRECT_REJECTED/)
    response = new Response(new Uint8Array(10 * 1024 * 1024 + 1))
    grant = await f.gateway.authorizeImageResource(f.lease, receipt, 'https://cdn.fixture.invalid/image')
    await assert.rejects(f.gateway.readImageResource(f.lease, grant), /IMAGE_RESOURCE_TOO_LARGE/)
  } finally { f.gateway.finish(f.lease) }
})

test('IMG14-R05: revoked authorization rejects a pending resource body and discards its late bytes', async () => {
  let release!: (value: Response) => void
  const f = fixture(undefined, () => new Promise(resolve => { release = resolve }))
  const receipt = await f.receipt()
  const grant = await f.gateway.authorizeImageResource(f.lease, receipt, 'https://cdn.fixture.invalid/image')
  const pending = f.gateway.readImageResource(f.lease, grant)
  await new Promise(resolve => setTimeout(resolve, 10))
  f.gateway.replace({ ...f.record, authRevision: 2 })
  await assert.rejects(pending, /AUTHORIZATION_REVOKED/)
  release(new Response(new Uint8Array([9])))
  await new Promise(resolve => setTimeout(resolve, 10))
})

test('IMG14-R06: DNS mixed public/private answers reject the resource without HTTP or a second DNS lookup', async () => {
  let calls = 0, lookups = 0
  const gateway = new ModelGateway({ keyFor: async () => key, fetch: async () => Response.json({}), imageResource: {
    fetch: async () => { calls++; return new Response('unexpected') }, lookup: async () => { lookups++; return [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] }
  } })
  const row = { id: randomUUID(), authRevision: 1, endpoint: 'https://api.fixture.invalid/v1', kind: 'IMAGE' as const, enabled: true }
  gateway.replace(row); const lease = gateway.begin(row.id, 'IMAGE')
  try {
    const receipt = await gateway.fetch(lease, row.endpoint + '/images/generations')
    const grant = await gateway.authorizeImageResource(lease, receipt, 'https://cdn.fixture.invalid/image')
    await assert.rejects(gateway.readImageResource(lease, grant), /IMAGE_RESOURCE_REJECTED/)
    assert.equal(calls, 0); assert.equal(lookups, 1)
  } finally { gateway.finish(lease) }
})

test('IMG14-R07: an explicit pre-aborted download cannot perform DNS or HTTP', async () => {
  let lookups = 0, sends = 0
  const gateway = new ModelGateway({ keyFor: async () => key, fetch: async () => Response.json({}), imageResource: { lookup: async () => { lookups++; return [{ address: '8.8.8.8', family: 4 }] }, fetch: async () => { sends++; return new Response('unexpected') } } })
  const row = { id: randomUUID(), authRevision: 1, endpoint: 'https://api.fixture.invalid/v1', kind: 'IMAGE' as const, enabled: true }
  gateway.replace(row); const lease = gateway.begin(row.id, 'IMAGE')
  try {
    const receipt = await gateway.fetch(lease, row.endpoint + '/images/generations'), grant = await gateway.authorizeImageResource(lease, receipt, 'https://cdn.fixture.invalid/image')
    const canceled = new AbortController(); canceled.abort(new Error('ISOLATED_CANCEL'))
    await assert.rejects(gateway.readImageResource(lease, grant, canceled.signal), /ISOLATED_CANCEL/)
    assert.equal(lookups, 0); assert.equal(sends, 0)
  } finally { gateway.finish(lease) }
})

test('IMG14-R08: mapped IPv6/private/reserved answers cannot bypass the public resource policy', async () => {
  let address = '::ffff:127.0.0.1', sends = 0
  const gateway = new ModelGateway({ keyFor: async () => key, fetch: async () => Response.json({}), imageResource: { lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }], fetch: async () => { sends++; return new Response('unexpected') } } })
  const row = { id: randomUUID(), authRevision: 1, endpoint: 'https://api.fixture.invalid/v1', kind: 'IMAGE' as const, enabled: true }
  gateway.replace(row); const lease = gateway.begin(row.id, 'IMAGE')
  try {
    const receipt = await gateway.fetch(lease, row.endpoint + '/images/generations')
    for (address of ['::ffff:127.0.0.1', '::ffff:c0a8:101', 'fd00::1', 'fe80::1', '2001:db8::1', '169.254.169.254', '100.64.0.1', '192.0.2.1']) {
      const grant = await gateway.authorizeImageResource(lease, receipt, 'https://cdn.fixture.invalid/image')
      await assert.rejects(gateway.readImageResource(lease, grant), /IMAGE_RESOURCE_REJECTED/)
    }
    assert.equal(sends, 0)
  } finally { gateway.finish(lease) }
})

test('IMG14-R09: the real undici resource transport reaches only a configured loopback origin with no credential headers', async () => {
  const { createServer } = await import('node:http')
  let sends = 0
  const server = createServer((request, response) => {
    sends++; assert.equal(request.url, '/image/owned.png'); assert.equal(request.headers.authorization, undefined); assert.equal(request.headers.cookie, undefined)
    response.end(Buffer.from([5, 8, 13]))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as import('node:net').AddressInfo).port, endpoint = `http://127.0.0.1:${port}/v1`
  const gateway = new ModelGateway({ keyFor: async () => key, fetch: async () => Response.json({}) })
  const row = { id: randomUUID(), authRevision: 1, endpoint, kind: 'IMAGE' as const, enabled: true }; gateway.replace(row); const lease = gateway.begin(row.id, 'IMAGE')
  try {
    const receipt = await gateway.fetch(lease, endpoint + '/images/generations'), grant = await gateway.authorizeImageResource(lease, receipt, `http://127.0.0.1:${port}/image/owned.png`, { allowSelfHosted: true })
    assert.deepEqual(await gateway.readImageResource(lease, grant), new Uint8Array([5, 8, 13])); assert.equal(sends, 1)
  } finally { gateway.finish(lease); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('IMG14-R10: a resource header promise ignoring abort is bounded at thirty seconds, and its late response is discarded', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pendingHeaders = Promise.withResolvers<Response>(), entered = Promise.withResolvers<void>(), external = new AbortController()
  const f = fixture(undefined, async () => { entered.resolve(); return pendingHeaders.promise })
  let lateCanceled = false
  try {
    const receipt = await f.receipt(), grant = await f.gateway.authorizeImageResource(f.lease, receipt, 'https://cdn.fixture.invalid/image')
    const work = f.gateway.readImageResource(f.lease, grant, external.signal).then(() => 'accepted', (cause: Error) => cause.message)
    await entered.promise; t.mock.timers.tick(30_000)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(await Promise.race([work, Promise.resolve('still pending')]), 'IMAGE_RESOURCE_TIMEOUT')
    pendingHeaders.resolve(new Response(new ReadableStream({ cancel() { lateCanceled = true } })))
    await new Promise(resolve => setImmediate(resolve)); assert.equal(lateCanceled, true)
  } finally { external.abort(new Error('ISOLATED_CLEANUP')); pendingHeaders.resolve(new Response('cleanup')); f.gateway.finish(f.lease); t.mock.timers.reset() }
})

test('IMG14-R11: authorization is rechecked after DNS and before the actual resource send', async () => {
  const dns = Promise.withResolvers<readonly import('node:dns').LookupAddress[]>(), entered = Promise.withResolvers<void>()
  let sends = 0
  const gateway = new ModelGateway({ keyFor: async () => key, fetch: async () => Response.json({}), imageResource: { lookup: async () => { entered.resolve(); return dns.promise }, fetch: async () => { sends++; return new Response('unexpected') } } })
  const row = { id: randomUUID(), authRevision: 1, endpoint: 'https://api.fixture.invalid/v1', kind: 'IMAGE' as const, enabled: true }; gateway.replace(row); const lease = gateway.begin(row.id, 'IMAGE')
  try {
    const receipt = await gateway.fetch(lease, row.endpoint + '/images/generations'), grant = await gateway.authorizeImageResource(lease, receipt, 'https://cdn.fixture.invalid/image')
    const work = gateway.readImageResource(lease, grant); await entered.promise; gateway.replace({ ...row, authRevision: 2 })
    await assert.rejects(work, /AUTHORIZATION_REVOKED/); dns.resolve([{ address: '8.8.8.8', family: 4 }]); await new Promise(resolve => setImmediate(resolve)); assert.equal(sends, 0)
  } finally { dns.resolve([]); gateway.finish(lease) }
})

test('IMG14-R12: a nested percent-encoded model Key in a receipt URL cannot be sent to the image host', async () => {
  let calls = 0
  const f = fixture(undefined, async () => { calls++; return new Response(new Uint8Array([1])) })
  try {
    const receipt = await f.receipt()
    const encoded = [...key].map(character => '%' + character.charCodeAt(0).toString(16)).join('')
    await assert.rejects(async () => {
      const grant = await f.gateway.authorizeImageResource(f.lease, receipt, 'https://cdn.fixture.invalid/image?echo=' + encodeURIComponent(encoded))
      await f.gateway.readImageResource(f.lease, grant)
    }, /IMAGE_RESOURCE_REJECTED/)
    assert.equal(calls, 0)
  } finally { f.gateway.finish(f.lease) }
})
