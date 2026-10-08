-- AlterTable
ALTER TABLE "Storyboard" ADD COLUMN     "sampleOutline" JSONB,
ADD COLUMN     "sampleOutlineAt" TIMESTAMP(3),
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'chapter';

-- AlterTable
ALTER TABLE "TrunkNode" ADD COLUMN     "linkBoardId" TEXT;
