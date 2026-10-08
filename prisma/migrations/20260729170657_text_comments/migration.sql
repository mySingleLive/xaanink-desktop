-- CreateEnum
CREATE TYPE "CommentAuthorType" AS ENUM ('USER', 'AI');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('OPEN', 'AGREED', 'APPLIED');

-- CreateTable
CREATE TABLE "TextComment" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "parentId" TEXT,
    "quote" TEXT,
    "prefix" TEXT,
    "suffix" TEXT,
    "startOffset" INTEGER,
    "endOffset" INTEGER,
    "authorType" "CommentAuthorType" NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'OPEN',
    "reviewId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TextComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TextComment_targetType_targetId_idx" ON "TextComment"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "TextComment_novelId_idx" ON "TextComment"("novelId");
