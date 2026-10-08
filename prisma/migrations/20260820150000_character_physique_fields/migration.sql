-- AlterTable：外在板块基础生理属性四列
ALTER TABLE "Character" ADD COLUMN     "height" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "weight" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "build" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "faceShape" TEXT NOT NULL DEFAULT '';
