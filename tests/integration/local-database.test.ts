import assert from "node:assert/strict"
import { before, after, test } from "node:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { PrismaClient } from "../../src/generated/prisma/client"
import { LocalPGliteAdapter } from "../../desktop/service/database/pglite-adapter"
import { createScopedClient, getDatabaseContext, runInDatabaseContext } from "../../desktop/service/context"
import { migrateDatabase, type Migration } from "../../desktop/service/database/migrations"

let root: string; let a: PGlite; let b: PGlite; let first: PrismaClient; let second: PrismaClient
const sql = 'CREATE TABLE marker (name TEXT PRIMARY KEY);'
const migration = (id: string, sql: string): Migration => ({ id, sql, checksum: createHash("sha256").update(sql).digest("hex") })
before(async () => {
  root = await mkdtemp(join(tmpdir(), "xuanxiang-scope-"))
  a = await PGlite.create({ dataDir: join(root, "A") }); b = await PGlite.create({ dataDir: join(root, "B") })
  await a.exec(sql); await b.exec(sql)
  await a.query("INSERT INTO marker VALUES ('A')"); await b.query("INSERT INTO marker VALUES ('B')")
  await a.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT); INSERT INTO "User" VALUES (\'author-a\',\'A\')')
  await b.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY, name TEXT); INSERT INTO "User" VALUES (\'author-b\',\'B\')')
  first = new PrismaClient({ adapter: new LocalPGliteAdapter(a) }); second = new PrismaClient({ adapter: new LocalPGliteAdapter(b) })
})
after(async () => { await first?.$disconnect(); await second?.$disconnect(); await a?.close(); await b?.close(); if (root) await rm(root, { recursive: true, force: true }) })

test("DESK-D04: trusted database scope never leaks to work outside a request", async () => {
  assert.throws(() => getDatabaseContext(), /context/)
  await runInDatabaseContext({ workspaceId: "A", database: first }, () => Promise.resolve())
  assert.throws(() => getDatabaseContext(), /context/)
})

