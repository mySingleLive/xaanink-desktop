import { NextResponse } from "next/server"

import { getOutlineTree } from "@/lib/services/outline"

import { getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

/** 分卷大纲树：卷（含章）按 index 升序 */
export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const volumes = await getOutlineTree(id)
  return NextResponse.json({ volumes })
}
