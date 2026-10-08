ALTER TABLE "TextComment" ADD COLUMN "anchorHash" TEXT;
CREATE TABLE "PreparedTextChange" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "novelId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL, "commentId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "baseVersion" INTEGER,
  "baseUpdatedAt" TIMESTAMP(3) NOT NULL, "baseHash" TEXT NOT NULL,
  "oldText" TEXT NOT NULL, "start" INTEGER NOT NULL, "end" INTEGER NOT NULL,
  "replacement" TEXT NOT NULL, "reply" TEXT NOT NULL,
  "commentUpdatedAt" TIMESTAMP(3) NOT NULL, "commentStatus" "CommentStatus" NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ready', "consumedOperationId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PreparedTextChange_state" CHECK ("status" IN ('ready', 'consumed')),
  CONSTRAINT "PreparedTextChange_range" CHECK ("start" >= 0 AND "end" > "start")
);
CREATE UNIQUE INDEX "PreparedTextChange_userId_operationId_key" ON "PreparedTextChange"("userId", "operationId");
CREATE INDEX "PreparedTextChange_novelId_targetType_targetId_idx" ON "PreparedTextChange"("novelId", "targetType", "targetId");
CREATE TABLE "TargetTextRevision" (
  "id" TEXT NOT NULL PRIMARY KEY, "operationId" TEXT NOT NULL, "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL, "field" TEXT NOT NULL, "side" TEXT NOT NULL,
  "text" TEXT NOT NULL, "hash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TargetTextRevision_side" CHECK ("side" IN ('before', 'after'))
);
CREATE UNIQUE INDEX "TargetTextRevision_operationId_side_key" ON "TargetTextRevision"("operationId", "side");
CREATE INDEX "TargetTextRevision_targetType_targetId_createdAt_idx" ON "TargetTextRevision"("targetType", "targetId", "createdAt");
