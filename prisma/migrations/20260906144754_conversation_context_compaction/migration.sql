-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "compactionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastInputTokens" INTEGER,
ADD COLUMN     "summarizedThroughId" TEXT,
ADD COLUMN     "summary" TEXT NOT NULL DEFAULT '';
