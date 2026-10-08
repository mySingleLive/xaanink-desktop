CREATE TABLE "ContentCandidate" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "novelId" TEXT NOT NULL, "chapterId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL, "baseVersion" INTEGER NOT NULL, "baseHash" TEXT NOT NULL,
  "content" TEXT NOT NULL, "contentHash" TEXT NOT NULL, "source" TEXT NOT NULL,
  "sourceRunId" TEXT, "status" TEXT NOT NULL, "checks" JSONB NOT NULL,
  "proposedCommentActions" JSONB NOT NULL DEFAULT '[]', "acceptedOperationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentCandidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentCandidate_status_check" CHECK ("status" IN ('incomplete','ready','needs_review','accepted','discarded'))
);
CREATE UNIQUE INDEX "ContentCandidate_userId_operationId_key" ON "ContentCandidate"("userId","operationId");
CREATE INDEX "ContentCandidate_novelId_chapterId_createdAt_idx" ON "ContentCandidate"("novelId","chapterId","createdAt");
