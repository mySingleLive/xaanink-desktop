import { getChapterFinalizationChecklist } from "@/lib/services/chapter-finalization"
import { chapterRoute, type ChapterRouteContext } from "../history-api"
export async function GET(_request: Request, ctx: ChapterRouteContext) {
  return chapterRoute(ctx, async scope => ({ checklist: await getChapterFinalizationChecklist(scope) }))
}
