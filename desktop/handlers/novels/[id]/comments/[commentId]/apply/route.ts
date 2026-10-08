import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { toErrorResponse } from "@/lib/ai/errors"
import { commitCommentChange, ownedComment, prepareCommentChange } from "@/lib/services/comment-change"
import { textBaselineSchema } from "@/lib/text-baseline"
import { getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; commentId: string }> }
const common = { operationId: z.string().min(1).max(140), baseline: textBaselineSchema }
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), ...common, commentUpdatedAt: z.iso.datetime(), range: z.enum(["selection", "paragraph"]).optional() }).strict(),
  z.object({ action: z.literal("commit"), ...common, preparedId: z.string().min(1) }).strict(),
])

/** 无编辑器缓冲的评审入口读取基线；编辑器须核对 flush 后草稿。 */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id: novelId, commentId } = await ctx.params
  const result = await getOwnedNovel(novelId)
  if ("error" in result) return result.error
  try {
    const { state, comment } = await ownedComment(prisma, { novelId, commentId, userId: result.session.user.id })
    // 候选稿只读（前端本就不显示应用按钮，此为防御）
    if (comment.targetType === "CANDIDATE_CONTENT") throw new ContentError("TARGET_READONLY", "候选稿为只读稿，不能应用改写", 422)
    return NextResponse.json({ baseline: { version: state.version, updatedAt: state.updatedAt, hash: state.hash }, commentUpdatedAt: comment.updatedAt.toISOString(), text: state.text })
  } catch (error) { return toErrorResponse(error) }
}

/** 只接受服务端补丁引用；旧 commit:true 或客户端 replacement 协议失败关闭。 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id: novelId, commentId } = await ctx.params
  const result = await getOwnedNovel(novelId)
  if ("error" in result) return result.error
  try {
    const body = await request.json().catch(() => null)
    if (!body?.baseline || !body?.operationId || !body?.action) throw new ContentError("PRECONDITION_REQUIRED", "评论应用协议已更新，请保留草稿并刷新页面", 428)
    const parsed = schema.safeParse(body)
    if (!parsed.success) throw new ContentError("INVALID_INPUT", parsed.error.issues[0]?.message ?? "参数不合法", 400)
    const scope = { novelId, commentId, userId: result.session.user.id }
    if (parsed.data.action === "prepare") {
      const input = parsed.data
      const patch = await prepareCommentChange({ ...scope, operationId: input.operationId, baseline: input.baseline, commentUpdatedAt: input.commentUpdatedAt, range: input.range })
      return NextResponse.json({ prepared: { id: patch.id, baseline: { version: patch.baseVersion, hash: patch.baseHash, updatedAt: patch.baseUpdatedAt.toISOString() }, oldText: patch.oldText, replacement: patch.replacement, start: patch.start, end: patch.end, expiresAt: patch.expiresAt.toISOString() } })
    }
    const input = parsed.data
    return NextResponse.json(await commitCommentChange({ ...scope, preparedId: input.preparedId, operationId: input.operationId, baseline: input.baseline }))
  } catch (error) { return toErrorResponse(error) }
}
