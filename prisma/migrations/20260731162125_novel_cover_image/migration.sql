-- CreateEnum
CREATE TYPE "CoverImageSource" AS ENUM ('AI', 'UPLOAD');

-- CreateTable
CREATE TABLE "NovelCoverImage" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "source" "CoverImageSource" NOT NULL,
    "url" TEXT NOT NULL,
    "prompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NovelCoverImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NovelCoverImage_novelId_createdAt_idx" ON "NovelCoverImage"("novelId", "createdAt");

-- AddForeignKey
ALTER TABLE "NovelCoverImage" ADD CONSTRAINT "NovelCoverImage_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
