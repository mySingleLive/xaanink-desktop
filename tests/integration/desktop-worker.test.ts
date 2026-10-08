import assert from "node:assert/strict"
import { test } from "node:test"
import { Worker } from "node:worker_threads"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { RpcPeer } from "../../desktop/service/rpc"
import { DirectoryAuthority } from "../../desktop/main/directory-authority"
import type { LocalResponse } from "../../desktop/shared/ipc"
import {defaultState} from "../../desktop/core/settings"
import {freezeTaskDefaults} from "../../desktop/shared/task-defaults"

test("IPC-01: built worker executes original local handlers with no HTTP server and retains original ownership guards", async () => {
  // Build the actual distribution entry so bundling/worker boot failures are covered.
  await import("../../scripts/build-desktop.mjs")
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-worker-"))
  const worker = new Worker(join(process.cwd(), "dist/service/index.cjs"), { workerData: { root: join(root, "app"), migrations: join(process.cwd(), "prisma/migrations") } })
  const rpc = new RpcPeer(worker, async method => { if(method==="model.defaults")return freezeTaskDefaults(defaultState.settings.agent,0);throw new Error(`Unexpected main request: ${method}`) })
  worker.on("error", () => rpc.dispose()); worker.on("exit", () => rpc.dispose())
  async function request(path: string, method = "GET", data?: unknown) {
    const id = randomUUID()
    const response = await rpc.call<LocalResponse>("start", { version: 1, id, path, method, headers: data ? { "Content-Type": "application/json" } : {}, body: data ? Array.from(Buffer.from(JSON.stringify(data))) : undefined })
    const chunks: Uint8Array[] = []
    for (;;) { const frame = await rpc.call<{ done: boolean; bytes?: Uint8Array }>("read", id); if (frame.done) break; chunks.push(frame.bytes!) }
    return { status: response.status, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) }
  }
  try {
    await rpc.call("ready")
    assert.deepEqual((await request("/api/novels")).data, { novels: [] })
    await assert.rejects(rpc.call("start", { version: 1, id: randomUUID(), path: "/api/../state.json", method: "GET", headers: {} }))
    await assert.rejects(rpc.call("read-file", { path: "state.json" }), /未知/)
    const directory = join(root, "author-work"); await mkdir(directory)
    const grants = new DirectoryAuthority(); const grant = await grants.issue(directory, "create-work", "fixture-main")
    const created = await rpc.call<{ novel: { id: string } }>("create-work", { selection: await grants.consume(grant.id, "create-work", "fixture-main"), input: { title: "真正的原组件数据", requestId: "worker-create-fixture" } })
    assert.equal((await request("/api/novels")).data.novels.length, 1)
    const theme = await request(`/api/novels/${created.novel.id}/theme`)
    assert.equal(theme.status, 200); assert.equal(theme.data.theme.title, "真正的原组件数据")
    await assert.rejects(request("/api/novels/unknown-work/theme"), /未关联/)
    assert.deepEqual((await request("/api/chat/conversations")).data, { conversations: [] })
    const globalPrompts = await request("/api/admin/prompts")
    const injected = await request(`/api/admin/prompts?novelId=${created.novel.id}`)
    assert.deepEqual(injected.data, globalPrompts.data, "unrelated workspace selectors cannot redirect global templates")
    const invalid = await request(`/api/admin/prompts?novelId=${created.novel.id}`, "POST", { key: "desktop_scope_test", name: "测试模板", content: "测试", novelId: created.novel.id })
    assert.equal(invalid.status,400,"a body workspace selector must fail the strict global template schema")
    assert.equal((await request("/api/admin/prompts")).data.prompts.some((row: { key: string }) => row.key === "desktop_scope_test"),false)
    const saved = await request(`/api/admin/prompts?novelId=${created.novel.id}`, "POST", { key: "desktop_scope_test", name: "测试模板", content: "测试" })
    assert.equal(saved.status, 201)
    assert.ok((await request("/api/admin/prompts")).data.prompts.some((row: { key: string }) => row.key === "desktop_scope_test"))
    assert.deepEqual(await rpc.call("task-status"),{active:0})
    await rpc.call("stop-tasks")
    assert.equal((await request(`/api/novels/${created.novel.id}/theme`)).status,200,"quiescing generation does not block renderer flush reads")
    await rpc.call("close")
    assert.equal((await request(`/api/novels/${created.novel.id}/theme`)).status,200,"macOS reopened window reconnects the original work after a clean close")
  } finally { await rpc.call("close").catch(() => undefined); rpc.dispose(); await worker.terminate(); await rm(root, { recursive: true, force: true }) }
})

