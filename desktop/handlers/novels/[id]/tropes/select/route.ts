import { NextResponse } from "next/server"
import { z } from "zod"

import { selectTrope } from "@/lib/services/trope"

import { firstIssueMessage, getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string }> }

const selectSchema = z.object({
  tropeId: z.string().min(1),
})

/** 选中平台库条目：复制为本小说的行且 selected=true（幂等） */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = selectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const trope = await selectTrope({ novelId: id, tropeId: parsed.data.tropeId })
    return NextResponse.json({ trope })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "选中失败" },
      { status: 400 }
    )
  }
}
