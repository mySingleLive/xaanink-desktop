import { withdrawContentCandidate } from "@/lib/services/content-candidate"
import { ContentError } from "@/lib/content-errors"
import { chapterRoute, mutationInput, type ChapterRouteContext } from "../../../history-api"
export async function POST(request: Request, ctx: ChapterRouteContext) {
  return chapterRoute(ctx, async (scope, params) => {
    const body = await request.json().catch(() => null)
    const input = mutationInput(body)
    if (typeof body?.candidateHash !== "string") throw new ContentError("INVALID_HASH", "缺少候选稿校验值", 400)
    return withdrawContentCandidate(scope, params.candidateId!, { ...input, candidateHash: body.candidateHash })
  })
}
