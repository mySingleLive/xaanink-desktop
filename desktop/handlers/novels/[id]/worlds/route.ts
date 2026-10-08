import { NextResponse } from "next/server"
import { createWorldSchema } from "@/lib/world-schema"
import { toErrorResponse } from "@/lib/ai/errors"

import { createWorld, listWorlds, WorldNameConflictError } from "@/lib/services/world"

import { firstIssueMessage, getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const worlds = await listWorlds(id)
  return NextResponse.json({ worlds })
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = createWorldSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const world = await createWorld(id, parsed.data)
    return NextResponse.json({ world })
  } catch (err) {
    if (err instanceof WorldNameConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    if (err instanceof Error && err.message === "父世界不存在") {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return toErrorResponse(err)
  }
}
