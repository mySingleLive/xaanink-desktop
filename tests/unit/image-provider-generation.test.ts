import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { PublicModel } from '../../desktop/core/settings'
import { ModelGateway } from '../../desktop/core/model-authorization'
import { generateMainImage } from '../../desktop/main/image-generation'
const prompt = 'Original complete character prompt with story-specific costume, lighting, pose and composition'
const url = 'https://cdn.fixture.invalid/image.png?signature=legitimate-resource-signature'
type Json = Record<string, any>
async function fixture(provider: string, modelId: string, replies: Json[]) {
  const png = await sharp({ create: { width: 7, height: 11, channels: 3, background: '#bc9' } }).png().toBuffer()
  const model: PublicModel = { id: randomUUID(), name: 'fixture', provider, protocol: 'openai', modelId, endpoint: 'https://fixture.invalid/v1', kind: 'IMAGE', contextWindow: 0, enabled: true, authRevision: 1, keyMask: '••', thinkingLevels: [], defaultThinking: 'default' }
  const calls: { path: string; method: string; body?: Json; headers: Headers }[] = []
  let downloads = 0
  const gateway = new ModelGateway({ keyFor: async () => 'main-private-key', fetch: async (address, init) => {
    const parsed = new URL(String(address)); calls.push({ path: parsed.pathname.replace('/v1', ''), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) })
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer main-private-key')
    assert.ok(replies.length, 'no unexpected provider retry')
    return Response.json(replies.shift())
  }, imageResource: { lookup: async () => [{ address: '8.8.8.8', family: 4 }], fetch: async (address, init) => { downloads++; assert.equal(String(address), url); assert.equal(new Headers(init?.headers).get('authorization'), null); return new Response(Uint8Array.from(png)) } } })
  gateway.replace(model); const lease = gateway.begin(model.id, 'IMAGE')
  const generate = () => generateMainImage({ model, gateway, lease, prompt, sizes: ['1664x2496', '1024x1536'], watermark: false, pollDelay: async () => {} })
  return { png, calls, model, gateway, lease, generate, downloads: () => downloads, close: () => gateway.finish(lease) }
}
const choices = (id?: string) => ({ output: { ...(id ? { task_id: id, task_status: 'SUCCEEDED' } : {}), choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: [{ type: 'image', image: url }] } }] }, usage: { image_count: 1, output_image_count: 1 } })

