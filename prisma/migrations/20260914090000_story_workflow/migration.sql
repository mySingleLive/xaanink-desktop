CREATE TABLE "StoryWorkflow" (
  "novelId" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "phase" TEXT NOT NULL DEFAULT 'brainstorm', "brief" TEXT NOT NULL DEFAULT '',
  "writingMode" TEXT NOT NULL DEFAULT 'chapter', "targetChapters" INTEGER NOT NULL DEFAULT 50,
  "targetWords" INTEGER NOT NULL DEFAULT 2000, "checkpoints" JSONB NOT NULL DEFAULT '{}',
  "approvals" JSONB NOT NULL DEFAULT '{}', "revisions" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoryWorkflow_pkey" PRIMARY KEY ("novelId"),
  CONSTRAINT "StoryWorkflow_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "StoryArtifactLink" (
  "id" TEXT NOT NULL, "novelId" TEXT NOT NULL, "sourceKey" TEXT NOT NULL, "targetKey" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL, "targetHash" TEXT NOT NULL, "reason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoryArtifactLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StoryArtifactLink_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StoryArtifactLink_novelId_sourceKey_targetKey_key" ON "StoryArtifactLink"("novelId", "sourceKey", "targetKey");
CREATE INDEX "StoryArtifactLink_novelId_targetKey_idx" ON "StoryArtifactLink"("novelId", "targetKey");
