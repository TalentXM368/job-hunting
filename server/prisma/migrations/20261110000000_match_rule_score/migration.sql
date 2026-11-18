-- AlterTable
ALTER TABLE "matches" ADD COLUMN "rule_reason" TEXT,
ADD COLUMN "rule_score" DECIMAL(3,1);
