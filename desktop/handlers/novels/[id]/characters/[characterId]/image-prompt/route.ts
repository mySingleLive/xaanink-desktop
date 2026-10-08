import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { generateText } from "@/lib/ai/generate"
import { normalizePersonalityTags } from "@/lib/personality-tags"
import { renderPrompt } from "@/lib/prompts/render"
import { getCharacter } from "@/lib/services/character"
import { resolveImageContext } from "@/lib/services/character-image"

import { firstIssueMessage, getOwnedNovel } from "../../../lib"

type RouteContext = { params: Promise<{ id: string; characterId: string }> }

const schema = z.object({
  kind: z.enum(["avatar", "portrait"]),
})

/**
 * AI 帮写文生图提示词：按角色资料 + 图像类型（头像/立绘）生成提示词文本，
 * 不落库，前端填入输入框后可继续修改。
 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id, characterId } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const character = await getCharacter(characterId)
  if (!character || character.novelId !== id) {
    return NextResponse.json({ error: "角色不存在" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const personalityTags = normalizePersonalityTags(character.personalityTags)
    const profile = [
      `姓名：${character.name}`,
      character.gender && `性别：${character.gender}`,
      character.age && `年龄：${character.age}`,
      character.occupation && `身份/职业：${character.occupation}`,
      character.personality && `人物描述：${character.personality}`,
      personalityTags.length > 0 && `性格：${personalityTags.join("、")}`,
      character.appearance && `外形样貌：${character.appearance}`,
      character.height && `身高：${character.height}`,
      character.weight && `体重：${character.weight}`,
      character.build && `身材：${character.build}`,
      character.faceShape && `脸型：${character.faceShape}`,
      character.clothing && `穿衣风格：${character.clothing}`,
      character.habits && `行为习惯：${character.habits}`,
    ]
      .filter(Boolean)
      .join("\n")

    const { era } = await resolveImageContext(id)
    const rendered = await renderPrompt("character.image-prompt", {
      character: profile,
      worldContext: era || "（作者尚未定主题，按角色资料自行判断合理的时代背景）",
      imageKind:
        parsed.data.kind === "avatar"
          ? "头像（正方形构图，面部特写）"
          : "立绘（竖版全身像，画面比例约 2:3）",
    })

    const { text } = await generateText({
      userId: result.session.user.id,
      novelId: id,
      action: "character.image-prompt",
      prompt: rendered,
    })

    return NextResponse.json({ text: text.trim() })
  } catch (err) {
    return toErrorResponse(err)
  }
}
