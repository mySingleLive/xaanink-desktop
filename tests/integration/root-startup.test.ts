import assert from "node:assert/strict"
import { test, after } from "node:test"
import { Worker } from "node:worker_threads"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath, rm, rename, lstat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { build } from "esbuild"
import { RpcPeer } from "../../desktop/service/rpc"
import { DataRootManager, RootMigrationCrash, type MigrationHost, type RootPointer } from "../../desktop/core/data-root"
import { directoryIdentity } from "../../desktop/core/root-ownership"
import { defaultState } from "../../desktop/core/settings"
import { freezeTaskDefaults } from "../../desktop/shared/task-defaults"

// Compile the actual distribution worker entry in an isolated output directory;
// this cannot replace the running App's dist/service/index.cjs during testing.
const output = join(process.cwd(), "dist", `root-startup-test-${randomUUID()}`)
const built = build({ bundle: true, platform: "node", target: "node24", format: "cjs", packages: "external", entryPoints: ["desktop/service/index.ts"], outfile: join(output, "index.cjs"), define: { "import.meta.url": "__desktopImportMetaUrl" }, banner: { js: 'var __desktopImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' } })
after(async () => { await built; await rm(output, { recursive: true, force: true }) })
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "xuanxiang-root-startup-")))
  const bootstrap = join(base, "bootstrap"), root = join(base, "默认作者目录"), target = join(base, "迁移后目录")
  await mkdir(bootstrap); await mkdir(target)
  return { base, bootstrap, root, target, async close() { await rm(base, { recursive: true, force: true }) } }
}
type Result = { version: 1; status: "ready"; root: string } | { version: 1; status: "failed"; code: string }
async function launch(root: string, bootstrap: string | undefined, migrations = join(process.cwd(), "prisma/migrations")) {
  await built
  // The initial RED deliberately uses the wire contract directly: the old
  // worker signals status only, and must not be mistaken for a complete root.
  const startup = new SharedArrayBuffer(64 * 1024), header = new Int32Array(startup, 0, 4)
  const worker = new Worker(join(output, "index.cjs"), { workerData: { root, bootstrap, migrations, startup } })
  let defaultsRequests = 0
  const rpc = new RpcPeer(worker, async method => { if (method === "model.defaults") { defaultsRequests++; return freezeTaskDefaults(defaultState.settings.agent, 0) }; throw Error("Startup must not request models or main services") })
  worker.on("error", () => rpc.dispose()); worker.on("exit", () => rpc.dispose())
  let closed = false
  function wait() {
    assert.notEqual(Atomics.wait(header, 0, 0, 25_000), "timed-out", "startup must wake the blocked main thread")
  }
  function result(): Result {
    wait()
    assert.equal(Atomics.load(header, 1), 1, "ready requires a versioned root/error envelope, not a status alone")
    const length = Atomics.load(header, 2)
    assert.ok(length > 0 && length <= startup.byteLength - 16)
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(startup, 16, length))) as Result
    assert.equal(Atomics.load(header, 0), value.status === "ready" ? 1 : 2)
    assert.equal(defaultsRequests, 0, "startup may not require an asynchronous main RPC while it is blocked")
    return value
  }
  return { rpc, result, wait, async close() { if (closed) return; closed = true; await rpc.call("close").catch(() => undefined); rpc.dispose(); await worker.terminate() } }
}
async function request(rpc: RpcPeer, path: string, method = "GET", data?: unknown) {
  const id = randomUUID()
  const reply = await rpc.call<{ status: number }>("start", { version: 1, id, path, method, headers: data ? { "Content-Type": "application/json" } : {}, body: data ? Array.from(Buffer.from(JSON.stringify(data))) : undefined })
  const chunks: Uint8Array[] = []
  for (;;) { const part = await rpc.call<{ done: boolean; bytes?: Uint8Array }>("read", id); if (part.done) break; chunks.push(part.bytes!) }
  return { status: reply.status, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) }
}
async function exists(path: string) { try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error } }
async function initialized(f: Awaited<ReturnType<typeof fixture>>) {
  const running = await launch(f.root, f.bootstrap)
  try { await running.rpc.call("ready"); await request(running.rpc, "/api/admin/prompts", "POST", { key: "root_startup_retained", name: "根目录验收模板", content: "必须在权威根读取原数据" }) }
  finally { await running.close() }
  // The fixture already exists before the tested subsequent startup. Adopt it
  // explicitly if the baseline worker has no bootstrap support yet.
  if (!await exists(join(f.bootstrap, "data-root.json"))) await new DataRootManager(f.bootstrap, f.root).adopt(await directoryIdentity(f.root))
}
async function closedFixtureHost(pointer: RootPointer): Promise<MigrationHost> {
  const paths = ["xaanink-app.json", "catalog.json"], directories: string[] = ["inbox/database"]
  async function files(path: string, relative: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = `${relative}/${entry.name}`
      if (entry.isDirectory()) { directories.push(next); await files(join(path, entry.name), next) }
      else if (entry.isFile()) paths.push(next)
      else throw Error("Test fixture ownership is not a regular closed file")
    }
  }
  await files(join(pointer.root.path, "inbox", "database"), "inbox/database")
  // This trusted fixture inventory is collected only after the real PGlite
  // worker has acknowledged close and exited, not from a running database.
  return { async quiesce() { return { source: pointer.root, ownedFiles: paths, ownedDirectories: directories, assertClosed() {}, release() {} } } }
}

