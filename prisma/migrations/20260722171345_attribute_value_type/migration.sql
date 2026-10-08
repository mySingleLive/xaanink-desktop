-- CreateEnum
CREATE TYPE "AttributeValueType" AS ENUM ('TEXT', 'NUMBER', 'SELECT');

-- AlterTable
ALTER TABLE "AttributeDefinition" ADD COLUMN     "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "valueType" "AttributeValueType" NOT NULL DEFAULT 'TEXT';
