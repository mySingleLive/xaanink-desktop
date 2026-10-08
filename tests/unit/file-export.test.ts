import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, symlink, link, unlink, realpath, chmod } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID, createHash } from "node:crypto"
import fs from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { FileExports, type FileExportOptions } from "../../desktop/main/file-export"
import { MAX_EXPORT_BYTES } from "../../desktop/shared/file-export"

const request = (text = "本地未保存草稿") => ({ id: randomUUID(), format: "md" as const, filename: "第一章.md", bytes: new TextEncoder().encode(text) })
async function fixture(run: (root: string) => Promise<void>) { const root = await mkdtemp(join(tmpdir(), "xuanxiang-export16-")); try { await run(root) } finally { await rm(root, { recursive: true, force: true }) } }
const options = (path: string): FileExportOptions => ({ assertOwner: () => {}, chooseSave: async () => path, guardTarget: async () => {} })

test("EX16-01 real binary save confirms exact bytes, hash and completed temporary cleanup", () => fixture(async root => {
  const path = join(root, "selected.md"), source = request("草稿 **中文**\n未审批正文"), service = new FileExports(options(path))
  const result = await service.save("window:nonce", source)
  assert.deepEqual(result, { id: source.id, status: "saved", bytesWritten: source.bytes.byteLength, sha256: createHash("sha256").update(source.bytes).digest("hex") })
  assert.deepEqual(new Uint8Array(await readFile(path)), source.bytes); assert.deepEqual(await readdir(root), ["selected.md"])
}))
test("EX16-02 native save cancellation creates no file and reports no saved receipt", () => fixture(async root => {
  const source = request(), service = new FileExports({ ...options(join(root, "no.md")), chooseSave: async () => null })
  assert.deepEqual(await service.save("window:nonce", source), { id: source.id, status: "cancelled" }); assert.deepEqual(await readdir(root), [])
}))
test("EX16-03 strict format/name/size/path requests are refused before invoking any picker", () => fixture(async root => {
  let pickers = 0; const service = new FileExports({ ...options(join(root, "no.md")), chooseSave: async () => { pickers++; return null } })
  for (const value of [{ ...request(), path: "/arbitrary.md" }, { ...request(), filename: "../x.md" }, { ...request(), filename: "CON.md" }, { ...request(), filename: "x.md " }, { ...request(), filename: "x.txt" }, { ...request(), bytes: new Uint8Array(MAX_EXPORT_BYTES + 1) }]) {
    const result = await service.save("window:nonce", value); assert.equal(result.status, "failed"); if (result.status === "failed") assert.equal(result.code, "EXPORT_INPUT_INVALID")
  }
  assert.equal(pickers, 0); assert.deepEqual(await readdir(root), [])
}))
test("EX16-04 cancel releases a pending picker, and its late path cannot overwrite a new owner's file", () => fixture(async root => {
  const gate = Promise.withResolvers<string | null>(), source = request("old"), path = join(root, "selected.md")
  const service = new FileExports({ ...options(path), chooseSave: async () => gate.promise })
  const pending = service.save("window:nonce", source); await new Promise(resolve => setImmediate(resolve)); service.cancel("window:nonce", source.id)
  assert.equal((await pending).status, "cancelled"); await service.flush()
  await writeFile(path, "new-owner"); gate.resolve(path); await new Promise(resolve => setImmediate(resolve)); assert.equal(await readFile(path, "utf8"), "new-owner")
}))
test("EX16-05 duplicate operation does not open another picker; a successful ID cannot replay", () => fixture(async root => {
  const gate = Promise.withResolvers<string | null>(), source = request(), path = join(root, "selected.md"); let pickers = 0
  const service = new FileExports({ ...options(path), chooseSave: async () => { pickers++; return gate.promise } })
  const first = service.save("owner", source); await new Promise(resolve => setImmediate(resolve))
  const busy = await service.save("owner", request()); assert.equal(busy.status, "failed"); if (busy.status === "failed") assert.equal(busy.code, "EXPORT_BUSY")
  gate.resolve(path); assert.equal((await first).status, "saved")
  const replay = await service.save("owner", source); assert.equal(replay.status, "failed"); if (replay.status === "failed") assert.equal(replay.code, "EXPORT_REPLAY"); assert.equal(pickers, 1)
}))
test("EX16-06 symlink, hardlink and directory destinations are preserved", () => fixture(async root => {
  const original = join(root, "original.md"); await writeFile(original, "keep")
  const symbolic = join(root, "symbolic.md"), hard = join(root, "hard.md"), directory = join(root, "directory.md")
  await symlink(original, symbolic); await link(original, hard); await mkdir(directory)
  for (const path of [symbolic, hard, directory]) assert.equal((await new FileExports(options(path)).save("owner", request())).status, "failed")
  assert.equal(await readFile(original, "utf8"), "keep")
}))
test("EX16-07 exact owner invalidation at commit preserves an existing file and cleans own temporary", () => fixture(async root => {
  const path = join(root, "old.md"); await writeFile(path, "old"); let current = true
  const service = new FileExports({ ...options(path), assertOwner: () => { if (!current) throw Error("private nonce") }, beforeRename: async () => { current = false } })
  assert.equal((await service.save("owner", request())).status, "cancelled"); assert.equal(await readFile(path, "utf8"), "old"); assert.deepEqual(await readdir(root), ["old.md"])
}))
test("EX16-08 changed destination and protected targets preserve old contents and expose only fixed safe errors", () => fixture(async root => {
  const path = join(root, "old.md"); await writeFile(path, "old")
  const service = new FileExports({ ...options(path), beforeRename: async () => { await writeFile(path, "external-change") } })
  const result = await service.save("owner", request()); assert.equal(result.status, "failed"); if (result.status === "failed") assert.equal(result.code, "EXPORT_TARGET_CHANGED"); assert.equal(await readFile(path, "utf8"), "external-change")
  const protectedService = new FileExports({ ...options(path), guardTarget: async () => { throw Error("secret-key/private-path") } })
  const denied = await protectedService.save("owner", request()); assert.equal(denied.status, "failed"); assert.doesNotMatch(JSON.stringify(denied), /secret-key|private-path/); assert.equal(await readFile(path, "utf8"), "external-change")
}))
test("EX16-09 replacing a wx temporary with foreign same bytes is refused without unlinking that file", () => fixture(async root => {
  const path = join(root, "new.md"), source = request(), service = new FileExports({ ...options(path), beforeRename: async () => {
    const temp = (await readdir(root)).find(name => name.endsWith(".tmp"))!; const target = join(root, temp); await unlink(target); await writeFile(target, source.bytes)
  } })
  const result = await service.save("owner", source); assert.equal(result.status, "failed"); assert.ok((await readdir(root)).some(name => name.endsWith(".tmp"))); assert.ok(!(await readdir(root)).includes("new.md"))
}))
test("EX16-10 directory fsync error cannot create a saved ACK or expose the raw cause", () => fixture(async root => {
  const path = join(root, "new.md"), source = request(), service = new FileExports({ ...options(path), beforeDirectorySync: async () => { throw Error("private I/O cause") } })
  const result = await service.save("owner", source); assert.equal(result.status, "failed"); if (result.status === "failed") assert.equal(result.code, "EXPORT_DURABILITY_UNCONFIRMED")
  assert.deepEqual(new Uint8Array(await readFile(path)), source.bytes); assert.doesNotMatch(JSON.stringify(result), /private/)
}))
test("EX16-13 owner loss after rename reports unconfirmed durability rather than a cancelled no-write", () => fixture(async root => {
  let active = true; const path = join(root, "committed.md"), source = request(), service = new FileExports({ ...options(path), assertOwner: () => { if (!active) throw Error("nonce expired") }, beforeDirectorySync: async () => { active = false } })
  const result = await service.save("owner", source); assert.equal(result.status, "failed"); if (result.status === "failed") assert.equal(result.code, "EXPORT_DURABILITY_UNCONFIRMED"); assert.deepEqual(new Uint8Array(await readFile(path)), source.bytes)
}))
test("EX16-14 the validated source bytes are immutable while the native picker is pending", () => fixture(async root => {
  const gate = Promise.withResolvers<string | null>(), source = request("original"), path = join(root, "source.md"), service = new FileExports({ ...options(path), chooseSave: async () => gate.promise })
  const pending = service.save("owner", source); source.bytes.fill(0); gate.resolve(path); assert.equal((await pending).status, "saved"); assert.equal(await readFile(path, "utf8"), "original")
}))
test("EX16-15 a real read-only selected directory fails without truncating an existing document", () => fixture(async root => {
  const path = join(root, "old.md"); await writeFile(path, "keep"); await chmod(root, 0o500)
  try { const result = await new FileExports(options(path)).save("owner", request()); assert.equal(result.status, "failed"); if (result.status === "failed") assert.equal(result.code, "EXPORT_WRITE_FAILED"); assert.equal(await readFile(path, "utf8"), "keep"); assert.deepEqual(await readdir(root), ["old.md"]) }
  finally { await chmod(root, 0o700) }
}))
test("EX16-11 cancelled physical writes still consume the bounded pending budget until actual completion", () => fixture(async root => {
  const gate = Promise.withResolvers<void>(), flights: Promise<unknown>[] = []; let entered = 0, selections = 0
  const service = new FileExports({ ...options(join(root, "unused.md")), chooseSave: async () => join(root, `file-${++selections}.md`), beforeRename: async () => { entered++; await gate.promise } })
  try {
    for (let index = 0; index < 8; index++) { const source = request(); flights.push(service.save(`owner-${index}`, source)); while (entered <= index) await new Promise(resolve => setImmediate(resolve)); service.cancel(`owner-${index}`, source.id) }
    let result: Awaited<ReturnType<FileExports["save"]>> | undefined
    flights.push(service.save("ninth", request()).then(value => { result = value }))
    await new Promise(resolve => setImmediate(resolve)); assert.equal(result?.status, "failed"); if (result?.status === "failed") assert.equal(result.code, "EXPORT_BUSY"); assert.equal(selections, 8)
  } finally { gate.resolve(); await Promise.allSettled(flights); await service.flush() }
}))
test("EX16-12 Windows attempts directory sync, allowing only an explicit unsupported error and never EIO", async t => fixture(async root => {
  const originalOpen = fs.open, canonical = await realpath(root); let code = "ENOTSUP", attempted = 0
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => { if (args[0] === canonical) { attempted++; throw Object.assign(Error("private directory failure"), { code }) } return originalOpen(...args) }); syncBuiltinESMExports()
  try {
    const supported = await new FileExports({ ...options(join(root, "first.md")), platform: "win32" }).save("owner", request())
    assert.equal(attempted, 1); assert.equal(supported.status, "saved")
    code = "EIO"; const failed = await new FileExports({ ...options(join(root, "second.md")), platform: "win32" }).save("owner", request())
    assert.equal(attempted, 2); assert.equal(failed.status, "failed"); if (failed.status === "failed") assert.equal(failed.code, "EXPORT_DURABILITY_UNCONFIRMED")
  } finally { t.mock.restoreAll(); syncBuiltinESMExports() }
}))
