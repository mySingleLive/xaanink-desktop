import {currentWorkAssets} from "@desktop/service/image-assets"
import sharp from "sharp"
import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { generateImageBuffer, resolveImageModel } from "@/lib/ai/image"
import { NoModelAvailableError } from "@/lib/ai/errors"
import type { SceneImageKind } from "@/lib/scene-schema"
import { lockContentOperation, requestHash } from "./content-commit"
import { buildSceneImagePrompt, buildSceneImageAssistPrompt } from "@/lib/scene-image-prompt"
import { generateText } from "@/lib/ai/generate"
import { lockSceneTree, ownedScene, ownedSceneBook, type SceneScope } from "./scene"
const formats = {png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif"} as const
export async function decodeSceneImage(buffer: Buffer, claimedMime?: string) {
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new ContentError("INVALID_IMAGE", "图片须为1字节至10MB", 400)
  try {
    const image = sharp(buffer, {limitInputPixels: 40000000, failOn: "warning"})
    const meta = await image.metadata(); const format = meta.format as keyof typeof formats
    if (!formats[format] || (claimedMime && claimedMime !== formats[format])) throw new Error("format")
    await image.clone().raw().toBuffer()
    return {extension: format === "jpeg" ? "jpg" : format, mime: formats[format]}
  } catch {throw new ContentError("INVALID_IMAGE", "只支持可解码的PNG、JPEG、WebP、GIF，文件类型须与内容一致", 400)}
}
export async function sceneImagePrompt(scope: SceneScope, sceneId: string, kind: SceneImageKind) {
  return buildSceneImagePrompt(kind, await ownedScene(prisma, scope, sceneId))
}
export async function generateSceneImagePrompt(scope: SceneScope, sceneId: string, kind: SceneImageKind, generate = generateText) {
  const scene = await ownedScene(prisma, scope, sceneId)
  const {text} = await generate({userId: scope.userId, novelId: scope.novelId, action: "scene.image-prompt", prompt: buildSceneImageAssistPrompt(kind, scene)})
  const prompt = text.trim()
  if (!prompt || prompt.length > 4000) throw new ContentError("INVALID_IMAGE_PROMPT", "图片提示词为空或过长，请重新帮写", 502)
  return prompt
}
async function persistBytes(buffer: Buffer, claimedMime?: string) {
  const {id,filename}=await currentWorkAssets().save(buffer,claimedMime)
  return {id, filename}
}
async function saveHistory(tx: Prisma.TransactionClient, scope: SceneScope, sceneId: string, kind: SceneImageKind, file: {id: string; filename: string}, source: string, prompt?: string, baseline?: number) {
  await lockSceneTree(tx, scope.novelId)
  const scene = await ownedScene(tx, scope, sceneId)
  const url = `/api/novels/${scope.novelId}/scenes/${sceneId}/images/${file.id}/asset`
  const image = await tx.sceneImage.create({data: {...file, sceneId, kind, source, url, prompt}})
  const revision = kind === "exterior" ? scene.exteriorImageRevision : scene.interiorImageRevision
  const applied = baseline === undefined || revision === baseline
  if (applied) await tx.scene.update({where: {id: sceneId}, data: kind === "exterior" ? {exteriorImageUrl: url, exteriorImageRevision: {increment: 1}} : {interiorImageUrl: url, interiorImageRevision: {increment: 1}}})
  return {image: {...image, createdAt: image.createdAt.toISOString()}, url, applied}
}
export async function uploadSceneImage(scope: SceneScope, sceneId: string, kind: SceneImageKind, buffer: Buffer, mime: string) {
  const scene = await ownedScene(prisma, scope, sceneId); const revision = kind === "exterior" ? scene.exteriorImageRevision : scene.interiorImageRevision; const file = await persistBytes(buffer, mime)
  try {return await prisma.$transaction(tx => saveHistory(tx, scope, sceneId, kind, file, "UPLOAD", undefined, revision))} catch (error) {await currentWorkAssets().removeCreated(file.filename).catch(() => undefined); throw error}
}
export async function selectSceneImage(scope: SceneScope, sceneId: string, kind: SceneImageKind, imageId: string | null) {
  return prisma.$transaction(async tx => {
    await lockSceneTree(tx, scope.novelId); await ownedScene(tx, scope, sceneId)
    const image = imageId ? await tx.sceneImage.findFirst({where: {id: imageId, sceneId, kind}}) : null
    if (imageId && !image) throw new ContentError("TARGET_NOT_FOUND", "图片版本不存在或不属于此场景与类型", 404)
    return tx.scene.update({where: {id: sceneId}, data: kind === "exterior" ? {exteriorImageUrl: image?.url ?? null, exteriorImageRevision: {increment: 1}} : {interiorImageUrl: image?.url ?? null, interiorImageRevision: {increment: 1}}})
  })
}
export interface GenerateSceneImageInput extends SceneScope {sceneId: string; kind: SceneImageKind; prompt: string; modelId?: string; operationId: string}
/** Claims before network I/O. Duplicate requests never call the provider twice. */
export async function generateSceneImage(input: GenerateSceneImageInput, provider = async (prompt: string, modelId?: string) => generateImageBuffer(await resolveImageModel(modelId), prompt)) {
  const hash = requestHash(input), key = {userId_operationId: {userId: input.userId, operationId: input.operationId}}
  const claim = await prisma.$transaction(async tx => {
    await ownedSceneBook(tx, input); await lockSceneTree(tx, input.novelId); await lockContentOperation(tx, input.userId, input.operationId)
    const prior = await tx.sceneImageRequest.findUnique({where: key})
    if (prior) {if (prior.requestHash !== hash) throw new ContentError("OPERATION_CONFLICT", "图片操作编号已用于不同请求"); return {prior}}
    const scene = await ownedScene(tx, input, input.sceneId)
    const request = await tx.sceneImageRequest.create({data: {userId: input.userId, novelId: input.novelId, sceneId: input.sceneId, kind: input.kind, operationId: input.operationId, requestHash: hash}})
    return {request, revision: input.kind === "exterior" ? scene.exteriorImageRevision : scene.interiorImageRevision}
  })
  if (claim.prior) { if (claim.prior.status === "failed") throw new ContentError("IMAGE_GENERATION_FAILED", (claim.prior.result as {error: string}).error, 502); return claim.prior.status === "pending" ? {pending: true} : claim.prior.result }
  let file: {id: string; filename: string} | undefined
  try {
    const buffer = await provider(input.prompt, input.modelId); file = await persistBytes(buffer)
    return await prisma.$transaction(async tx => {const result = await saveHistory(tx, input, input.sceneId, input.kind, file!, "AI", input.prompt, claim.revision); await tx.sceneImageRequest.update({where: key, data: {status: "complete", result: result as Prisma.InputJsonValue}}); return result})
  } catch (error) {
    if (file) await currentWorkAssets().removeCreated(file.filename).catch(() => undefined)
    const message = error instanceof ContentError || error instanceof NoModelAvailableError ? error.message : error instanceof Error && error.message.startsWith("文生图") ? error.message : "图片生成失败，请检查模型配置后发起新的生成"
    await prisma.sceneImageRequest.update({where: key, data: {status: "failed", result: {error: message}}})
    if (error instanceof ContentError) throw error
    throw new ContentError("IMAGE_GENERATION_FAILED", message, 502)
  }
}
export async function readSceneImageAsset(scope: SceneScope, sceneId: string, imageId: string) {
  await ownedScene(prisma, scope, sceneId)
  const image = await prisma.sceneImage.findFirst({where: {id: imageId, sceneId}})
  if (!image || !/^[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(image.filename)) throw new ContentError("TARGET_NOT_FOUND", "图片不存在", 404)
  const asset = await currentWorkAssets().read(image.filename).catch(() => null)
  if (!asset) throw new ContentError("TARGET_NOT_FOUND", "图片文件不存在", 404)
  return asset
}
