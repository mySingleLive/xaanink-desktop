import { NextResponse } from "next/server"
import { sceneControlSchema, patchSceneSchema } from "@/lib/scene-schema"
import { deleteScene, getScene, updateScene } from "@/lib/services/scene"
import { toErrorResponse } from "@/lib/ai/errors"
import { firstIssueMessage, getOwnedNovel } from "../lib"
type Context = {params: Promise<{id: string; sceneId: string}>}
export async function GET(_request: Request, ctx: Context) { const {id, sceneId} = await ctx.params; const owner = await getOwnedNovel(id); if ("error" in owner) return owner.error; const scene = await getScene(sceneId); return scene?.novelId === id ? NextResponse.json({scene}) : NextResponse.json({error: "场景不存在"}, {status: 404}) }
export async function PATCH(request: Request, ctx: Context) {
 const {id, sceneId} = await ctx.params; const owner = await getOwnedNovel(id); if ("error" in owner) return owner.error
 const body = await request.json().catch(() => null)
 if (body?.expectedVersion == null || !body?.operationId) return NextResponse.json({error: "缺少场景版本或保存编号", code: "PRECONDITION_REQUIRED"}, {status: 428})
 const parsed = patchSceneSchema.safeParse(body); if (!parsed.success) return NextResponse.json({error: firstIssueMessage(parsed.error, "参数不合法")}, {status: 400})
 const {expectedVersion, operationId, ...data} = parsed.data
 try {return NextResponse.json({scene: await updateScene(sceneId, data, {novelId: id, userId: owner.novel.userId, expectedVersion, operationId})})} catch (error) {return toErrorResponse(error)}
}
export async function DELETE(request: Request, ctx: Context) {
 const {id, sceneId} = await ctx.params; const owner = await getOwnedNovel(id); if ("error" in owner) return owner.error
 const body = await request.json().catch(() => null)
 if (body?.expectedVersion == null || !body?.operationId) return NextResponse.json({error: "缺少删除版本或编号", code: "PRECONDITION_REQUIRED"}, {status: 428})
 const parsed = sceneControlSchema.safeParse(body); if (!parsed.success) return NextResponse.json({error: "删除参数不合法"}, {status: 400})
 try {return NextResponse.json(await deleteScene(sceneId, {novelId: id, userId: owner.novel.userId, ...parsed.data}))} catch (error) {return toErrorResponse(error)}
}
