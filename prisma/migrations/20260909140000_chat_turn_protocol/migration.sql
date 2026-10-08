ALTER TABLE "Conversation" ADD COLUMN "activeAttemptId" TEXT, ADD COLUMN "executionEpoch" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "leaseExpiresAt" TIMESTAMP(3), ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN "turnId" TEXT, ADD COLUMN "attemptId" TEXT, ADD COLUMN "parts" JSONB;
CREATE UNIQUE INDEX "Message_turn_user_key" ON "Message"("turnId") WHERE "role" = 'USER' AND "turnId" IS NOT NULL;
CREATE UNIQUE INDEX "Message_attempt_assistant_key" ON "Message"("attemptId") WHERE "role" = 'ASSISTANT' AND "attemptId" IS NOT NULL;
CREATE TABLE "ChatTurn" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "conversationId" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "userMessageId" TEXT NOT NULL UNIQUE, "clientRequestId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued',
 "latestAttemptId" TEXT, "interaction" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ChatTurn_status_check" CHECK ("status" IN ('queued','running','waiting_user','succeeded','failed','interrupted'))
);
CREATE UNIQUE INDEX "ChatTurn_userId_clientRequestId_key" ON "ChatTurn"("userId", "clientRequestId");
CREATE INDEX "ChatTurn_conversationId_createdAt_idx" ON "ChatTurn"("conversationId", "createdAt");
CREATE TABLE "ChatAttempt" (
 "id" TEXT PRIMARY KEY, "turnId" TEXT NOT NULL REFERENCES "ChatTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "attemptNo" INTEGER NOT NULL, "assistantMessageId" TEXT NOT NULL UNIQUE, "executionEpoch" INTEGER NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'queued', "stage" TEXT NOT NULL DEFAULT 'waiting_model',
 "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastProgressAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "endedAt" TIMESTAMP(3), "errorCode" TEXT, "errorMessage" TEXT, "diagnosticId" TEXT,
 "retryUsed" INTEGER NOT NULL DEFAULT 0, "hasWriteEffects" BOOLEAN NOT NULL DEFAULT false, "lastEventSeq" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ChatAttempt_status_check" CHECK ("status" IN ('queued','running','waiting_user','succeeded','failed','interrupted'))
);
CREATE UNIQUE INDEX "ChatAttempt_turnId_attemptNo_key" ON "ChatAttempt"("turnId", "attemptNo");
CREATE TABLE "ChatRequest" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "clientRequestId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "turnId" TEXT NOT NULL REFERENCES "ChatTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE, "entryAttemptId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ChatRequest_userId_clientRequestId_key" ON "ChatRequest"("userId", "clientRequestId");
CREATE TABLE "ChatToolExecution" (
 "id" TEXT PRIMARY KEY, "turnId" TEXT NOT NULL,
 "attemptId" TEXT NOT NULL REFERENCES "ChatAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "toolCallId" TEXT NOT NULL, "toolName" TEXT NOT NULL, "operationId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "input" JSONB NOT NULL, "output" JSONB, "status" TEXT NOT NULL DEFAULT 'started', "hasExternalEffects" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ChatToolExecution_status_check" CHECK ("status" IN ('started','succeeded','failed','unknown'))
);
CREATE UNIQUE INDEX "ChatToolExecution_attemptId_toolCallId_key" ON "ChatToolExecution"("attemptId", "toolCallId");
CREATE INDEX "ChatToolExecution_turnId_operationId_idx" ON "ChatToolExecution"("turnId", "operationId");
CREATE TABLE "ChatWriteEffect" (
 "id" TEXT PRIMARY KEY, "toolExecutionId" TEXT NOT NULL REFERENCES "ChatToolExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "targetModel" TEXT NOT NULL, "targetId" TEXT, "operation" TEXT NOT NULL, "receipt" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ChatWriteEffect_toolExecutionId_idx" ON "ChatWriteEffect"("toolExecutionId");
