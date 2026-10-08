-- CreateTable
CREATE TABLE "SubAgentRun" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "conversationId" TEXT,
    "agentKind" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "transcript" JSONB,
    "result" JSONB,
    "tokenUsage" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubAgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubAgentRun_novelId_idx" ON "SubAgentRun"("novelId");

-- CreateIndex
CREATE INDEX "SubAgentRun_conversationId_idx" ON "SubAgentRun"("conversationId");
