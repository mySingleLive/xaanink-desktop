import { getChapterVersion } from "@/lib/services/chapter-history"
import { chapterRoute, type ChapterRouteContext } from "../../history-api"
export async function GET(_request: Request, ctx: ChapterRouteContext) {
  return chapterRoute(ctx, async (scope, params) => ({ version: await getChapterVersion(scope, params.versionId!) }))
}
