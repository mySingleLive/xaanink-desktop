import { getContentCandidate } from "@/lib/services/content-candidate"
import { chapterRoute, type ChapterRouteContext } from "../../history-api"
import { countChineseWords } from "@/lib/text"
export async function GET(_request: Request, ctx: ChapterRouteContext) {
  return chapterRoute(ctx, async (scope, params) => { const candidate = await getContentCandidate(scope, params.candidateId!); return { candidate: { ...candidate, wordCount: countChineseWords(candidate.content) } } })
}
