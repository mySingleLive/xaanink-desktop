import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { ModelRepository, type ModelDraft } from '../../desktop/main/model-repository'
import { ModelGateway } from '../../desktop/core/model-authorization'
import { ModelService } from '../../desktop/main/model-service'
import { configureModelTransport } from '../../desktop/service/models'
import { DirectoryAuthority } from '../../desktop/main/directory-authority'
import { Workspaces } from '../../desktop/service/workspaces'
import { resolveImageModel, generateImageBuffer, saveCharacterImage } from '../../src/lib/ai/image'
import { getDatabaseContext } from '../../desktop/service/context'
const protection = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }

test('IMG14-I01: original image entry receives one full authorized image from main and stores it with original local asset service; worker HTTP stays blocked', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xuanxiang-image-business-'))
  const works = new Workspaces(join(root, 'data'), join(process.cwd(), 'prisma/migrations'))
  const png = await sharp({ create: { width: 12, height: 18, channels: 4, background: '#abc' } }).png().toBuffer()
  const draft: ModelDraft = { name: 'My image model', provider: 'custom', protocol: 'openai', modelId: 'private-image-model', endpoint: 'http://127.0.0.1:19133/v1', kind: 'IMAGE', contextWindow: 0, enabled: true, thinkingLevels: [], defaultThinking: 'default', apiKey: 'only-in-main' }
  let repository!: ModelRepository, network = 0
  const calls: string[] = []
  const gateway = new ModelGateway({ keyFor: (id, rev) => repository.keyFor(id, rev), fetch: async (url, init) => {
    network++; assert.equal(String(url), draft.endpoint + '/images/generations'); assert.equal(JSON.parse(String(init?.body)).prompt, 'Original complete character artwork prompt')
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer only-in-main')
    return Response.json({ data: [{ url: 'http://127.0.0.1:19133/assets/receipt-123.png' }] })
  }, imageResource: { fetch: async (_url, init) => { network++; assert.equal(new Headers(init?.headers).get('authorization'), null); return new Response(Uint8Array.from(png)) } } })
  repository = new ModelRepository(join(root, 'state.json'), protection, gateway); const service = new ModelService(repository, gateway)
  configureModelTransport(async (method, value) => {
    calls.push(method)
    if (method === 'model.defaults') return service.defaults() as never
    if (method === 'model.resolve') return service.resolve(value) as never
    if (method === 'model.image.start') return service.startImage(value) as never
    if (method === 'model.read') return service.read(value) as never
    if (method === 'model.cancel') return service.cancel(value) as never
    throw new Error('Unexpected main request: ' + method)
  })
  const originalFetch = globalThis.fetch
  try {
    await works.initialize()
    const workPath = join(root, 'work'); await mkdir(workPath)
    const authority = new DirectoryAuthority(), selection = await authority.issue(workPath, 'create-work', 'isolated-test-frame')
    const work = await works.create(await authority.consume(selection.id, 'create-work', 'isolated-test-frame'), { title: 'Original artwork work', requestId: 'create-image-work' })
    let state = await repository.saveModel(0, draft); state.settings.agent.imageModelId = state.models[0].id; state = await repository.updateSettings(state.revision, state.settings)
    globalThis.fetch = async () => { throw new Error('WORKER_HTTP_FORBIDDEN') }
    await works.runWithGlobal(work.id, async () => {
      const model = await resolveImageModel()
      assert.equal(model.apiKey, 'desktop-main-vault')
      const bytes = await generateImageBuffer(model, 'Original complete character artwork prompt', { sizes: ['1024x1536'], watermark: false })
      assert.deepEqual(bytes, png)
      const url = await saveCharacterImage('original-character', 'portrait', bytes)
      assert.ok(url.startsWith('/_desktop/assets/' + work.id + '/'))
      const assets = getDatabaseContext().assets!
      assert.deepEqual((await assets.read(url.split('/').at(-1)!)).bytes, png)
    })
    assert.equal(network, 2); assert.ok(calls.includes('model.image.start')); assert.equal(calls.includes('model.start'), false); assert.equal(service.activeCount, 0)
  } finally { globalThis.fetch = originalFetch; await service.close(); await works.close(); await rm(root, { recursive: true, force: true }) }
})
