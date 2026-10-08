import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import sharp from "sharp"
import type { PublicModel } from "../../desktop/core/settings"
import { ModelGateway } from "../../desktop/core/model-authorization"
import { generateMainImage } from "../../desktop/main/image-generation"

async function fixture(provider = "openai", modelId = "gpt-image-1", kind: "IMAGE" | "TEXT" = "IMAGE") {
  const png = await sharp({ create: { width: 2, height: 3, channels: 4, background: "#201c18" } }).png().toBuffer()
  const model: PublicModel = { id: randomUUID(), name: "isolated image", provider, protocol: "openai", modelId,
    endpoint: provider === "google" ? "https://generativelanguage.googleapis.com/v1beta" : "https://fixture.invalid/v1",
    kind, contextWindow: 0, enabled: true, authRevision: 1, keyMask: "••••••••", thinkingLevels: [], defaultThinking: "default" }
  const calls: { url: string; init?: RequestInit }[] = []
  let response: unknown = { data: [{ b64_json: png.toString("base64") }] }
  const gateway = new ModelGateway({ keyFor: async () => "isolated-main-only-key", fetch: async (url, init) => {
    calls.push({ url: String(url), init }); return Response.json(response)
  } })
  const record = { id: model.id, authRevision: 1, endpoint: model.endpoint, kind, enabled: true,
    protocol: provider === "google" ? "google" as const : "openai" as const }
  gateway.replace(record)
  const lease = gateway.begin(model.id, kind)
  return { model, png, calls, gateway, lease, record, response(value: unknown) { response = value }, close() { gateway.finish(lease) } }
}

test("IMG14-01: actual main adapter generates one PNG using an authorized OpenAI request and a documented compatible candidate size", async () => {
  const f = await fixture()
  try {
    const image = await generateMainImage({ ...f, prompt: "Original full novel portrait prompt", sizes: ["2048x2048", "1024x1024"], watermark: false })
    assert.deepEqual(Buffer.from(image.bytes), f.png); assert.equal(image.mimeType, "image/png"); assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].url, f.model.endpoint + "/images/generations")
    const body = JSON.parse(String(f.calls[0].init?.body))
    assert.equal(body.prompt, "Original full novel portrait prompt"); assert.equal(body.model, f.model.modelId)
    assert.equal(body.n, 1); assert.equal(body.size, "1024x1024"); assert.equal(body.watermark, undefined)
    assert.equal(new Headers(f.calls[0].init?.headers).get("authorization"), "Bearer isolated-main-only-key")
    assert.equal(JSON.stringify(image).includes("isolated-main-only-key"), false)
  } finally { f.close() }
})

test("IMG14-02: Gemini IMAGE uses its native interaction protocol, retains portrait composition and returns actual image bytes", async () => {
  const f = await fixture("google", "gemini-2.5-flash-image")
  try {
    f.response({ status: "completed", steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: f.png.toString("base64") }] }] })
    const image = await generateMainImage({ ...f, prompt: "Original full character prompt", sizes: ["1664x2496", "1024x1536"] })
    assert.deepEqual(Buffer.from(image.bytes), f.png); assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].url, f.model.endpoint + "/interactions")
    const body = JSON.parse(String(f.calls[0].init?.body))
    assert.deepEqual(body.input, [{ type: "text", text: "Original full character prompt" }])
    assert.equal(body.response_format.delivery, "inline"); assert.equal(body.response_format.aspect_ratio, "2:3")
    assert.equal(body.response_format.image_size, undefined); assert.equal(body.store, false); assert.equal(body.stream, false)
    const headers = new Headers(f.calls[0].init?.headers)
    assert.equal(headers.get("x-goog-api-key"), "isolated-main-only-key"); assert.equal(headers.get("authorization"), null)
  } finally { f.close() }
})

test("IMG14-03: a text-only authority cannot become an image call even through an internal adapter invocation", async () => {
  const f = await fixture("custom", "isolated-text", "TEXT")
  try {
    await assert.rejects(generateMainImage({ ...f, prompt: "An image" }), /MODEL_KIND_MISMATCH/)
    assert.equal(f.calls.length, 0)
  } finally { f.close() }
})

