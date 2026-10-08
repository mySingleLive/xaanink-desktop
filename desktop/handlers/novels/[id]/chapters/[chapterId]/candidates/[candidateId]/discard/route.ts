import { discardContentCandidate } from "@/lib/services/content-candidate"
import { chapterRoute, type ChapterRouteContext } from "../../../history-api"
export async function POST(_request: Request, ctx: ChapterRouteContext) {
  return chapterRoute(ctx, async (scope, params) => ({ candidate: await discardContentCandidate(scope, params.candidateId!) }))
}
