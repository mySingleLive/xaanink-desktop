-- 仅增量扩展；legacy 无绑定评分不伪造内容版本。无破坏性回填。
ALTER TABLE "Review"
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "contentVersion" INTEGER,
  ADD COLUMN "candidateId" TEXT,
  ADD COLUMN "reviewConfigHash" TEXT,
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'current',
  ADD COLUMN "sourceRunId" TEXT;
CREATE INDEX "Review_novelId_targetId_contentHash_reviewConfigHash_idx" ON "Review"("novelId", "targetId", "contentHash", "reviewConfigHash");
CREATE INDEX "Review_candidateId_idx" ON "Review"("candidateId");
ALTER TABLE "SubAgentRun"
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "contentVersion" INTEGER,
  ADD COLUMN "candidateId" TEXT,
  ADD COLUMN "reviewConfigHash" TEXT;
CREATE INDEX "SubAgentRun_candidateId_idx" ON "SubAgentRun"("candidateId");
ALTER TABLE "ContentCandidate"
  ADD COLUMN "baseContent" TEXT,
  ADD COLUMN "withdrawnOperationId" TEXT,
  ADD COLUMN "baselineReviewId" TEXT,
  ADD COLUMN "candidateReviewId" TEXT,
  ADD COLUMN "reviewConfigHash" TEXT,
  ADD COLUMN "targetWordCount" INTEGER,
  ADD COLUMN "wordRequirement" JSONB,
  ADD COLUMN "improvementId" TEXT,
  ADD COLUMN "iteration" INTEGER,
  ADD COLUMN "qualityDecision" JSONB;
CREATE INDEX "ContentCandidate_improvementId_idx" ON "ContentCandidate"("improvementId");
CREATE TABLE "ContentImprovementRun" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "novelId" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL, "operationId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "turnId" TEXT, "attemptId" TEXT, "baseVersion" INTEGER NOT NULL, "baseHash" TEXT NOT NULL,
  "baseContent" TEXT NOT NULL, "authorInstructions" TEXT NOT NULL, "comments" JSONB NOT NULL,
  "boundaries" JSONB NOT NULL, "wordRequirement" JSONB NOT NULL, "reviewConfig" JSONB, "reviewConfigHash" TEXT,
  "writerCalls" INTEGER NOT NULL DEFAULT 0 CHECK ("writerCalls" BETWEEN 0 AND 2),
  "baselineCalls" INTEGER NOT NULL DEFAULT 0 CHECK ("baselineCalls" BETWEEN 0 AND 1),
  "candidateCalls" INTEGER NOT NULL DEFAULT 0 CHECK ("candidateCalls" BETWEEN 0 AND 2),
  "candidateIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "status" TEXT NOT NULL DEFAULT 'running',
  "result" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ContentImprovementRun_userId_operationId_key" ON "ContentImprovementRun"("userId", "operationId");
CREATE UNIQUE INDEX "ContentImprovementRun_turnId_chapterId_key" ON "ContentImprovementRun"("turnId", "chapterId");
CREATE INDEX "ContentImprovementRun_novelId_chapterId_idx" ON "ContentImprovementRun"("novelId", "chapterId");
CREATE TABLE "CandidateCommentEffect" (
  "id" TEXT NOT NULL PRIMARY KEY, "novelId" TEXT NOT NULL, "candidateId" TEXT NOT NULL,
  "commentId" TEXT NOT NULL, "beforeStatus" TEXT NOT NULL, "afterStatus" TEXT NOT NULL,
  "afterUpdatedAt" TIMESTAMP(3) NOT NULL, "replyId" TEXT NOT NULL, "withdrawnAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CandidateCommentEffect_candidateId_commentId_key" ON "CandidateCommentEffect"("candidateId", "commentId");
CREATE INDEX "CandidateCommentEffect_novelId_idx" ON "CandidateCommentEffect"("novelId");