test("ROOT11-01 built worker freezes canonical UTF8 root only after seed and durable first adoption", { timeout: 35_000 }, async () => {
  const f = await fixture(), running = await launch(f.root, f.bootstrap)
  try {
    assert.deepEqual(running.result(), { version: 1, status: "ready", root: f.root })
    const marker = JSON.parse(await readFile(join(f.root, "xaanink-app.json"), "utf8"))
    assert.equal(marker.inboxReady, true)
    const pointer = JSON.parse(await readFile(join(f.bootstrap, "data-root.json"), "utf8"))
    assert.equal(pointer.rootId, marker.id); assert.deepEqual(pointer.root, await directoryIdentity(f.root)); assert.equal(pointer.revision, 1)
    assert.equal(await running.rpc.call("ready"), true)
    assert.ok((await request(running.rpc, "/api/admin/prompts")).data.prompts.length > 0)
  } finally { await running.close(); await f.close() }
})

// Full closed-database inventory hashing can exceed one minute alongside the
// other integration suite. The worker's own 25-second startup barrier above
// remains unchanged; this allowance covers the complete migration scenario.
test("ROOT11-02 built worker starts from migrated pointer and preserves seeded user data instead of default root", { timeout: 180_000 }, async () => {
  const f = await fixture()
  try {
    await initialized(f)
    const manager = new DataRootManager(f.bootstrap, f.root), resolved = await manager.resolve(); assert.equal(resolved.state, "existing"); if (resolved.state !== "existing") throw Error("fixture pointer absent")
    await manager.migrate(await directoryIdentity(f.target), await closedFixtureHost(resolved.pointer))
    const running = await launch(f.root, f.bootstrap)
    try {
      running.wait()
      assert.equal(await exists(join(f.root, "xaanink-app.json")), false, "old root must not be reinitialized")
      assert.deepEqual(running.result(), { version: 1, status: "ready", root: f.target })
      assert.ok((await request(running.rpc, "/api/admin/prompts")).data.prompts.some((row: { key: string }) => row.key === "root_startup_retained"))
      assert.equal(await exists(join(f.root, "xaanink-app.json")), false, "old root must not be reinitialized")
      assert.equal(await exists(join(f.root, "inbox", "database")), false)
    } finally { await running.close() }
  } finally { await f.close() }
})

test("ROOT11-03 missing pointed root blocks startup and never creates an unrelated default database", { timeout: 60_000 }, async () => {
  const f = await fixture()
  try {
    await initialized(f); await rename(f.root, f.root + "-失联")
    const fallback = join(f.base, "不要创建"), running = await launch(fallback, f.bootstrap)
    try {
      running.wait(); assert.equal(await exists(fallback), false, "an unavailable pointer may not create a fallback root")
      assert.deepEqual(running.result(), { version: 1, status: "failed", code: "ROOT_UNAVAILABLE" })
      await assert.rejects(running.rpc.call("ready"), /^Error: ROOT_UNAVAILABLE$/)
      assert.equal(await exists(fallback), false); assert.equal(await exists(f.root), false)
      assert.ok(await exists(join(f.root + "-失联", "inbox", "database", "PG_VERSION")))
    } finally { await running.close() }
  } finally { await f.close() }
})

