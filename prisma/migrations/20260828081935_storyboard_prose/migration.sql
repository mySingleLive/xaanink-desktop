-- AlterTable
ALTER TABLE "Storyboard" ADD COLUMN     "prose" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "proseAt" TIMESTAMP(3);