test('IMG14-P01: xAI uses image-specific ratio/resolution and exactly one output instead of an OpenAI size field', async () => {
  const f = await fixture('xai', 'grok-imagine-image-2.0', [{ data: [{ url }] }])
  try { assert.deepEqual(Buffer.from((await f.generate()).bytes), f.png); assert.equal(f.calls[0].path, '/images/generations'); assert.equal(f.calls[0].body?.prompt, prompt); assert.equal(f.calls[0].body?.aspect_ratio, '2:3'); assert.equal(f.calls[0].body?.resolution, '2k'); assert.equal(f.calls[0].body?.n, 1); assert.equal(f.calls[0].body?.size, undefined) } finally { f.close() }
})
for (const model of ['glm-image', 'cogview-4-250304']) test('IMG14-P02: ZAI ' + model + ' chooses a documented legal portrait and does not invent an n field', async () => {
  const f = await fixture('zai', model, [{ data: [{ url }] }])
  try { await f.generate(); assert.equal(f.calls[0].body?.prompt, prompt); assert.equal(f.calls[0].body?.size, '1024x1536'); assert.equal(f.calls[0].body?.n, undefined); assert.equal(f.downloads(), 1) } finally { f.close() }
})
test('IMG14-P03: MiniMax native response validates base status and single-image counters, preserving full prompt and portrait ratio', async () => {
  const f = await fixture('minimax', 'image-01', [{ base_resp: { status_code: 0 }, data: { image_urls: [url] }, metadata: { success_count: '1', failed_count: '0' } }])
  try { await f.generate(); assert.equal(f.calls[0].path, '/image_generation'); assert.equal(f.calls[0].body?.prompt, prompt); assert.equal(f.calls[0].body?.aspect_ratio, '2:3'); assert.equal(f.calls[0].body?.n, 1); assert.equal(f.calls[0].body?.prompt_optimizer, false); assert.equal(f.downloads(), 1) } finally { f.close() }
})
for (const model of ['doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-flash-260915', 'doubao-seedream-5-0-260128', 'doubao-seedream-5-0-lite-260128', 'doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828']) test('IMG14-P04: Ark ' + model + ' generates a single full-prompt image with model-specific sequential controls', async () => {
  const f = await fixture('bytedance', model, [{ data: [{ url }], usage: { generated_images: 1 } }])
  try { await f.generate(); assert.equal(f.calls[0].body?.prompt, prompt); assert.equal(f.calls[0].body?.watermark, false); assert.equal(f.calls[0].body?.stream, false); assert.equal(f.calls[0].body?.sequential_image_generation, ['doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-flash-260915'].includes(model) ? undefined : 'disabled'); assert.equal(f.calls[0].body?.image, undefined); assert.equal(f.calls[0].body?.tools, undefined); assert.equal(f.downloads(), 1) } finally { f.close() }
})
for (const model of ['qwen-image-3.0-pro', 'qwen-image-2.1-pro', 'qwen-image-2.0-pro', 'qwen-image-max', 'z-image-turbo', 'wan2.6-t2i']) test('IMG14-P05: Alibaba synchronous ' + model + ' uses native text messages, single quantity and exact prompt', async () => {
  const f = await fixture('alibaba', model, [choices()])
  try { await f.generate(); assert.equal(f.calls[0].path, '/services/aigc/multimodal-generation/generation'); assert.deepEqual(f.calls[0].body?.input.messages, [{ role: 'user', content: [{ text: prompt }] }]); assert.equal(f.calls[0].body?.parameters.n, model === 'z-image-turbo' ? undefined : 1); assert.equal(f.calls[0].body?.parameters.prompt_extend, false); assert.equal(f.downloads(), 1) } finally { f.close() }
})
for (const model of ['wan2.7-image-pro', 'wan2.7-image', 'wan2.6-image', 'wanx2.1-t2i-turbo', 'kling/kling-v3-image-generation', 'kling/kling-v3-omni-image-generation', 'vidu/vidu-image_reference2image', 'vidu/viduq2-fast_reference2image']) test('IMG14-P06: Alibaba asynchronous ' + model + ' submits once, polls its exact task and downloads only completed output', async () => {
  const f = await fixture('alibaba', model, [{ output: { task_id: 'owned-task', task_status: 'PENDING' } }, model === 'wanx2.1-t2i-turbo' ? { output: { task_id: 'owned-task', task_status: 'SUCCEEDED', results: [{ url }], task_metrics: { TOTAL: 1, SUCCEEDED: 1, FAILED: 0 } } } : choices('owned-task')])
  try { await f.generate(); assert.equal(f.calls[0].headers.get('x-dashscope-async'), 'enable'); assert.equal(f.calls[1].path, '/tasks/owned-task'); assert.equal(f.calls[1].method, 'GET'); assert.equal(f.calls[0].body?.parameters.n, 1); assert.equal(f.downloads(), 1); assert.equal(f.calls.length, 2) } finally { f.close() }
})
for (const [model, path, replies] of [
  ['hy-image-v3', '/wand/hunyuan-image/v3-generation', [{ data: [{ url }] }]],
  ['hy-image-v3.5-preview', '/wand/hunyuan-image/v35-generation', [{ choices: [{ finish_reason: 'stop', delta: { type: 'image', image: { url } } }] }]],
  ['wand-vega-image-lite', '/wand/vega-images/generations', [{ task_id: 'owned-task' }, { task_id: 'owned-task', status: 'completed', data: [{ url }] }]],
  ['vidu-image-q2', '/wand/vidu-image/generation', [{ task_id: 'owned-task', state: 'created' }, { state: 'success', creations: [{ url }] }]],
  ['seedream-image-v5.0-pro', '/wand/si-image/generation', [{ data: [{ url }] }]],
  ['seedream-image-v5.0-lite', '/wand/si-image/generation', [{ data: [{ url }] }]]
] as [string, string, Json[]][]) test('IMG14-P07: Tencent ' + model + ' uses its distinct international image protocol and final receipt', async () => {
  const f = await fixture('tencent', model, replies)
  try { await f.generate(); assert.equal(f.calls[0].path, path); assert.equal(f.downloads(), 1); assert.equal(f.calls[0].body?.model, model); const sent = f.calls[0].body!; assert.equal(sent.prompt ?? sent.messages?.[0]?.content?.[0]?.text, prompt); assert.equal(f.calls[0].body?.n, undefined) } finally { f.close() }
})
test('IMG14-P08: unverified future vendor model and edit-only model fail before any generation or download', async () => {
  for (const model of ['future-unverified-model', 'qwen-image-edit-max']) {
    const f = await fixture('alibaba', model, [])
    try { await assert.rejects(f.generate(), /IMAGE_GENERATION_UNSUPPORTED/); assert.equal(f.calls.length, 0); assert.equal(f.downloads(), 0) } finally { f.close() }
  }
})


