import { NextResponse } from "next/server"

import { toErrorResponse } from "@/lib/ai/errors"
import {
  ForeshadowCharacterNotFoundError,
  ForeshadowCharacterRevealedError,
  getForeshadowCharacter,
  promoteForeshadowCharacter,
} from "@/lib/services/foreshadow-character"

import { getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; fid: string }> }

/** 转为正式角色：由 name 建 SUPPORTING 正式 Character，revealedCharacterId 回填 */
export async function POST(_request: Request, ctx: RouteContext) {
  const { id, fid } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const existing = await getForeshadowCharacter(fid)
  if (!existing || existing.novelId !== id) {
    return NextResponse.json({ error: "伏笔角色不存在" }, { status: 404 })
  }

  try {
    const { foreshadowCharacter, character } = await promoteForeshadowCharacter(fid)
    return NextResponse.json({ foreshadowCharacter, character })
  } catch (err) {
    if (err instanceof ForeshadowCharacterNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof ForeshadowCharacterRevealedError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    return toErrorResponse(err)
  }
}
