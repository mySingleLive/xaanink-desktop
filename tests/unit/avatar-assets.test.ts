import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, readdir, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setImmediate as tick } from "node:timers/promises"
import sharp from "sharp"
import { AvatarAssetError, AvatarAssetService, type AvatarAssetOptions } from "../../desktop/main/avatar-assets"

async function fixture(options: Partial<AvatarAssetOptions> = {}) {
  const base = await mkdtemp(join(tmpdir(), "xuanxiang-avatar-"))
  const root = join(base, "data"); await mkdir(root)
  const service = new AvatarAssetService({ root, ...options })
  const session = randomUUID(); const owner = "window-a"; service.begin(owner, session)
  return { base, root, service, owner, session, close: async () => { service.close(); await rm(base, { recursive: true, force: true }) } }
}
const pixelImage = (width = 1024, height = 600) => sharp({ create: { width, height, channels: 4, background: { r: 20, g: 90, b: 180, alpha: 0.5 } } })
function errorCode(code: string) { return (error: unknown) => error instanceof AvatarAssetError && error.code === code && !error.cause }
async function input(f: Awaited<ReturnType<typeof fixture>>, bytes: Buffer, name = "source.png") { const path = join(f.base, name); await writeFile(path, bytes); return path }
function previewBytes(value: { previewDataUrl: string }) { assert.ok(value.previewDataUrl.startsWith("data:image/png;base64,")); return Buffer.from(value.previewDataUrl.split(",")[1], "base64") }