test("IMG14-04: a rotated authorization rejects the old image snapshot before any actual HTTP call", async () => {
  const f = await fixture()
  try {
    f.gateway.replace({ ...f.record, authRevision: 2 })
    await assert.rejects(generateMainImage({ ...f, prompt: "An image" }), /AUTHORIZATION_REVOKED/)
    assert.equal(f.calls.length, 0)
  } finally { f.close() }
})


test("IMG14-05: compatible provider URL receipts download image bytes only in main, without exporting a URL or API Key", async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#abc' } }).png().toBuffer()
  const model: PublicModel = { id: randomUUID(), name: 'local server', provider: 'custom', protocol: 'openai', modelId: 'configured-image', endpoint: 'http://127.0.0.1:19145/v1', kind: 'IMAGE', contextWindow: 0, enabled: true, authRevision: 1, keyMask: '••', thinkingLevels: [], defaultThinking: 'default' }
  const calls: string[] = []
  const gateway = new ModelGateway({ keyFor: async () => 'isolated-download-key', fetch: async (url) => { calls.push(String(url)); return Response.json({ data: [{ url: 'http://127.0.0.1:19145/out/one.png' }] }) }, imageResource: { fetch: async (url, init) => { calls.push(String(url)); assert.equal(new Headers(init?.headers).get('authorization'), null); return new Response(Uint8Array.from(png)) } } })
  gateway.replace(model); const lease = gateway.begin(model.id, 'IMAGE')
  try {
    const result = await generateMainImage({ model, lease, gateway, prompt: 'Full original story cover' })
    assert.deepEqual(Buffer.from(result.bytes), png); assert.equal(result.mimeType, 'image/png')
    assert.deepEqual(calls, [model.endpoint + '/images/generations', 'http://127.0.0.1:19145/out/one.png'])
    assert.equal('url' in result, false)
  } finally { gateway.finish(lease) }
})

test("IMG14-06: successful URL download containing HTML is rejected instead of becoming a stored image", async () => {
  const model: PublicModel = { id: randomUUID(), name: 'local server', provider: 'custom', protocol: 'openai', modelId: 'configured-image', endpoint: 'http://127.0.0.1:19145/v1', kind: 'IMAGE', contextWindow: 0, enabled: true, authRevision: 1, keyMask: '••', thinkingLevels: [], defaultThinking: 'default' }
  const gateway = new ModelGateway({ keyFor: async () => 'isolated-download-key', fetch: async () => Response.json({ data: [{ url: 'http://127.0.0.1:19145/out/one.png' }] }), imageResource: { fetch: async () => new Response('<script>not an image</script>') } })
  gateway.replace(model); const lease = gateway.begin(model.id, 'IMAGE')
  try { await assert.rejects(generateMainImage({ model, lease, gateway, prompt: 'Original' }), /IMAGE_RESPONSE_INVALID/) } finally { gateway.finish(lease) }
})

test('IMG14-07: a PNG with a valid metadata header but truncated pixel stream cannot be returned as verified image bytes', async () => {
  const f = await fixture()
  try {
    const truncated = f.png.subarray(0, Math.max(45, f.png.length - 30))
    f.response({ data: [{ b64_json: truncated.toString('base64') }] })
    await assert.rejects(generateMainImage({ ...f, prompt: 'Original' }), /IMAGE_RESPONSE_INVALID/)
  } finally { f.close() }
})

test('IMG14-08: an image entry carrying a provider error cannot be accepted despite a valid image, or leak the raw diagnostic', async () => {
  const f = await fixture()
  try {
    f.response({ data: [{ b64_json: f.png.toString('base64'), error: { message: 'echo isolated-main-only-key' } }] })
    await assert.rejects(generateMainImage({ ...f, prompt: 'Original' }), (cause: Error) => cause.message === 'IMAGE_PROVIDER_FAILED')
  } finally { f.close() }
})
