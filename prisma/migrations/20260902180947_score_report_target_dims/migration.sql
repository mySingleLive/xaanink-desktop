-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "aiDimensions" JSONB;

-- AlterTable
ALTER TABLE "SubAgentRun" ADD COLUMN     "targetId" TEXT,
ADD COLUMN     "targetType" TEXT;

-- CreateIndex
CREATE INDEX "SubAgentRun_targetType_targetId_idx" ON "SubAgentRun"("targetType", "targetId");
