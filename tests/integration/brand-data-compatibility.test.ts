import assert from "node:assert/strict"
import { test } from "node:test"
import { createHash, randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, rename, rm, cp, lstat } from "node:fs/promises"
import { tmpdir, hostname } from "node:os"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { PrismaClient } from "../../src/generated/prisma/client"
import { prisma } from "../../src/lib/db"
import { LocalPGliteAdapter } from "../../desktop/service/database/pglite-adapter"
import { loadMigrations, migrateDatabase } from "../../desktop/service/database/migrations"
import { DirectoryAuthority } from "../../desktop/main/directory-authority"
import { Workspaces } from "../../desktop/service/workspaces"
import { workspaceStorage } from "../../desktop/service/workspace-storage"
import { DataRootManager, RootMigrationCrash } from "../../desktop/core/data-root"
import { directoryIdentity } from "../../desktop/core/root-ownership"
import { collectClosedRootFiles } from "../../desktop/main/owned-root-files"
import { WorkLeaseRecovery } from "../../desktop/core/work-lease-recovery"
import { workNames } from "../../desktop/core/brand-names"
import { getDatabaseContext, retainDatabaseTask } from "../../desktop/service/context"

const migrations = join(process.cwd(), "prisma/migrations")
const grants = new DirectoryAuthority()
async function selected(path: string) {
  const grant = await grants.issue(path, "create-work", "brand-test-frame")
  return grants.consume(grant.id, "create-work", "brand-test-frame")
}
const families = [
  // This is a historical format fixture; do not replace its xuanxiang tokens.
  { family: "legacy", appMarker: "xuanxiang-app.json", app: "Xuanxiangxiezuo-Desktop", manifest: "xuanxiang-work.json", storage: "xuanxiang-storage.json", required: "xuanxiang-storage-required.json", lock: ".xuanxiang-lock", audit: ".xuanxiang-lease-recovery.json", restores: ".xuanxiang-restores", stage: ".xuanxiang-migration-", recovery: ".xuanxiang-root-recovery-" },
  { family: "current", appMarker: "xaanink-app.json", app: "XaanInk", manifest: "xaanink-work.json", storage: "xaanink-storage.json", required: "xaanink-storage-required.json", lock: ".xaanink-lock", audit: ".xaanink-lease-recovery.json", restores: ".xaanink-restores", stage: ".xaanink-migration-", recovery: ".xaanink-root-recovery-" },
] as const
async function exists(path: string) {
  try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error }
}
async function fixture(run: (base: string) => Promise<void>) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "xaanink-brand-data-")))
  try { await run(base) } finally { await rm(base, { recursive: true, force: true }) }
}
async function applicationRoot(path: string, names: typeof families[number], inboxReady = false) {
  await mkdir(join(path, "inbox"), { recursive: true })
  await writeFile(join(path, names.appMarker), JSON.stringify({ schemaVersion: 1, app: names.app, id: randomUUID(), phase: "ready", inboxReady }))
  await writeFile(join(path, "catalog.json"), JSON.stringify({ schemaVersion: 1, revision: 0, value: [] }))
}
function storageEnvelope(state: unknown) { return JSON.stringify({ state, sha256: createHash("sha256").update(JSON.stringify(state)).digest("hex") }) }

/** Independently build an existing legacy work. Its control protocol is literal
 * old-version data; it is never created by, or renamed from, the new Workspaces.
 */
async function legacyWork(path: string) {
  await mkdir(join(path, "assets"), { recursive: true })
  const engine = await PGlite.create({ dataDir: join(path, "database"), relaxedDurability: false })
  const db = new PrismaClient({ adapter: new LocalPGliteAdapter(engine) })
  let novelId: string
  try {
    await migrateDatabase(engine, await loadMigrations(migrations))
    await db.user.create({ data: { id: "local-author", name: "保留的作者", email: "brand-legacy@localhost.invalid", passwordHash: "" } })
    novelId = (await db.novel.create({ data: { userId: "local-author", title: "旧作品原始正文", theme: { create: { title: "旧作品原始正文", synopsis: "原有内容不可丢失", referenceCases: "", channel: "", genre: "", tags: [], sellingPoints: "", targetAudience: "" } } } })).id
  } finally { await db.$disconnect(); await engine.close() }
  const id = randomUUID(), manifest = { schemaVersion: 1, id, phase: "ready", novelId: novelId!, title: "旧作品原始正文", requestId: "legacy-brand-create", requestHash: "legacy-original-request-hash", createdAt: "2026-10-07T00:00:00.000Z" }
  const state = { schemaVersion: 1, workId: id, revision: 0, active: { kind: "original" }, previous: null }
  await writeFile(join(path, "xuanxiang-work.json"), JSON.stringify(manifest))
  await writeFile(join(path, "xuanxiang-storage.json"), storageEnvelope(state))
  await writeFile(join(path, "xuanxiang-storage-required.json"), JSON.stringify({ schemaVersion: 1, workId: id, required: true }))
  return manifest
}

