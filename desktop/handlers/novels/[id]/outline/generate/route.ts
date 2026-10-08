import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { generateOutline } from "@/lib/services/outline"

import { firstIssueMessage, getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string }> }

const generateSchema = z.object({
  volumes: z.number().int().min(1, "至少 1 卷").max(20, "最多 20 卷").default(3),
  chaptersPerVolume: z.number().int().min(1, "每卷至少 1 章").max(50, "每卷最多 50 章").default(10),
  guidance: z.string().trim().max(2000).optional(),
})

/**
 * AI 生成分卷大纲并替换式落库（同步执行，耗时较长属预期）。
 * 返回最新大纲树。
 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => ({}))
  const parsed = generateSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const volumes = await generateOutline(id, parsed.data, result.session.user.id)
    return NextResponse.json({ volumes })
  } catch (err) {
    return toErrorResponse(err)
  }
}
