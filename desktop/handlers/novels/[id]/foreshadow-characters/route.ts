import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import {
  createForeshadowCharacter,
  listForeshadowCharacters,
} from "@/lib/services/foreshadow-character"

import { firstIssueMessage, getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

const createSchema = z.object({
  name: z.string().trim().min(1, "伏笔角色名不能为空").max(100),
  note: z.string().trim().max(20000).optional(),
})

export async function GET(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const foreshadowCharacters = await listForeshadowCharacters(id)
  return NextResponse.json({ foreshadowCharacters })
}

export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const foreshadowCharacter = await createForeshadowCharacter(id, parsed.data)
    return NextResponse.json({ foreshadowCharacter })
  } catch (err) {
    return toErrorResponse(err)
  }
}
