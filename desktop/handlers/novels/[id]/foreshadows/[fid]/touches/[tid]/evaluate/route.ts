import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { generateJSON } from "@/lib/ai/generate"
import { prisma } from "@/lib/db"
import { renderPrompt } from "@/lib/prompts/render"
import { recordTouchScore } from "@/lib/services/foreshadow"
import { completeRun, failRun, startRun } from "@/lib/services/subagent-run"

import { getOwnedNovel } from "../../../../../lib"

type RouteContext = { params: Promise<{ id: string; fid: string; tid: string }> }

const evaluateSchema = z.object({
  score: z.number().min(0).max(100),
  comment: z.string().default(""),
})

/**
 * 单触点 AI 评估（面板「评估此触点」按钮）：judge 单发，
 * 评「这一笔写得好不好」（埋得是否自然/提及是否不生硬/回收是否痛快合理），
 * 时机与规划合理性归章/卷评审的「伏笔运营」维度，不在此评估。
 */
export async function POST(_request: Request, ctx: RouteContext) {
  const { id, fid, tid } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error
  const userId = result.session.user.id

  const touch = await prisma.foreshadowTouch.findUnique({
    where: { id: tid },
    include: { foreshadow: true },
  })
  if (!touch || touch.novelId !== id || touch.foreshadowId !== fid) {
    return NextResponse.json({ error: "触点不存在" }, { status: 404 })
  }

  /* 触点上下文：章正文/大纲（截 3000 字）；无锚点触点只有摘要 */
  let contextText = ""
  let targetLabel = ""
  if (touch.chapterId) {
    const chapter = await prisma.chapter.findUnique({
      where: { id: touch.chapterId },
      include: { volume: { select: { index: true } } },
    })
    if (chapter) {
      targetLabel = `第 ${chapter.volume.index} 卷第 ${chapter.index} 章《${chapter.title}》`
      const body = chapter.content.trim() ? chapter.content : chapter.outline
      contextText = body.slice(0, 3000)
    }
  }

  const run = await startRun({
    novelId: id,
    agentKind: "judge",
    task: `评估伏笔触点「${touch.foreshadow.title}」`,
    targetType: "FORESHADOW_TOUCH",
    targetId: tid,
  })

  try {
    const prompt = await renderPrompt("foreshadow.touch.evaluate", {
      title: touch.foreshadow.title,
      content: touch.foreshadow.content,
      kind: touch.kind,
      summary: touch.summary,
      targetLabel,
      contextText: contextText || "（目标内容为空）",
    })
    const { data, promptTokens, completionTokens } = await generateJSON({
      userId,
      novelId: id,
      tier: "ADVANCED",
      action: "foreshadow.touch.evaluate",
      prompt,
      schema: evaluateSchema,
    })
    await recordTouchScore(id, tid, data.score, data.comment)
    await completeRun(run.id, {
      transcript: { prompt, output: data },
      result: { score: data.score },
      tokenUsage: { input: promptTokens, output: completionTokens },
    })
    return NextResponse.json({ score: data.score, comment: data.comment })
  } catch (err) {
    await failRun(run.id, err instanceof Error ? err.message : "评估失败")
    return toErrorResponse(err)
  }
}
