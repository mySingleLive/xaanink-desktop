import { NextResponse } from "next/server"
import { z } from "zod"

import { buildNovelContext } from "@/lib/ai/context"
import { toErrorResponse } from "@/lib/ai/errors"
import { generateText } from "@/lib/ai/generate"
import { SettingType } from "@/generated/prisma/enums"
import { prisma } from "@/lib/db"
import { SETTING_TYPE_LABELS } from "@/lib/setting-types"
import { listSettings } from "@/lib/services/setting"

import { firstIssueMessage, getOwnedNovel } from "../../lib"

type RouteContext = { params: Promise<{ id: string }> }

const assistSchema = z.object({
  type: z.enum(SettingType),
  name: z.string().trim().max(100).default(""),
  currentContent: z.unknown().optional(),
  instruction: z.string().trim().max(2000).default(""),
  /** 世界级设定的所属世界 id（小说级类型留空） */
  worldId: z.string().trim().min(1).nullish(),
})

/**
 * AI 辅助生成设定初稿（不落库，前端预览后由用户确认再保存）。
 * 使用 setting.assist 模板（变量：theme / settingType / existingSettings / userHint）。
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
    const { type, name, currentContent, instruction, worldId } = parsed.data
    const world = worldId ? await prisma.world.findFirst({ where: { id: worldId, novelId: id } }) : null
    if (worldId && !world) return NextResponse.json({ error: "世界不存在" }, { status: 404 })
    const existing = await listSettings(id, { type, worldId: world?.id })

    const hintParts = []
    if (world) {
      hintParts.push(
        `所属世界：${world.name}${world.description ? `（世界介绍：${world.description.slice(0, 500)}）` : ""}`
      )
    }
    if (name) hintParts.push(`设定名称：${name}`)
    if (currentContent !== undefined) {
      hintParts.push(`当前内容（在此基础上完善）：\n${JSON.stringify(currentContent, null, 2)}`)
    }
    if (instruction) hintParts.push(`补充要求：${instruction}`)
    const context = await buildNovelContext(id, hintParts.join("\n"))

    const { text } = await generateText({
      userId: result.session.user.id,
      novelId: id,
      action: "setting.assist",
      promptKey: "setting.assist",
      vars: {
        theme: context,
        settingType: `${SETTING_TYPE_LABELS[type]}（${type}）`,
        existingSettings:
          existing.length > 0
            ? existing
                .map((s) => `### ${s.name}\n${JSON.stringify(s.content, null, 2)}`)
                .join("\n\n")
            : "（暂无）",
        userHint: hintParts.length > 0 ? hintParts.join("\n") : "（无，请自由发挥）",
      },
    })

    return NextResponse.json({ text })
  } catch (err) {
    return toErrorResponse(err)
  }
}
