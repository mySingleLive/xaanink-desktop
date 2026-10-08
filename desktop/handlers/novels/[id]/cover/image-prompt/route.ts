import { NextResponse } from "next/server"

import { buildNovelSections } from "@/lib/ai/context"
import { toErrorResponse } from "@/lib/ai/errors"
import { generateText } from "@/lib/ai/generate"
import { prisma } from "@/lib/db"
import { renderPrompt } from "@/lib/prompts/render"
import { resolveImageContext } from "@/lib/services/character-image"

import { getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string }> }

/** 塞进模板的大纲文本上限，避免整本大纲把封面提示词淹没 */
const OUTLINE_MAX = 3000

/** 卷章大纲拼成文本（与 review.ts 的拼法一致）：卷简介 + 各章大纲，卷章按 index 排序 */
async function buildOutlineText(novelId: string): Promise<string> {
  const volumes = await prisma.volume.findMany({
    where: { novelId },
    include: { chapters: { orderBy: { index: "asc" } } },
    orderBy: { index: "asc" },
  })
  if (volumes.length === 0) return "（暂无大纲）"

  const text = volumes
    .map((volume) => {
      const chaptersText = volume.chapters
        .map((c) => `第 ${c.index} 章《${c.title}》\n${c.outline}`)
        .join("\n\n")
      return `第 ${volume.index} 卷《${volume.title}》\n卷简介：${volume.summary}\n\n${chaptersText}`
    })
    .join("\n\n")
  return text.length > OUTLINE_MAX ? `${text.slice(0, OUTLINE_MAX)}…` : text
}

/**
 * AI 帮写封面提示词：按主题/设定/角色/大纲 + 时代语境生成封面文生图提示词文本，
 * 不落库，前端填入输入框后可继续修改。
 */
export async function POST(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  try {
    const [sections, outline, { era }] = await Promise.all([
      buildNovelSections(id),
      buildOutlineText(id),
      resolveImageContext(id),
    ])

    const rendered = await renderPrompt("cover.image-prompt", {
      theme: sections.theme,
      settings: sections.settings,
      characters: sections.characters,
      outline,
      worldContext: era || "（作者尚未定主题，按作品资料自行判断合理的风格背景）",
    })

    const { text } = await generateText({
      userId: result.session.user.id,
      novelId: id,
      action: "cover.image-prompt",
      prompt: rendered,
    })

    return NextResponse.json({ text: text.trim() })
  } catch (err) {
    return toErrorResponse(err)
  }
}