test("AVATAR-01: actual PNG/JPEG/WebP decode into bounded PNG previews without persistence or source paths", async () => {
  const f = await fixture()
  try {
    for (const format of ["png", "jpeg", "webp"] as const) {
      const source = await pixelImage().toFormat(format).toBuffer()
      const path = await input(f, source, `opaque-name-${format}.bin`)
      const result = await f.service.stageSelected(f.owner, f.session, path)
      const bytes = previewBytes(result); const meta = await sharp(bytes).metadata()
      assert.equal(meta.format, "png"); assert.equal(meta.width, 512); assert.equal(meta.height, 300)
      assert.equal(result.width, 512); assert.equal(result.height, 300); assert.equal(result.bytes, bytes.length)
      assert.match(result.draftId, /^[0-9a-f-]{36}$/)
      assert.equal(JSON.stringify(result).includes(path), false)
      assert.deepEqual(await readdir(f.root), [])
    }
  } finally { await f.close() }
})
test("AVATAR-02: EXIF orientation is applied and original metadata is removed without enlarging a small image", async () => {
  const f = await fixture()
  try {
    const source = await pixelImage(16, 8).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    assert.ok((await sharp(source).metadata()).exif)
    const result = await f.service.stageSelected(f.owner, f.session, await input(f, source))
    const meta = await sharp(previewBytes(result)).metadata()
    assert.equal(meta.width, 8); assert.equal(meta.height, 16)
    assert.equal(meta.exif, undefined); assert.equal(meta.icc, undefined); assert.equal(meta.orientation, undefined)
  } finally { await f.close() }
})
test("AVATAR-03: extension and image-like signatures cannot substitute for an actual supported decode", async () => {
  const f = await fixture()
  try {
    for (const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), Buffer.from("GIF89a"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0])]) {
      await assert.rejects(f.service.stageSelected(f.owner, f.session, await input(f, bytes)), errorCode("INVALID_IMAGE"))
    }
    await assert.rejects(f.service.stageSelected(f.owner, f.session, f.base), errorCode("INVALID_SELECTION"))
    assert.deepEqual(await readdir(f.root), [])
  } finally { await f.close() }
})
test("AVATAR-04: 10MiB input and 16M pixel bounds reject oversized sources while the pixel boundary remains usable", async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.service.stageSelected(f.owner, f.session, await input(f, Buffer.alloc(10 * 1024 * 1024 + 1))), errorCode("INPUT_TOO_LARGE"))
    await assert.rejects(f.service.stageSelected(f.owner, f.session, await input(f, await pixelImage(4001, 4000).png().toBuffer())), errorCode("PIXEL_LIMIT"))
    const result = await f.service.stageSelected(f.owner, f.session, await input(f, await pixelImage(4000, 4000).png().toBuffer()))
    assert.equal(result.width, 512); assert.equal(result.height, 512)
  } finally { await f.close() }
})
test("AVATAR-05: owner/session authorization prevents replay and cancelled sessions cannot revive after a native picker returns", async () => {
  const f = await fixture()
  try {
    const path = await input(f, await pixelImage(16, 8).png().toBuffer())
    await assert.rejects(f.service.stageSelected("window-b", f.session, path), errorCode("CANCELLED"))
    assert.throws(() => f.service.begin(f.owner, "../invalid"), errorCode("INVALID_SESSION"))
    f.service.cancel(f.owner, f.session)
    assert.throws(() => f.service.begin(f.owner, f.session), errorCode("CANCELLED"))
    await assert.rejects(f.service.stageSelected(f.owner, f.session, path), errorCode("CANCELLED"))
    assert.throws(() => f.service.assertActive(f.owner, f.session), errorCode("CANCELLED"))
  } finally { await f.close() }
})
test("AVATAR-06: cancel discards late reads and a newer selection wins within one session", async () => {
  const delayed = Promise.withResolvers<Buffer>(); const bytes = await pixelImage(16, 8).png().toBuffer()
  const f = await fixture({ readSelectedFile: async path => path.endsWith("late") ? delayed.promise : bytes })
  try {
    const old = f.service.stageSelected(f.owner, f.session, join(f.base, "late")); const rejected = assert.rejects(old, errorCode("STALE_SELECTION"))
    await tick()
    const newest = await f.service.stageSelected(f.owner, f.session, join(f.base, "new")); await rejected
    delayed.resolve(bytes); await tick()
    const persisted = await f.service.persistDraft(f.owner, f.session, newest.draftId)
    assert.ok(await f.service.readAsset(persisted.assetId))
    const late = Promise.withResolvers<Buffer>(); const other = await fixture({ readSelectedFile: async () => late.promise })
    try {
      const pending = other.service.stageSelected(other.owner, other.session, join(other.base, "late")); const cancelled = assert.rejects(pending, errorCode("CANCELLED"))
      await tick(); other.service.cancel(other.owner, other.session); await cancelled
      late.resolve(bytes); await tick(); assert.deepEqual(await readdir(other.root), [])
    } finally { late.resolve(bytes); await other.close() }
  } finally { delayed.resolve(bytes); await f.close() }
})
test("AVATAR-07: persistence is atomic, privately stored and idempotent across profile-CAS retries", async () => {
  const f = await fixture()
  try {
    const draft = await f.service.stageSelected(f.owner, f.session, await input(f, await pixelImage(16, 8).png().toBuffer()))
    await assert.rejects(f.service.persistDraft("window-b", f.session, draft.draftId), errorCode("CANCELLED"))
    const first = await f.service.persistDraft(f.owner, f.session, draft.draftId)
    assert.equal(first.url, `xaanink://asset/global/${first.assetId}`)
    assert.notEqual(first.assetId, draft.draftId)
    assert.deepEqual(await f.service.readAsset(first.assetId), previewBytes(draft))
    f.service.assertActive(f.owner, f.session)
    const retried = await f.service.persistDraft(f.owner, f.session, draft.draftId)
    assert.deepEqual(retried, first)
    const dir = join(f.root, "assets", "global"); assert.deepEqual(await readdir(dir), [`${first.assetId}.png`])
    if (process.platform !== "win32") assert.equal((await stat(join(dir, `${first.assetId}.png`))).mode & 0o777, 0o600)
    f.service.cancel(f.owner, f.session)
    await assert.rejects(f.service.persistDraft(f.owner, f.session, draft.draftId), errorCode("CANCELLED"))
    assert.ok(await f.service.readAsset(first.assetId))
  } finally { await f.close() }
})
test("AVATAR-08: pre-rename failures and cancellation preserve a retryable draft and never publish partial bytes", async () => {
  let fail = true; const f = await fixture({ beforeRename: async () => { if (fail) throw Error("fixture-private-source-path") } })
  try {
    const draft = await f.service.stageSelected(f.owner, f.session, await input(f, await pixelImage(16, 8).png().toBuffer()))
    await assert.rejects(f.service.persistDraft(f.owner, f.session, draft.draftId), errorCode("ASSET_WRITE_FAILED"))
    assert.deepEqual(await readdir(join(f.root, "assets", "global")), [])
    fail = false; assert.ok(await f.service.persistDraft(f.owner, f.session, draft.draftId))
    const gate = Promise.withResolvers<void>(); const entered = Promise.withResolvers<void>()
    const other = await fixture({ beforeRename: async () => { entered.resolve(); await gate.promise } })
    try {
      const next = await other.service.stageSelected(other.owner, other.session, await input(other, await pixelImage(16, 8).png().toBuffer()))
      const pending = other.service.persistDraft(other.owner, other.session, next.draftId); const rejected = assert.rejects(pending, errorCode("CANCELLED"))
      await entered.promise; other.service.cancel(other.owner, other.session); gate.resolve(); await rejected
      assert.deepEqual(await readdir(join(other.root, "assets", "global")), [])
    } finally { gate.resolve(); await other.close() }
  } finally { await f.close() }
})
test("AVATAR-09: post-rename sync uncertainty cannot grant an asset; retry returns the same normalized asset", async () => {
  let fail = true; const f = await fixture({ beforeDirectorySync: async () => { if (fail) throw Error("fixture-sync-failure") } })
  try {
    const draft = await f.service.stageSelected(f.owner, f.session, await input(f, await pixelImage(16, 8).png().toBuffer()))
    await assert.rejects(f.service.persistDraft(f.owner, f.session, draft.draftId), errorCode("ASSET_WRITE_FAILED"))
    const names = await readdir(join(f.root, "assets", "global")); assert.equal(names.length, 1)
    fail = false; const persisted = await f.service.persistDraft(f.owner, f.session, draft.draftId)
    assert.deepEqual(names, [`${persisted.assetId}.png`]); assert.deepEqual(await f.service.readAsset(persisted.assetId), previewBytes(draft))
  } finally { await f.close() }
})
test("AVATAR-10: reads accept only UUID assets and never follow file/directory symlinks to arbitrary paths", async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.service.readAsset("../../source.png"), errorCode("INVALID_ASSET_ID"))
    assert.equal(await f.service.readAsset(randomUUID()), null)
    const dir = join(f.root, "assets", "global"); await mkdir(dir, { recursive: true })
    const id = randomUUID(); const source = await input(f, await pixelImage(16, 8).png().toBuffer())
    await symlink(source, join(dir, `${id}.png`)); await assert.rejects(f.service.readAsset(id), errorCode("ASSET_READ_FAILED"))
    await rm(dir, { recursive: true }); await symlink(f.base, dir, "dir")
    await assert.rejects(f.service.readAsset(id), errorCode("ASSET_READ_FAILED"))
  } finally { await f.close() }
})
test("AVATAR-11: owner shutdown clears only its drafts and close invalidates every remaining session", async () => {
  const f = await fixture()
  try {
    const second = randomUUID(); f.service.begin("window-b", second)
    f.service.cancelOwner(f.owner); assert.throws(() => f.service.assertActive(f.owner, f.session), errorCode("CANCELLED"))
    f.service.assertActive("window-b", second)
    f.service.close(); assert.throws(() => f.service.assertActive("window-b", second), errorCode("CANCELLED"))
    assert.throws(() => f.service.begin("window-c", randomUUID()), errorCode("CANCELLED"))
  } finally { await f.close() }
})
test("AVATAR-12: animated WebP is rejected rather than silently taking its first frame", async () => {
  const f = await fixture()
  try {
    const raw = Buffer.alloc(2 * 4 * 4, 255); raw.fill(0, 0, 2 * 2 * 4)
    const bytes = await sharp(raw, { raw: { width: 2, height: 4, channels: 4, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer()
    assert.equal((await sharp(bytes).metadata()).pages, 2)
    await assert.rejects(f.service.stageSelected(f.owner, f.session, await input(f, bytes)), errorCode("ANIMATED_IMAGE"))
    assert.deepEqual(await readdir(f.root), [])
  } finally { await f.close() }
})
test("AVATAR-13: cancelled late reads do not exhaust preparation slots and all old results remain discarded", async () => {
  const bytes = await pixelImage(16, 8).png().toBuffer(); const gate = Promise.withResolvers<Buffer>()
  const f = await fixture({ readSelectedFile: async path => path.endsWith("late") ? gate.promise : bytes })
  try {
    for (let i = 0; i < 5; i++) {
      const session = randomUUID(); f.service.begin(f.owner, session)
      const pending = f.service.stageSelected(f.owner, session, join(f.base, "late")); const rejected = assert.rejects(pending, errorCode("CANCELLED"))
      await tick(); f.service.cancel(f.owner, session); await rejected
    }
    const current = await f.service.stageSelected(f.owner, f.session, join(f.base, "current"))
    assert.equal(current.width, 16); assert.equal(current.height, 8)
    gate.resolve(bytes); await tick(); assert.deepEqual(await readdir(f.root), [])
  } finally { gate.resolve(bytes); await f.close() }
})

test("AVATAR-14: cancellation before begin prevents a queued text-only profile from reviving its session", async () => {
  const f = await fixture()
  try {
    const unregistered = randomUUID()
    f.service.cancel(f.owner, unregistered)
    assert.throws(() => f.service.begin(f.owner, unregistered), errorCode("CANCELLED"))
    f.service.cancel(f.owner, unregistered)
    assert.throws(() => f.service.begin(f.owner, unregistered), errorCode("CANCELLED"))
    f.service.begin("window-b", unregistered)
    f.service.assertActive("window-b", unregistered)
    f.service.assertActive(f.owner, f.session)
  } finally { await f.close() }
})

test("AVATAR-15: a rejected replacement file preserves the last valid preview draft for profile save", async () => {
  const f = await fixture()
  try {
    const first = await f.service.stageSelected(f.owner, f.session, await input(f, await pixelImage(16, 8).png().toBuffer()))
    await assert.rejects(f.service.stageSelected(f.owner, f.session, await input(f, Buffer.from("not a decodable image"), "broken.png")), errorCode("INVALID_IMAGE"))
    const saved = await f.service.persistDraft(f.owner, f.session, first.draftId)
    assert.deepEqual(await f.service.readAsset(saved.assetId), previewBytes(first))
    const next = await f.service.stageSelected(f.owner, f.session, await input(f, await pixelImage(8, 16).png().toBuffer(), "replacement.png"))
    await assert.rejects(f.service.persistDraft(f.owner, f.session, first.draftId), errorCode("DRAFT_UNAVAILABLE"))
    assert.deepEqual(await f.service.readAsset((await f.service.persistDraft(f.owner, f.session, next.draftId)).assetId), previewBytes(next))
  } finally { await f.close() }
})
test("AVATAR-16: an old pending save cannot publish or retire a newly selected valid draft", async () => {
  const gate = Promise.withResolvers<void>(); const entered = Promise.withResolvers<void>(); let writes = 0
  const f = await fixture({ beforeRename: async () => { if (++writes === 1) { entered.resolve(); await gate.promise } } })
  try {
    const first = await f.service.stageSelected(f.owner, f.session, await input(f, await pixelImage(16, 8).png().toBuffer()))
    const old = f.service.persistDraft(f.owner, f.session, first.draftId)
    const rejected = assert.rejects(old, errorCode("DRAFT_UNAVAILABLE")); void rejected.catch(() => undefined)
    await entered.promise
    const next = await f.service.stageSelected(f.owner, f.session, await input(f, await pixelImage(8, 16).png().toBuffer(), "new.png"))
    gate.resolve(); await rejected
    assert.throws(() => f.service.assertActive(f.owner, f.session, first.draftId), errorCode("DRAFT_UNAVAILABLE"))
    f.service.cancel(f.owner, f.session, first.draftId)
    f.service.assertActive(f.owner, f.session, next.draftId)
    const persisted = await f.service.persistDraft(f.owner, f.session, next.draftId)
    assert.deepEqual(await f.service.readAsset(persisted.assetId), previewBytes(next))
    assert.deepEqual(await readdir(join(f.root, "assets", "global")), [`${persisted.assetId}.png`])
  } finally { gate.resolve(); await tick(); await f.close() }
})
test("AVATAR-17: picker click order governs selection even when the older native picker returns last", async () => {
  const f = await fixture()
  try {
    const older = f.service.beginSelection(f.owner, f.session)
    const newer = f.service.beginSelection(f.owner, f.session)
    const newest = await f.service.stageSelected(f.owner, f.session, await input(f, await pixelImage(8, 16).png().toBuffer(), "newer.png"), newer)
    await assert.rejects(f.service.stageSelected(f.owner, f.session, await input(f, await pixelImage(16, 8).png().toBuffer(), "older.png"), older), errorCode("STALE_SELECTION"))
    const saved = await f.service.persistDraft(f.owner, f.session, newest.draftId)
    assert.deepEqual(await f.service.readAsset(saved.assetId), previewBytes(newest))
  } finally { await f.close() }
})
test("AVATAR-18: starting a subsequently cancelled picker discards an older late read and retains the prior valid draft", async () => {
  const bytes = await pixelImage(16, 8).png().toBuffer(); const gate = Promise.withResolvers<Buffer>(); const entered = Promise.withResolvers<void>()
  const f = await fixture({ readSelectedFile: async path => { if (path.endsWith("late")) { entered.resolve(); return gate.promise } return bytes } })
  try {
    const original = await f.service.stageSelected(f.owner, f.session, join(f.base, "original"))
    const older = f.service.beginSelection(f.owner, f.session)
    const pending = f.service.stageSelected(f.owner, f.session, join(f.base, "late"), older)
    const rejected = assert.rejects(pending, errorCode("STALE_SELECTION")); void rejected.catch(() => undefined)
    await entered.promise
    const cancelledPicker = f.service.beginSelection(f.owner, f.session)
    assert.ok(cancelledPicker > older)
    // Native picker cancellation has no selected path to stage. It must still
    // invalidate earlier reads while preserving the last decoded preview.
    await rejected; gate.resolve(bytes); await tick()
    f.service.assertActive(f.owner, f.session, original.draftId)
    const saved = await f.service.persistDraft(f.owner, f.session, original.draftId)
    assert.deepEqual(await f.service.readAsset(saved.assetId), previewBytes(original))
    assert.deepEqual(await readdir(join(f.root, "assets", "global")), [`${saved.assetId}.png`])
  } finally { gate.resolve(bytes); await tick(); await f.close() }
})
