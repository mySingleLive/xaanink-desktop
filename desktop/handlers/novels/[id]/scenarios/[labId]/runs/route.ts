import { NextResponse } from "next/server"

import { listScenarioRuns } from "@/lib/services/subagent-run"

import { getOwnedNovel } from "../../../lib"
import { getOwnedScenarioLab } from "../../lib"

type RouteContext = { params: Promise<{ id: string; labId: string }> }

/**
 * 本试验场的子代理运行列表（推进过程展开面板的数据源，前端 2s 轮询）。
 * query: since=ISO 时间戳（只取该时刻之后——本次推演的起点），缺省取最近全部（上限 50 条）。
 */
export async function GET(request: Request, ctx: RouteContext) {
  const { id, labId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const lab = await getOwnedScenarioLab(labId, id)
  if (!lab) {
    return NextResponse.json({ error: "情景试验场不存在" }, { status: 404 })
  }

  const since = new URL(request.url).searchParams.get("since")
  if (since && Number.isNaN(new Date(since).getTime())) {
    return NextResponse.json({ error: "since 参数不合法" }, { status: 400 })
  }

  const runs = await listScenarioRuns({ novelId: id, labTitle: lab.title, since: since ?? undefined })
  return NextResponse.json({ runs })
}
