import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import {
  ForeshadowCharacterNotFoundError,
  getForeshadowCharacter,
  revealForeshadowCharacter,
} from "@/lib/services/foreshadow-character"

import { firstIssueMessage, getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; fid: string }> }

const revealSchema = z.object({
  characterId: z.string().trim().min(1, "正式角色 id 不能为空"),
})

/** 揭示为某个已存在的正式角色：回填 revealedCharacterId */
export async function POST(request: Request, ctx: RouteContext) {
  const { id, fid } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getForeshadowCharacter(fid)
  if (!existing || existing.novelId !== id) {
    return NextResponse.json({ error: "伏笔角色不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = revealSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const foreshadowCharacter = await revealForeshadowCharacter(fid, parsed.data.characterId)
    return NextResponse.json({ foreshadowCharacter })
  } catch (err) {
    if (err instanceof ForeshadowCharacterNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof Error && err.message === "正式角色不存在") {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return toErrorResponse(err)
  }
}
