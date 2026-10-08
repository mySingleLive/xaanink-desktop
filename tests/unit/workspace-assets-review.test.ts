import assert from "node:assert/strict"
import { test } from "node:test"
import { chmod, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import sharp from "sharp"
import { WorkspaceAssets } from "../../desktop/service/workspace-assets"
import { currentWorkAssets, saveWorkImage } from "../../desktop/service/image-assets"
import { runInDatabaseContext } from "../../desktop/service/context"
import { uploadSceneImage, readSceneImageAsset } from "../../src/lib/services/scene-image"
import type { PrismaClient } from "../../src/generated/prisma/client"

const png = () => sharp({ create: { width: 4, height: 3, channels: 3, background: "#746750" } }).png().toBuffer()
async function rig() {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-assets-review-"))
  return { root, assets: new WorkspaceAssets(root), dispose: () => rm(root, { recursive: true, force: true }) }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}

test("WA57-01: rollback cannot delete a newly replaced author file even when its image bytes are identical", async () => {
  const r = await rig()
  try {
    const bytes = await png(), image = await r.assets.save(bytes), target = join(r.root, "assets", image.filename)
    const old = await stat(target, { bigint: true }), replacement = join(r.root, "author-replacement.png")
    await writeFile(replacement, bytes, { flag: "wx" })
    await rename(replacement, target)
    const current = await stat(target, { bigint: true })
    assert.notEqual(current.ino, old.ino, "the replacement is a different author's file, rather than an in-place edit")
    await assert.rejects(r.assets.removeCreated(image.filename), /变化|归属|写入|确认/)
    assert.deepEqual(await readFile(target), bytes)
  } finally { await r.dispose() }
})

test("WA57-02: swapping the owned root blocks reads, writes and rollback without touching the replacement work", async () => {
  const base = await mkdtemp(join(tmpdir(), "xuanxiang-assets-root-review-")), root = join(base, "work"), moved = join(base, "original")
  await mkdir(root)
  const assets = new WorkspaceAssets(root)
  try {
    const bytes = await png(), image = await assets.save(bytes)
    await rename(root, moved); await mkdir(root); await mkdir(join(root, "assets"))
    await writeFile(join(root, "assets", image.filename), bytes)
    for (const run of [() => assets.read(image.filename), () => assets.save(bytes), () => assets.removeCreated(image.filename)]) await assert.rejects(run(), /身份|目录/)
    assert.deepEqual(await readdir(join(root, "assets")), [image.filename])
    assert.deepEqual(await readFile(join(root, "assets", image.filename)), bytes)
    assert.deepEqual(await readFile(join(moved, "assets", image.filename)), bytes)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test("WA57-03: full pixel decoding rejects truncated input whose PNG metadata can still be read", async () => {
  const r = await rig()
  try {
    const complete = await png(), truncated = complete.subarray(0, complete.length - 22)
    assert.equal((await sharp(truncated).metadata()).format, "png", "the fixture intentionally passes a metadata-only check")
    await assert.rejects(r.assets.save(truncated, "image/png"), /内容无效|解码/)
    assert.deepEqual(await readdir(r.root), [])
  } finally { await r.dispose() }
})

test("WA57-04: actual PNG JPEG WebP and GIF decoding returns matching file extensions and MIME, never the caller's extension", async () => {
  const r = await rig()
  try {
    const source = await png()
    for (const [format, ext, mime] of [["png", "png", "image/png"], ["jpeg", "jpg", "image/jpeg"], ["webp", "webp", "image/webp"], ["gif", "gif", "image/gif"]] as const) {
      const bytes = await sharp(source).toFormat(format).toBuffer(), image = await r.assets.save(bytes, mime)
      assert.ok(image.filename.endsWith("." + ext)); assert.equal(image.mime, mime)
      const stored = await r.assets.read(image.filename)
      assert.equal(stored.mime, mime); assert.deepEqual(stored.bytes, bytes)
      assert.equal((await sharp(stored.bytes).raw().toBuffer()).length, format === "gif" ? 48 : 36)
    }
  } finally { await r.dispose() }
})

test("WA57-05: asynchronous decode and disk write use an owned copy of the caller's mutable buffer", async () => {
  const r = await rig()
  try {
    const bytes = await png(), expected = Buffer.from(bytes), pending = r.assets.save(bytes)
    bytes.fill(0)
    const image = await pending
    assert.deepEqual((await r.assets.read(image.filename)).bytes, expected)
  } finally { await r.dispose() }
})

test("WA57-06: simultaneous trusted database contexts keep image URLs and actual files in their own work", async () => {
  const a = await rig(), b = await rig(), entered = deferred(), proceed = deferred(), ids = [randomUUID(), randomUUID()], database = {} as PrismaClient
  try {
    const first = runInDatabaseContext({ workspaceId: ids[0], database, assets: a.assets }, async () => { entered.resolve(); await proceed.promise; return saveWorkImage(await png()) })
    await entered.promise
    const second = await runInDatabaseContext({ workspaceId: ids[1], database, assets: b.assets }, () => saveWorkImage(Buffer.from([0x89])).catch(error => error))
    assert.ok(second instanceof Error); assert.deepEqual(await readdir(b.root), [])
    const secondValid = await runInDatabaseContext({ workspaceId: ids[1], database, assets: b.assets }, async () => saveWorkImage(await png()))
    proceed.resolve(); const firstValid = await first
    assert.equal(firstValid.url, `/_desktop/assets/${ids[0]}/${firstValid.filename}`)
    assert.equal(secondValid.url, `/_desktop/assets/${ids[1]}/${secondValid.filename}`)
    assert.deepEqual(await readdir(join(a.root, "assets")), [firstValid.filename])
    assert.deepEqual(await readdir(join(b.root, "assets")), [secondValid.filename])
    assert.throws(() => currentWorkAssets(), /context/)
    assert.throws(() => runInDatabaseContext({ workspaceId: "inbox", database, assets: a.assets }, currentWorkAssets), /作品目录/)
    assert.throws(() => runInDatabaseContext({ workspaceId: ids[0], database }, currentWorkAssets), /作品目录/)
  } finally { proceed.resolve(); await a.dispose(); await b.dispose() }
})

test("WA57-07: original scene upload/read adapter preserves its URL and rolls back only the new image on database rejection", async () => {
  const r = await rig(), scope = { novelId: "novel", userId: "local-author" }
  const history: Array<Record<string, unknown>> = [], reads: unknown[] = []
  let fail = false
  const database = {
    novel: { findFirst: async ({ where }: { where: unknown }) => { reads.push(where); return { id: scope.novelId } } },
    scene: { findFirst: async ({ where }: { where: { id: string; novelId: string } }) => where.id === "scene" && where.novelId === scope.novelId ? { id: "scene", exteriorImageRevision: 0, interiorImageRevision: 0 } : null, update: async () => ({}) },
    sceneImage: {
      create: async ({ data }: { data: Record<string, unknown> }) => { if (fail) throw Error("isolated database rejection"); const row = { ...data, createdAt: new Date("2026-10-08T00:00:00Z") }; history.push(row); return row },
      findFirst: async ({ where }: { where: { id: string; sceneId: string } }) => history.find(row => row.id === where.id && row.sceneId === where.sceneId) ?? null,
    },
    $executeRaw: async () => 1,
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(database),
  }
  try {
    const bytes = await png(), existing = await r.assets.save(bytes), workId = randomUUID()
    await runInDatabaseContext({ workspaceId: workId, database: database as unknown as PrismaClient, assets: r.assets }, async () => {
      const result = await uploadSceneImage(scope, "scene", "exterior", bytes, "image/png")
      assert.equal(result.url, `/api/novels/novel/scenes/scene/images/${result.image.id}/asset`)
      assert.equal(result.applied, true)
      assert.deepEqual(await readSceneImageAsset(scope, "scene", result.image.id), { bytes, mime: "image/png" })
      const before = (await readdir(join(r.root, "assets"))).sort()
      fail = true
      await assert.rejects(uploadSceneImage(scope, "scene", "interior", bytes, "image/png"), /database rejection/)
      assert.deepEqual((await readdir(join(r.root, "assets"))).sort(), before)
      assert.deepEqual((await r.assets.read(existing.filename)).bytes, bytes)
      await assert.rejects(readSceneImageAsset(scope, "foreign-scene", result.image.id), /场景不存在/)
      await assert.rejects(readSceneImageAsset(scope, "scene", "foreign-image"), /图片不存在/)
    })
    assert.ok(reads.length >= 3)
    assert.deepEqual(reads[0], { id: "novel", userId: "local-author", status: { not: "DELETED" } })
  } finally { await r.dispose() }
})

test("WA57-08: asset-directory symlink replacement during uncertain persistence never yields a receipt or deletes the external work", async () => {
  const r = await rig(), external = await mkdtemp(join(tmpdir(), "xuanxiang-assets-external-review-"))
  try {
    const bytes = await png(), marker = join(external, "author.txt")
    await writeFile(marker, "external author data")
    const assets = new WorkspaceAssets(r.root, { beforeDirectorySync: async () => { await rename(join(r.root, "assets"), join(r.root, "assets-original")); await symlink(external, join(r.root, "assets")) } })
    await assert.rejects(assets.save(bytes))
    assert.deepEqual(await readdir(external), ["author.txt"])
    assert.equal(await readFile(marker, "utf8"), "external author data")
    const uncertain = await readdir(join(r.root, "assets-original"))
    assert.equal(uncertain.length, 1); assert.deepEqual(await readFile(join(r.root, "assets-original", uncertain[0])), bytes)
  } finally { await r.dispose(); await rm(external, { recursive: true, force: true }) }
})

test("WA57-09: a same-byte replacement before durability acknowledgement cannot become this operation's successful receipt", async () => {
  const r = await rig()
  let replaced: string | undefined
  const bytes = await png()
  try {
    const assets = new WorkspaceAssets(r.root, { beforeDirectorySync: async () => {
      const files = await readdir(join(r.root, "assets"))
      assert.equal(files.length, 1)
      replaced = files[0]
      const target = join(r.root, "assets", replaced), old = await stat(target, { bigint: true }), authorFile = join(r.root, "author-same-image.png")
      await writeFile(authorFile, bytes, { flag: "wx" }); await rename(authorFile, target)
      assert.notEqual((await stat(target, { bigint: true })).ino, old.ino)
    } })
    await assert.rejects(assets.save(bytes), /变化|归属|身份|写入/)
    assert.ok(replaced)
    assert.deepEqual(await readFile(join(r.root, "assets", replaced)), bytes)
    await assert.rejects(assets.removeCreated(replaced))
    assert.deepEqual(await readFile(join(r.root, "assets", replaced)), bytes)
  } finally { await r.dispose() }
})

test("WA57-10: an actual POSIX permission failure returns no image and preserves every existing author file", { skip: process.platform === "win32" ? "requires POSIX directory permissions; Windows ACL acceptance is separate" : false }, async () => {
  const r = await rig()
  try {
    const bytes = await png(), existing = await r.assets.save(bytes), directory = join(r.root, "assets")
    await chmod(directory, 0o500)
    await assert.rejects(r.assets.save(bytes), (error: unknown) => (error as NodeJS.ErrnoException).code === "EACCES")
    assert.deepEqual(await readdir(directory), [existing.filename])
    assert.deepEqual(await readFile(join(directory, existing.filename)), bytes)
  } finally { await chmod(join(r.root, "assets"), 0o700).catch(() => {}); await r.dispose() }
})
