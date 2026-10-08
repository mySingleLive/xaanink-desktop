-- Existing records retain NULL: current settings cannot manufacture historical
-- model choices. The desktop runtime preserves their explicit text selection.
ALTER TABLE "Conversation" ADD COLUMN "defaultsSnapshot" JSONB;
ALTER TABLE "ChatTurn" ADD COLUMN "defaultsSnapshot" JSONB;
ALTER TABLE "SubAgentRun" ADD COLUMN "defaultsSnapshot" JSONB;
