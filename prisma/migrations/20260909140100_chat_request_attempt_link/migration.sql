ALTER TABLE "ChatAttempt" ADD COLUMN "requestId" TEXT;
ALTER TABLE "SubAgentRun" ADD COLUMN "attemptId" TEXT;
CREATE INDEX "SubAgentRun_attemptId_idx" ON "SubAgentRun"("attemptId");
