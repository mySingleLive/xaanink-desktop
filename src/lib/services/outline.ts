import { z } from "zod"
import type {Prisma} from "@/generated/prisma/client"

import { buildNovelSections } from "@/lib/ai/context"
import { generateJSON } from "@/lib/ai/generate"
import { prisma } from "@/lib/db"
import { renderPrompt } from "@/lib/prompts/render"
import { advanceNovelStage } from "@/lib/services/stage"
import { ContentError, requireVersion } from "@/lib/content-errors"
import { chapterForReceipt, type ChapterSaveOptions } from "./chapter"
import { commitChapterRevision } from "./content-commit"

export async function assertLegacyOutlineWritable(novelId: string, db: Prisma.TransactionClient = prisma) {
  if (await db.planningDocument.findUnique({where:{novelId},select:{novelId:true}})) throw new ContentError("OUTLINE_PROJECTION_READONLY", "大纲由叙事线投影，请在叙事线的卷章大纲中修改", 409)
}

/** 分卷大纲树：卷（含章），均按 index 升序；不含正文 content，避免负载过大 */
export async function getOutlineTree(novelId: string) {
  return prisma.volume.findMany({
    where: { novelId },
    orderBy: { index: "asc" },
    include: {
      chapters: {
        orderBy: { index: "asc" },
        select: {
          id: true,
          volumeId: true,
          index: true,
          title: true,
          outline: true,
          wordCount: true,
          status: true,
          version: true,
        },
      },
    },
  })
}

export interface GenerateOutlineInput {
  /** 卷数 */
  volumes: number
  /** 每卷章数 */
  chaptersPerVolume: number
  /** 补充要求（追加到提示词末尾） */
  guidance?: string
}

const generatedOutlineSchema = z.object({
  volumes: z
    .array(
      z.object({
        title: z.string().min(1),
        summary: z.string().default(""),
        chapters: z
          .array(
            z.object({
              title: z.string().min(1),
              outline: z.string().default(""),
            })
          )
          .min(1),
      })
    )
    .min(1),
})

export type GeneratedOutline = z.infer<typeof generatedOutlineSchema>

/**
 * AI 生成分卷大纲（outline.generate 模板）并替换式落库：
 * 删除旧 Volume（级联删 Chapter、Review 保留）后按新结构创建，
 * 新 Chapter.status = OUTLINE；同时把 novel.currentStage 推进到 OUTLINE_REVIEW。
 */
export async function generateOutline(
  novelId: string,
  input: GenerateOutlineInput,
  userId: string
) {
  await assertLegacyOutlineWritable(novelId)
  const sections = await buildNovelSections(novelId, undefined, undefined, input.guidance)
  const basePrompt = await renderPrompt("outline.generate", {
    theme: sections.theme,
    settings: sections.settings,
    characters: sections.characters,
    tropes: sections.tropes,
    volumeCount: String(input.volumes),
    chaptersPerVolume: String(input.chaptersPerVolume),
  })
  const prompt = input.guidance?.trim()
    ? `${basePrompt}\n\n【补充要求】\n${input.guidance.trim()}`
    : basePrompt

  const { data } = await generateJSON({
    userId,
    novelId,
    tier: "ADVANCED",
    action: "outline.generate",
    prompt,
    schema: generatedOutlineSchema,
  })

  // 替换式落库：删旧卷（章节级联删除）后重建
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Novel" WHERE id=${novelId} FOR UPDATE`;
    await assertLegacyOutlineWritable(novelId,tx);
    await tx.volume.deleteMany({where:{novelId}});
    return Promise.all([
    ...data.volumes.map((volume, volumeIndex) =>
      tx.volume.create({
        data: {
          novelId,
          index: volumeIndex + 1,
          title: volume.title,
          summary: volume.summary,
          chapters: {
            create: volume.chapters.map((chapter, chapterIndex) => ({
              index: chapterIndex + 1,
              title: chapter.title,
              outline: chapter.outline,
              status: "OUTLINE",
            })),
          },
        },
      })
    ),
  ])})

  await advanceNovelStage(novelId, "OUTLINE_REVIEW")
  return getOutlineTree(novelId)
}

