import { createHash } from "node:crypto"
import { z } from "zod"
import { Prisma, type ForeshadowReference } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { anchorContext } from "@/lib/comment-anchor"
import { resolveReferenceAnchor, type ForeshadowReferenceDTO, type ReferenceTargetType } from "@/lib/foreshadow-reference"
import { inferTouchReferenceAnchor, type TouchReferenceEvidence } from "@/lib/foreshadow-reference-evidence"

export class ReferenceError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "ReferenceError" }
}
export const referenceInputSchema = z.object({
  targetType: z.enum(["CHAPTER_OUTLINE", "CHAPTER_CONTENT"]),
  targetId: z.string().min(1),
  quote: z.string().min(1).max(20000).optional(),
  prefix: z.string().max(32).optional(), suffix: z.string().max(32).optional(),
  startOffset: z.number().int().nonnegative().optional(), endOffset: z.number().int().positive().optional(),
})
export const relocateReferenceSchema = referenceInputSchema.extend({
  quote: z.string().min(1).max(20000), expectedUpdatedAt: z.string().datetime(),
})
type ReferenceInput = z.infer<typeof referenceInputSchema>
type Tx = Prisma.TransactionClient

async function requireTouch(tx: Tx, novelId: string, fid: string, tid: string) {
  const touch = await tx.foreshadowTouch.findFirst({ where: { id: tid, novelId, foreshadowId: fid, foreshadow: { novelId } } })
  if (!touch) throw new ReferenceError("触点不存在", 404)
  return touch
}

/** 与正文写入共享行锁；在事务里完成原文及归属校验和引用写入。 */
async function sourceForWrite(tx: Tx, novelId: string, input: ReferenceInput) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Chapter" WHERE "id"=${input.targetId} FOR SHARE`)
  const chapter = await tx.chapter.findFirst({ where: { id: input.targetId, volume: { novelId } } })
  if (!chapter) throw new ReferenceError("章节不存在或不属于本作品", 404)
  return input.targetType === "CHAPTER_OUTLINE" ? chapter.outline : chapter.content
}

function anchorData(source: string, input: ReferenceInput) {
  if (!input.quote) return { quote: null, prefix: null, suffix: null, startOffset: null, endOffset: null }
  // 先验证当前选区，再以落库后的同一规则确认它可被准确读回。
  const exact = input.startOffset !== undefined && input.endOffset !== undefined &&
    source.slice(input.startOffset, input.endOffset) === input.quote &&
    (!input.prefix || source.slice(Math.max(0, input.startOffset - input.prefix.length), input.startOffset) === input.prefix) &&
    (!input.suffix || source.slice(input.endOffset, input.endOffset + input.suffix.length) === input.suffix)
  const anchor = exact ? { start: input.startOffset!, end: input.endOffset! } : resolveReferenceAnchor(source, { ...input, quote: input.quote })
  if (!anchor) throw new ReferenceError("选中的原文尚未保存、已改动或无法唯一定位，请保存后重新框选", 409)
  const fields = { quote: input.quote, ...anchorContext(source, anchor.start, anchor.end), startOffset: anchor.start, endOffset: anchor.end }
  if (!resolveReferenceAnchor(source, fields)) throw new ReferenceError("选区与其他原文重复，请扩大选区以便准确标注", 409)
  return fields
}

function identity(input: ReferenceInput, anchor: ReturnType<typeof anchorData>) {
  return `${input.targetType}:${input.targetId}:${anchor.quote === null ? "whole" : createHash("sha256").update(JSON.stringify([anchor.quote, anchor.prefix, anchor.suffix, anchor.startOffset])).digest("hex")}`
}

export async function addReference(novelId: string, fid: string, tid: string, input: ReferenceInput) {
  return prisma.$transaction(async tx => {
    await requireTouch(tx, novelId, fid, tid)
    const source = await sourceForWrite(tx, novelId, input)
    const anchor = anchorData(source, input)
    // 前插或邻近文字变化后，原引用的快照偏移会过期；同一当前选区仍复用原记录。
    if (anchor.quote) {
      const previous = await tx.foreshadowReference.findMany({ where: { novelId, touchId: tid, targetType: input.targetType, targetId: input.targetId, quote: anchor.quote } })
      const matching = previous.find(ref => {
        const current = resolveReferenceAnchor(source, ref)
        return current?.start === anchor.startOffset && current.end === anchor.endOffset
      })
      if (matching) return matching
    }
    const identityKey = identity(input, anchor)
    return tx.foreshadowReference.upsert({
      where: { touchId_identityKey: { touchId: tid, identityKey } }, update: {},
      create: { novelId, touchId: tid, targetType: input.targetType, targetId: input.targetId, identityKey, ...anchor },
    })
  })
}

