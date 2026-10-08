import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { LocalPGliteAdapter } from "../../desktop/service/database/pglite-adapter"
import { PrismaClient } from "../generated/adapter/client"

const schema = `
CREATE TYPE "ProbeState" AS ENUM ('DRAFT','FINAL');
CREATE TABLE "Probe" (id TEXT PRIMARY KEY, label TEXT UNIQUE NOT NULL,
 tags TEXT[] NOT NULL, state "ProbeState" NOT NULL DEFAULT 'DRAFT', payload JSONB NOT NULL,
 optional JSONB, "happenedAt" TIMESTAMP(3) NOT NULL, large BIGINT NOT NULL, precise DECIMAL(30,8) NOT NULL);
CREATE TABLE "ProbeChild" (id TEXT PRIMARY KEY, "parentId" TEXT NOT NULL REFERENCES "Probe"(id));
CREATE TABLE deferred_parent (id INTEGER PRIMARY KEY);
CREATE TABLE deferred_child (id INTEGER REFERENCES deferred_parent(id) DEFERRABLE INITIALLY DEFERRED);
`
let root: string
let pg: PGlite
let prisma: PrismaClient
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const record = (id: string) => ({ id, label: `原稿🖋️${id}' ; DROP TABLE "Probe";--`,
  tags: ["人物", "你好", "a,b", '带"引号'], state: "DRAFT" as const,
  payload: { nested: ["正文", null, 42], flag: true }, happenedAt: new Date("2026-01-02T03:04:05.678Z"),
  large: 9007199254740993n, precise: "12345678901234567890.12345678" })

before(async () => {
  root = await mkdtemp(join(tmpdir(), "xuanxiang-adapter-"))
  pg = await PGlite.create({ dataDir: join(root, "database"), relaxedDurability: false })
  await pg.exec(schema)
  prisma = new PrismaClient({ adapter: new LocalPGliteAdapter(pg) })
})
after(async () => { await prisma?.$disconnect(); await pg?.close(); if (root) await rm(root, { recursive: true, force: true }) })

test("ADAPTER-01: real Prisma values and hostile SQL parameters round trip without type loss", async () => {
  const expected = record("types")
  const row = await prisma.probe.create({ data: expected })
  assert.deepEqual(row.tags, expected.tags)
  assert.equal(row.label, expected.label)
  assert.deepEqual(row.payload, expected.payload)
  assert.equal(row.optional, null)
  assert.equal(row.happenedAt.toISOString(), expected.happenedAt.toISOString())
  assert.equal(row.large, expected.large)
  assert.equal(row.precise.toString(), expected.precise)
  assert.equal(row.state, "DRAFT")
  const query = await prisma.$queryRaw<{ label: string }[]>`SELECT label FROM "Probe" WHERE label = ${expected.label}`
  assert.deepEqual(query, [{ label: expected.label }])
})

test("ADAPTER-02: executeScript only acknowledges actual engine completion", async () => {
  const release = deferred()
  const started = deferred()
  const delayed = new Proxy(pg, { get(target, name) {
    if (name === "exec") return async (sql: string) => { started.resolve(); await release.promise; return target.exec(sql) }
    const value = Reflect.get(target, name); return typeof value === "function" ? value.bind(target) : value
  } })
  const adapter = await new LocalPGliteAdapter(delayed).connect()
  let settled = false
  const done = adapter.executeScript("CREATE TABLE script_done (id INTEGER)").then(() => { settled = true })
  await started.promise; await pause(20)
  const acknowledgedBeforeCompletion = settled
  release.resolve(); await done
  await pg.query("SELECT * FROM script_done")
  assert.equal(acknowledgedBeforeCompletion, false)
})

test("ADAPTER-03: commits, nested tx work, constraints, and rollback have real effects", async () => {
  await prisma.$transaction(async tx => {
    await tx.probe.create({ data: record("committed") })
    await tx.probeChild.create({ data: { id: "child", parentId: "committed" } })
  })
  assert.equal(await prisma.probeChild.count(), 1)
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.probe.create({ data: record("rolled-back") })
    await tx.probeChild.create({ data: { id: "missing", parentId: "absent" } })
  }), { code: "P2003" })
  assert.equal(await prisma.probe.findUnique({ where: { id: "rolled-back" } }), null)
  await assert.rejects(prisma.probe.create({ data: record("committed") }), { code: "P2002" })
  assert.equal(await prisma.$executeRaw`UPDATE "Probe" SET state = 'FINAL' WHERE id = 'absent'`, 0)
  assert.equal(await prisma.$executeRaw`UPDATE "Probe" SET state = 'FINAL' WHERE id = 'committed'`, 1)
})

test("ADAPTER-03: requested isolation is set inside the acquired transaction", async () => {
  for (const [isolationLevel, expected] of [["ReadCommitted", "read committed"], ["RepeatableRead", "repeatable read"], ["Serializable", "serializable"]] as const) {
    const rows = await prisma.$transaction(tx => tx.$queryRawUnsafe<{ transaction_isolation: string }[]>("SHOW transaction_isolation"), { isolationLevel })
    assert.equal(rows[0].transaction_isolation, expected)
  }
})

test("ADAPTER-03: deferred foreign key failure during COMMIT reaches caller and frees queue", async () => {
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("INSERT INTO deferred_child VALUES (99)")
  }))
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>("SELECT count(*) FROM deferred_child")
  assert.equal(rows[0].count, 0n)
})

