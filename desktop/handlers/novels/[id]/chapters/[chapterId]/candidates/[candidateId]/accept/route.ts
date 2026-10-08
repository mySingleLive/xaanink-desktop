import { z } from "zod"
import { acceptContentCandidate } from "@/lib/services/content-candidate"
import { ContentError } from "@/lib/content-errors"
import { chapterRoute, mutationInput, type ChapterRouteContext } from "../../../history-api"

/** 调档采用（card-select F2）：本章字数规划档目标值，合法性由服务层判定 */
const wordRangeAdjustSchema = z.object({ wordMin: z.number().int(), wordBudget: z.number().int() })

export async function POST(request: Request, ctx: ChapterRouteContext) {
  return chapterRoute(ctx, async (scope, params) => {
    const body = await request.json().catch(() => null)
    const input = mutationInput(body)
    if (typeof body?.candidateHash !== "string") throw new ContentError("INVALID_HASH", "缺少候选稿校验值", 400)
    if (body?.mode !== undefined && body.mode !== "replace") throw new ContentError("INVALID_REQUEST", "未知采用模式", 400)
    let wordRangeAdjust: { wordMin: number; wordBudget: number } | undefined
    if (body?.wordRangeAdjust !== undefined) {
      const parsed = wordRangeAdjustSchema.safeParse(body.wordRangeAdjust)
      if (!parsed.success) throw new ContentError("INVALID_REQUEST", "字数范围参数无效", 400)
      wordRangeAdjust = parsed.data
    }
    return { receipt: await acceptContentCandidate(scope, params.candidateId!, { ...input, candidateHash: body.candidateHash, mode: body?.mode, wordRangeAdjust }) }
  })
}
