ALTER TABLE "UsageRecord" ADD COLUMN "turnId" TEXT, ADD COLUMN "attemptId" TEXT;
CREATE INDEX "UsageRecord_turnId_attemptId_idx" ON "UsageRecord"("turnId", "attemptId");
CREATE TABLE "AttemptObservation" (
 "attemptId" TEXT PRIMARY KEY REFERENCES "ChatAttempt"(id) ON DELETE CASCADE,
 "turnId" TEXT NOT NULL, "modelId" TEXT, "provider" TEXT, "auto" BOOLEAN NOT NULL DEFAULT false,
 "data" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AttemptObservation_provider_modelId_createdAt_idx" ON "AttemptObservation"("provider", "modelId", "createdAt");
CREATE INDEX "AttemptObservation_turnId_idx" ON "AttemptObservation"("turnId");
