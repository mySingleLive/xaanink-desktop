ALTER TABLE "Conversation" ADD COLUMN "reviewModelId" TEXT;
ALTER TABLE "ChatAttempt" ADD COLUMN "defaultsSnapshot" JSONB;
