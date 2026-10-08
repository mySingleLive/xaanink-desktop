import { NextResponse } from "next/server"
import { getOwnedNovel, firstIssueMessage } from "@desktop/handlers/novels/[id]/lib"
import { addReference, referenceInputSchema } from "@/lib/services/foreshadow-reference"
import { referenceErrorResponse } from "./response"

type Context = { params: Promise<{ id: string; fid: string; tid: string }> }
export async function POST(request: Request, ctx: Context) {
  const { id, fid, tid } = await ctx.params
  const owner = await getOwnedNovel(id)
  if ("error" in owner) return owner.error
  const parsed = referenceInputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssueMessage(parsed.error, "引用参数不合法") }, { status: 400 })
  try { return NextResponse.json({ reference: await addReference(id, fid, tid, parsed.data) }, { status: 201 }) }
  catch (error) { return referenceErrorResponse(error) }
}