test("BDC01 a real legacy database opens under the new app, saves, closes and reopens using the original manifest/storage/lease", { timeout: 60_000 }, async () => {
  await fixture(async base => {
    const app = join(base, "app"), path = join(base, "legacy-work"); await applicationRoot(app, families[1]); const original = await legacyWork(path)
    const preserved = await Promise.all(["xuanxiang-work.json", "xuanxiang-storage.json", "xuanxiang-storage-required.json"].map(name => readFile(join(path, name))))
    let works = new Workspaces(app, migrations)
    try {
      await works.initialize(); const work = await works.open(await selected(path)); assert.equal(work.id, original.id)
      await works.run(work.id, async () => {
        assert.equal(await exists(join(path, ".xuanxiang-lock", "owner.json")), true)
        assert.equal(await exists(join(path, ".xaanink-lock")), false)
        assert.equal((await prisma.theme.findUnique({ where: { novelId: work.novelId } }))!.synopsis, "原有内容不可丢失")
        await prisma.novel.update({ where: { id: work.novelId }, data: { title: "改名应用保存的新标题" } })
      })
      await works.close(); works = new Workspaces(app, migrations); await works.initialize()
      assert.equal((await works.open(await selected(path))).title, "改名应用保存的新标题")
      assert.equal(await works.run(work.id, () => prisma.novel.count()), 1)
      await works.close()
      assert.deepEqual(await Promise.all(["xuanxiang-work.json", "xuanxiang-storage.json", "xuanxiang-storage-required.json"].map(name => readFile(join(path, name)))), preserved)
      for (const name of ["xaanink-work.json", "xaanink-storage.json", "xaanink-storage-required.json", ".xaanink-lock", ".xuanxiang-lock"]) assert.equal(await exists(join(path, name)), false)
    } finally { await works.close() }
  })
})

for (const appNames of families) {
  test(`BDC02 new work inside a ${appNames.family} application catalog writes current names and retains real data through reopen`, { timeout: 60_000 }, async () => {
    await fixture(async base => {
      const app = join(base, "app"), path = join(base, "new-work"); await applicationRoot(app, appNames); await mkdir(path)
      let works = new Workspaces(app, migrations)
      try {
        await works.initialize(); const input = { title: "新作品", requestId: "brand-new-work-request" }
        const work = await works.create(await selected(path), input)
        assert.equal(JSON.parse(await readFile(join(path, "xaanink-work.json"), "utf8")).novelId, work.novelId)
        assert.equal(await exists(join(path, "xuanxiang-work.json")), false)
        assert.equal((await works.create(await selected(path), input)).id, work.id, "retry remains the same work and manifest")
        await works.close()
        await (await workspaceStorage(path)).initialize()
        assert.equal(JSON.parse(await readFile(join(path, "xaanink-storage-required.json"), "utf8")).workId, work.id)
        assert.equal(JSON.parse(await readFile(join(path, "xaanink-storage.json"), "utf8")).state.workId, work.id)
        assert.equal(await exists(join(path, "xuanxiang-storage.json")), false)
        works = new Workspaces(app, migrations); await works.initialize(); await works.open(await selected(path))
        await works.run(work.id, async () => {
          assert.equal(await exists(join(path, ".xaanink-lock", "owner.json")), true); assert.equal(await exists(join(path, ".xuanxiang-lock")), false)
          await prisma.novel.update({ where: { id: work.novelId }, data: { title: "新作品实际保存" } })
        })
        await works.close(); works = new Workspaces(app, migrations); await works.initialize()
        assert.equal((await works.open(await selected(path))).title, "新作品实际保存")
        assert.equal(await works.run(work.id, () => prisma.novel.count()), 1)
      } finally { await works.close() }
    })
  })
}

