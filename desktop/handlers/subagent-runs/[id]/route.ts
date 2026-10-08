import { NextResponse } from "next/server"

import { getOwnedNovel } from "@desktop/handlers/novels/[id]/lib"
import { getRun } from "@/lib/services/subagent-run"

type RouteContext = { params: Promise<{ id: string }> }

/** 子代理运行记录（subagent tab 只读回放的数据源；按所属小说鉴权） */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const run = await getRun(id)
  if (!run) {
    return NextResponse.json({ error: "子代理运行记录不存在" }, { status: 404 })
  }
  const result = await getOwnedNovel(run.novelId)
  if ("error" in result) return result.error
  return NextResponse.json({ run })
}
