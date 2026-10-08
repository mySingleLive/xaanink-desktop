-- 严格 1:N 重构：ShotCard.trunkNodeId 改为必填。
-- 1) 删除孤儿卡（trunkNodeId 为 null 的旧「手工卡」与源节点已不存在的悬垂卡）；
-- 2) 为没有任何卡的情节点补建默认卡（卡文本 = 节点文本，序号接板内现有最大序号以 1024 步距递增）；
-- 3) 列置 NOT NULL。

-- 1) 孤儿卡清理
DELETE FROM "ShotCard"
WHERE "trunkNodeId" IS NULL
   OR "trunkNodeId" NOT IN (SELECT "id" FROM "TrunkNode");

-- 2) 无卡节点补建默认卡
WITH cardless AS (
  SELECT
    n."id" AS node_id,
    n."storyboardId" AS board_id,
    n."text" AS node_text,
    ROW_NUMBER() OVER (PARTITION BY n."storyboardId" ORDER BY n."index") AS rn
  FROM "TrunkNode" n
  WHERE NOT EXISTS (SELECT 1 FROM "ShotCard" c WHERE c."trunkNodeId" = n."id")
),
maxidx AS (
  SELECT "storyboardId", MAX("index") AS mx
  FROM "ShotCard"
  GROUP BY "storyboardId"
)
INSERT INTO "ShotCard"
  ("id", "storyboardId", "index", "trunkNodeId", "text",
   "chapterIds", "characterIds", "foreshadowIds", "sceneIds",
   "status", "staleSource", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  c.board_id,
  COALESCE(m.mx, 0) + c.rn * 1024,
  c.node_id,
  c.node_text,
  '{}', '{}', '{}', '{}',
  'draft', false, NOW(), NOW()
FROM cardless c
LEFT JOIN maxidx m ON m."storyboardId" = c.board_id;

-- 3) AlterTable
ALTER TABLE "ShotCard" ALTER COLUMN "trunkNodeId" SET NOT NULL;
