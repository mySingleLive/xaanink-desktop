ALTER TABLE "ContentCandidate" DROP CONSTRAINT "ContentCandidate_status_check";
ALTER TABLE "ContentCandidate" ADD CONSTRAINT "ContentCandidate_status_check"
  CHECK ("status" IN ('incomplete', 'reviewing', 'ready', 'needs_review', 'accepted', 'discarded', 'withdrawn'));
