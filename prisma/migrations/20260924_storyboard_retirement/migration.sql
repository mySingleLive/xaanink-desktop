-- 故事板退役（不可逆）：删除 Storyboard/TrunkNode/ShotCard/EmotionType 四表。
-- 伏笔触点转挂章节规则（docs/creation-flow-v3/02-technical-design.md §1）：
--   挂了分镜卡的触点（shotCardId 非空，无论是否同时挂节点）→ 该卡 chapterIds 的第一个关联章；
--   仅挂情节点的触点（shotCardId 为空）→ 该节点分镜卡集合（按卡 index 升序）第一个非空 chapterIds 首元素；
--   取不到关联章的触点保留摘要与评分，成为无锚点记录，不删除伏笔数据。

-- 1) 挂了分镜卡的触点：转挂触点自身那张卡的第一个关联章
UPDATE "ForeshadowTouch" t
SET "chapterId" = c."chapterIds"[1]
FROM "ShotCard" c
WHERE c."id" = t."shotCardId"
  AND t."shotCardId" IS NOT NULL
  AND t."chapterId" IS NULL
  AND c."chapterIds"[1] IS NOT NULL;

-- 2) 仅挂情节点的触点（shotCardId 为空）：转挂该节点分镜卡集合中第一个非空 chapterIds 的首元素
UPDATE "ForeshadowTouch" t
SET "chapterId" = sub."chapterId"
FROM (
  SELECT DISTINCT ON (n."id") n."id" AS "nodeId", c."chapterIds"[1] AS "chapterId"
  FROM "TrunkNode" n
  JOIN "ShotCard" c ON c."trunkNodeId" = n."id"
  WHERE c."chapterIds"[1] IS NOT NULL
  ORDER BY n."id", c."index" ASC
) sub
WHERE t."trunkNodeId" = sub."nodeId"
  AND t."shotCardId" IS NULL
  AND t."chapterId" IS NULL;

-- 3) 指向被删实体的伏笔引用（保留即悬空）
DELETE FROM "ForeshadowReference" WHERE "targetType" IN ('TRUNK_NODE', 'STORYBOARD_PROSE');

-- 4) 引用目标类型白名单同步收缩
ALTER TABLE "ForeshadowReference" DROP CONSTRAINT "ForeshadowReference_targetType_check";
ALTER TABLE "ForeshadowReference" ADD CONSTRAINT "ForeshadowReference_targetType_check" CHECK ("targetType" IN ('CHAPTER_OUTLINE', 'CHAPTER_CONTENT'));

-- 5) 触点结构：删除情节点/分镜卡两列及索引
DROP INDEX "ForeshadowTouch_novelId_trunkNodeId_idx";
ALTER TABLE "ForeshadowTouch" DROP COLUMN "trunkNodeId", DROP COLUMN "shotCardId";

-- 6) 删除故事板四表
DROP TABLE "ShotCard";
DROP TABLE "TrunkNode";
DROP TABLE "Storyboard";
DROP TABLE "EmotionType";
