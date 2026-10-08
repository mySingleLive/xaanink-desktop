import { NextResponse } from "next/server"
import { z } from "zod"
import { toErrorResponse } from "@/lib/ai/errors"
import { createVolume } from "@/lib/services/outline"
import { firstIssueMessage, getOwnedNovel } from "../../lib"

const schema = z.object({ title: z.string().trim().min(1, "卷名不能为空").max(100) })

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const owned = await getOwnedNovel(id)
  if ("error" in owned) return owned.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssueMessage(parsed.error, "参数不合法") }, { status: 400 })
  try {
    return NextResponse.json({ volume: await createVolume(id, parsed.data) }, { status: 201 })
  } catch (error) { return toErrorResponse(error) }
}
