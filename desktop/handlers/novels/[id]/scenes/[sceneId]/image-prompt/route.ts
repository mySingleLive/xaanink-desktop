import { NextResponse } from "next/server"
import { z } from "zod"
import { sceneImageKindSchema } from "@/lib/scene-schema"
import { generateSceneImagePrompt } from "@/lib/services/scene-image"
import { toErrorResponse } from "@/lib/ai/errors"
import { getOwnedNovel } from "../../lib"
export async function POST(request: Request, ctx: {params: Promise<{id: string; sceneId: string}>}) {
  const {id, sceneId} = await ctx.params
  const owner = await getOwnedNovel(id)
  if ("error" in owner) return owner.error
  const parsed = z.object({kind: sceneImageKindSchema}).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({error: "图片类型不合法"}, {status: 400})
  try {
    const text = await generateSceneImagePrompt({novelId: id, userId: owner.novel.userId}, sceneId, parsed.data.kind)
    return NextResponse.json({text})
  } catch (error) { return toErrorResponse(error) }
}
