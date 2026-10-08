import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sceneImageKindSchema } from "@/lib/scene-schema"
import { ownedScene } from "@/lib/services/scene"
import { uploadSceneImage, sceneImagePrompt } from "@/lib/services/scene-image"
import { toErrorResponse } from "@/lib/ai/errors"
import { getOwnedNovel } from "../../lib"
type Context = {params: Promise<{id: string; sceneId: string}>}
export async function GET(request: Request, ctx: Context) {const {id, sceneId} = await ctx.params; const owner = await getOwnedNovel(id); if ("error" in owner) return owner.error; const kind = sceneImageKindSchema.safeParse(new URL(request.url).searchParams.get("kind") ?? "exterior"); if (!kind.success) return NextResponse.json({error: "图片类型不合法"}, {status: 400}); try {await ownedScene(prisma, {novelId: id, userId: owner.novel.userId}, sceneId); const images = await prisma.sceneImage.findMany({where: {sceneId, kind: kind.data}, orderBy: {createdAt: "desc"}}); return NextResponse.json({images, defaultPrompt: await sceneImagePrompt({novelId: id, userId: owner.novel.userId}, sceneId, kind.data)})} catch (error) {return toErrorResponse(error)}}
export async function POST(request: Request, ctx: Context) {const {id, sceneId} = await ctx.params; const owner = await getOwnedNovel(id); if ("error" in owner) return owner.error; const form = await request.formData().catch(() => null), file = form?.get("file"), kind = sceneImageKindSchema.safeParse(form?.get("kind")); if (!(file instanceof File) || file.size > 10 * 1024 * 1024 || !kind.success) return NextResponse.json({error: "请选择10MB以内的PNG、JPEG、WebP或GIF图片"}, {status: 400}); try {return NextResponse.json(await uploadSceneImage({novelId: id, userId: owner.novel.userId}, sceneId, kind.data, Buffer.from(await file.arrayBuffer()), file.type))} catch (error) {return toErrorResponse(error)}}
