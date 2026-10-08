import { NextResponse } from "next/server"
import { z } from "zod"

import { buildNovelContext } from "@/lib/ai/context"
import { toErrorResponse } from "@/lib/ai/errors"
import { generateText } from "@/lib/ai/generate"
import { renderPrompt } from "@/lib/prompts/render"
import { CharacterRoleType } from "@/generated/prisma/enums"
import { listCharacters } from "@/lib/services/character"

import { firstIssueMessage, getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string }> }

const assistSchema = z.object({
  roleType: z.enum(CharacterRoleType),
  instruction: z.string().trim().max(2000).default(""),
})

const JSON_OUTPUT_INSTRUCTION =
  "\n\n请只输出一个 JSON 代码块（```json ... ```）或纯 JSON 对象，不要输出任何解释性文字。aliases 字段为字符串数组（别名/外号）；relationships 字段为数组：[{ \"target\": \"关系对象\", \"description\": \"关系描述\" }]；motivations 字段为有序层数组：[{ \"items\": [{ \"text\": \"动机内容\", \"importance\": 1~5 }] }]，第 1 层最表面、末层最根本，每层可并列多条；beliefs 字段为对象：{ \"worldview\": \"世界观\", \"values\": \"价值观\", \"outlook\": \"人生观\" }（均可选）；bigFive 字段为对象：{ \"openness\": 0~100, \"conscientiousness\": 0~100, \"extraversion\": 0~100, \"agreeableness\": 0~100, \"neuroticism\": 0~100 }——它是角色性格的骨架，必须先定 personality/personalityTags 再据其推定、互相印证（内向→extraversion 给低、严谨自律→conscientiousness 给高、多疑→agreeableness 偏低），要有区分度、不给五维全 50 的中庸值。"

/**
 * AI 生成角色草稿（不落库，前端预览确认后填入表单）。
 * 使用 character.assist 模板（变量：theme / roleType / existingCharacters / userHint），
 * 返回模型输出的 JSON 字符串，前端 tolerant parse。
 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = assistSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  try {
    const context = await buildNovelContext(id)
    const existing = await listCharacters(id)

    const rendered = await renderPrompt("character.assist", {
      theme: context,
      roleType: parsed.data.roleType,
      existingCharacters:
        existing.length > 0
          ? existing.map((c) => `- ${c.name}（${c.roleType}）：${c.personality}`).join("\n")
          : "（暂无）",
      userHint: parsed.data.instruction || "（无，请自由发挥）",
    })

    const { text } = await generateText({
      userId: result.session.user.id,
      novelId: id,
      action: "character.assist",
      prompt: rendered + JSON_OUTPUT_INSTRUCTION,
    })

    return NextResponse.json({ text })
  } catch (err) {
    return toErrorResponse(err)
  }
}
