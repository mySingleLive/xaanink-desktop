import { NextResponse } from "next/server"
import { createSceneSchema } from "@/lib/scene-schema"
import { createScene, listScenes } from "@/lib/services/scene"
import { toErrorResponse } from "@/lib/ai/errors"
import { firstIssueMessage, getOwnedNovel } from "./lib"
type Context = {params: Promise<{id: string}>}
export async function GET(_request: Request, ctx: Context) { const {id} = await ctx.params; const owner = await getOwnedNovel(id); if ("error" in owner) return owner.error; return NextResponse.json({scenes: await listScenes(id)}) }
export async function POST(request: Request, ctx: Context) {
 const {id} = await ctx.params; const owner = await getOwnedNovel(id); if ("error" in owner) return owner.error
 const parsed = createSceneSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({error: firstIssueMessage(parsed.error, "参数不合法")}, {status: 400})
 try { return NextResponse.json({scene: await createScene(id, parsed.data, {userId: owner.novel.userId})}) } catch (error) {return toErrorResponse(error)}
}
