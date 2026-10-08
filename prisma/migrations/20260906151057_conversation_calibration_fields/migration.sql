-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "lastFirstStepInputTokens" INTEGER,
ADD COLUMN     "lastPromptEstimate" INTEGER;
