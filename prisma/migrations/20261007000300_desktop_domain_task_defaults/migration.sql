ALTER TABLE "ContentImprovementRun" ADD COLUMN "defaultsSnapshot" JSONB;
ALTER TABLE "SopPlan" ADD COLUMN "defaultsSnapshot" JSONB;
ALTER TABLE "SopNodeRun" ADD COLUMN "defaultsSnapshot" JSONB;
ALTER TABLE "CascadeJob" ADD COLUMN "defaultsSnapshot" JSONB;
ALTER TABLE "ScenarioTurn" ADD COLUMN "defaultsSnapshot" JSONB;
