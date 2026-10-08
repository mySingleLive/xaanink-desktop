CREATE TABLE "NovelCreationRequest" (
 "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL, "novelId" TEXT NOT NULL, "result" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "NovelCreationRequest_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "NovelCreationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NovelCreationRequest_userId_requestId_key" ON "NovelCreationRequest"("userId", "requestId");
CREATE INDEX "NovelCreationRequest_novelId_idx" ON "NovelCreationRequest"("novelId");