test("BDC03 legacy required pointer loss refuses to open or create a replacement control family", { timeout: 60_000 }, async () => {
  await fixture(async base => {
    const app = join(base, "app"), path = join(base, "legacy-work"); await applicationRoot(app, families[1]); await legacyWork(path)
    await rename(join(path, "xuanxiang-storage.json"), join(base, "retained-storage.json"))
    const before = (await readdir(path)).sort(), works = new Workspaces(app, migrations)
    try {
      await works.initialize(); await assert.rejects(works.open(await selected(path)), /缺失/)
      assert.deepEqual((await readdir(path)).sort(), before); assert.deepEqual(await works.list(), [])
      assert.equal(await exists(join(path, "xaanink-storage.json")), false)
      assert.equal(await exists(join(path, "xuanxiang-storage.json")), false)
    } finally { await works.close() }
  })
})

test("BDC04 an existing legacy candidate remains authoritative, including after a real write and reopen", { timeout: 60_000 }, async () => {
  await fixture(async base => {
    const app = join(base, "app"), path = join(base, "legacy-work"); await applicationRoot(app, families[1]); const manifest = await legacyWork(path)
    const candidateId = randomUUID(), candidate = join(path, ".xuanxiang-restores", candidateId); await mkdir(candidate, { recursive: true }); await cp(join(path, "database"), join(candidate, "database"), { recursive: true })
    let candidateEngine = await PGlite.create({ dataDir: join(candidate, "database"), relaxedDurability: false })
    try { await candidateEngine.query('UPDATE "Novel" SET title=$1 WHERE id=$2', ["原已恢复候选标题", manifest.novelId]) } finally { await candidateEngine.close() }
    const state = { schemaVersion: 1, workId: manifest.id, revision: 1, active: { kind: "candidate", id: candidateId, directory: await directoryIdentity(candidate) }, previous: null }
    await writeFile(join(path, "xuanxiang-storage.json"), storageEnvelope(state))
    let works = new Workspaces(app, migrations)
    try {
      await works.initialize(); const work = await works.open(await selected(path)); assert.equal(work.title, "原已恢复候选标题")
      await works.run(work.id, () => prisma.novel.update({ where: { id: work.novelId }, data: { title: "候选内新保存" } }))
      await works.close(); works = new Workspaces(app, migrations); await works.initialize()
      assert.equal((await works.open(await selected(path))).title, "候选内新保存"); await works.close()
      candidateEngine = await PGlite.create({ dataDir: join(path, "database"), relaxedDurability: false })
      try { assert.equal((await candidateEngine.query<{ title: string }>('SELECT title FROM "Novel" WHERE id=$1', [manifest.novelId])).rows[0].title, "旧作品原始正文") } finally { await candidateEngine.close() }
      assert.equal(await exists(join(path, ".xaanink-restores")), false)
    } finally { await works.close() }
  })
})