/**
 * 追加一卷（index 自动取当前最大值 +1），用于对话中逐卷搭建大纲，
 * 不影响已有卷章。同时把创作阶段推进到 OUTLINE。
 */
export async function createVolume(
  novelId: string,
  data: { title: string; summary?: string }
) {
  const volume = await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Novel" WHERE id=${novelId} FOR UPDATE`;
    await assertLegacyOutlineWritable(novelId,tx);
    const last=await tx.volume.findFirst({where:{novelId},orderBy:{index:"desc"}});
    return tx.volume.create({data:{novelId,index:(last?.index??0)+1,title:data.title,summary:data.summary??""}});
  });
  await advanceNovelStage(novelId, "OUTLINE")
  return volume
}

/**
 * 新建一章（status=OUTLINE），用于对话中逐章细化大纲。
 *
 * 传了 index 就落在该序号上，没传才追加到卷末（当前最大值 +1）。
 * index 是为批量建章准备的：模型会把一卷的十几章**并行**提交，
 * 纯追加时落库顺序取决于哪个调用先返回，章名对但顺序全乱
 * （原著第 3 章《梅丽莎》会变成第 5 章）。模型自己知道「这是第几章」，
 * 让它明说即可各就各位。声明的序号撞车时退回追加，保证调用不失败。
 */
export async function createChapter(
  volumeId: string,
  data: { title: string; outline?: string; index?: number }
) {
  return prisma.$transaction(async tx=>{
    const parent=await tx.volume.findUniqueOrThrow({where:{id:volumeId}});
    await tx.$queryRaw`SELECT id FROM "Novel" WHERE id=${parent.novelId} FOR UPDATE`;
    await assertLegacyOutlineWritable(parent.novelId,tx);
    const last=await tx.chapter.findFirst({where:{volumeId},orderBy:{index:"desc"}});
    const desired=data.index&&data.index>0?data.index:(last?.index??0)+1;
    const occupied=await tx.chapter.findFirst({where:{volumeId,index:desired}});
    return tx.chapter.create({data:{volumeId,index:occupied?(last?.index??0)+1:desired,title:data.title,outline:data.outline??"",status:"OUTLINE"}});
  });
}

/**
 * 更新卷标题/卷简介并写快照。
 * Volume 用 updatedAt 校验外部修改；快照与更新在同一事务中，版本号递增。
 */
export async function updateVolume(
  id: string,
  data: { title?: string; summary?: string },
  expectedUpdatedAt?: string
) {
  return prisma.$transaction(async tx => {
    const owner=await tx.volume.findUniqueOrThrow({where:{id},select:{novelId:true}});
    await tx.$queryRaw`SELECT id FROM "Novel" WHERE id = ${owner.novelId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM "Volume" WHERE id = ${id} FOR UPDATE`
    const before = await tx.volume.findUnique({ where: { id } })
    if (!before) throw new ContentError("TARGET_NOT_FOUND", "卷不存在", 404)
    if(await tx.planningDocument.findUnique({where:{novelId:before.novelId}})) throw new ContentError("OUTLINE_PROJECTION_READONLY", "请在叙事线的卷章大纲中修改", 409)
    if (expectedUpdatedAt && before.updatedAt.toISOString() !== expectedUpdatedAt) throw new ContentError("VERSION_CONFLICT", "卷大纲已有变化，请核对后重新保存")
    const volume = await tx.volume.update({ where: { id }, data })
    const last = await tx.contentVersion.aggregate({ where: { targetType: "Volume", targetId: id }, _max: { version: true } })
    await tx.contentVersion.create({ data: { targetType: "Volume", targetId: id, version: (last._max.version ?? 0) + 1, snapshot: JSON.parse(JSON.stringify(volume)), reason: "卷大纲更新" } })
    return volume
  })
}

/** 更新章标题/章大纲：version+1 并写入 ContentVersion 快照 */
export async function updateChapterOutline(
  id: string,
  data: { title?: string; outline?: string },
  options?: ChapterSaveOptions
) {
  requireVersion(options?.expectedVersion)
  if (!options) throw new ContentError("PRECONDITION_REQUIRED", "缺少稿件版本", 428)
  return chapterForReceipt(await commitChapterRevision({ ...options, chapterId: id, changes: data, source: "metadata", reason: "章大纲更新" }))
}