test('IMG14-P09: Wan interleave and text-only size budgets differ; illegal preferred sizes are replaced before the single charged submit', async () => {
  for (const model of ['wan2.6-image', 'wan2.6-t2i', 'wan2.5-t2i-preview']) {
    const replies = model === 'wan2.6-t2i' ? [choices()] : [{ output: { task_id: 'owned-task', task_status: 'PENDING' } }, model === 'wan2.5-t2i-preview' ? { output: { task_id: 'owned-task', task_status: 'SUCCEEDED', results: [{ url }] } } : choices('owned-task')]
    const f = await fixture('alibaba', model, replies)
    try {
      await f.generate()
      const [w, h] = String(f.calls[0].body?.parameters.size).split('*').map(Number)
      assert.ok(w * h >= (model === 'wan2.6-image' ? 768 ** 2 : 1280 ** 2))
      assert.ok(w * h <= (model === 'wan2.6-image' ? 1280 ** 2 : 1440 ** 2))
      assert.ok(w / h >= 0.25 && w / h <= 4)
      assert.equal(f.calls.filter(call => call.method === 'POST').length, 1)
    } finally { f.close() }
  }
})

test('IMG14-P10: all six Vidu text-to-image IDs choose a published portrait preset instead of silently forcing a square', async () => {
  for (const model of ['vidu/vidu-image_reference2image', 'vidu/vidu-image-pro_reference2image', 'vidu/vidu-image-lite_reference2image', 'vidu/viduq3-fast_reference2image', 'vidu/viduq2-pro_reference2image', 'vidu/viduq2-fast_reference2image']) {
    const f = await fixture('alibaba', model, [{ output: { task_id: 'owned-task', task_status: 'PENDING' } }, choices('owned-task')])
    try {
      await f.generate(); const size = String(f.calls[0].body?.parameters.size)
      const [w, h] = size.split('*').map(Number); assert.ok(w < h)
      assert.equal(size, ['vidu/vidu-image_reference2image', 'vidu/vidu-image-pro_reference2image', 'vidu/vidu-image-lite_reference2image'].includes(model) ? '1024*1536' : '848*1264')
    } finally { f.close() }
  }
})
test('IMG14-P11: WAND 3:4 fallback uses the official 1080x1440 preset before submitting once', async () => {
  const f = await fixture('tencent', 'wand-vega-image-pro', [{ task_id: 'owned-task' }, { task_id: 'owned-task', status: 'completed', data: [{ url }] }])
  try {
    await generateMainImage({ model: f.model, gateway: f.gateway, lease: f.lease, prompt, sizes: ['1152x1536'], pollDelay: async () => {} })
    assert.equal(f.calls[0].body?.size, '1080x1440'); assert.equal(f.calls.filter(call => call.method === 'POST').length, 1)
  } finally { f.close() }
})

