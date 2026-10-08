import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, realpath, writeFile, readFile, readdir, rm, rename, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { selectBrandStartupPaths } from "../../desktop/main/brand-startup-paths"
import { directoryIdentity } from "../../desktop/core/root-ownership"
import { Workspaces } from "../../desktop/service/workspaces"
import { prisma } from "../../src/lib/db"

async function fixture(run: (paths: { base: string; appData: string; home: string; isolatedRoot: null }) => Promise<void>) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "xaanink-brand-startup-"))), appData = join(base, "app-data"), home = join(base, "home")
  await mkdir(appData); await mkdir(home)
  try { await run({ base, appData, home, isolatedRoot: null }) } finally { await rm(base, { recursive: true, force: true }) }
}
async function readyRoot(root: string, family: "legacy" | "current") {
  await mkdir(join(root, "inbox"), { recursive: true }); const id = randomUUID()
  // Old filename/app strings are historical fixture protocol values.
  await writeFile(join(root, family === "legacy" ? "xuanxiang-app.json" : "xaanink-app.json"), JSON.stringify({ schemaVersion: 1, app: family === "legacy" ? "Xuanxiangxiezuo-Desktop" : "XaanInk", id, phase: "ready", inboxReady: true }))
  return { schemaVersion: 1, revision: 1, rootId: id, migrationId: null, root: await directoryIdentity(root) }
}

test("BSP01 a clean install selects current paths without creating any directory", async () => {
  await fixture(async paths => {
    const before = await readdir(paths.base), result = selectBrandStartupPaths(paths)
    assert.deepEqual(result, { bootstrap: join(paths.appData, "XaanInk"), defaultRoot: join(paths.home, ".xaanink"), encryptionFamily: "current" })
    assert.equal(existsSync(result.bootstrap), false); assert.equal(existsSync(result.defaultRoot), false)
    assert.deepEqual(await readdir(paths.base), before)
  })
})

test("BSP02 the original bootstrap lock and its custom legacy pointer win over default roots", async () => {
  await fixture(async paths => {
    const bootstrap = join(paths.appData, "Xuanxiangxiezuo-Desktop"); await mkdir(bootstrap)
    const custom = join(paths.base, "作者自定义数据"), pointer = await readyRoot(custom, "legacy"), bytes = JSON.stringify(pointer)
    await writeFile(join(bootstrap, "data-root.json"), bytes)
    await readyRoot(join(paths.home, ".xaanink"), "current")
    assert.deepEqual(selectBrandStartupPaths(paths), { bootstrap, defaultRoot: custom, encryptionFamily: "legacy" })
    assert.equal(await readFile(join(bootstrap, "data-root.json"), "utf8"), bytes)
    assert.equal(existsSync(join(paths.appData, "XaanInk")), false)
  })
})

test("BSP03 a valid legacy default root is adopted without moving it into the current namespace", async () => {
  await fixture(async paths => {
    const root = join(paths.home, ".xuanxiang"); await readyRoot(root, "legacy")
    const result = selectBrandStartupPaths(paths)
    assert.equal(result.defaultRoot, root); assert.equal(result.encryptionFamily, "legacy")
    assert.equal(existsSync(join(paths.home, ".xaanink")), false)
    assert.equal(existsSync(result.bootstrap), false, "selection itself has no mkdir or pointer-write side effects")
  })
})

test("BSP04 a damaged legacy pointer, missing pointed root, and incomplete control history never silently become a clean install", async () => {
  await fixture(async paths => {
    const bootstrap = join(paths.appData, "Xuanxiangxiezuo-Desktop"); await mkdir(bootstrap)
    const file = join(bootstrap, "data-root.json")
    for (const bytes of ["{damaged", JSON.stringify({ schemaVersion: 1, revision: 1, rootId: randomUUID(), migrationId: null, root: { path: join(paths.base, "missing"), device: "1", inode: "1" } })]) {
      await writeFile(file, bytes); assert.throws(() => selectBrandStartupPaths(paths))
      assert.equal(await readFile(file, "utf8"), bytes)
      assert.equal(existsSync(join(paths.appData, "XaanInk")), false); assert.equal(existsSync(join(paths.home, ".xaanink")), false)
    }
    await rm(file); await writeFile(join(bootstrap, "root-migration.json"), "{damaged")
    assert.throws(() => selectBrandStartupPaths(paths))
    assert.equal(await readFile(join(bootstrap, "root-migration.json"), "utf8"), "{damaged")
  })
})

