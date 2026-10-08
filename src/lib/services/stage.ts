import type { NovelStage } from "@/generated/prisma/enums"
import { prisma } from "@/lib/db"

/** 创作流程阶段顺序（与 Prisma NovelStage 枚举一致） */
export const NOVEL_STAGE_ORDER: NovelStage[] = [
  "THEME",
  "SETTING",
  "STYLE",
  "CHARACTER",
  "TROPE",
  "MAP",
  "OUTLINE",
  "OUTLINE_REVIEW",
  "WRITING",
  "CHAPTER_REVIEW",
  "DONE",
]

/**
 * 把小说的 currentStage 推进到 target；只前进不回退
 * （当前阶段已晚于 target 时不做任何事）。
 */
export async function advanceNovelStage(novelId: string, target: NovelStage) {
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { currentStage: true },
  })
  if (!novel) return

  if (NOVEL_STAGE_ORDER.indexOf(target) > NOVEL_STAGE_ORDER.indexOf(novel.currentStage)) {
    await prisma.novel.update({
      where: { id: novelId },
      data: { currentStage: target },
    })
  }
}
