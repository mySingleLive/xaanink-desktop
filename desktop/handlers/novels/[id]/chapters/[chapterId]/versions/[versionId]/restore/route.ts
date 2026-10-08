import { restoreChapterVersion } from "@/lib/services/chapter-history"
import { chapterRoute, mutationInput, type ChapterRouteContext } from "../../../history-api"
export async function POST(request: Request, ctx: ChapterRouteContext) {
  return chapterRoute(ctx, async (scope, params) => ({ receipt: await restoreChapterVersion(scope, params.versionId!, mutationInput(await request.json().catch(() => null))) }))
}
