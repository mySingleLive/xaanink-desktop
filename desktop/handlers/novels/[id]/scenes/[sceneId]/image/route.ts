import { NextResponse } from "next/server"
import { z } from "zod"
import { sceneImageKindSchema } from "@/lib/scene-schema"
import { generateSceneImage, selectSceneImage } from "@/lib/services/scene-image"
import { toErrorResponse } from "@/lib/ai/errors"
import { getOwnedNovel } from "../../lib"
type Context = {params: Promise<{id: string; sceneId: string}>}
export async function POST(request: Request, ctx: Context) {const {id, sceneId} = await ctx.params; const owner = await getOwnedNovel(id); if ("error" in owner) return owner.error; const parsed = z.object({kind: sceneImageKindSchema, prompt: z.string().trim().min(1).max(4000), modelId: z.string().max(100).optional(), operationId: z.string().min(1).max(160)}).strict().safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({error: "图片生成参数不合法"}, {status: 400}); try {const result = await generateSceneImage({novelId: id, userId: owner.novel.userId, sceneId, ...parsed.data}); return NextResponse.json(result, {status: result && typeof result === "object" && "pending" in result ? 202 : 200})} catch (error) {return toErrorResponse(error)}}
export async function PATCH(request: Request, ctx: Context) {const {id, sceneId} = await ctx.params; const owner = await getOwnedNovel(id); if ("error" in owner) return owner.error; const parsed = z.object({kind: sceneImageKindSchema, imageId: z.string().min(1).nullable()}).strict().safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({error: "图片选择参数不合法"}, {status: 400}); try {return NextResponse.json({scene: await selectSceneImage({novelId: id, userId: owner.novel.userId}, sceneId, parsed.data.kind, parsed.data.imageId)})} catch (error) {return toErrorResponse(error)}}
