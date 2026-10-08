-- CreateEnum
CREATE TYPE "ModelKind" AS ENUM ('TEXT', 'IMAGE');

-- CreateEnum
CREATE TYPE "AttributeTarget" AS ENUM ('CHARACTER', 'ITEM', 'SCENE');

-- AlterTable
ALTER TABLE "AIModel" ADD COLUMN     "kind" "ModelKind" NOT NULL DEFAULT 'TEXT';

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "attributes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "portraitUrl" TEXT;

-- CreateTable
CREATE TABLE "AttributeDefinition" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "targets" "AttributeTarget"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "attributes" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "novelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "coordinates" TEXT NOT NULL DEFAULT '',
    "attributes" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttributeDefinition_novelId_idx" ON "AttributeDefinition"("novelId");

-- CreateIndex
CREATE UNIQUE INDEX "AttributeDefinition_novelId_name_key" ON "AttributeDefinition"("novelId", "name");

-- CreateIndex
CREATE INDEX "Item_novelId_idx" ON "Item"("novelId");

-- CreateIndex
CREATE INDEX "Scene_novelId_idx" ON "Scene"("novelId");

-- AddForeignKey
ALTER TABLE "AttributeDefinition" ADD CONSTRAINT "AttributeDefinition_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
