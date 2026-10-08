import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, rm, readFile, writeFile, rename, cp, symlink } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { hostname } from "node:os"
import { DirectoryAuthority } from "../../desktop/main/directory-authority"
import { Workspaces } from "../../desktop/service/workspaces"
import { prisma } from "../../src/lib/db"
import { createNovelOnce } from "../../src/lib/services/novel-create"
import { loadMigrations, type Migration } from "../../desktop/service/database/migrations"
const grants = new DirectoryAuthority()
async function selected(path: string) { const grant = await grants.issue(path, "create-work", "test-frame"); return grants.consume(grant.id, "create-work", "test-frame") }
const migrations = join(process.cwd(), "prisma/migrations")
test("DESK-D01/D04: explicit work directories hold independent original schema data and survive reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-workspaces-"))
  let works = new Workspaces(join(root, "app"), migrations)
  try {
    await works.initialize(); await mkdir(join(root, "甲")); await mkdir(join(root, "乙"))
    const a = await works.create(await selected(join(root, "甲")), { title: "甲", requestId: "request-one" })
    const b = await works.create(await selected(join(root, "乙")), { title: "乙", requestId: "request-two" })
    const titles = await Promise.all([a,b].map(work => works.run(work.id, async () => (await prisma.novel.findMany()).map(novel => novel.title))))
    assert.deepEqual(titles, [["甲"], ["乙"]])
    assert.equal(JSON.parse(await readFile(join(a.path, "xaanink-work.json"), "utf8")).novelId, a.novelId)
    await works.run(a.id, async () => {
      await assert.rejects(createNovelOnce("local-author", { title: "不允许隐式建书", requestId: "unselected-directory" }), { code: "DIRECTORY_REQUIRED" })
    })
    await works.close(); works = new Workspaces(join(root, "app"), migrations); await works.initialize()
    assert.equal((await works.list()).length, 2)
    assert.equal(await works.run(a.id, () => prisma.novel.count()), 1)
    assert.equal((await works.open(await selected(a.path))).id, a.id)
    const firstClose = works.close(); const secondClose = works.close()
    assert.equal(firstClose, secondClose)
    await assert.rejects(works.run(a.id, () => prisma.novel.count()), /正在关闭/)
    await firstClose
    await works.close(); await cp(a.path, join(root, "copy"), { recursive: true })
    await assert.rejects(works.open(await selected(join(root, "copy"))), /重复|重新关联/)
    await rename(a.path, join(root, "moved-original")); await mkdir(a.path)
    await assert.rejects(works.create(await selected(a.path), { title: "甲", requestId: "request-one" }), /变化/)
    await assert.rejects(readFile(join(a.path, "xaanink-work.json")), { code: "ENOENT" })
  } finally { await works.close(); await rm(root, { recursive: true, force: true }) }
})
test("DESK-D02/D03: refuse nonempty creation and missing/mismatched work data without creating an empty database", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-workspaces-"))
  const works = new Workspaces(join(root, "app"), migrations)
  try {
    await works.initialize(); const directory = join(root, "chosen"); await mkdir(directory); await writeFile(join(directory, "author.txt"), "用户文件")
    await assert.rejects(works.create(await selected(directory), { title: "不能覆盖", requestId: "nonempty" }), /空目录/)
    assert.equal(await readFile(join(directory, "author.txt"), "utf8"), "用户文件")
    await rm(join(directory, "author.txt")); const work = await works.create(await selected(directory), { title: "原作品", requestId: "created-work" }); await works.close()
    await rename(join(directory, "database"), join(directory, "previous-db"))
    await assert.rejects(works.open(await selected(directory)), /数据库|缺失/)
    await assert.rejects(readFile(join(directory, "database", "PG_VERSION")), { code: "ENOENT" })
    assert.equal(work.path.endsWith("chosen"), true)
  } finally { await works.close(); await rm(root, { recursive: true, force: true }) }
})

 test("IPC-02: worker retains the chosen directory identity after grant consumption", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-workspace-proof-")); const works = new Workspaces(join(root, "app"), migrations)
  try {
    await works.initialize(); const path = join(root, "selected"); const other = join(root, "other")
    await mkdir(path); await mkdir(other); const proof = await selected(path)
    await rename(path, join(root, "old")); await symlink(other, path, "dir")
    await assert.rejects(works.create(proof, { title: "不应写入", requestId: "swapped-path" }), /变化|授权/)
    await assert.rejects(readFile(join(other, "xaanink-work.json")), { code: "ENOENT" })
  } finally { await works.close(); await rm(root, { recursive: true, force: true }) }
})

test("DESK-D03: missing migration resources never poison first-run initialization", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-workspace-init-"))
  const broken = new Workspaces(join(root, "app"), join(root, "missing-migrations"))
  const valid = new Workspaces(join(root, "app"), migrations)
  try {
    await assert.rejects(broken.initialize()); await valid.initialize()
    assert.equal(await valid.run("inbox", () => prisma.user.count()), 1)
    await valid.close(); await rm(join(root, "app", "inbox", "database"), { recursive: true })
    await assert.rejects(valid.run("inbox", () => prisma.user.count()), /缺失|重建/)
  } finally { await broken.close(); await valid.close(); await rm(root, { recursive: true, force: true }) }
})

