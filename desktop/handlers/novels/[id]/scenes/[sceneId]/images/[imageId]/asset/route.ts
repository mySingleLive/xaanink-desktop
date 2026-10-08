import { readSceneImageAsset } from "@/lib/services/scene-image"
import { toErrorResponse } from "@/lib/ai/errors"
import { getOwnedNovel } from "../../../../lib"
export async function GET(_request: Request, ctx: {params: Promise<{id: string; sceneId: string; imageId: string}>}) {const {id, sceneId, imageId} = await ctx.params; const owner = await getOwnedNovel(id); if ("error" in owner) return owner.error; try {const {bytes, mime} = await readSceneImageAsset({novelId: id, userId: owner.novel.userId}, sceneId, imageId); return new Response(new Uint8Array(bytes), {headers: {"Content-Type": mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}})} catch (error) {return toErrorResponse(error)}}
