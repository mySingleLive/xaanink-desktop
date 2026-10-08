import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { toErrorResponse } from "@/lib/ai/errors"
import { createChapter } from "@/lib/services/outline"
import { firstIssueMessage, getOwnedNovel } from "../../../../lib"

const schema = z.object({ title: z.string().trim().min(1, "章节名不能为空").max(100) })

export async function POST(request: Request, ctx: { params: Promise<{ id: string; volumeId: string }> }) {
  const { id, volumeId } = await ctx.params
  const owned = await getOwnedNovel(id)
  if ("error" in owned) return owned.error
  const volume = await prisma.volume.findFirst({ where: { id: volumeId, novelId: id }, select: { id: true } })
  if (!volume) return NextResponse.json({ error: "卷不存在" }, { status: 404 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssueMessage(parsed.error, "参数不合法") }, { status: 400 })
  try {
    return NextResponse.json({ chapter: await createChapter(volume.id, parsed.data) }, { status: 201 })
  } catch (error) { return toErrorResponse(error) }
}