for (const names of families) {
  const other = families.find(value => value.family !== names.family)!
  test(`BDC05 ${names.family} work shares the live writer lease and refuses an opposite-family lease without deleting either`, { timeout: 60_000 }, async () => {
    await fixture(async base => {
      const app = join(base, "app"), path = join(base, "work"); await applicationRoot(app, families[1])
      let works = new Workspaces(app, migrations), rival = new Workspaces(app, migrations)
      try {
        await works.initialize(); let id: string
        if (names.family === "legacy") { id = (await legacyWork(path)).id; await works.open(await selected(path)) }
        else { await mkdir(path); id = (await works.create(await selected(path), { title: "锁保护作品", requestId: "brand-lease-work" })).id }
        await works.run(id, () => prisma.novel.count()); const ownerFile = join(path, names.lock, "owner.json"), owner = await readFile(ownerFile)
        await rival.initialize(); await assert.rejects(rival.open(await selected(path)), /进程|锁|打开/)
        assert.deepEqual(await readFile(ownerFile), owner); assert.equal(await exists(join(path, other.lock)), false)
        // Reusing an already open PGlite slot must revalidate controls before
        // the real write callback. A fresh-open check alone misses this state.
        const originalTitle = await works.run(id, async () => (await prisma.novel.findFirstOrThrow()).title)
        for (const control of [other.audit, other.storage]) {
          const bytes = Buffer.from("foreign-control-must-remain-unchanged"), controlPath = join(path, control)
          await writeFile(controlPath, bytes); let callbackEntered = false
          try {
            await assert.rejects(works.run(id, async () => {
              callbackEntered = true
              await prisma.novel.updateMany({ data: { title: "mixed-family-write-must-not-commit" } })
            }))
            assert.equal(callbackEntered, false, "the warmed connection cannot enter a write scope after its control family changes")
            assert.deepEqual(await readFile(controlPath), bytes)
            assert.deepEqual(await readFile(ownerFile), owner)
          } finally { await rm(controlPath, { force: true }) }
          assert.equal(await works.run(id, async () => (await prisma.novel.findFirstOrThrow()).title), originalTitle)
        }
        await rival.close(); await works.close()
        // The old owner names are intentionally retained for compatibility.
        for (const lock of [names.lock, other.lock]) {
          await mkdir(join(path, lock)); const bytes = JSON.stringify({ token: randomUUID(), pid: process.pid, host: "foreign-host.invalid" })
          await writeFile(join(path, lock, "owner.json"), bytes)
          works = new Workspaces(app, migrations); await works.initialize()
          await assert.rejects(works.open(await selected(path)))
          assert.equal(await readFile(join(path, lock, "owner.json"), "utf8"), bytes)
          assert.equal(await exists(join(path, lock === names.lock ? other.lock : names.lock)), false)
          await works.close(); await rm(join(path, lock), { recursive: true })
        }
        // Both real engines have acknowledged close. A genuinely exited child
        // supplies the stale owner; only an explicit confirmation may recover it.
        const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" }); await once(child, "exit")
        assert.ok(child.pid); assert.throws(() => process.kill(child.pid!, 0), { code: "ESRCH" })
        await mkdir(join(path, names.lock)); await writeFile(join(path, names.lock, "owner.json"), JSON.stringify({ token: randomUUID(), pid: child.pid, host: hostname() }))
        let confirmed: string | null = null
        const recovery = new WorkLeaseRecovery({ namesForWork: workNames, assertHost() {}, assertWorkClosed() {}, assertConfirmed(requestId) { assert.equal(requestId, confirmed) } })
        const preview = await recovery.prepare(await directoryIdentity(path))
        await assert.rejects(recovery.recover(preview.requestId)); confirmed = preview.requestId
        assert.equal((await recovery.recover(preview.requestId)).status, "recovered")
        const prefix = names.family === "legacy" ? "xuanxiang" : "xaanink"
        const audit = JSON.parse(await readFile(join(path, `.${prefix}-lease-recovery.json`), "utf8"))
        assert.equal(audit.payload.type, `${prefix}-work-lease-recovery`)
        assert.equal(await exists(join(path, names.lock)), false)
        assert.equal(await exists(join(path, names.family === "legacy" ? ".xaanink-lease-recovery.json" : ".xuanxiang-lease-recovery.json")), false)
      } finally { await rival.close(); await works.close() }
    })
  })

  test(`BDC06 ${names.family} root migration preserves real closed database content and its namespace`, { timeout: 60_000 }, async () => {
    await fixture(async base => {
      const root = join(base, "source"), target = join(base, "target"), boot = join(base, "boot"); await applicationRoot(root, names, true); await mkdir(target); await mkdir(boot)
      let engine: PGlite | undefined = await PGlite.create({ dataDir: join(root, "inbox", "database"), relaxedDurability: false })
      try {
        await engine.exec("CREATE TABLE brand_migration_proof(id integer PRIMARY KEY, body text); INSERT INTO brand_migration_proof VALUES(1,'原真实内容'); CHECKPOINT;")
        await engine.close(); engine = undefined
        const marker = await readFile(join(root, names.appMarker)), proof = await directoryIdentity(root), manager = new DataRootManager(boot, root)
        await manager.adopt(proof)
        const closed = () => { assert.equal(engine, undefined, "inventory/migration never runs with a real engine open") }, inventory = await collectClosedRootFiles(proof, closed)
        assert.equal(inventory.files.includes(names.appMarker), true)
        const result = await manager.migrate(await directoryIdentity(target), { quiesce: async () => ({ source: proof, ownedFiles: inventory.files, ownedDirectories: inventory.directories, preserved: inventory.preserved, assertClosed: closed, release() {} }) })
        assert.equal(result.status, "complete"); assert.equal(result.root.root.path, target)
        assert.deepEqual(await readFile(join(target, names.appMarker)), marker); assert.equal(await exists(join(target, other.appMarker)), false)
        const journal = JSON.parse(await readFile(join(boot, "root-migration.json"), "utf8"))
        assert.equal(journal.journal.stage, names.stage + result.migrationId)
        if (journal.journal.recovery) assert.equal(journal.journal.recovery.path, names.recovery + result.migrationId + ".json")
        assert.deepEqual(DataRootManager.parseMigrationSnapshot(journal), journal)
        engine = await PGlite.create({ dataDir: join(target, "inbox", "database"), relaxedDurability: false })
        assert.deepEqual((await engine.query("SELECT * FROM brand_migration_proof")).rows, [{ id: 1, body: "原真实内容" }])
        await engine.exec("INSERT INTO brand_migration_proof VALUES(2,'迁移后保存');"); await engine.close(); engine = undefined
        engine = await PGlite.create({ dataDir: join(target, "inbox", "database"), relaxedDurability: false })
        assert.equal((await engine.query<{ n: number }>("SELECT count(*)::int AS n FROM brand_migration_proof")).rows[0].n, 2)
      } finally { await engine?.close() }
    })
  })

  test(`BDC07 ${names.family} committed migration recovery keeps original journal prefix/checksum semantics`, { timeout: 60_000 }, async () => {
    await fixture(async base => {
      const root = join(base, "source"), target = join(base, "target"), boot = join(base, "boot"); await applicationRoot(root, names, true); await mkdir(target); await mkdir(boot)
      let engine: PGlite | undefined = await PGlite.create({ dataDir: join(root, "inbox", "database"), relaxedDurability: false })
      try {
        await engine.exec("CREATE TABLE brand_recovery_proof(body text); INSERT INTO brand_recovery_proof VALUES('迁移中断前的正文'); CHECKPOINT;")
        await engine.close(); engine = undefined
        const proof = await directoryIdentity(root), closed = () => { assert.equal(engine, undefined) }, inventory = await collectClosedRootFiles(proof, closed)
        const host = { quiesce: async () => ({ source: proof, ownedFiles: inventory.files, ownedDirectories: inventory.directories, preserved: inventory.preserved, assertClosed: closed, release() {} }) }
        const manager = new DataRootManager(boot, root, { hook(phase) { if (phase === "pointer-written") throw new RootMigrationCrash("isolated brand fixture crash") } })
        await manager.adopt(proof); await assert.rejects(manager.migrate(await directoryIdentity(target), host), RootMigrationCrash)
        const before = JSON.parse(await readFile(join(boot, "root-migration.json"), "utf8"))
        assert.equal(before.journal.stage, names.stage + before.journal.migrationId); assert.deepEqual(DataRootManager.parseMigrationSnapshot(before), before)
        const recovered = await new DataRootManager(boot, root).recover(host); assert.equal(recovered!.status, "complete")
        const after = JSON.parse(await readFile(join(boot, "root-migration.json"), "utf8"))
        assert.equal(after.journal.stage, before.journal.stage); assert.equal(after.journal.migrationId, before.journal.migrationId)
        assert.deepEqual(after.journal.files, before.journal.files, "recovery retains the original receipted copy proofs")
        assert.deepEqual(DataRootManager.parseMigrationSnapshot(after), after)
        engine = await PGlite.create({ dataDir: join(target, "inbox", "database"), relaxedDurability: false })
        assert.deepEqual((await engine.query("SELECT body FROM brand_recovery_proof")).rows, [{ body: "迁移中断前的正文" }])
      } finally { await engine?.close() }
    })
  })
}

