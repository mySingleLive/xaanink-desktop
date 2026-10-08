-- AlterTable：签名动作列改名为行为习惯（保留数据）
ALTER TABLE "Character" RENAME COLUMN "signatureAction" TO "habits";

-- AlterTable：角色属性六板块新增列
ALTER TABLE "Character" ADD COLUMN     "aliases" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "bio" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tastes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "dialogueStyle" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sampleDialogue" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "desires" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "fears" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "beliefs" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "bigFive" JSONB,
ADD COLUMN     "abilities" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "backstory" TEXT NOT NULL DEFAULT '';
