import { NextResponse } from "next/server"

import { toErrorResponse } from "@/lib/ai/errors"
import { generateText } from "@/lib/ai/generate"
import { buildItemImageAssistPrompt } from "@/lib/item-image-prompt"
import { resolveImageContext } from "@/lib/services/character-image"
import { getItem } from "@/lib/services/item"

import { getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; itemId: string }> }

/**
 * AI 帮写文生图提示词：按物品资料（名称+外形+介绍）与作品时代语境生成提示词文本，
 * 不落库，前端填入输入框后可继续修改。无入参（物品只有图标一种图，无 kind 维度）。
 */
export async function POST(_request: Request, ctx: RouteContext) {
  const { id, itemId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const item = await getItem(itemId)
  if (!item || item.novelId !== id) {
    return NextResponse.json({ error: "物品不存在" }, { status: 404 })
  }

  try {
    const { era } = await resolveImageContext(id)
    const rendered = buildItemImageAssistPrompt(
      { name: item.name, appearance: item.appearance, description: item.description },
      era || "（作者尚未定主题，按物品资料自行判断合理的时代背景）"
    )

    const { text } = await generateText({
      userId: result.session.user.id,
      novelId: id,
      action: "item.image-prompt",
      prompt: rendered,
    })

    return NextResponse.json({ text: text.trim() })
  } catch (err) {
    return toErrorResponse(err)
  }
}
