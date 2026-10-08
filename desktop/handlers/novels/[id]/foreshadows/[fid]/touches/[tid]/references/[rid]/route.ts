import { NextResponse } from "next/server"
import { getOwnedNovel, firstIssueMessage } from "@desktop/handlers/novels/[id]/lib"
import { relocateReference, relocateReferenceSchema, removeReference } from "@/lib/services/foreshadow-reference"
import { referenceErrorResponse } from "../response"

type Context = { params: Promise<{ id: string; fid: string; tid: string; rid: string }> }
export async function PATCH(request: Request, ctx: Context) {
  const { id, fid, tid, rid } = await ctx.params
  const owner = await getOwnedNovel(id)
  if ("error" in owner) return owner.error
  const parsed = relocateReferenceSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssueMessage(parsed.error, "引用参数不合法") }, { status: 400 })
  try { await relocateReference(id, fid, tid, rid, parsed.data); return NextResponse.json({ ok: true }) }
  catch (error) { return referenceErrorResponse(error) }
}
export async function DELETE(_request: Request, ctx: Context) {
  const { id, fid, tid, rid } = await ctx.params
  const owner = await getOwnedNovel(id)
  if ("error" in owner) return owner.error
  try { await removeReference(id, fid, tid, rid); return NextResponse.json({ ok: true }) }
  catch (error) { return referenceErrorResponse(error) }
}
