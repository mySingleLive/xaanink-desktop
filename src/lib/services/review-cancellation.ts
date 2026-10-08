import type { Prisma } from "@/generated/prisma/client"
import { ContentError } from "@/lib/content-errors"
import { prisma } from "@/lib/db"
import type { ScoreTargetType } from "@/lib/score-types"

const shared = globalThis as typeof globalThis & { novelReviewAborts?: Map<string, AbortController> }
const controllers = shared.novelReviewAborts ??= new Map<string, AbortController>()
const cancelled = () => new ContentError("REVIEW_CANCELLED", "评审已停止", 409)

/** 直接评审也传递取消信号；数据库运行状态负责阻止跨进程或迟到的结果写入。 */
export async function withReviewAbort<T>(runId: string, signal: AbortSignal | undefined, task: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  controllers.set(runId, controller)
  try {
    combined.throwIfAborted()
    if ((await prisma.subAgentRun.findUnique({ where: { id: runId }, select: { status: true } }))?.status !== "running") throw cancelled()
    return await task(combined)
  } catch (error) {
    if (combined.aborted) throw cancelled()
    throw error
  } finally {
    if (controllers.get(runId) === controller) controllers.delete(runId)
  }
}

/** 与保存评审的事务共用行锁：取消先到时拒绝落库，保存先完成时保留已提交评分。 */
export async function assertReviewRunning(tx: Prisma.TransactionClient, runId: string, signal?: AbortSignal) {
  await tx.$queryRaw`SELECT id FROM "SubAgentRun" WHERE id = ${runId} FOR UPDATE`
  const run = await tx.subAgentRun.findUnique({ where: { id: runId }, select: { status: true } })
  if (signal?.aborted || run?.status !== "running") throw cancelled()
}

export async function cancelStandaloneScoreReview(userId: string, novelId: string, targetType: ScoreTargetType, targetId: string, candidateId?: string) {
  const owned = await prisma.novel.findFirst({ where: { id: novelId, userId, status: { not: "DELETED" } }, select: { id: true } })
  if (!owned) throw new ContentError("TARGET_NOT_FOUND", "小说不存在或无权访问", 404)
  const runs = await prisma.subAgentRun.findMany({
    // 缺省（章级）必须显式 candidateId:null——候选 standalone run 共享同一 targetType/targetId，不过滤会误杀
    where: { novelId, targetType, targetId, candidateId: candidateId ?? null, attemptId: null, status: "running" },
    select: { id: true },
  })
  const ids = runs.map(run => run.id)
  const result = await prisma.subAgentRun.updateMany({
    where: { id: { in: ids }, status: "running" },
    data: { status: "error", errorMessage: "作者已停止评审，已完成的评分保留" },
  })
  for (const id of ids) controllers.get(id)?.abort(cancelled())
  return { stopped: result.count }
}
