-- CreateEnum
CREATE TYPE "CharacterImageKind" AS ENUM ('AVATAR', 'PORTRAIT');

-- CreateEnum
CREATE TYPE "CharacterImageSource" AS ENUM ('AI', 'UPLOAD');

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "avatarCrop" JSONB,
ADD COLUMN     "portraitCrop" JSONB;

-- CreateTable
CREATE TABLE "CharacterImage" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "kind" "CharacterImageKind" NOT NULL,
    "source" "CharacterImageSource" NOT NULL,
    "url" TEXT NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CharacterImage_characterId_kind_idx" ON "CharacterImage"("characterId", "kind");

-- AddForeignKey
ALTER TABLE "CharacterImage" ADD CONSTRAINT "CharacterImage_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