test("DESK-D01: built worker signals fully initialized owned root while main thread is synchronously waiting", { timeout: 30000 }, async () => {
  await import("../../scripts/build-desktop.mjs")
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-worker-startup-"))
  const appRoot = join(root, "app")
  const startup = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  const worker = new Worker(join(process.cwd(), "dist/service/index.cjs"), { workerData: { root: appRoot, migrations: join(process.cwd(), "prisma/migrations"), startup: startup.buffer } })
  let mainRequests = 0
  const rpc = new RpcPeer(worker, async method => { mainRequests++;if(method==="model.defaults")return freezeTaskDefaults(defaultState.settings.agent,0);throw new Error(`Unexpected main request: ${method}`) })
  worker.on("error", () => rpc.dispose()); worker.on("exit", () => rpc.dispose())
  try {
    // The independent worker must complete without this thread processing any
    // message or Promise callback, matching the pre-app-ready native barrier.
    assert.notEqual(Atomics.wait(startup, 0, 0, 20000), "timed-out")
    assert.equal(Atomics.load(startup, 0), 1)
    const marker = JSON.parse(await readFile(join(appRoot, "xaanink-app.json"), "utf8"))
    assert.equal(marker.phase, "ready")
    assert.equal(marker.inboxReady, true)
    assert.ok((await readFile(join(appRoot, "inbox", "database", "PG_VERSION"), "utf8")).trim())
    assert.deepEqual(JSON.parse(await readFile(join(appRoot, "catalog.json"), "utf8")).value, [])
    assert.equal(await rpc.call("ready"), true)
    assert.equal(mainRequests, 0)
    const requestId = randomUUID()
    const response = await rpc.call<LocalResponse>("start", { version: 1, id: requestId, path: "/api/admin/prompts", method: "GET", headers: {} })
    assert.equal(response.status, 200)
    const chunks: Uint8Array[] = []
    for (;;) { const frame = await rpc.call<{ done: boolean; bytes?: Uint8Array }>("read", requestId); if (frame.done) break; chunks.push(frame.bytes!) }
    assert.ok(JSON.parse(Buffer.concat(chunks).toString("utf8")).prompts.length > 0, "startup ready includes original prompt seeding")
    await rpc.call("close")
  } finally { rpc.dispose(); await worker.terminate(); await rm(root, { recursive: true, force: true }) }
})

test("DESK-D01: worker startup failure signals unblock main without claiming or modifying an unrelated data root", { timeout: 30000 }, async () => {
  await import("../../scripts/build-desktop.mjs")
  const root = await mkdtemp(join(tmpdir(), "xuanxiang-worker-startup-error-"))
  try {
    for (const scenario of ["nonempty", "missing-resources"] as const) {
      const appRoot = join(root, scenario)
      await mkdir(appRoot)
      const original = Buffer.from("作者原文件\n保留内容\0")
      await writeFile(join(appRoot, "author.txt"), original)
      const startup = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
      const worker = new Worker(join(process.cwd(), "dist/service/index.cjs"), { workerData: { root: appRoot, migrations: scenario === "nonempty" ? join(process.cwd(), "prisma/migrations") : join(root, "absent-migrations"), startup: startup.buffer } })
      const rpc = new RpcPeer(worker, async () => { throw new Error("Unexpected startup main request") })
      worker.on("error", () => rpc.dispose()); worker.on("exit", () => rpc.dispose())
      try {
        assert.notEqual(Atomics.wait(startup, 0, 0, 10000), "timed-out")
        assert.equal(Atomics.load(startup, 0), 2)
        await assert.rejects(rpc.call("ready"), scenario === "nonempty" ? /不是空目录/ : /ENOENT/)
        assert.deepEqual(await readFile(join(appRoot, "author.txt")), original)
        assert.deepEqual(await readdir(appRoot), ["author.txt"])
      } finally { rpc.dispose(); await worker.terminate() }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
