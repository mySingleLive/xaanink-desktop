-- AlterTable
ALTER TABLE "TrunkNode" ADD COLUMN     "emotions" JSONB;

-- CreateTable
CREATE TABLE "EmotionType" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmotionType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmotionType_novelId_idx" ON "EmotionType"("novelId");

-- CreateIndex
CREATE UNIQUE INDEX "EmotionType_novelId_label_key" ON "EmotionType"("novelId", "label");
