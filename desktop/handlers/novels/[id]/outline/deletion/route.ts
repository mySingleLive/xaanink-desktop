import { NextResponse } from "next/server"
import { z } from "zod"
import { toErrorResponse } from "@/lib/ai/errors"
import { deleteOutlineVolumes, getOutlineDeletionPreview } from "@/lib/services/outline-structure"
import { firstIssueMessage, getOwnedNovel } from "../../lib"

const scopeSchema = z.object({ volumeId: z.string().min(1).max(100).optional() })
const deleteSchema = scopeSchema.extend({ expectedRevision: z.string().regex(/^[a-f0-9]{64}$/), operationId: z.string().min(1).max(160) })
type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, ctx: Context) {
  const { id } = await ctx.params
  const owned = await getOwnedNovel(id)
  if ("error" in owned) return owned.error
  const parsed = scopeSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: firstIssueMessage(parsed.error, "删除范围不合法") }, { status: 400 })
  try {
    return NextResponse.json(await getOutlineDeletionPreview(id, parsed.data.volumeId), { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return toErrorResponse(error) }
}

export async function DELETE(request: Request, ctx: Context) {
  const { id } = await ctx.params
  const owned = await getOwnedNovel(id)
  if ("error" in owned) return owned.error
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssueMessage(parsed.error, "请先核对删除范围") }, { status: 400 })
  try {
    return NextResponse.json(await deleteOutlineVolumes({ ...parsed.data, novelId: id, userId: owned.session.user.id }))
  } catch (error) { return toErrorResponse(error) }
}
