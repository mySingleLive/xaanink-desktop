-- AlterTable
ALTER TABLE "Character" ALTER COLUMN "habits" SET DEFAULT '';

-- CreateTable
CREATE TABLE "ScenarioLab" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "cast" JSONB NOT NULL DEFAULT '[]',
    "sceneIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "premise" TEXT NOT NULL DEFAULT '',
    "prose" TEXT NOT NULL DEFAULT '',
    "proseAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScenarioLab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioTurn" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'beat',
    "narrative" TEXT NOT NULL DEFAULT '',
    "beats" JSONB NOT NULL DEFAULT '[]',
    "direction" TEXT,
    "checks" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScenarioTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioNode" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "index" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "turnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScenarioNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioCard" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "index" DOUBLE PRECISION NOT NULL,
    "nodeId" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "characterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sceneIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScenarioCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScenarioLab_novelId_idx" ON "ScenarioLab"("novelId");

-- CreateIndex
CREATE INDEX "ScenarioTurn_labId_idx" ON "ScenarioTurn"("labId");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioTurn_labId_index_key" ON "ScenarioTurn"("labId", "index");

-- CreateIndex
CREATE INDEX "ScenarioNode_labId_idx" ON "ScenarioNode"("labId");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioNode_labId_index_key" ON "ScenarioNode"("labId", "index");

-- CreateIndex
CREATE INDEX "ScenarioCard_labId_idx" ON "ScenarioCard"("labId");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioCard_labId_index_key" ON "ScenarioCard"("labId", "index");