test("DESK-D03: failed first migration can resume the same work creation without overwriting unrelated files", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-workspace-retry-"))
  let works: Workspaces | undefined
  try {
    const broken = join(root, "migrations"); await mkdir(join(broken, "001"), { recursive: true }); await writeFile(join(broken, "001", "migration.sql"), "INVALID SQL")
    works = new Workspaces(join(root, "app"), migrations); await works.initialize()
    // The reservation repository now needs a real ready inbox before it can
    // reserve a target. Keep that connection open and inject invalid SQL only
    // for the new work's actual first database migration.
    assert.equal(await works.run("inbox", () => prisma.user.count()),1)
    ;(works as unknown as {migrations:Migration[]}).migrations=await loadMigrations(broken)
    const directory = join(root, "selected"); await mkdir(directory)
    const input = { title: "重试作品", requestId: "retry-work-request" }
    await assert.rejects(works.create(await selected(directory), input), /syntax error/)
    const before = JSON.parse(await readFile(join(directory, "xaanink-work.json"), "utf8"))
    assert.equal(before.phase,"creating")
    await writeFile(join(directory, "author.txt"), "保留我")
    await works.close(); works = new Workspaces(join(root, "app"), migrations); await works.initialize()
    const work = await works.create(await selected(directory), input)
    assert.equal(work.id, before.id); assert.equal(await works.run(work.id, () => prisma.novel.count()), 1)
    assert.equal(await readFile(join(directory, "author.txt"), "utf8"), "保留我")
  } finally { await works?.close(); await rm(root, { recursive: true, force: true }) }
})

test("DESK-D03: ordinary opens never steal stale directory leases", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-workspace-lock-")); const works = new Workspaces(join(root, "app"), migrations)
  try {
    await works.initialize(); const directory = join(root, "selected"); await mkdir(directory)
    const work = await works.create(await selected(directory), { title: "原作品", requestId: "stale-work-request" })
    await mkdir(join(directory, ".xaanink-lock")); const owner = JSON.stringify({ token: "previous-token", host: hostname(), pid: 2147483647 })
    await writeFile(join(directory, ".xaanink-lock", "owner.json"), owner)
    await assert.rejects(works.run(work.id, () => prisma.novel.count()), /锁需要恢复/)
    assert.equal(await readFile(join(directory, ".xaanink-lock", "owner.json"), "utf8"), owner)
  } finally { await works.close(); await rm(root, { recursive: true, force: true }) }
})

test("DESK-D03: owned unready inbox resumes initialization after a migration error", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-inbox-retry-")); let works: Workspaces | undefined
  try {
    const broken = join(root, "migrations"); await mkdir(join(broken, "001"), { recursive: true }); await writeFile(join(broken, "001", "migration.sql"), "INVALID SQL")
    works = new Workspaces(join(root, "app"), broken); await works.initialize()
    await assert.rejects(works.run("inbox", () => prisma.user.count())); await works.close()
    works = new Workspaces(join(root, "app"), migrations); await works.initialize()
    assert.equal(await works.run("inbox", () => prisma.user.count()), 1)
    assert.equal(JSON.parse(await readFile(join(root, "app", "xaanink-app.json"), "utf8")).inboxReady, true)
  } finally { await works?.close(); await rm(root, { recursive: true, force: true }) }
})

test("DESK-D04: failed LRU retirement retains the real engine and lease for a later close retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-lru-retry-")); const works = new Workspaces(join(root, "app"), migrations)
  try {
    await works.initialize(); const records = []
    for (let index = 0; index < 4; index++) {
      const directory = join(root, `work-${index}`); await mkdir(directory)
      records.push(await works.create(await selected(directory), { title: `作品${index}`, requestId: `lru-create-${index}` }))
    }
    for (const record of records) await works.run(record.id, () => prisma.novel.count())
    const internals = works as unknown as { slots: Map<string, { connection: Promise<{ engine: { close(): Promise<void> } }> }> }
    const { engine } = await internals.slots.get(records[0].id)!.connection
    const close = engine.close.bind(engine); let failed = false
    engine.close = async () => { if (!failed) { failed = true; throw new Error("fixture close failure") }; await close() }
    await assert.rejects(works.run("inbox", () => prisma.user.count()), /fixture close failure/)
    await assert.rejects(works.run(records[0].id, () => prisma.novel.count()), /关闭未完成/)
    await works.close()
    await assert.rejects(readFile(join(records[0].path, ".xaanink-lock", "owner.json")), { code: "ENOENT" })
    assert.equal(await works.run(records[0].id, () => prisma.novel.count()), 1)
  } finally { await works.close(); await rm(root, { recursive: true, force: true }) }
})

test("DESK-D04: detached original chat executions retain both work and global databases until their real finally", async () => {
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-detached-")); const works = new Workspaces(join(root, "app"), migrations)
  let release: (() => void) | undefined
  try {
    await works.initialize(); const directory = join(root, "work"); await mkdir(directory)
    const work = await works.create(await selected(directory), { title: "后台创作", requestId: "retained-original-chat" })
    const { registerAttemptAbort } = await import("../../src/lib/local-chat-cancellation")
    const { globalPrisma } = await import("../../src/lib/db")
    const resume = Promise.withResolvers<void>(); let result: Promise<unknown> | undefined
    await works.runWithGlobal(work.id, async () => {
      release = registerAttemptAbort("retainer-fixture", new AbortController())
      result = resume.promise.then(async () => {
        assert.equal(await prisma.novel.count(), 1)
        assert.equal(await globalPrisma.user.count(), 1)
      })
    })
    await assert.rejects(works.close(), /任务运行/)
    resume.resolve(); await result
    release!(); release!(); release = undefined
    await works.close()
  } finally { release?.(); await works.close(); await rm(root, { recursive: true, force: true }) }
})
