import assert from "node:assert/strict"
import { test } from "node:test"
import { build } from "esbuild"
import { Worker } from "node:worker_threads"
import { randomUUID, createHash } from "node:crypto"
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import sharp from "sharp"
import { RpcPeer } from "../../desktop/service/rpc"
import { DirectoryAuthority } from "../../desktop/main/directory-authority"
import { defaultState } from "../../desktop/core/settings"
import { freezeTaskDefaults } from "../../desktop/shared/task-defaults"
import type { LocalResponse } from "../../desktop/shared/ipc"

test("IMG60-W01: privately built real worker persists original item/character image histories, isolates work URLs and reads them after a cold restart", { timeout: 90000 }, async () => {
  // Private generated bundle stays beneath the project for external package
  // resolution. Never rewrite the main/service dist used by root's Electron.
  await mkdir("tests/generated", { recursive: true })
  const generated = await mkdtemp(join(process.cwd(), "tests/generated/image-review60-")), entry = join(generated, "service.cjs")
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-image-worker-review-")), app = join(root, "app"), work = join(root, "author-work"), other = join(root, "another-work")
  const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex")
  let worker: Worker | undefined, rpc: RpcPeer | undefined
  const external: string[] = []
  async function startWorker() {
    worker = new Worker(entry, { workerData: { root: app, migrations: join(process.cwd(), "prisma/migrations") } })
    rpc = new RpcPeer(worker, async method => { if (method === "model.defaults") return freezeTaskDefaults(defaultState.settings.agent, 0); external.push(method); throw Error(`unexpected model/network operation ${method}`) })
    const peer = rpc; worker.on("error", () => peer.dispose()); worker.on("exit", () => peer.dispose())
    await rpc.call("ready")
  }
  async function request(path: string, body?: FormData | Record<string, unknown>) {
    const wire = new Request("https://local.invalid" + path, { method: body ? "POST" : "GET", headers: body && !(body instanceof FormData) ? { "content-type": "application/json" } : undefined, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
    const id = randomUUID(), response = await rpc!.call<LocalResponse>("start", { version: 1, id, path, method: wire.method, headers: Object.fromEntries(wire.headers), body: body ? new Uint8Array(await wire.arrayBuffer()) : undefined })
    const chunks: Uint8Array[] = []
    for (;;) { const next = await rpc!.call<{ done: boolean; bytes?: Uint8Array }>("read", id); if (next.done) break; assert.ok(next.bytes instanceof Uint8Array); assert.ok(next.bytes.byteLength <= 65536); chunks.push(next.bytes) }
    return { status: response.status, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) }
  }
  function upload(bytes: Buffer, mime: string, kind?: string) { const form = new FormData(); form.append("file", new File([new Uint8Array(bytes)], "author-image", { type: mime })); if (kind) form.append("kind", kind); return form }
  try {
    await build({ bundle: true, platform: "node", target: "node24", format: "cjs", packages: "external", tsconfig: "tsconfig.json", entryPoints: ["desktop/service/index.ts"], outfile: entry, define: { "import.meta.url": "__desktopImportMetaUrl" }, banner: { js: 'var __desktopImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' } })
    await mkdir("docs/evidence/implementation-10", { recursive: true })
    await writeFile("docs/evidence/implementation-10/review-60-worker-build.json", JSON.stringify({ builtAt: new Date().toISOString(), build: "private esbuild node24 service bundle; root dist and route generator untouched", sha256: digest(await readFile(entry)), entrySha256: digest(await readFile("desktop/service/index.ts")), ephemeralFileDeletedAfterTest: true }, null, 2) + "\n")
    await startWorker(); await mkdir(work); await mkdir(other)
    const grants = new DirectoryAuthority()
    async function create(directory: string, title: string) { const owner = randomUUID(), grant = await grants.issue(directory, "create-work", owner); return rpc!.call<{ novel: { id: string } }>("create-work", { selection: await grants.consume(grant.id, "create-work", owner), input: { title, requestId: randomUUID() } }) }
    const first = await create(work, "独立图片作品"), second = await create(other, "隔离图片作品")
    const novel = first.novel.id, manifest = JSON.parse(await readFile(join(work, "xaanink-work.json"), "utf8")), foreignManifest = JSON.parse(await readFile(join(other, "xaanink-work.json"), "utf8"))
    const item = await request(`/api/novels/${novel}/items`, { name: "本地信物" }), character = await request(`/api/novels/${novel}/characters`, { name: "本地作者角色", roleType: "PROTAGONIST" })
    assert.equal(item.status, 200); assert.equal(character.status, 200)
    const small = await sharp({ create: { width: 4, height: 3, channels: 3, background: "#a09078" } }).jpeg().toBuffer()
    const personImage = await request(`/api/novels/${novel}/characters/${character.data.character.id}/images`, upload(small, "image/jpeg", "avatar"))
    assert.equal(personImage.status, 200); assert.ok(personImage.data.url.endsWith(".jpg"))
    const large = await sharp(Buffer.alloc(1800 * 1800 * 3, 91), { raw: { width: 1800, height: 1800, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()
    assert.ok(large.length > 8 * 1024 * 1024 && large.length < 10 * 1024 * 1024)
    const itemImage = await request(`/api/novels/${novel}/items/${item.data.item.id}/images`, upload(large, "image/png"))
    assert.equal(itemImage.status, 200)
    for (const [url, bytes, mime] of [[personImage.data.url, small, "image/jpeg"], [itemImage.data.url, large, "image/png"]] as const) {
      assert.ok(url.startsWith(`/_desktop/assets/${manifest.id}/`))
      const asset = await rpc!.call<{ bytes: Uint8Array; mime: string }>("image-asset", url)
      assert.ok(asset.bytes instanceof Uint8Array); assert.equal(asset.mime, mime); assert.deepEqual(Buffer.from(asset.bytes), bytes)
      await assert.rejects(rpc!.call("image-asset", url.replace(manifest.id, foreignManifest.id)), /图片|ENOENT|目录/)
    }
    const before = (await readdir(join(work, "assets"))).sort()
    await assert.rejects(request(`/api/novels/${novel}/items/${item.data.item.id}/images`, upload(Buffer.from("<svg>invalid image</svg>"), "image/png")), /图片/)
    assert.deepEqual((await readdir(join(work, "assets"))).sort(), before)
    assert.equal((await request(`/api/novels/${novel}/items/${item.data.item.id}/images`)).data.images.length, 1)
    assert.equal((await request(`/api/novels/${second.novel.id}/items/${item.data.item.id}/images`)).status, 404)
    for (const invalid of [itemImage.data.url + "?secret", itemImage.data.url.replace(".png", ".svg"), "/api/admin/prompts", "file:///private/author.png"]) await assert.rejects(rpc!.call("image-asset", invalid), /标识/)
    await rpc!.call("close"); rpc!.dispose(); await worker!.terminate(); rpc = undefined; worker = undefined
    await startWorker()
    assert.deepEqual(Buffer.from((await rpc!.call<{ bytes: Uint8Array }>("image-asset", itemImage.data.url)).bytes), large)
    assert.deepEqual(Buffer.from((await rpc!.call<{ bytes: Uint8Array }>("image-asset", personImage.data.url)).bytes), small)
    assert.equal((await request(`/api/novels/${novel}/items/${item.data.item.id}/images`)).data.images[0].url, itemImage.data.url)
    assert.equal((await request(`/api/novels/${novel}/characters/${character.data.character.id}/images?kind=avatar`)).data.images[0].url, personImage.data.url)
    assert.equal((await readdir(join(work, "assets"))).length, 2); assert.deepEqual(await readdir(join(other, "assets")), [])
    assert.deepEqual(external, [])
  } finally { await rpc?.call("close").catch(() => {}); rpc?.dispose(); await worker?.terminate(); await rm(root, { recursive: true, force: true }); await rm(generated, { recursive: true, force: true }) }
})
