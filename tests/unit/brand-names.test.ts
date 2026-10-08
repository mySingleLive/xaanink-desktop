import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, rename, rm, symlink, link, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LEGACY_NAMES, CURRENT_NAMES } from "../../desktop/shared/brand-names"
import { readApplicationBrand, readApplicationBrandImmediately, readWorkBrand, readWorkBrandImmediately } from "../../desktop/core/brand-names"
import { directoryIdentity, allowedManagedFile, allowedManagedDirectory } from "../../desktop/core/root-ownership"

// Compatibility fixtures deliberately retain the original literal names.
const families = [
  { family: "legacy", appMarker: "xuanxiang-app.json", appIdentity: "Xuanxiangxiezuo-Desktop", workManifest: "xuanxiang-work.json", storage: "xuanxiang-storage.json", storageRequired: "xuanxiang-storage-required.json", lock: ".xuanxiang-lock", audit: ".xuanxiang-lease-recovery.json", auditType: "xuanxiang-work-lease-recovery", leaseTemporaryPrefix: ".xuanxiang-lease-recovery-", restores: ".xuanxiang-restores", preserved: ".xuanxiang-preserved", migrationStagePrefix: ".xuanxiang-migration-", rootRecoveryPrefix: ".xuanxiang-root-recovery-" },
  { family: "current", appMarker: "xaanink-app.json", appIdentity: "XaanInk", workManifest: "xaanink-work.json", storage: "xaanink-storage.json", storageRequired: "xaanink-storage-required.json", lock: ".xaanink-lock", audit: ".xaanink-lease-recovery.json", auditType: "xaanink-work-lease-recovery", leaseTemporaryPrefix: ".xaanink-lease-recovery-", restores: ".xaanink-restores", preserved: ".xaanink-preserved", migrationStagePrefix: ".xaanink-migration-", rootRecoveryPrefix: ".xaanink-root-recovery-" },
] as const
function appMarker(app: string) { return { schemaVersion: 1, app, id: randomUUID(), phase: "ready", inboxReady: true } }
function workManifest() { return { schemaVersion: 1, id: randomUUID(), phase: "ready", novelId: "fixture-novel", title: "作者保留的作品", requestId: "brand-fixture-request", requestHash: "fixture-hash", createdAt: "2026-10-08T00:00:00.000Z" } }
async function fixture(run: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "xaanink-brand-names-")))
  try { await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test("BRN01 names expose exact current and compatibility protocols without mutable global family state", () => {
  assert.deepEqual(LEGACY_NAMES, families[0]); assert.deepEqual(CURRENT_NAMES, families[1])
  assert.equal(Object.isFrozen(LEGACY_NAMES), true); assert.equal(Object.isFrozen(CURRENT_NAMES), true)
})

for (const names of families) {
  const other = families.find(value => value.family !== names.family)!
  test(`BRN02 ${names.family} app/work readers preserve values and synchronously seal the original file identity`, async () => {
    await fixture(async root => {
      const app = join(root, "app"), work = join(root, "work"); await mkdir(app); await mkdir(work)
      const marker = appMarker(names.appIdentity), manifest = workManifest()
      const appBytes = JSON.stringify(marker), workBytes = JSON.stringify(manifest)
      await writeFile(join(app, names.appMarker), appBytes); await writeFile(join(work, names.workManifest), workBytes)
      const appRoot = await directoryIdentity(app), workRoot = await directoryIdentity(work)
      for (const observed of [await readApplicationBrand(appRoot), readApplicationBrandImmediately(appRoot)]) {
        assert.equal(observed.names.family, names.family); assert.equal(observed.filename, names.appMarker); assert.deepEqual(observed.value, marker)
        assert.equal(observed.assertCurrent(), undefined)
      }
      for (const observed of [await readWorkBrand(workRoot), readWorkBrandImmediately(workRoot)]) {
        assert.equal(observed.names.family, names.family); assert.equal(observed.filename, names.workManifest); assert.deepEqual(observed.value, manifest)
        assert.equal(observed.assertCurrent(), undefined)
      }
      assert.equal(await readFile(join(app, names.appMarker), "utf8"), appBytes)
      assert.equal(await readFile(join(work, names.workManifest), "utf8"), workBytes)
      assert.deepEqual(await readdir(app), [names.appMarker]); assert.deepEqual(await readdir(work), [names.workManifest])
    })
  })

  test(`BRN03 ${names.family} rejects wrong app value, damaged metadata, and duplicate markers without rewriting`, async () => {
    await fixture(async root => {
      const proof = await directoryIdentity(root)
      for (const bytes of [JSON.stringify(appMarker(other.appIdentity)), "{damaged", JSON.stringify({ ...appMarker(names.appIdentity), schemaVersion: 2 })]) {
        await writeFile(join(root, names.appMarker), bytes)
        await assert.rejects(readApplicationBrand(proof)); assert.throws(() => readApplicationBrandImmediately(proof))
        assert.equal(await readFile(join(root, names.appMarker), "utf8"), bytes)
      }
      await writeFile(join(root, names.appMarker), JSON.stringify(appMarker(names.appIdentity)))
      await writeFile(join(root, other.appMarker), JSON.stringify(appMarker(other.appIdentity)))
      await assert.rejects(readApplicationBrand(proof)); assert.throws(() => readApplicationBrandImmediately(proof))
      await rm(join(root, names.appMarker)); await rm(join(root, other.appMarker))
      for (const invalid of ["{damaged", JSON.stringify({ ...workManifest(), schemaVersion: 2 }), JSON.stringify({ ...workManifest(), phase: "unknown" }), JSON.stringify({ ...workManifest(), id: "not-a-uuid" }), JSON.stringify({ ...workManifest(), novelId: 123 }), JSON.stringify({ ...workManifest(), unexpected: "not-authorized" })]) {
        await writeFile(join(root, names.workManifest), invalid)
        await assert.rejects(readWorkBrand(proof)); assert.throws(() => readWorkBrandImmediately(proof))
        assert.equal(await readFile(join(root, names.workManifest), "utf8"), invalid)
        assert.equal(await readdir(root).then(values => values.length), 1)
      }
      const bytes = JSON.stringify(workManifest())
      await writeFile(join(root, names.workManifest), bytes); await writeFile(join(root, other.workManifest), bytes)
      await assert.rejects(readWorkBrand(proof)); assert.throws(() => readWorkBrandImmediately(proof))
      assert.equal(await readFile(join(root, names.workManifest), "utf8"), bytes)
      assert.equal(await readFile(join(root, other.workManifest), "utf8"), bytes)
    })
  })

  test(`BRN04 ${names.family} rejects controls from the other family before choosing a second lease or storage pointer`, async () => {
    await fixture(async root => {
      const manifest = workManifest(), proof = await directoryIdentity(root)
      await writeFile(join(root, names.workManifest), JSON.stringify(manifest))
      for (const filename of [other.storage, other.storageRequired, other.audit, other.lock, other.restores,`${other.leaseTemporaryPrefix}${randomUUID()}.tmp`].flatMap(name=>[name,name.toUpperCase()])) {
        if (filename.toLowerCase() === other.lock || filename.toLowerCase() === other.restores) await mkdir(join(root, filename))
        else await writeFile(join(root, filename), JSON.stringify({ schemaVersion: 1, workId: manifest.id, required: true }))
        const entries = (await readdir(root)).sort()
        await assert.rejects(readWorkBrand(proof)); assert.throws(() => readWorkBrandImmediately(proof))
        assert.deepEqual((await readdir(root)).sort(), entries)
        await rm(join(root, filename), { recursive: true })
      }
    })
  })

  test(`BRN05 ${names.family} app/work reject links, cached identity replacement, competing markers and same-inode content changes`, async () => {
    await fixture(async root => {
      for (const kind of ["work", "application"] as const) {
        const filename = kind === "work" ? names.workManifest : names.appMarker, competing = kind === "work" ? other.workManifest : other.appMarker
        const read = kind === "work" ? readWorkBrand : readApplicationBrand, readImmediately = kind === "work" ? readWorkBrandImmediately : readApplicationBrandImmediately
        const value = kind === "work" ? workManifest() : appMarker(names.appIdentity)
        const path = join(root, kind), outside = join(root, kind + "-outside.json"); await mkdir(path)
        const bytes = JSON.stringify(value); await writeFile(outside, bytes)
        const proof = await directoryIdentity(path), marker = join(path, filename)
        for (const attach of [symlink, link]) {
          await attach(outside, marker)
          await assert.rejects(read(proof)); assert.throws(() => readImmediately(proof))
          await unlink(marker)
        }
        await writeFile(marker, bytes)
        const observed = await read(proof), synchronous = readImmediately(proof)
        await rename(marker, marker + ".retained"); await writeFile(marker, bytes)
        assert.throws(() => observed.assertCurrent()); assert.throws(() => synchronous.assertCurrent())
        const originalInode = await read(proof), originalInodeSync = readImmediately(proof)
        await writeFile(marker, JSON.stringify({ ...value, id: randomUUID() }))
        assert.throws(() => originalInode.assertCurrent(), "same-inode valid content mutation invalidates the proof")
        assert.throws(() => originalInodeSync.assertCurrent())
        await writeFile(marker, bytes)
        const fresh = await read(proof), freshSync = readImmediately(proof)
        await writeFile(join(path, competing), kind === "work" ? bytes : JSON.stringify(appMarker(other.appIdentity)))
        assert.throws(() => fresh.assertCurrent(), "adding the competing marker invalidates the proof")
        assert.throws(() => freshSync.assertCurrent())
        await rename(path, path + ".retained"); await mkdir(path); await writeFile(join(path, filename), bytes)
        await assert.rejects(read(proof)); assert.throws(() => readImmediately(proof))
        assert.equal(await readFile(outside, "utf8"), bytes)
      }
    })
  })

  test(`BRN06 ${names.family} recovery UUID classification avoids prefix-length assumptions and excludes nested work controls`, () => {
    assert.equal(allowedManagedFile(`${names.rootRecoveryPrefix}${randomUUID()}.json`), true)
    assert.equal(allowedManagedFile(`${names.rootRecoveryPrefix}not-a-uuid.json`), false)
    assert.equal(allowedManagedFile(names.appMarker), true)
    assert.equal(allowedManagedFile(`inbox/database/${names.workManifest}`), false)
    assert.equal(allowedManagedDirectory(`session/${names.lock}`), false)
  })
}

test("BRN07 absence never initializes a marker or guesses a family", async () => {
  await fixture(async root => {
    const proof = await directoryIdentity(root)
    await assert.rejects(readApplicationBrand(proof)); assert.throws(() => readApplicationBrandImmediately(proof))
    await assert.rejects(readWorkBrand(proof)); assert.throws(() => readWorkBrandImmediately(proof))
    assert.deepEqual(await readdir(root), [])
  })
})
