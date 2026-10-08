import assert from "node:assert/strict"
import { before, after, test } from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { PrismaClient } from "../../src/generated/prisma/client"
import { LocalPGliteAdapter } from "../../desktop/service/database/pglite-adapter"
import { loadMigrations, migrateDatabase } from "../../desktop/service/database/migrations"
import { LOCAL_AUTHOR_ID, runInDatabaseContext } from "../../desktop/service/context"
import { commitChapterRevision, contentHash } from "../../src/lib/services/content-commit"
import { auth } from "../../src/lib/auth"
import { getOwnedNovel } from "../../desktop/handlers/novels/[id]/lib"

let root: string; let engine: PGlite; let db: PrismaClient
const scoped = <T>(run: () => T) => runInDatabaseContext({ workspaceId: "fixture-work", database: db }, run)
before(async () => {
  root = await mkdtemp(join(tmpdir(), "xuanxiang-original-services-"))
  engine = await PGlite.create({ dataDir: join(root, "database"), relaxedDurability: false })
  await migrateDatabase(engine, await loadMigrations(join(process.cwd(), "prisma/migrations")))
  db = new PrismaClient({ adapter: new LocalPGliteAdapter(engine) })
  await db.user.create({ data: { id: LOCAL_AUTHOR_ID, email: "local-author@localhost.invalid", name: "测试作者", passwordHash: "" } })
  await db.novel.create({ data: { id: "novel-a", userId: LOCAL_AUTHOR_ID, title: "隔离夹具作品" } })
  await db.volume.create({ data: { id: "volume-a", novelId: "novel-a", index: 1, title: "卷一", summary: "" } })
  await db.chapter.create({ data: { id: "chapter-a", volumeId: "volume-a", index: 1, title: "首章", outline: "章纲", content: "初稿正文", status: "FINAL" } })
})
after(async () => { await db?.$disconnect(); await engine?.close(); if (root) await rm(root, { recursive: true, force: true }) })

test("IPC-01: local identity requires trusted context and retains novel ownership checks", async () => {
  assert.equal(await auth(), null)
  await db.user.create({ data: { id: "foreign-author", email: "foreign@localhost.invalid", name: "其他作者", passwordHash: "" } })
  await db.novel.create({ data: { id: "foreign-work", userId: "foreign-author", title: "不属于本地作者" } })
  await scoped(async () => {
    assert.deepEqual((await auth())?.user, { id: LOCAL_AUTHOR_ID, role: "USER" })
    assert.equal("novel" in await getOwnedNovel("novel-a"), true)
    const foreign = await getOwnedNovel("foreign-work")
    assert.equal("error" in foreign ? foreign.error.status : null, 403)
  })
})

test("SERVICE-content-commit: original CAS, idempotency and immutable snapshots execute on PGlite", () => scoped(async () => {
  const input = { userId: LOCAL_AUTHOR_ID, novelId: "novel-a", chapterId: "chapter-a", expectedVersion: 1, operationId: "manual-op-1", source: "manual" as const, reason: "手动修改", changes: { content: "改后的中文正文🖋️" } }
  const receipt = await commitChapterRevision(input)
  assert.equal(receipt.version, 2)
  assert.equal(receipt.contentHash, contentHash(input.changes.content))
  assert.deepEqual(await commitChapterRevision(input), receipt)
  assert.equal(await db.contentMutation.count(), 1)
  assert.equal(await db.contentVersion.count({ where: { targetId: "chapter-a" } }), 2)
  assert.equal((await db.chapter.findUniqueOrThrow({ where: { id: "chapter-a" } })).status, "WRITTEN")
  await assert.rejects(commitChapterRevision({ ...input, operationId: "stale", changes: { content: "不该覆盖" } }), { code: "VERSION_CONFLICT" })
  await assert.rejects(commitChapterRevision({ ...input, changes: { content: "换内容却重放编号" } }), { code: "OPERATION_CONFLICT" })
  await assert.rejects(commitChapterRevision({ ...input, userId: "other-author", operationId: "unauthorized" }), { code: "TARGET_NOT_FOUND" })
}))

test("SERVICE-content-commit: failure inside original effects rolls back content, version, snapshots and receipt", () => scoped(async () => {
  const before = await db.chapter.findUniqueOrThrow({ where: { id: "chapter-a" } })
  const count = await db.contentVersion.count({ where: { targetId: before.id } })
  await assert.rejects(commitChapterRevision({ userId: LOCAL_AUTHOR_ID, novelId: "novel-a", chapterId: before.id, expectedVersion: before.version,
    operationId: "effect-failure", source: "manual", reason: "回滚夹具", changes: { content: "不能残留" } }, async tx => {
    await tx.novel.update({ where: { id: "novel-a" }, data: { title: "同事务临时标题" } }); throw new Error("effect fixture failed")
  }), /effect fixture failed/)
  assert.deepEqual(await db.chapter.findUniqueOrThrow({ where: { id: before.id } }), before)
  assert.equal(await db.contentVersion.count({ where: { targetId: before.id } }), count)
  assert.equal(await db.contentMutation.count({ where: { operationId: "effect-failure" } }), 0)
  assert.equal((await db.novel.findUniqueOrThrow({ where: { id: "novel-a" } })).title, "隔离夹具作品")
}))

test("ADAPTER-07: usage records retain an immutable local model snapshot and uncallable reference", async () => {
  await db.aIModel.create({ data: { id: "global-model-reference", name: "测试型号", provider: "custom", modelId: "fixture-text", apiKeyEncrypted: "", enabled: false, inputCostPer1k: 0, outputCostPer1k: 0 } })
  const snapshot = { modelId: "fixture-text", authRevision: 4, priceConfigured: false, kind: "TEXT" }
  const usage = await db.usageRecord.create({ data: { userId: LOCAL_AUTHOR_ID, novelId: "novel-a", modelId: "global-model-reference", action: "fixture", promptTokens: 12, completionTokens: 8, cost: 0, modelSnapshot: snapshot } as never })
  assert.deepEqual((usage as unknown as { modelSnapshot: unknown }).modelSnapshot, snapshot)
  const reference = await db.aIModel.findUniqueOrThrow({ where: { id: "global-model-reference" } })
  assert.equal(reference.enabled, false); assert.equal(reference.apiKeyEncrypted, "")
})
