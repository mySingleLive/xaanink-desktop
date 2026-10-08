import { NextResponse } from "next/server"
import { z } from "zod"

import { TropeKind } from "@/generated/prisma/enums"
import { createCustomTrope, listTropeLibrary } from "@/lib/services/trope"

import { firstIssueMessage, getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

const customTropeSchema = z.object({
  kind: z.enum(TropeKind),
  category: z.string().trim().min(1, "分类不能为空").max(50),
  content: z.string().trim().min(1, "内容不能为空").max(2000),
  referenceCase: z.string().trim().max(2000).default(""),
})

/** 平台库 + 本小说已选/自定义 合并视图 */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const tropes = await listTropeLibrary(id)
  return NextResponse.json({ tropes })
}

/** 新建自定义爽点/泪点 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = customTropeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  const trope = await createCustomTrope({ novelId: id, ...parsed.data })
  return NextResponse.json({ trope })
}