test('IMG14-P12: a mismatched task echo and a failed task carrying an old image cannot be downloaded', async () => {
  for (const output of [{ task_id: 'other-task', task_status: 'SUCCEEDED', ...choices().output }, { task_id: 'owned-task', task_status: 'FAILED', ...choices().output }]) {
    const f = await fixture('alibaba', 'wan2.7-image', [{ output: { task_id: 'owned-task', task_status: 'PENDING' } }, { output }])
    try { await assert.rejects(f.generate(), /IMAGE_RESPONSE_INVALID|IMAGE_PROVIDER_FAILED/); assert.equal(f.downloads(), 0); assert.equal(f.calls.filter(call => call.method === 'POST').length, 1) } finally { f.close() }
  }
})
test('IMG14-P13: a single returned URL does not excuse reported multiple or invalid output counts', async () => {
  for (const count of [2, 0, '1', -1]) {
    const reply: Json = choices(); reply.usage = { output_image_count: count }
    const f = await fixture('alibaba', 'qwen-image-3.0-pro', [reply])
    try { await assert.rejects(f.generate(), /IMAGE_RESPONSE_INVALID/); assert.equal(f.downloads(), 0) } finally { f.close() }
  }
})
test('IMG14-P14: MiniMax business error cannot be hidden by HTTP200 and a valid-looking old URL', async () => {
  const f = await fixture('minimax', 'image-01', [{ base_resp: { status_code: 1004, status_msg: 'echo main-private-key' }, data: { image_urls: [url] }, metadata: { success_count: '1', failed_count: '0' } }])
  try { await assert.rejects(f.generate(), (cause: Error) => cause.message === 'IMAGE_PROVIDER_FAILED'); assert.equal(f.downloads(), 0) } finally { f.close() }
})
test('IMG14-P15: Key revocation during an ignored-abort poll delay forbids the next actual GET and any late download', async () => {
  const f = await fixture('alibaba', 'wan2.7-image', [{ output: { task_id: 'owned-task', task_status: 'PENDING' } }, choices('owned-task')])
  const entered = Promise.withResolvers<void>(), delay = Promise.withResolvers<void>()
  try {
    const work = generateMainImage({ model: f.model, gateway: f.gateway, lease: f.lease, prompt, pollDelay: async () => { entered.resolve(); await delay.promise } })
    await entered.promise; f.gateway.replace({ ...f.model, authRevision: 2 })
    await assert.rejects(work, /AUTHORIZATION_REVOKED/); delay.resolve(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.calls.length, 1); assert.equal(f.downloads(), 0)
  } finally { delay.resolve(); f.close() }
})
test('IMG14-P16: exactly one image is required; an unsolicited batch is rejected before downloading even its first result', async () => {
  const f = await fixture('bytedance', 'doubao-seedream-5-0-pro-260628', [{ data: [{ url }, { url }], usage: { generated_images: 2 } }])
  try { await assert.rejects(f.generate(), /IMAGE_RESPONSE_INVALID/); assert.equal(f.downloads(), 0) } finally { f.close() }
})

test('IMG14-P17: published character limits fail before a paid call instead of letting the provider silently truncate the original prompt', async () => {
  for (const [modelId, maximum] of [['z-image-turbo', 800], ['wan2.6-image', 2000], ['wan2.7-image', 5000], ['kling/kling-v3-image-generation', 2500]] as const) {
    const f = await fixture('alibaba', modelId, [])
    try {
      await assert.rejects(generateMainImage({ model: f.model, gateway: f.gateway, lease: f.lease, prompt: '香'.repeat(maximum + 1) }), /IMAGE_PROMPT_TOO_LONG/)
      assert.equal(f.calls.length, 0); assert.equal(f.downloads(), 0)
    } finally { f.close() }
  }
})
