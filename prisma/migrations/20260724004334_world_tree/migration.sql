-- CreateTable
CREATE TABLE "World" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "World_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "worldId" TEXT;

-- ===== 数据迁移：WORLDVIEW 设定 → 世界（须在枚举重建前完成） =====

-- 1) 逐条 WORLDVIEW 设定生成同名世界，文字介绍迁入 description
INSERT INTO "World" ("id", "novelId", "parentId", "name", "description", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."novelId", NULL, s."name",
       COALESCE(s."content"->>'text', ''),
       s."createdAt", s."updatedAt"
FROM "Setting" s
WHERE s."type" = 'WORLDVIEW'
ORDER BY s."createdAt" ASC;

-- 2) 有世界级设定但没有任何世界的小说：补默认「主世界」
INSERT INTO "World" ("id", "novelId", "parentId", "name", "description", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, n."id", NULL, '主世界', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Novel" n
WHERE EXISTS (
    SELECT 1 FROM "Setting" s
    WHERE s."novelId" = n."id"
      AND s."type" IN ('LEVEL_SYSTEM','POWER_SYSTEM','CONCEPT','FACTION','MAP')
)
AND NOT EXISTS (SELECT 1 FROM "World" w WHERE w."novelId" = n."id");

-- 3) 世界级设定回填 worldId = 该小说最早创建的世界；金手指/文风保持 NULL（小说级）
UPDATE "Setting" s
SET "worldId" = w."id"
FROM (
    SELECT DISTINCT ON ("novelId") "novelId", "id"
    FROM "World"
    ORDER BY "novelId", "createdAt" ASC, "id" ASC
) w
WHERE s."novelId" = w."novelId"
  AND s."type" IN ('LEVEL_SYSTEM','POWER_SYSTEM','CONCEPT','FACTION','MAP');

-- 4) 删除已迁入世界的 WORLDVIEW 设定行
DELETE FROM "Setting" WHERE "type" = 'WORLDVIEW';

-- ===== 枚举重建（移除 WORLDVIEW，新增 SOCIETY/CULTURE/GEOGRAPHY） =====
BEGIN;
CREATE TYPE "SettingType_new" AS ENUM ('LEVEL_SYSTEM', 'POWER_SYSTEM', 'CONCEPT', 'GOLD_FINGER', 'STYLE', 'MAP', 'FACTION', 'SOCIETY', 'CULTURE', 'GEOGRAPHY');
ALTER TABLE "Setting" ALTER COLUMN "type" TYPE "SettingType_new" USING ("type"::text::"SettingType_new");
ALTER TYPE "SettingType" RENAME TO "SettingType_old";
ALTER TYPE "SettingType_new" RENAME TO "SettingType";
DROP TYPE "public"."SettingType_old";
COMMIT;

-- DropIndex
DROP INDEX "Setting_novelId_type_name_key";

-- CreateIndex
CREATE INDEX "World_novelId_parentId_idx" ON "World"("novelId", "parentId");

-- CreateIndex
CREATE INDEX "Setting_worldId_type_idx" ON "Setting"("worldId", "type");

-- CreateIndex
CREATE INDEX "Setting_parentId_idx" ON "Setting"("parentId");

-- 部分唯一索引（Prisma schema 无法表达条件唯一，仅存在于此迁移；与 service 层冲突检查对应）：
-- 小说级设定 (novelId,type,name) / 世界顶级设定 (worldId,type,name) / 子地图 (parentId,name)
CREATE UNIQUE INDEX "Setting_novel_type_name_key" ON "Setting"("novelId", "type", "name") WHERE "worldId" IS NULL AND "parentId" IS NULL;
CREATE UNIQUE INDEX "Setting_world_type_name_key" ON "Setting"("worldId", "type", "name") WHERE "worldId" IS NOT NULL AND "parentId" IS NULL;
CREATE UNIQUE INDEX "Setting_parent_name_key" ON "Setting"("parentId", "name") WHERE "parentId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "World" ADD CONSTRAINT "World_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "World" ADD CONSTRAINT "World_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Setting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
