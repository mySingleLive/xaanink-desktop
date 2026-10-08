-- AlterTable
ALTER TABLE "ContentCandidate" ADD COLUMN     "basedOnCandidateId" TEXT,
ADD COLUMN     "drawId" TEXT,
ADD COLUMN     "variant" TEXT;

-- CreateIndex
CREATE INDEX "ContentCandidate_chapterId_drawId_idx" ON "ContentCandidate"("chapterId", "drawId");
