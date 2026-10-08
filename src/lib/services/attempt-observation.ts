import type { Prisma } from "@/generated/prisma/client"
import { controlPrisma } from "@/lib/db"

export interface AttemptMetrics {
  requestStartedAt: string; queueMs: number; databaseMs: number; prepareMs: number
  modelStartedAt: string | null; firstEventMs: number | null; firstTextMs: number | null
  modelMs: number | null; saveConfirmMs: number | null; totalMs: number | null
  networkRequests: number; networkErrors: number; retries: number; status: string
  modelName?: string; effort?: string | null; configHash?: string; costStrategy?: boolean
  inputEstimate?: number; usage: "reported_only"
  errorCode?: string; httpStatuses?: Record<string, number>
  providerErrorCodes?: string[]
  /** 终态原始错误名（如 PrismaClientKnownRequestError）；分类码在 errorCode */
  errorName?: string
  /** 原始错误消息尾部（截断 500 字符）：zod 路径/Prisma 码等定位信息，避免排查依赖进程日志 */
  errorDetail?: string
}
/** 只存结构化计量；时钟可注入，未发生阶段保持 null。 */
export class AttemptMeter {
  data: AttemptMetrics
  private started: number
  private modelStart: number | null = null
  constructor(private clock: () => number = () => performance.now(), requestStartedAt = new Date().toISOString()) {
    this.started = clock()
    this.data = { requestStartedAt, queueMs: 0, databaseMs: 0, prepareMs: 0, modelStartedAt: null, firstEventMs: null, firstTextMs: null,
      modelMs: null, saveConfirmMs: null, totalMs: null, networkRequests: 0, networkErrors: 0, retries: 0, status: "queued", usage: "reported_only" }
  }
  startModel() { this.modelStart = this.clock(); this.data.modelStartedAt = new Date().toISOString() }
  event(readable = false) { if (this.modelStart === null) return; const elapsed = this.clock() - this.modelStart; this.data.firstEventMs ??= elapsed; if (readable) this.data.firstTextMs ??= elapsed }
  modelEnd() { if (this.modelStart !== null) this.data.modelMs = this.clock() - this.modelStart }
  end(status: string, retries: number) { this.data.status = status; this.data.retries = retries; this.data.totalMs = this.clock() - this.started }
}
export async function saveAttemptObservation(scope: { turnId: string; attemptId: string }, meter: AttemptMeter, model?: { id: string; provider: string }, auto = false) {
  const data = { turnId: scope.turnId, modelId: model?.id ?? null, provider: model?.provider ?? null, auto, data: JSON.parse(JSON.stringify(meter.data)) as Prisma.InputJsonValue }
  await controlPrisma.attemptObservation.upsert({ where: { attemptId: scope.attemptId }, create: { attemptId: scope.attemptId, ...data }, update: data })
}
export function usageCategory(action: string) {
  return action === "chat" ? "chat" : action === "chat.compact" ? "compression" : /review|judge|baseline/.test(action) ? "review" : "generation"
}
