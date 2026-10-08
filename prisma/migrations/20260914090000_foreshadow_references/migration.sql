CREATE TABLE "ForeshadowReference" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "novelId" TEXT NOT NULL,
  "touchId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL,
  "quote" TEXT,
  "prefix" TEXT,
  "suffix" TEXT,
  "startOffset" INTEGER,
  "endOffset" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ForeshadowReference_touchId_fkey" FOREIGN KEY ("touchId") REFERENCES "ForeshadowTouch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ForeshadowReference_targetType_check" CHECK ("targetType" IN ('TRUNK_NODE','CHAPTER_OUTLINE','CHAPTER_CONTENT','STORYBOARD_PROSE')),
  CONSTRAINT "ForeshadowReference_anchor_check" CHECK (("quote" IS NULL AND "startOffset" IS NULL AND "endOffset" IS NULL) OR (length("quote") > 0 AND "startOffset" >= 0 AND "endOffset" > "startOffset"))
);
CREATE UNIQUE INDEX "ForeshadowReference_touchId_identityKey_key" ON "ForeshadowReference"("touchId", "identityKey");
CREATE INDEX "ForeshadowReference_novelId_targetType_targetId_idx" ON "ForeshadowReference"("novelId", "targetType", "targetId");

-- 历史关系逐条保留；正文摘要的唯一精确匹配在读取时保守解析，不猜语义。
INSERT INTO "ForeshadowReference" ("id", "novelId", "touchId", "targetType", "targetId", "identityKey")
SELECT 'fr_' || md5(t."id" || k.kind), t."novelId", t."id", k.kind, t."chapterId", k.kind || ':' || t."chapterId" || ':whole'
FROM "ForeshadowTouch" t CROSS JOIN (VALUES ('CHAPTER_OUTLINE'), ('CHAPTER_CONTENT')) k(kind)
WHERE t."chapterId" IS NOT NULL;
INSERT INTO "ForeshadowReference" ("id", "novelId", "touchId", "targetType", "targetId", "identityKey")
SELECT 'fr_' || md5(t."id" || 'TRUNK_NODE'), t."novelId", t."id", 'TRUNK_NODE', t."trunkNodeId", 'TRUNK_NODE:' || t."trunkNodeId" || ':whole'
FROM "ForeshadowTouch" t WHERE t."trunkNodeId" IS NOT NULL;
INSERT INTO "ForeshadowReference" ("id", "novelId", "touchId", "targetType", "targetId", "identityKey")
SELECT 'fr_' || md5(t."id" || 'STORYBOARD_PROSE'), t."novelId", t."id", 'STORYBOARD_PROSE', n."storyboardId", 'STORYBOARD_PROSE:' || n."storyboardId" || ':whole'
FROM "ForeshadowTouch" t JOIN "TrunkNode" n ON n."id" = t."trunkNodeId"
JOIN "Storyboard" b ON b."id" = n."storyboardId" AND b."novelId" = t."novelId" AND b."type" = 'chapter';
