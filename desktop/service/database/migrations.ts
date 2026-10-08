import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { PGlite } from "@electric-sql/pglite"
import { migrationStatements } from "./sql-boundary"
export interface Migration { id: string; sql: string; checksum: string }
export async function migrateDatabase(engine: PGlite, migrations: Migration[],assertCreation?:()=>void): Promise<void> {
  assertCreation?.()
  const snapshot = migrations.map(migration => Object.freeze({ id: migration.id, sql: migration.sql, checksum: migration.checksum }))
  const ids = new Set<string>()
  const prepared = new Map<string, string[]>()
  for (const migration of snapshot) {
    if (ids.has(migration.id) || createHash("sha256").update(migration.sql).digest("hex") !== migration.checksum) throw new Error("Invalid migration checksum or duplicate id")
    prepared.set(migration.id, migrationStatements(migration.sql))
    ids.add(migration.id)
  }
  await engine.transaction(async tx => {
    assertCreation?.()
    await tx.exec('CREATE TABLE IF NOT EXISTS "_desktop_migrations" (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now())')
    assertCreation?.()
    const applied = await tx.query<{ id: string; checksum: string }>('SELECT id, checksum FROM "_desktop_migrations" ORDER BY id')
    assertCreation?.()
    const recorded = new Map(applied.rows.map(row => [row.id, row.checksum]))
    for (const row of applied.rows) {
      if (snapshot.find(item => item.id === row.id)?.checksum !== row.checksum) throw new Error("Installed migration checksum differs; keep the original database")
    }
    for (const migration of snapshot) {
      if (recorded.has(migration.id)) continue
      for (const statement of prepared.get(migration.id)!) {
        // Every Parse sees the same literal mode, even if a prior SELECT used
        // set_config(). Extended-protocol query accepts one statement only:
        // an accidental lexical merge cannot execute a hidden COMMIT batch.
        await tx.query("SET LOCAL standard_conforming_strings = on")
        assertCreation?.()
        await tx.query(statement)
        assertCreation?.()
      }
      await tx.query('INSERT INTO "_desktop_migrations" (id,checksum) VALUES ($1,$2)', [migration.id, migration.checksum])
      assertCreation?.()
    }
    assertCreation?.()
  })
}

// These frozen upstream scripts have explicit outer BEGIN/COMMIT wrappers.
// Move only their wrapper into our single durable migration transaction; no
// constraints, row locks, procedural BEGIN blocks or SQL bodies are removed.
const wrapped = new Set(["20260724004334_world_tree", "20260909170000_world_tree_guard", "20261004000100_recursive_scenes"])
export async function loadMigrations(directory: string): Promise<Migration[]> {
  const entries = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
  return Promise.all(entries.map(async entry => {
    let sql = await readFile(join(directory, entry.name, "migration.sql"), "utf8")
    if (wrapped.has(entry.name)) {
      if ((sql.match(/^BEGIN;\r?$/gm) ?? []).length !== 1 || (sql.match(/^COMMIT;\r?$/gm) ?? []).length !== 1) throw new Error("Upstream migration wrapper changed; review required")
      sql = sql.replace(/^(?:BEGIN|COMMIT);\r?$/gm, "")
    }
    return { id: entry.name, sql, checksum: createHash("sha256").update(sql).digest("hex") }
  }))
}
