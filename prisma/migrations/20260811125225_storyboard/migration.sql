-- CreateTable
CREATE TABLE "Storyboard" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "layoutMode" TEXT NOT NULL DEFAULT 'grid',
    "columnCount" INTEGER NOT NULL DEFAULT 4,
    "withEnding" BOOLEAN NOT NULL DEFAULT true,
    "foreshadowIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Storyboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrunkNode" (
    "id" TEXT NOT NULL,
    "storyboardId" TEXT NOT NULL,
    "index" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "history" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrunkNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShotCard" (
    "id" TEXT NOT NULL,
    "storyboardId" TEXT NOT NULL,
    "index" DOUBLE PRECISION NOT NULL,
    "trunkNodeId" TEXT,
    "stage" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "imagePrompt" TEXT,
    "chapterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "characterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "foreshadowIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sceneIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'draft',
    "writtenWords" INTEGER,
    "staleSource" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShotCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForeshadowCharacter" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT,
    "revealedCharacterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForeshadowCharacter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Storyboard_novelId_idx" ON "Storyboard"("novelId");

-- CreateIndex
CREATE INDEX "TrunkNode_storyboardId_idx" ON "TrunkNode"("storyboardId");

-- CreateIndex
CREATE UNIQUE INDEX "TrunkNode_storyboardId_index_key" ON "TrunkNode"("storyboardId", "index");

-- CreateIndex
CREATE INDEX "ShotCard_storyboardId_idx" ON "ShotCard"("storyboardId");

-- CreateIndex
CREATE INDEX "ShotCard_trunkNodeId_idx" ON "ShotCard"("trunkNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "ShotCard_storyboardId_index_key" ON "ShotCard"("storyboardId", "index");

-- CreateIndex
CREATE INDEX "ForeshadowCharacter_novelId_idx" ON "ForeshadowCharacter"("novelId");
