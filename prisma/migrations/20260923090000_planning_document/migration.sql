CREATE TABLE "PlanningDocument" (
  "novelId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanningDocument_pkey" PRIMARY KEY ("novelId"),
  CONSTRAINT "PlanningDocument_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
