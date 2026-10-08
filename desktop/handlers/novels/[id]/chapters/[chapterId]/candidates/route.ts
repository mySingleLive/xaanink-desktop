import { listContentCandidates } from "@/lib/services/content-candidate"
import { chapterRoute, pagination, type ChapterRouteContext } from "../history-api"
export async function GET(request: Request, ctx: ChapterRouteContext) {
  return chapterRoute(ctx, scope => listContentCandidates(scope, pagination(request)))
}
