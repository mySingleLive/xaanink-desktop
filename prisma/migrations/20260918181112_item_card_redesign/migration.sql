-- CreateEnum
CREATE TYPE "ItemImageSource" AS ENUM ('AI', 'UPLOAD');

-- DropForeignKey
ALTER TABLE "AttemptObservation" DROP CONSTRAINT "AttemptObservation_attemptId_fkey";

-- AlterTable
ALTER TABLE "ForeshadowReference" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "acquisition" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "aliases" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "appearance" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "effects" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "iconCrop" JSONB,
ADD COLUMN     "iconUrl" TEXT,
ADD COLUMN     "levels" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "tags" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "ItemImage" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "source" "ItemImageSource" NOT NULL,
    "url" TEXT NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemImage_itemId_createdAt_idx" ON "ItemImage"("itemId", "createdAt");

-- AddForeignKey
ALTER TABLE "ItemImage" ADD CONSTRAINT "ItemImage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptObservation" ADD CONSTRAINT "AttemptObservation_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ChatAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
