-- CreateEnum
CREATE TYPE "ForeshadowStatus" AS ENUM ('PLANNED', 'PLANTED', 'RESOLVED', 'DROPPED');

-- CreateEnum
CREATE TYPE "ForeshadowTouchKind" AS ENUM ('PLANT', 'MENTION', 'PAYOFF');

-- CreateTable
CREATE TABLE "Foreshadow" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "expectation" TEXT NOT NULL DEFAULT '',
    "plannedChapter" INTEGER,
    "status" "ForeshadowStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Foreshadow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForeshadowTouch" (
    "id" TEXT NOT NULL,
    "foreshadowId" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "kind" "ForeshadowTouchKind" NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "trunkNodeId" TEXT,
    "shotCardId" TEXT,
    "chapterId" TEXT,
    "score" DOUBLE PRECISION,
    "scoreComment" TEXT NOT NULL DEFAULT '',
    "scoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForeshadowTouch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Foreshadow_novelId_status_idx" ON "Foreshadow"("novelId", "status");

-- CreateIndex
CREATE INDEX "ForeshadowTouch_novelId_chapterId_idx" ON "ForeshadowTouch"("novelId", "chapterId");

-- CreateIndex
CREATE INDEX "ForeshadowTouch_novelId_trunkNodeId_idx" ON "ForeshadowTouch"("novelId", "trunkNodeId");

-- CreateIndex
CREATE INDEX "ForeshadowTouch_foreshadowId_createdAt_idx" ON "ForeshadowTouch"("foreshadowId", "createdAt");

-- AddForeignKey
ALTER TABLE "ForeshadowTouch" ADD CONSTRAINT "ForeshadowTouch_foreshadowId_fkey" FOREIGN KEY ("foreshadowId") REFERENCES "Foreshadow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