test("BDC09 a query waiting behind a real PGlite transaction revalidates authority after acquiring the engine queue", { timeout: 60_000 }, async () => {
  await fixture(async base => {
    const path=join(base,"queued-work");await mkdir(path)
    await writeFile(join(path,"xaanink-work.json"),JSON.stringify({schemaVersion:1,id:randomUUID(),phase:"ready",novelId:randomUUID(),title:"队列原值",requestId:"queue-work",requestHash:"queue-original",createdAt:new Date().toISOString()}))
    const engine=await PGlite.create({dataDir:join(path,"database"),relaxedDurability:false})
    let adapter:Awaited<ReturnType<LocalPGliteAdapter["connect"]>>|undefined,transaction:Awaited<ReturnType<NonNullable<typeof adapter>["startTransaction"]>>|undefined,queued:Promise<unknown>|undefined
    const attempted=Promise.withResolvers<void>();let notify=false
    try{
      await engine.exec("CREATE TABLE queue_guard(value TEXT NOT NULL); INSERT INTO queue_guard VALUES ('original')")
      const brand=await (await import("../../desktop/core/brand-names")).readWorkBrand(await directoryIdentity(path))
      adapter=await new LocalPGliteAdapter(engine,async()=>{brand.assertCurrent();if(notify)attempted.resolve()}).connect()
      transaction=await adapter.startTransaction()
      await transaction.executeRaw({sql:"UPDATE queue_guard SET value='transaction-uncommitted'",args:[],argTypes:[]})
      notify=true;queued=adapter.executeRaw({sql:"UPDATE queue_guard SET value='queued-write-must-not-commit'",args:[],argTypes:[]});void queued.catch(()=>{})
      await attempted.promise
      const control=join(path,".xuanxiang-lease-recovery.json"),bytes=Buffer.from("foreign-control-after-root-query-guard")
      await writeFile(control,bytes);await transaction.rollback();transaction=undefined
      await assert.rejects(queued);assert.deepEqual(await readFile(control),bytes)
      await rm(control)
      assert.equal((await engine.query<{value:string}>("SELECT value FROM queue_guard")).rows[0].value,"original")
    }finally{await transaction?.rollback();await queued?.catch(()=>{});await adapter?.dispose();await engine.close()}
  })
})

