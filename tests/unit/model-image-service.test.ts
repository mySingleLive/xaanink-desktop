import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { ModelRepository, type ModelDraft } from '../../desktop/main/model-repository'
import { ModelGateway } from '../../desktop/core/model-authorization'
import { ModelService } from '../../desktop/main/model-service'
const draft: ModelDraft = { name: 'Image model', provider: 'custom', protocol: 'openai', modelId: 'original-image', endpoint: 'https://fixture.invalid/v1', kind: 'IMAGE', contextWindow: 0, enabled: true, thinkingLevels: [], defaultThinking: 'default', apiKey: 'isolated-main-key' }
const protection = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
async function fixture(network: typeof fetch) {
  const root = await mkdtemp(join(tmpdir(), 'xuanxiang-semantic-image-'))
  let repository!: ModelRepository
  const gateway = new ModelGateway({ keyFor: (id, revision) => repository.keyFor(id, revision), fetch: network })
  repository = new ModelRepository(join(root, 'state.json'), protection, gateway)
  const service = new ModelService(repository, gateway), state = await repository.saveModel(0, draft), model = state.models[0]
  const input = { id: randomUUID(), modelId: model.id, authRevision: model.authRevision, prompt: 'The complete original creation prompt', sizes: ['1024x1024'] }
  return { root, repository, service, state, model, input, async close() { await service.close(); await rm(root, { recursive: true, force: true }) } }
}

test('IMG14-S01: semantic image start streams actual bytes in bounded IPC frames, without taking URLs, endpoints or Keys from worker', async () => {
  const png = await sharp(randomBytes(128 * 256 * 3), { raw: { width: 128, height: 256, channels: 3 } }).png().toBuffer()
  const bodies: unknown[] = []
  const f = await fixture(async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ data: [{ b64_json: png.toString('base64') }] }) })
  try {
    await assert.rejects(f.service.startImage({ ...f.input, endpoint: 'https://evil.invalid', apiKey: 'forged' }))
    assert.equal(bodies.length, 0)
    const header = await f.service.startImage(f.input)
    assert.equal(header.status, 200); assert.equal(header.headers['content-type'], 'image/png')
    const chunks: Uint8Array[] = []
    for (;;) { const next = await f.service.read(f.input.id); if (next.done) break; assert.ok(next.bytes!.length <= 65536); chunks.push(next.bytes!) }
    assert.deepEqual(Buffer.concat(chunks), png); assert.equal(f.service.activeCount, 0)
    assert.equal((bodies[0] as { prompt: string }).prompt, f.input.prompt)
  } finally { await f.close() }
})

test('IMG14-S02: cancelling image generation does not wait for an upstream ignoring abort or accept its late pixels', async () => {
  const entered = Promise.withResolvers<void>(), response = Promise.withResolvers<Response>()
  const f = await fixture(async () => { entered.resolve(); return response.promise })
  try {
    const pending = f.service.startImage(f.input); await entered.promise
    await f.service.cancel(f.input.id)
    await assert.rejects(pending, /AUTHORIZATION_REVOKED|IMAGE_CANCELLED/)
    assert.equal(f.service.activeCount, 0)
    await f.service.close(); assert.equal(f.service.activeCount, 0)
    response.resolve(Response.json({ data: [{ b64_json: 'late' }] }))
    await assert.rejects(f.service.read(f.input.id), /不可读取/)
  } finally { response.resolve(Response.json({})); await f.close() }
})

test('IMG14-S03: changing Key during generation rejects old response and removes the transfer', async () => {
  const entered = Promise.withResolvers<void>(), response = Promise.withResolvers<Response>()
  const f = await fixture(async () => { entered.resolve(); return response.promise })
  try {
    const pending = f.service.startImage(f.input); await entered.promise
    await f.repository.saveModel(f.state.revision, { ...draft, id: f.model.id, apiKey: 'replacement-key' })
    await assert.rejects(pending, /AUTHORIZATION_REVOKED/)
    assert.equal(f.service.activeCount, 0)
    response.resolve(Response.json({ data: [{ b64_json: 'late' }] }))
  } finally { response.resolve(Response.json({})); await f.close() }
})

test('IMG14-S04: the semantic start deadline includes asynchronous repository resolution, and releases its slot on timeout', async t => {
  const f = await fixture(async () => { throw new Error('must not send') })
  const originalRead = f.repository.read.bind(f.repository)
  const entered = Promise.withResolvers<void>()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    f.repository.read = async () => { entered.resolve(); return new Promise(() => {}) }
    const work = f.service.startImage(f.input).then(() => 'accepted', (error: Error) => error.message)
    await entered.promise; t.mock.timers.tick(180_000); await new Promise(resolve => setImmediate(resolve))
    assert.equal(await Promise.race([work, Promise.resolve('still pending')]), 'IMAGE_TIMEOUT')
    assert.equal(f.service.activeCount, 0)
  } finally { f.repository.read = originalRead; await f.service.cancel(f.input.id); t.mock.timers.reset(); await f.close() }
})