test("ROOT11-04 invalid journal blocks before any default root mutation and emits a safe code", { timeout: 35_000 }, async () => {
  const f = await fixture()
  try {
    const corrupt = JSON.stringify({ journal: { secret: "must-not-cross-startup-envelope" }, sha256: "invalid" })
    await writeFile(join(f.bootstrap, "root-migration.json"), corrupt)
    const running = await launch(f.root, f.bootstrap)
    try {
      running.wait(); assert.equal(await exists(f.root), false, "invalid journal must be read before root initialization")
      assert.deepEqual(running.result(), { version: 1, status: "failed", code: "JOURNAL_INVALID" })
      await assert.rejects(running.rpc.call("ready"), /^Error: JOURNAL_INVALID$/)
      assert.equal(await exists(f.root), false)
      assert.equal(await readFile(join(f.bootstrap, "root-migration.json"), "utf8"), corrupt)
    } finally { await running.close() }
  } finally { await f.close() }
})

test("ROOT11-05 invalid pointer is never ignored even when a writable default root exists", { timeout: 35_000 }, async () => {
  const f = await fixture()
  try {
    await mkdir(f.root); await writeFile(join(f.root, "author.txt"), "原文件不得改动")
    await writeFile(join(f.bootstrap, "data-root.json"), JSON.stringify({ revision: 1, root: { path: "sensitive/path" } }))
    const running = await launch(f.root, f.bootstrap)
    try {
      assert.deepEqual(running.result(), { version: 1, status: "failed", code: "POINTER_INVALID" })
      assert.deepEqual(await readdir(f.root), ["author.txt"])
    } finally { await running.close() }
  } finally { await f.close() }
})

test("ROOT11-06 failed original resource initialization never publishes ready or first pointer", { timeout: 35_000 }, async () => {
  const f = await fixture(), running = await launch(f.root, f.bootstrap, join(f.base, "missing-migrations-sensitive-path"))
  try {
    assert.deepEqual(running.result(), { version: 1, status: "failed", code: "ROOT_INITIALIZATION_FAILED" })
    await assert.rejects(running.rpc.call("ready"), /^Error: ROOT_INITIALIZATION_FAILED$/)
    assert.equal(await exists(f.root), false); assert.equal(await exists(join(f.bootstrap, "data-root.json")), false)
  } finally { await running.close(); await f.close() }
})

test("ROOT11-07 real startup recovery finishes committed journal before opening the new database", { timeout: 180_000 }, async () => {
  const f = await fixture()
  try {
    await initialized(f)
    const manager = new DataRootManager(f.bootstrap, f.root, { hook(phase) { if (phase === "pointer-written") throw new RootMigrationCrash("simulated terminated fixture migration") } })
    const resolved = await manager.resolve(); if (resolved.state !== "existing") throw Error("fixture pointer absent")
    await assert.rejects(manager.migrate(await directoryIdentity(f.target), await closedFixtureHost(resolved.pointer)), RootMigrationCrash)
    assert.ok(await exists(join(f.root, "xaanink-app.json")), "old copy exists before recovery")
    const running = await launch(f.root, f.bootstrap)
    try {
      running.wait()
      assert.equal(JSON.parse(await readFile(join(f.bootstrap, "root-migration.json"), "utf8")).journal.phase, "complete", "startup must recover before opening a database")
      assert.deepEqual(running.result(), { version: 1, status: "ready", root: f.target })
      assert.equal(JSON.parse(await readFile(join(f.bootstrap, "root-migration.json"), "utf8")).journal.phase, "complete")
      assert.equal(await exists(join(f.root, "xaanink-app.json")), false)
      assert.ok((await request(running.rpc, "/api/admin/prompts")).data.prompts.some((row: { key: string }) => row.key === "root_startup_retained"))
    } finally { await running.close() }
  } finally { await f.close() }
})
test("ROOT11-08 production-size barrier requires bootstrap and cannot enter fixture compatibility accidentally", { timeout: 35_000 }, async () => {
  const f = await fixture(), running = await launch(f.root, undefined)
  try {
    running.wait(); assert.equal(await exists(f.root), false, "new production handshake must not initialize without its authority bootstrap")
    assert.deepEqual(running.result(), { version: 1, status: "failed", code: "BOOTSTRAP_UNAVAILABLE" })
    await assert.rejects(running.rpc.call("ready"), /^Error: BOOTSTRAP_UNAVAILABLE$/)
  } finally { await running.close(); await f.close() }
})
