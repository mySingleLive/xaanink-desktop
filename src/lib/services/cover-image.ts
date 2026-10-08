import {
  generateImageBuffer,
  resolveImageModel,
  saveNovelCoverImage,
} from "@/lib/ai/image"
import { buildCoverImagePrompt, COVER_SIZE_CANDIDATES } from "@/lib/cover-image-prompt"
import { prisma } from "@/lib/db"

import { resolveImageContext } from "./character-image"

/**
 * 当前封面唯一写入口：AI 生成、手动上传、历史版本回指三处都经它写 Novel.coverUrl，
 * 避免多处直写分叉。同 url 重写不落库（coverUrl 可空，故守卫显式包含 null），不触 updatedAt。
 */
export async function setNovelCover(novelId: string, url: string) {
  await prisma.novel.updateMany({
    where: { id: novelId, OR: [{ coverUrl: null }, { coverUrl: { not: url } }] },
    data: { coverUrl: url },
  })
}

export interface GenerateNovelCoverInput {
  novelId: string
  /** 自定义提示词；仅在 promptIsComplete 时使用，否则按作品资料自动拼装 */
  prompt?: string
  /** 指定文生图模型（AIModel id），不传取最新可用的 */
  modelId?: string
  /**
   * true 表示 prompt 已是完整提示词，原样发给模型（面板里作者手动编辑过的走这条）；
   * 否则忽略 prompt，按书名/简介/类型标签自动拼装。
   */
  promptIsComplete?: boolean
}

/**
 * 生成小说封面并落库：调用文生图模型 → 图片落盘 → 写 NovelCoverImage 版本记录
 * → 把 Novel.coverUrl 指向新版本。与角色图像共用 resolveImageContext / 尺寸降级 /
 * 落盘这一整条链路，保证封面与立绘的时代语境、画风约束一致。
 */
export async function generateNovelCover(input: GenerateNovelCoverInput) {
  const { novelId, modelId } = input

  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    include: { theme: { select: { synopsis: true, genre: true, tags: true } } },
  })
  if (!novel || novel.status === "DELETED") {
    throw new Error("小说不存在")
  }

  const prompt =
    input.promptIsComplete && input.prompt
      ? input.prompt.trim()
      : buildCoverImagePrompt(
          {
            title: novel.title,
            synopsis: novel.theme?.synopsis || undefined,
            genre: novel.theme?.genre || undefined,
            tags: novel.theme?.tags,
          },
          await resolveImageContext(novelId)
        )

  const model = await resolveImageModel(modelId)
  const buffer = await generateImageBuffer(model, prompt, { sizes: COVER_SIZE_CANDIDATES })
  const url = await saveNovelCoverImage(novelId, buffer)

  const image = await prisma.novelCoverImage.create({
    data: { novelId, source: "AI", url, prompt },
  })
  await setNovelCover(novelId, url)

  return { url, image, prompt }
}