for (const names of families) {
  const other = families.find(value => value.family !== names.family)!
  test(`BDC08 ${names.family} retained database task rejects a later write after control family changes`, { timeout: 60_000 }, async () => {
    await fixture(async base => {
      const app = join(base, "app"), path = join(base, "work"); await applicationRoot(app, families[1])
      const works = new Workspaces(app, migrations), signal = Promise.withResolvers<void>()
      let task: Promise<unknown> | undefined
      try {
        await works.initialize(); let id: string
        if (names.family === "legacy") { id = (await legacyWork(path)).id; await works.open(await selected(path)) }
        else { await mkdir(path); id = (await works.create(await selected(path), { title: "保留任务原始标题", requestId: "brand-retained-work" })).id }
        const originalTitle = await works.run(id, async () => (await prisma.novel.findFirstOrThrow()).title)
        await works.run(id, async () => {
          const release = retainDatabaseTask(), { database } = getDatabaseContext()
          task = (async () => { await signal.promise; return database.novel.updateMany({ data: { title: "retained-mixed-write-must-not-commit" } }) })().finally(release)
          void task.catch(() => {})
        })
        const control = join(path, other.audit), bytes = Buffer.from("retained-task-foreign-audit")
        await writeFile(control, bytes)
        try { signal.resolve(); await assert.rejects(task!); assert.deepEqual(await readFile(control), bytes) }
        finally { await rm(control, { force: true }) }
        assert.equal(await works.run(id, async () => (await prisma.novel.findFirstOrThrow()).title), originalTitle)
        // A final authority failure must roll back statements already issued
        // inside the transaction and release its engine queue for later reads.
        try {
          await assert.rejects(works.run(id, () => prisma.$transaction(async tx => {
            await tx.novel.updateMany({ data: { title: "transaction-mixed-write-must-rollback" } })
            await writeFile(control, bytes)
          })))
          assert.deepEqual(await readFile(control), bytes)
        } finally { await rm(control, { force: true }) }
        assert.equal(await works.run(id, async () => (await prisma.novel.findFirstOrThrow()).title), originalTitle)
        assert.equal(await works.run(id, () => prisma.$transaction(tx => tx.novel.count())), 1)
      } finally { signal.resolve(); await task?.catch(() => {}); await works.close() }
    })
  })
}
