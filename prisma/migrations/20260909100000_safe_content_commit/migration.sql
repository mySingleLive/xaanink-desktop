-- 不删除、合并或伪造旧快照。有冲突时先保留原记录并出审计提案。
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "ContentVersion" WHERE "targetType" = 'Chapter'
    GROUP BY "targetId", "version" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Chapter snapshot duplicates require a reviewed repair before migration';
  END IF;
END $$;
CREATE UNIQUE INDEX "ContentVersion_chapter_revision_key"
  ON "ContentVersion" ("targetType", "targetId", "version") WHERE "targetType" = 'Chapter';

CREATE TABLE "ContentMutation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "novelId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "beforeVersion" INTEGER,
  "afterVersion" INTEGER,
  "beforeHash" TEXT NOT NULL,
  "afterHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentMutation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContentMutation_userId_operationId_key" ON "ContentMutation"("userId", "operationId");
CREATE INDEX "ContentMutation_novelId_targetType_targetId_idx" ON "ContentMutation"("novelId", "targetType", "targetId");