test("DESK-D04: simultaneous work requests keep their own database after asynchronous suspension", async () => {
  const scoped = createScopedClient()
  const [rowsA, rowsB] = await Promise.all([
    runInDatabaseContext({ workspaceId: "A", database: first }, async () => { await new Promise(resolve => setTimeout(resolve, 20)); return scoped.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM marker") }),
    runInDatabaseContext({ workspaceId: "B", database: second }, async () => { await new Promise(resolve => setTimeout(resolve, 5)); return scoped.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM marker") }),
  ])
  assert.deepEqual(rowsA, [{ name: "A" }]); assert.deepEqual(rowsB, [{ name: "B" }])
})

test("ADAPTER-06: using the default client inside an interactive tx is rejected instead of self-deadlocking", async () => {
  const scoped = createScopedClient()
  await runInDatabaseContext({ workspaceId: "A", database: first }, async () => {
    await assert.rejects(scoped.$transaction(async () => scoped.$queryRawUnsafe("SELECT 1"), { timeout: 100 }), /supplied transaction/)
    const rows = await scoped.$transaction(tx => tx.$queryRawUnsafe<{ name: string }[]>("SELECT name FROM marker"))
    assert.deepEqual(rows, [{ name: "A" }])
  })
})

test("ADAPTER-08: migration failure rolls back the whole pending batch and does not advance checksums", async () => {
  const one = migration("001", "CREATE TABLE migrated (id INTEGER PRIMARY KEY)")
  await migrateDatabase(a, [one])
  await assert.rejects(migrateDatabase(a, [one, migration("002", "ALTER TABLE migrated ADD COLUMN changed TEXT"), migration("003", "INVALID SQL")]))
  const columns = await a.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name='migrated' ORDER BY column_name")
  assert.deepEqual(columns.rows.map(row => row.column_name), ["id"])
  const rows = await a.query<{ id: string }>('SELECT id FROM "_desktop_migrations" ORDER BY id')
  assert.deepEqual(rows.rows, [{ id: "001" }])
  await assert.rejects(migrateDatabase(a, [migration("001", "CREATE TABLE wrong (id INTEGER)")]), /checksum/)
})

test("DESK-D04/ADAPTER-06: captured methods resolve the current scope and cannot bypass a transaction", async () => {
  const scoped = createScopedClient()
  const borrowed = runInDatabaseContext({ workspaceId: "A", database: first }, () => scoped.$queryRawUnsafe)
  const rows = await runInDatabaseContext({ workspaceId: "B", database: second }, () => borrowed<{ name: string }[]>("SELECT name FROM marker"))
  assert.deepEqual(rows, [{ name: "B" }])
  await assert.rejects(async () => borrowed("SELECT 1"), /context/)
  await runInDatabaseContext({ workspaceId: "A", database: first }, async () => {
    await assert.rejects(scoped.$transaction(async () => borrowed("SELECT 1"), { timeout: 100 }), /supplied transaction/)
  })
})

test("DESK-D04/ADAPTER-06: captured model delegate and method are checked at invocation", async () => {
  const scoped = createScopedClient()
  const delegate = runInDatabaseContext({ workspaceId: "A", database: first }, () => scoped.user)
  const borrowed = delegate.findMany
  const rows = await runInDatabaseContext({ workspaceId: "B", database: second }, () => borrowed({ select: { name: true } }))
  assert.deepEqual(rows, [{ name: "B" }])
  await assert.rejects(async () => delegate.findMany({ select: { name: true } }), /context/)
  await runInDatabaseContext({ workspaceId: "A", database: first }, async () => {
    await assert.rejects(scoped.$transaction(async () => borrowed({ select: { name: true } }), { timeout: 100 }), /supplied transaction/)
  })
})

test("ADAPTER-04: original batch transactions retain atomic semantics and reject foreign database promises", async () => {
  const scoped = createScopedClient()
  const query = runInDatabaseContext({ workspaceId: "A", database: first }, () => scoped.$queryRawUnsafe("SELECT name FROM marker"))
  await runInDatabaseContext({ workspaceId: "B", database: second }, async () => {
    await assert.rejects(async () => scoped.$transaction([query]), /another database context/)
  })
  const results = await runInDatabaseContext({ workspaceId: "A", database: first }, () => scoped.$transaction([query]))
  assert.deepEqual(results, [[{ name: "A" }]])
})

test("ADAPTER-08: top-level transaction control is rejected before changing the database", async () => {
  const one = migration("001", "CREATE TABLE migrated (id INTEGER PRIMARY KEY)")
  const escape = migration("002", "CREATE TABLE leaked(id INTEGER); COMMIT; SELECT * FROM nonexistent_table")
  await assert.rejects(migrateDatabase(a, [one, escape]), /transaction control/i)
  const rows = await a.query("SELECT * FROM information_schema.tables WHERE table_name='leaked'")
  assert.equal(rows.rows.length, 0)
  await assert.rejects(migrateDatabase(a, [one, migration("002", 'CREATE TABLE a$tag$(id INT); CREATE TABLE leaked(id INT); COMMIT; DROP TABLE a$tag$; SELECT * FROM nonexistent_table')]), /transaction control/i)
  assert.equal((await a.query("SELECT * FROM information_schema.tables WHERE table_name IN ('leaked','a$tag$')")).rows.length, 0)
  await assert.rejects(migrateDatabase(a, [one, migration("002", 'SET "standard_conforming_strings"=off'), migration("003", "CREATE TABLE leaked_parser(id INT); SELECT 'a\\''; COMMIT; SELECT * FROM nonexistent_table; --'")]), /literal parsing/i)
  assert.equal((await a.query("SELECT * FROM information_schema.tables WHERE table_name='leaked_parser'")).rows.length, 0)
})

test("ADAPTER-08: changing parser mode through set_config cannot escape the migration transaction", async () => {
  const one = migration("001", "CREATE TABLE migrated (id INTEGER PRIMARY KEY)")
  const change = migration("002", "SELECT set_config('standard_conforming_strings','off',true); CREATE TABLE parser_mode_guard(id INT); SELECT 'a\\'; SELECT * FROM nonexistent_table")
  await assert.rejects(migrateDatabase(a, [one, change]), /nonexistent_table/)
  assert.equal((await a.query("SELECT * FROM information_schema.tables WHERE table_name='parser_mode_guard'")).rows.length, 0)
})

test("ADAPTER-08: invalid statements without words still fail and roll back the entire migration", async () => {
  const one = migration("001", "CREATE TABLE migrated (id INTEGER PRIMARY KEY)")
  for (const invalid of ["123", "'literal'", "+", "$$body$$"]) {
    await assert.rejects(migrateDatabase(a, [one, migration("002", `CREATE TABLE silent_error(id INT); ${invalid}; -- trailing comment`)]))
    assert.equal((await a.query("SELECT * FROM information_schema.tables WHERE table_name='silent_error'")).rows.length, 0)
    assert.deepEqual((await a.query('SELECT id FROM "_desktop_migrations" ORDER BY id')).rows, [{ id: "001" }])
  }
})

test("ADAPTER-08: caller mutation while waiting for the engine cannot change the verified migration", async () => {
  const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>()
  const lock = b.transaction(async () => { entered.resolve(); await release.promise })
  await entered.promise
  const row = migration("001", "CREATE TABLE intended(id INTEGER)")
  const pending = migrateDatabase(b, [row])
  row.sql = "CREATE TABLE mutated(id INTEGER)"
  release.resolve(); await lock; await pending
  assert.equal((await b.query("SELECT * FROM information_schema.tables WHERE table_name='intended'")).rows.length, 1)
  assert.equal((await b.query("SELECT * FROM information_schema.tables WHERE table_name='mutated'")).rows.length, 0)
})
