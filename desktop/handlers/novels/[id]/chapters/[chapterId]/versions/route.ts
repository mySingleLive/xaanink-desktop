import { listChapterVersions } from "@/lib/services/chapter-history"
import { chapterRoute, pagination, type ChapterRouteContext } from "../history-api"
export async function GET(request: Request, ctx: ChapterRouteContext) {
  return chapterRoute(ctx, scope => listChapterVersions(scope, pagination(request)))
}