test("BSP05 nonempty or unsafe legacy defaults are preserved and prevent new empty databases", async () => {
  await fixture(async paths => {
    const root = join(paths.home, ".xuanxiang"); await mkdir(root); await writeFile(join(root, "author.txt"), "不能覆盖作者数据")
    assert.throws(() => selectBrandStartupPaths(paths)); assert.deepEqual(await readdir(root), ["author.txt"])
    await rename(root, root + ".retained"); await symlink(root + ".retained", root, "dir")
    assert.throws(() => selectBrandStartupPaths(paths)); assert.equal(existsSync(join(paths.home, ".xaanink")), false)
    assert.equal(await readFile(join(root + ".retained", "author.txt"), "utf8"), "不能覆盖作者数据")
  })
})

test("BSP06 conflicting authoritative bootstrap histories require explicit recovery instead of choosing or merging", async () => {
  await fixture(async paths => {
    for (const [name, family] of [["Xuanxiangxiezuo-Desktop", "legacy"], ["XaanInk", "current"]] as const) {
      const bootstrap = join(paths.appData, name); await mkdir(bootstrap)
      await writeFile(join(bootstrap, "data-root.json"), JSON.stringify(await readyRoot(join(paths.base, name + "-root"), family)))
    }
    const before = await Promise.all(["Xuanxiangxiezuo-Desktop", "XaanInk"].map(name => readFile(join(paths.appData, name, "data-root.json"), "utf8")))
    assert.throws(() => selectBrandStartupPaths(paths))
    assert.deepEqual(await Promise.all(["Xuanxiangxiezuo-Desktop", "XaanInk"].map(name => readFile(join(paths.appData, name, "data-root.json"), "utf8"))), before)
  })
})

test("BSP07 test isolation never inspects or falls back to legacy application state", async () => {
  await fixture(async paths => {
    const legacy = join(paths.appData, "Xuanxiangxiezuo-Desktop"); await mkdir(legacy)
    await writeFile(join(legacy, "data-root.json"), "invalid legacy state must be ignored in explicit isolation")
    await mkdir(join(paths.home, ".xuanxiang")); await writeFile(join(paths.home, ".xuanxiang", "author.txt"), "宿主夹具")
    const isolatedRoot = join(paths.base, "isolated-data")
    assert.deepEqual(selectBrandStartupPaths({ ...paths, isolatedRoot }), { bootstrap: isolatedRoot + "-bootstrap", defaultRoot: isolatedRoot, encryptionFamily: "current" })
    assert.equal(existsSync(isolatedRoot), false); assert.equal(existsSync(isolatedRoot + "-bootstrap"), false)
    assert.equal(await readFile(join(legacy, "data-root.json"), "utf8"), "invalid legacy state must be ignored in explicit isolation")
  })
})

test("BSP08 a current pointer retains current encryption identity and rejects replacement root identity", async () => {
  await fixture(async paths => {
    const bootstrap = join(paths.appData, "XaanInk"), root = join(paths.base, "current-root"); await mkdir(bootstrap)
    const pointer = await readyRoot(root, "current"); await writeFile(join(bootstrap, "data-root.json"), JSON.stringify(pointer))
    assert.deepEqual(selectBrandStartupPaths(paths), { bootstrap, defaultRoot: root, encryptionFamily: "current" })
    await rename(root, root + ".retained"); await readyRoot(root, "current")
    assert.throws(() => selectBrandStartupPaths(paths))
    assert.equal(existsSync(join(paths.home, ".xaanink")), false)
  })
})

test("BSP09 an owned first-run inbox can finish initialization in its original namespace", async () => {
  for(const family of ["legacy","current"] as const) await fixture(async paths=>{
    const root=join(paths.home,family==="legacy"?".xuanxiang":".xaanink")
    await readyRoot(root,family)
    const file=join(root,family==="legacy"?"xuanxiang-app.json":"xaanink-app.json"),marker=JSON.parse(await readFile(file,"utf8"))
    marker.inboxReady=false;await writeFile(file,JSON.stringify(marker))
    await writeFile(join(root,"catalog.json"),JSON.stringify({schemaVersion:1,revision:1,value:[]}))
    const works=new Workspaces(root,join(process.cwd(),"prisma/migrations"))
    try{
      await works.initialize()
      const before=await readFile(file,"utf8"),selected=selectBrandStartupPaths(paths)
      assert.equal(selected.defaultRoot,root);assert.equal(selected.encryptionFamily,family)
      assert.equal(await readFile(file,"utf8"),before,"selection preserves partial initialization bytes")
      assert.equal(await works.run("inbox",()=>prisma.user.count()),1)
      const after=JSON.parse(await readFile(file,"utf8"));assert.equal(after.id,marker.id);assert.equal(after.inboxReady,true)
    }finally{await works.close()}
  })
})