export async function relocateReference(novelId: string, fid: string, tid: string, rid: string, input: z.infer<typeof relocateReferenceSchema>) {
  return prisma.$transaction(async tx => {
    await requireTouch(tx, novelId, fid, tid)
    const current = await tx.foreshadowReference.findFirst({ where: { id: rid, touchId: tid, novelId } })
    if (!current) throw new ReferenceError("引用不存在", 404)
    if (current.targetType !== input.targetType || current.targetId !== input.targetId) throw new ReferenceError("重新定位不能更换来源")
    const anchor = anchorData(await sourceForWrite(tx, novelId, input), input)
    const result = await tx.foreshadowReference.updateMany({
      where: { id: rid, updatedAt: new Date(input.expectedUpdatedAt) },
      data: { ...anchor, identityKey: identity(input, anchor) },
    })
    if (!result.count) throw new ReferenceError("引用已被其他操作更新，请刷新后重试", 409)
  })
}

export async function removeReference(novelId: string, fid: string, tid: string, rid: string) {
  return prisma.$transaction(async tx => {
    await requireTouch(tx, novelId, fid, tid)
    await tx.foreshadowReference.deleteMany({ where: { id: rid, touchId: tid, novelId } })
  })
}

export async function createDefaultReferences(tx: Tx, touch: { id: string; novelId: string; chapterId: string | null }) {
  const targets: { targetType: ReferenceTargetType; targetId: string }[] = []
  if (touch.chapterId) targets.push({ targetType: "CHAPTER_OUTLINE", targetId: touch.chapterId }, { targetType: "CHAPTER_CONTENT", targetId: touch.chapterId })
  await tx.foreshadowReference.createMany({ data: targets.map(t => ({ ...t, novelId: touch.novelId, touchId: touch.id, identityKey: `${t.targetType}:${t.targetId}:whole` })), skipDuplicates: true })
}

/** 一次批量解析当前作品的引用来源，包含已删除源和失效原文。 */
export async function referenceDTOs(novelId: string, touches: ({ id: string } & TouchReferenceEvidence)[]) {
  const refs = await prisma.foreshadowReference.findMany({ where: { novelId, touchId: { in: touches.map(t => t.id) } }, orderBy: { createdAt: "asc" } })
  const chapterIds = [...new Set(refs.map(r => r.targetId))]
  const chapters = await prisma.chapter.findMany({ where: { id: { in: chapterIds }, volume: { novelId } }, include: { volume: { select: { index: true } } } })
  const sources = new Map<string, { label: string; text: string }>()
  for (const c of chapters) for (const type of ["CHAPTER_OUTLINE", "CHAPTER_CONTENT"] as const) {
    sources.set(`${type}:${c.id}`, { label: `第 ${c.volume.index} 卷 · 第 ${c.index} 章 ${c.title}`, text: type === "CHAPTER_OUTLINE" ? c.outline : c.content })
  }
  const evidence = new Map(touches.map(t => [t.id, t]))
  const result = new Map<string, ForeshadowReferenceDTO[]>()
  for (const r of refs) {
    const source = sources.get(`${r.targetType}:${r.targetId}`)
    let fields: Pick<ForeshadowReference, "quote" | "prefix" | "suffix" | "startOffset" | "endOffset"> = r
    let anchorSource: ForeshadowReferenceDTO["anchorSource"] = r.quote ? "selection" : null
    // 无原文快照的已登记关系可依据本次触点定位；失效的手工摘录绝不走推断。
    if (!r.quote && source) {
      const touch = evidence.get(r.touchId)
      const inferred = touch ? inferTouchReferenceAnchor(source.text, touch) : null
      if (inferred) {
        const quote = source.text.slice(inferred.start, inferred.end)
        fields = { quote, ...anchorContext(source.text, inferred.start, inferred.end), startOffset: inferred.start, endOffset: inferred.end }
        anchorSource = quote === touch?.summary.trim() ? "summary" : "evidence"
      }
    }
    const anchor = source ? resolveReferenceAnchor(source.text, fields) : null
    const dto: ForeshadowReferenceDTO = {
      id: r.id, touchId: r.touchId, targetType: r.targetType as ReferenceTargetType, targetId: r.targetId,
      quote: fields.quote, prefix: fields.prefix, suffix: fields.suffix, startOffset: fields.startOffset, endOffset: fields.endOffset,
      label: source?.label ?? "来源已删除", missing: !source,
      anchor, anchorSource, status: !source ? "missing" : anchor ? "located" : fields.quote ? "changed" : "unlocated", updatedAt: r.updatedAt.toISOString(),
    }
    result.set(r.touchId, [...(result.get(r.touchId) ?? []), dto])
  }
  return result
}
