import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { sceneControlSchema } from "@/lib/scene-schema"
import { ownedScene, restoreScene } from "@/lib/services/scene"
import { toErrorResponse } from "@/lib/ai/errors"
import { getOwnedNovel } from "../../lib"
type Context = {params: Promise<{id: string; sceneId: string}>}
export async function GET(_request: Request, ctx: Context) {const {id, sceneId} = await ctx.params; const owner = await getOwnedNovel(id); if ("error" in owner) return owner.error; try {await ownedScene(prisma, {novelId: id, userId: owner.novel.userId}, sceneId); return NextResponse.json({versions: await prisma.contentVersion.findMany({where: {targetType: "Scene", targetId: sceneId}, orderBy: {version: "desc"}})})} catch (error) {return toErrorResponse(error)}}
export async function POST(request: Request, ctx: Context) {const {id, sceneId} = await ctx.params; const owner = await getOwnedNovel(id); if ("error" in owner) return owner.error; const parsed = sceneControlSchema.extend({snapshotId: z.string().min(1)}).safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({error: "缺少有效版本、历史或操作编号"}, {status: 400}); const {snapshotId, ...control} = parsed.data; try {return NextResponse.json({scene: await restoreScene(sceneId, snapshotId, {novelId: id, userId: owner.novel.userId, ...control})})} catch (error) {return toErrorResponse(error)}}
