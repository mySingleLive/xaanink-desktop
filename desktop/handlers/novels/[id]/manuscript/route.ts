import { NextResponse } from "next/server"
import { z } from "zod"
import { toErrorResponse } from "@/lib/ai/errors"
import { getNovelExportMetadata, getOutlineCollection } from "@/lib/services/outline-structure"
import { firstIssueMessage, getOwnedNovel } from "../lib"

const querySchema = z.object({ kind: z.enum(["content", "outline", "metadata"]), volumeId: z.string().min(1).max(100).optional() })

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const owned = await getOwnedNovel(id)
  if ("error" in owned) return owned.error
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: firstIssueMessage(parsed.error, "导出范围不合法") }, { status: 400 })
  try {
    const data = parsed.data.kind === "metadata" ? await getNovelExportMetadata(id) : await getOutlineCollection(id, parsed.data.kind, parsed.data.volumeId)
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return toErrorResponse(error) }
}
