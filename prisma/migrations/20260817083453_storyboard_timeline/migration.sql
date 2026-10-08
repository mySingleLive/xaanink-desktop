-- AlterTable
ALTER TABLE "Storyboard" ADD COLUMN     "timelineCharacterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "timelineForeshadowIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "TrunkNode" ADD COLUMN     "characterStates" JSONB;
