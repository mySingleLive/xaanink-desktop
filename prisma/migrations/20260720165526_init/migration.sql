-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserPlan" AS ENUM ('FREE', 'BASIC', 'PRO');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "NovelStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "NovelStage" AS ENUM ('THEME', 'SETTING', 'STYLE', 'CHARACTER', 'TROPE', 'MAP', 'OUTLINE', 'OUTLINE_REVIEW', 'WRITING', 'CHAPTER_REVIEW', 'DONE');

-- CreateEnum
CREATE TYPE "SettingType" AS ENUM ('WORLDVIEW', 'LEVEL_SYSTEM', 'POWER_SYSTEM', 'CONCEPT', 'GOLD_FINGER', 'STYLE', 'MAP', 'FACTION');

-- CreateEnum
CREATE TYPE "TropeKind" AS ENUM ('SATISFACTION', 'TEAR');

-- CreateEnum
CREATE TYPE "CharacterRoleType" AS ENUM ('PROTAGONIST', 'SUPPORTING', 'ANTAGONIST');

-- CreateEnum
CREATE TYPE "ChapterStatus" AS ENUM ('OUTLINE', 'REVIEWED', 'WRITTEN', 'CHAPTER_REVIEWED', 'FINAL');

-- CreateEnum
CREATE TYPE "ReviewTargetType" AS ENUM ('VOLUME_OUTLINE', 'CHAPTER_OUTLINE', 'CHAPTER_CONTENT');

-- CreateEnum
CREATE TYPE "ReviewHumanStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CascadeTriggerType" AS ENUM ('SETTING', 'CHARACTER');

-- CreateEnum
CREATE TYPE "CascadeJobStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING_CONFIRM', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "ModelTier" AS ENUM ('NORMAL', 'ADVANCED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "plan" "UserPlan" NOT NULL DEFAULT 'FREE',
    "tokenQuota" BIGINT NOT NULL DEFAULT 100000,
    "tokenUsed" BIGINT NOT NULL DEFAULT 0,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "themePreference" TEXT NOT NULL DEFAULT 'light',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Novel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "coverUrl" TEXT,
    "status" "NovelStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentStage" "NovelStage" NOT NULL DEFAULT 'THEME',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Novel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Theme" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL,
    "referenceCases" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "tags" TEXT[],
    "sellingPoints" TEXT NOT NULL,
    "targetAudience" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Theme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "type" "SettingType" NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trope" (
    "id" TEXT NOT NULL,
    "novelId" TEXT,
    "kind" "TropeKind" NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "referenceCase" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleType" "CharacterRoleType" NOT NULL,
    "age" TEXT NOT NULL,
    "occupation" TEXT NOT NULL,
    "personality" TEXT NOT NULL,
    "appearance" TEXT NOT NULL,
    "clothing" TEXT NOT NULL,
    "catchphrase" TEXT NOT NULL,
    "signatureAction" TEXT NOT NULL,
    "relationships" JSONB NOT NULL,
    "growthArc" TEXT NOT NULL,
    "extra" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Volume" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Volume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL,
    "volumeId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "outline" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ChapterStatus" NOT NULL DEFAULT 'OUTLINE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "targetType" "ReviewTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "aiScore" DOUBLE PRECISION,
    "aiComments" JSONB,
    "humanStatus" "ReviewHumanStatus" NOT NULL DEFAULT 'PENDING',
    "humanComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CascadeJob" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "triggerType" "CascadeTriggerType" NOT NULL,
    "triggerId" TEXT NOT NULL,
    "status" "CascadeJobStatus" NOT NULL DEFAULT 'PENDING',
    "affectedItems" JSONB NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CascadeJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "novelId" TEXT,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIModel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "baseUrl" TEXT,
    "tier" "ModelTier" NOT NULL DEFAULT 'NORMAL',
    "inputCostPer1k" DOUBLE PRECISION NOT NULL,
    "outputCostPer1k" DOUBLE PRECISION NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "novelId" TEXT,
    "modelId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "Novel_userId_status_idx" ON "Novel"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Theme_novelId_key" ON "Theme"("novelId");

-- CreateIndex
CREATE INDEX "Setting_novelId_type_idx" ON "Setting"("novelId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_novelId_type_name_key" ON "Setting"("novelId", "type", "name");

-- CreateIndex
CREATE INDEX "Trope_novelId_kind_idx" ON "Trope"("novelId", "kind");

-- CreateIndex
CREATE INDEX "Character_novelId_roleType_idx" ON "Character"("novelId", "roleType");

-- CreateIndex
CREATE INDEX "Volume_novelId_idx" ON "Volume"("novelId");

-- CreateIndex
CREATE UNIQUE INDEX "Volume_novelId_index_key" ON "Volume"("novelId", "index");

-- CreateIndex
CREATE INDEX "Chapter_volumeId_status_idx" ON "Chapter"("volumeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_volumeId_index_key" ON "Chapter"("volumeId", "index");

-- CreateIndex
CREATE INDEX "Review_novelId_targetType_targetId_idx" ON "Review"("novelId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "Review_humanStatus_idx" ON "Review"("humanStatus");

-- CreateIndex
CREATE INDEX "ContentVersion_targetType_targetId_version_idx" ON "ContentVersion"("targetType", "targetId", "version");

-- CreateIndex
CREATE INDEX "CascadeJob_novelId_status_idx" ON "CascadeJob"("novelId", "status");

-- CreateIndex
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");

-- CreateIndex
CREATE INDEX "Conversation_novelId_idx" ON "Conversation"("novelId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIModel_provider_enabled_idx" ON "AIModel"("provider", "enabled");

-- CreateIndex
CREATE INDEX "AIModel_tier_idx" ON "AIModel"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_key_key" ON "PromptTemplate"("key");

-- CreateIndex
CREATE INDEX "UsageRecord_userId_createdAt_idx" ON "UsageRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_modelId_createdAt_idx" ON "UsageRecord"("modelId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_novelId_idx" ON "UsageRecord"("novelId");

-- AddForeignKey
ALTER TABLE "Novel" ADD CONSTRAINT "Novel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trope" ADD CONSTRAINT "Trope_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Volume" ADD CONSTRAINT "Volume_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "Volume"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CascadeJob" ADD CONSTRAINT "CascadeJob_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AIModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
