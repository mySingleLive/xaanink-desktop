ALTER TABLE "ChatTurn" ADD COLUMN "action" JSONB;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "SopPlan" WHERE "status" = 'active' GROUP BY "conversationId" HAVING count(*) > 1)
 THEN RAISE EXCEPTION 'SOP active plan duplicates: export IDs and reconcile before retrying migration; no records deleted'; END IF;
END $$;
CREATE UNIQUE INDEX "SopPlan_active_conversation_key" ON "SopPlan"("conversationId") WHERE "status" = 'active';
