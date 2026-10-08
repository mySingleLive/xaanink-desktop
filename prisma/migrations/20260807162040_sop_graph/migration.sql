-- AlterTable
ALTER TABLE "SubAgentRun" ADD COLUMN     "sopNodeRunId" TEXT;

-- CreateTable
CREATE TABLE "SopPlan" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "entryIntent" TEXT,
    "items" JSONB NOT NULL,
    "deferredQuestions" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SopNodeRun" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "targetId" TEXT,
    "parentRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "iterations" INTEGER NOT NULL DEFAULT 0,
    "scoreHistory" JSONB,
    "finalScore" DOUBLE PRECISION,
    "openFindings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopNodeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SopPlan_novelId_idx" ON "SopPlan"("novelId");

-- CreateIndex
CREATE INDEX "SopPlan_conversationId_idx" ON "SopPlan"("conversationId");

-- CreateIndex
CREATE INDEX "SopNodeRun_novelId_idx" ON "SopNodeRun"("novelId");

-- CreateIndex
CREATE INDEX "SopNodeRun_parentRunId_idx" ON "SopNodeRun"("parentRunId");

-- CreateIndex
CREATE INDEX "SubAgentRun_sopNodeRunId_idx" ON "SubAgentRun"("sopNodeRunId");
