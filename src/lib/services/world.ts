import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { createWorldSchema, patchWorldSchema, worldNameSchema } from "@/lib/world-schema"
import { committedTargetText, commitTargetText, readTextTarget, type TextBaseline, type TextReceipt } from "./target-text"
import { requestHash } from "./content-commit"
import { lockWorldTree, worldWriteError } from "./world-guard"
export { WorldNameConflictError } from "./world-guard"

export class WorldAmbiguousError extends ContentError {
  constructor(public candidates: { id: string; name: string; parentId: string | null }[]) {
    super("WORLD_AMBIGUOUS", "多个世界具有此名称，请按候选世界 ID 明确选择", 409)
  }
}
export function listWorlds(novelId: string) { return prisma.world.findMany({ where: { novelId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) }
export function getWorld(id: string) { return prisma.world.findUnique({ where: { id } }) }

/** ID 不存在时不回退猜名称；名称兼容查找必须唯一。parentId 缺省表示所有层级。 */
export async function resolveWorldReference(novelId: string, reference: { id?: string; name?: string; parentId?: string | null }) {
  if (reference.id !== undefined) return prisma.world.findFirst({ where: { id: reference.id, novelId, ...(reference.parentId === undefined ? {} : { parentId: reference.parentId }) } })
  const parsed = worldNameSchema.safeParse(reference.name)
  if (!parsed.success) throw new ContentError("INVALID_WORLD_NAME", parsed.error.issues[0].message, 400)
  const rows = await prisma.world.findMany({ where: { novelId, ...(reference.parentId === undefined ? {} : { parentId: reference.parentId }) }, select: { id: true, name: true, parentId: true } })
  const matches = rows.filter(row => typeof row.name === "string" && row.name.trim() === parsed.data)
  if (matches.length > 1) throw new WorldAmbiguousError(matches)
  return matches[0] ? getWorld(matches[0].id) : null
}

/** 仅明确、合法且没有歧义的名称可创建父世界占位。并发由数据库树守卫串行化。 */
export async function resolveOrCreateParentWorld(novelId: string, name: string) {
  const existing = await resolveWorldReference(novelId, { name })
  if (existing) return existing.id
  try { return (await createWorld(novelId, { name })).id }
  catch (error) {
    const again = await resolveWorldReference(novelId, { name })
    if (again) return again.id
    throw error
  }
}

export async function createWorld(novelId: string, input: { name: string; parentId?: string | null; description?: string }) {
  const parsed = createWorldSchema.safeParse(input)
  if (!parsed.success) throw new ContentError("INVALID_WORLD_INPUT", parsed.error.issues[0].message, 400)
  try {
    return await prisma.$transaction(async tx => {
      await lockWorldTree(tx, novelId)
      return tx.world.create({ data: { novelId, ...parsed.data, parentId: parsed.data.parentId ?? null, description: parsed.data.description ?? "" } })
    })
  } catch (error) { return worldWriteError(error) }
}

export async function updateWorld(id: string, input: { name?: string; description?: string; parentId?: string | null }, options?: { userId: string; operationId: string; baseline: TextBaseline }) {
  if (!options) throw new ContentError("PRECONDITION_REQUIRED", "缺少世界观基线，请保留草稿并重新读取", 428)
  const parsed = patchWorldSchema.safeParse(input)
  if (!parsed.success) throw new ContentError("INVALID_WORLD_INPUT", parsed.error.issues[0].message, 400)
  const data = parsed.data
  const existing = await getWorld(id)
  if (!existing) throw new ContentError("TARGET_NOT_FOUND", "世界不存在", 404)
  const scope = { userId: options.userId, novelId: existing.novelId, targetType: "WORLD", targetId: id }
  await readTextTarget(prisma, scope)
  const operationFingerprint = requestHash({ scope, data, options })
  const prior = await prisma.contentMutation.findUnique({ where: { userId_operationId: { userId: options.userId, operationId: options.operationId } } })
  if (prior) {
    if (prior.requestHash !== operationFingerprint) throw new ContentError("OPERATION_CONFLICT", "此保存编号已用于不同世界观请求")
    const receipt = prior.result as unknown as TextReceipt
    return { ...existing, ...receipt.metadata, description: await committedTargetText(scope, receipt), updatedAt: new Date(receipt.updatedAt) }
  }
  try {
    const receipt = await commitTargetText({ ...scope, ...options, operationFingerprint, text: data.description ?? existing.description, name: data.name, parentId: data.parentId, source: "manual", reason: "世界观更新" })
    const world = await prisma.world.findUniqueOrThrow({ where: { id } })
    return { ...world, ...receipt.metadata, description: await committedTargetText(scope, receipt), updatedAt: new Date(receipt.updatedAt) }
  } catch (error) { return worldWriteError(error) }
}

export async function deleteWorld(id: string) {
  const existing = await getWorld(id)
  if (!existing) throw new ContentError("TARGET_NOT_FOUND", "世界不存在", 404)
  return prisma.$transaction(async tx => { await lockWorldTree(tx, existing.novelId); return tx.world.delete({ where: { id } }) })
}
