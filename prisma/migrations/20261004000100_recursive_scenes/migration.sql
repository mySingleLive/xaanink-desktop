BEGIN;
ALTER TABLE "Scene"
 ADD COLUMN "parentId" TEXT,
 ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "backstory" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "entryMethod" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "exteriorDescription" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "interiorDescription" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "factionSettingId" TEXT,
 ADD COLUMN "factionId" TEXT,
 ADD COLUMN "factionNameSnapshot" TEXT,
 ADD COLUMN "exteriorImageUrl" TEXT,
 ADD COLUMN "interiorImageUrl" TEXT,
 ADD COLUMN "exteriorImageRevision" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "interiorImageRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Scene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX IF EXISTS "Scene_novelId_idx";
CREATE INDEX "Scene_novelId_parentId_idx" ON "Scene"("novelId", "parentId");
CREATE TABLE "SceneImage" (
 "id" TEXT PRIMARY KEY, "sceneId" TEXT NOT NULL, "kind" TEXT NOT NULL, "source" TEXT NOT NULL,
 "url" TEXT NOT NULL, "filename" TEXT NOT NULL, "prompt" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SceneImage_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SceneImage_sceneId_kind_createdAt_idx" ON "SceneImage"("sceneId", "kind", "createdAt");
CREATE TABLE "SceneImageRequest" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "novelId" TEXT NOT NULL, "operationId" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL, "sceneId" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
 "result" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SceneImageRequest_userId_operationId_key" ON "SceneImageRequest"("userId", "operationId");
-- Each identity repair is a new immutable setting revision, never an edit of an old snapshot.
DO $$ DECLARE r RECORD; revised JSONB; old_snapshot JSONB; stamp TIMESTAMP(3); BEGIN
 FOR r IN SELECT * FROM "Setting" WHERE "type" = 'FACTION' AND jsonb_typeof("content"->'factions') = 'array'
 AND EXISTS (SELECT 1 FROM jsonb_array_elements("content"->'factions') f WHERE coalesce(f->>'id','') = '') FOR UPDATE LOOP
   IF EXISTS (SELECT 1 FROM "ContentVersion" WHERE "targetType"='Setting' AND "targetId"=r.id AND "version"=r.version AND "snapshot"->'content' IS DISTINCT FROM r.content) THEN
     RAISE EXCEPTION 'Faction identity repair stopped: inconsistent setting snapshot';
   END IF;
   old_snapshot := to_jsonb(r);
   IF NOT EXISTS (SELECT 1 FROM "ContentVersion" WHERE "targetType"='Setting' AND "targetId"=r.id AND "version"=r.version) THEN
     INSERT INTO "ContentVersion" ("id","targetType","targetId","version","snapshot","reason") VALUES (gen_random_uuid()::text,'Setting',r.id,r.version,old_snapshot,'势力身份兼容迁移前');
   END IF;
   SELECT jsonb_set(r.content,'{factions}',coalesce(jsonb_agg(CASE WHEN coalesce(f->>'id','')='' THEN f || jsonb_build_object('id',gen_random_uuid()::text) ELSE f END ORDER BY ord),'[]'::jsonb))
     INTO revised FROM jsonb_array_elements(r.content->'factions') WITH ORDINALITY AS e(f,ord);
   stamp := clock_timestamp();
   UPDATE "Setting" SET "content"=revised,"version"=r.version+1,"updatedAt"=stamp WHERE "id"=r.id;
   INSERT INTO "ContentVersion" ("id","targetType","targetId","version","snapshot","reason") VALUES
     (gen_random_uuid()::text,'Setting',r.id,r.version+1,old_snapshot || jsonb_build_object('content',revised,'version',r.version+1,'updatedAt',stamp),'势力身份兼容迁移');
 END LOOP;
END $$;

COMMIT;