test("ADAPTER-04: external read, write, and second client cannot enter an active transaction", async () => {
  const entered = deferred(); const release = deferred()
  const external = new PrismaClient({ adapter: new LocalPGliteAdapter(pg) })
  const transaction = prisma.$transaction(async tx => {
    await tx.probe.create({ data: record("isolated") }); entered.resolve(); await release.promise
    throw new Error("rollback fixture")
  })
  const rejected = assert.rejects(transaction, /rollback fixture/)
  await entered.promise
  let readFinished = false; let writeFinished = false
  const read = external.probe.findUnique({ where: { id: "isolated" } }).then(value => { readFinished = true; return value })
  const write = external.probe.create({ data: record("outside") }).then(value => { writeFinished = true; return value })
  await pause(40)
  const leaked = readFinished || writeFinished
  release.resolve(); await rejected
  assert.equal(await read, null)
  assert.equal((await write).id, "outside")
  assert.equal(leaked, false)
  await external.$disconnect()
})

test("ADAPTER-05: Prisma timeout rolls back before the next transaction succeeds", async () => {
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.probe.create({ data: record("timed-out") })
    await pause(120)
  }, { timeout: 50 }), { code: "P2028" })
  const result = await prisma.$transaction(tx => tx.probe.findUnique({ where: { id: "timed-out" } }))
  assert.equal(result, null)
})

test("ADAPTER-06: nested service writes use the supplied transaction and roll back together", async () => {
  const nested = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    await tx.probeChild.create({ data: { id: "nested", parentId: "outer" } })
    throw new Error("nested service failed")
  }
  await assert.rejects(prisma.$transaction(async tx => { await tx.probe.create({ data: record("outer") }); await nested(tx) }), /nested service failed/)
  assert.equal(await prisma.probe.count({ where: { id: "outer" } }), 0)
  assert.equal(await prisma.probeChild.count({ where: { id: "nested" } }), 0)
})

test("ADAPTER-02/03: invalid script and isolation fail without poisoning future work", async () => {
  const adapter = await new LocalPGliteAdapter(pg).connect()
  await assert.rejects(adapter.executeScript("THIS IS NOT SQL"))
  await assert.rejects(adapter.startTransaction("SERIALIZABLE; DROP TABLE Probe" as never), /isolation/)
  await adapter.executeScript("CREATE TABLE after_failure (id INTEGER)")
  assert.equal((await pg.query("SELECT * FROM after_failure")).rows.length, 0)
  await adapter.dispose()
})

test("ADAPTER-05: dispose rejects pending starters and releases their leases before resolving", async () => {
  const adapter = await new LocalPGliteAdapter(pg).connect()
  const first = await adapter.startTransaction()
  const second = adapter.startTransaction()
  const closedStarter = assert.rejects(second, /closed|disposed/i)
  await adapter.dispose()
  // Cleanup even a faulty implementation, so RED cannot leave the runner hung.
  const unexpectedlyOpen = await second.catch(() => null)
  if (unexpectedlyOpen) await unexpectedlyOpen.rollback()
  await closedStarter
  await assert.rejects(adapter.startTransaction(), /closed|disposed/i)
  await assert.rejects(adapter.executeScript("SELECT 1"), /closed|disposed/i)
  await first.rollback()
  await adapter.dispose()
  assert.equal((await pg.query<{ value: number }>("SELECT 1 AS value")).rows[0].value, 1)
})

test("ADAPTER-05: same ending is idempotent; opposite ending and writes after finishing reject", async () => {
  const adapter = await new LocalPGliteAdapter(pg).connect()
  const rolledBack = await adapter.startTransaction()
  await rolledBack.rollback(); await rolledBack.rollback()
  await assert.rejects(rolledBack.commit(), /already|closed|finish/i)
  const committed = await adapter.startTransaction()
  const committing = committed.commit()
  const query = { sql: "INSERT INTO deferred_parent VALUES (71)", args: [], argTypes: [] }
  await assert.rejects(committed.executeRaw(query), /closed|finish/i)
  await committing; await committed.commit()
  await assert.rejects(committed.queryRaw({ sql: "SELECT 1", args: [], argTypes: [] }), /closed|finish/i)
  assert.equal((await pg.query("SELECT * FROM deferred_parent WHERE id=71")).rows.length, 0)
  await adapter.dispose()
})

test("ADAPTER-05: rejected opposite ending cannot make dispose lose an in-flight COMMIT", async () => {
  const callbackEnded = deferred(); const release = deferred()
  const delayed = new Proxy(pg, { get(target, name) {
    if (name === "transaction") return (run: Parameters<PGlite["transaction"]>[0]) => target.transaction(async tx => {
      const result = await run(tx); callbackEnded.resolve(); await release.promise; return result
    })
    const value = Reflect.get(target, name); return typeof value === "function" ? value.bind(target) : value
  } })
  const adapter = await new LocalPGliteAdapter(delayed).connect()
  const tx = await adapter.startTransaction(); const commit = tx.commit()
  await callbackEnded.promise
  await assert.rejects(tx.rollback(), /already|finish/)
  let disposed = false
  const close = adapter.dispose().then(() => { disposed = true })
  await pause(30); const prematurelyDisposed = disposed
  release.resolve(); await commit; await close
  assert.equal(prematurelyDisposed, false)
})
