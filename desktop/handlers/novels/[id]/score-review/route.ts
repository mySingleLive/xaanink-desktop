import { NextResponse } from "next/server"
import { z } from "zod"

import { toErrorResponse } from "@/lib/ai/errors"
import { ContentError } from "@/lib/content-errors"
import { prisma } from "@/lib/db"
import {
  ReviewContentEmptyError,
  ReviewTargetNotFoundError,
  requestAIReview,
} from "@/lib/services/review"
import { SCORE_TARGET_TYPES } from "@/lib/services/score-report"
import { completeRun, failRun, startRun } from "@/lib/services/subagent-run"
import { startCandidateScoreReview } from "@/lib/services/content-review"
import { runReaderPanel } from "@/lib/sop/runner"
import { cancelStandaloneScoreReview } from "@/lib/services/review-cancellation"

import { firstIssueMessage, getOwnedNovel } from "../lib"

type RouteContext = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  targetType: z.enum(SCORE_TARGET_TYPES),
  targetId: z.string().min(1),
  /** 候选稿直连评审：存在时 targetId 即 chapterId，评委单跑（不走读者团/对话） */
  candidateId: z.string().min(1).optional(),
})

/** 无对话回合的直接评审及旧的未收尾记录，也可由评分浮窗停止。 */
export async function DELETE(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const owned = await getOwnedNovel(id)
  if ("error" in owned) return owned.error
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "参数不合法" }, { status: 400 })
  try {
    return NextResponse.json(await cancelStandaloneScoreReview(owned.session.user.id, id, parsed.data.targetType, parsed.data.targetId, parsed.data.candidateId))
  } catch (error) { return toErrorResponse(error) }
}

/** 任务一句话用的对象名解析（评委子代理档案）；解析失败退回通用文案，不影响主流程 */
async function resolveTaskLabel(
  novelId: string,
  targetType: string,
  targetId: string
): Promise<string> {
  try {
    if (targetType === "VOLUME_OUTLINE") {
      const volume = await prisma.volume.findUnique({ where: { id: targetId } })
      if (volume) return `评阅第 ${volume.index} 卷《${volume.title}》大纲`
    } else {
      const chapter = await prisma.chapter.findUnique({
        where: { id: targetId },
        include: { volume: true },
      })
      if (chapter && chapter.volume.novelId === novelId) {
        return `评阅第 ${chapter.index} 章《${chapter.title}》${targetType === "CHAPTER_CONTENT" ? "正文" : "大纲"}`
      }
    }
  } catch {
    // 忽略，reviewService 会再校验一次目标
  }
  return "评阅"
}

const errText = (err: unknown) => (err instanceof Error ? err.message : "未知错误")

/**
 * 悬浮评分指示器「发起/重新评审」按钮的统一入口：
 * 章/卷 → requestAIReview（评委评审，落 Review），外包 judge SubAgentRun
 * （target 列携带——聚合的评委卡回放链接与「评审中」检测都靠它，与对话工具路径一致）；
 * 章正文一键全量评审（2026-09 评分页按钮合并）= 评委 + 读者团三人并行，
 * 读者团失败降级为 panelWarnings 警示、不挡评委分。
 * 进行中重复发起映射 409，内容为空 400，目标不存在 404。
 */
export async function POST(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  const result = await getOwnedNovel(id)
  if ("error" in result) return result.error

  const body = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: firstIssueMessage(parsed.error, "参数不合法") },
      { status: 400 }
    )
  }

  const { targetType, targetId, candidateId } = parsed.data
  const userId = result.session.user.id

  try {
    // 候选稿直连评审（评委单跑，不经对话/读者团；候选面板「发起/重新评审」入口；服务层实现见 content-review.ts）
    if (candidateId) {
      if (targetType !== "CHAPTER_CONTENT") throw new ContentError("INVALID_INPUT", "候选评审仅支持章正文目标", 400)
      const { review } = await startCandidateScoreReview({ userId, novelId: id, chapterId: targetId, candidateId, abortSignal: request.signal })
      return NextResponse.json({ review })
    }

    // 章/卷：评委子代理档案先于评审建立（running 态即「评审中」信号），失败 failRun 留痕
    const task = await resolveTaskLabel(id, targetType, targetId)
    const run = await startRun({ novelId: id, agentKind: "judge", task, targetType, targetId })
    const judgeJob = (async () => {
      try {
        const { review, usage } = await requestAIReview({ novelId: id, targetType, targetId, userId, sourceRunId: run.id, abortSignal: request.signal })
        const comments = Array.isArray(review.aiComments) ? review.aiComments : []
        if (review.sourceRunId !== run.id) await completeRun(run.id, {
          transcript: { score: review.aiScore, comments },
          result: { score: review.aiScore ?? null, commentCount: comments.length },
          tokenUsage: usage,
        })
        return review
      } catch (err) {
        await failRun(run.id, err instanceof Error ? err.message : "评审失败")
        throw err
      }
    })()

    // 大纲类目标仅评委评审
    if (targetType !== "CHAPTER_CONTENT") {
      return NextResponse.json({ review: await judgeJob })
    }

    // 章正文：评委 + 读者团两路并行（SopNodeRun 与 run 档案各自独立互不冲突；
    // 「评审中」检测对两路 run 同时生效）
    const [judgeRes, readersRes] = await Promise.allSettled([
      judgeJob,
      runReaderPanel({ novelId: id, userId, chapterId: targetId, conversationId: null }),
    ])

    const panelWarnings: string[] = []
    if (readersRes.status === "rejected") {
      panelWarnings.push(`读者团试读失败：${errText(readersRes.reason)}`)
    }
    // 评委分是核心产物：评委失败则整单失败（走下方错误映射）
    if (judgeRes.status === "rejected") throw judgeRes.reason
    return NextResponse.json({ review: judgeRes.value, panelWarnings })
  } catch (err) {
    if (err instanceof ReviewTargetNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof ReviewContentEmptyError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return toErrorResponse(err)
  }
}
