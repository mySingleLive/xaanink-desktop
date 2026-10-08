import { AsyncLocalStorage } from "node:async_hooks"
import type { Prisma, PrismaClient } from "@/generated/prisma/client"
import { isLocalAttemptRunning } from "./local-chat-cancellation"
import { ContentError } from "./content-errors"
import { CHAT_LEASE_MS, RECLAIM_GRACE_MS } from "./chat-protocol"
import type { ResolvedModel } from "./ai/provider"
import type { TaskDefaults } from "@desktop/shared/task-defaults"
import { runWithTaskDefaults } from "@desktop/service/task-defaults"

export interface ChatExecutionScope {
  userId: string
  conversationId: string
  turnId: string
  attemptId: string
  epoch: number
  toolExecutionId?: string
  operationId?: string
  /** Main text resolution for this invocation; review/image use separate frozen role IDs. */
  resolvedModel?: ResolvedModel
  /** Keyless defaults frozen when this turn began; children inherit the same IDs. */
  taskDefaults?: TaskDefaults
  networkRetry?: { maxRetries: number; canRetry: () => boolean; notify: () => void; fetch: typeof fetch }
  signal?: AbortSignal
  progress?: (event: Record<string, unknown>) => void
  /** 工具执行抛错时回传 wire 错误码（route 据此给 tool-output-error 补 code；不影响抛出行为） */
  onToolError?: (toolCallId: string, code: string) => void
}
interface ExecutionContext extends ChatExecutionScope { transaction?: Prisma.TransactionClient }
const context = new AsyncLocalStorage<ExecutionContext | undefined>()
/** 工具写入和检查点共用会话行锁；允许短暂排队，仍远短于 60 秒执行租约。 */
export const CHAT_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 }
/** 仅用于幂等控制面：短时阻塞导致事务过期时重试一次，绝不重放业务工具。 */
export async function retryChatControlTransaction<T>(run: () => Promise<T>): Promise<T> {
  try { return await run() }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2028") return run()
    throw error
  }
}
export const currentChatExecution = () => context.getStore()
export const runInChatExecution = <T>(scope: ChatExecutionScope, run: () => T): T => scope.taskDefaults
  ? runWithTaskDefaults(scope.taskDefaults, () => context.run(scope, run)) : context.run(scope, run)
/** 仅供不可变候选、实际用量及控制面审计；禁止包住正文/评论/评分写入。 */
export const outsideChatExecution = <T>(run: () => T) => context.run(undefined, run)

/**
 * 条件重新获租：宽限内，或本进程仍持有实际运行的执行器时，允许延续原租约。
 * 本机暂停/数据库阻塞可能错过宽限；时间过期不能单独证明执行器已退出。
 * 无本机存活证明时仍受宽限约束；回收、取消、epoch 变更或终态后绝不复活。
 * 与回收方的条件写成对：两侧都只在持锁事务内按同一判定收敛，恰好一侧生效。
 */
export async function reacquireChatLease(tx: Prisma.TransactionClient, scope: ChatExecutionScope): Promise<boolean> {
  const now = Date.now()
  const localOwner = isLocalAttemptRunning(scope.attemptId)
  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Conversation" SET "leaseExpiresAt" = ${new Date(now + CHAT_LEASE_MS)}
    WHERE "id" = ${scope.conversationId} AND "userId" = ${scope.userId}
      AND "activeAttemptId" = ${scope.attemptId} AND "executionEpoch" = ${scope.epoch}
      AND "cancelRequestedAt" IS NULL
      AND "leaseExpiresAt" IS NOT NULL
      AND ("leaseExpiresAt" > ${new Date(now - RECLAIM_GRACE_MS)} OR ${localOwner})
      AND EXISTS (SELECT 1 FROM "ChatAttempt" WHERE "id" = ${scope.attemptId} AND "status" IN ('queued', 'running'))
    RETURNING "id"`
  return rows.length === 1
}

/** 必须先于任何业务锁，且锁持有到业务事务提交；取消事务采用同一首锁。 */
export async function assertChatExecution(tx: Prisma.TransactionClient, scope: ChatExecutionScope) {
  const rows = await tx.$queryRaw<{ activeAttemptId: string | null; executionEpoch: number; live: boolean; cancelRequestedAt: Date | null }[]>`
    SELECT "activeAttemptId", "executionEpoch", "cancelRequestedAt", ("leaseExpiresAt" > CURRENT_TIMESTAMP) AS live
    FROM "Conversation" WHERE "id" = ${scope.conversationId} AND "userId" = ${scope.userId} FOR UPDATE`
  const row = rows[0]
  if (!row || row.activeAttemptId !== scope.attemptId || row.executionEpoch !== scope.epoch || row.cancelRequestedAt || scope.signal?.aborted) {
    throw new ContentError("EXECUTION_REVOKED", "此轮执行已停止或失去运行权限，旧结果不能写入", 409)
  }
  // 过期后先核对当前执行器，再尝试条件续租；取消与 epoch 门禁始终优先。
  if (!row.live && !await reacquireChatLease(tx, scope)) {
    throw new ContentError("EXECUTION_REVOKED", "此轮执行已停止或失去运行权限，旧结果不能写入", 409)
  }
}

const reads = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"])
const controlModels = new Set(["chatTurn", "chatAttempt", "chatRequest", "chatToolExecution", "chatWriteEffect"])
type DynamicObject = Record<string, unknown>

function effectReceipt(value: unknown): Prisma.InputJsonObject {
  if (Array.isArray(value)) return { count: value.length, ids: value.flatMap(row => row && typeof row === "object" && "id" in row && typeof row.id === "string" ? [row.id] : []) }
  if (!value || typeof value !== "object") return { acknowledged: true }
  const row = value as Record<string, unknown>
  return Object.fromEntries(["id", "version", "updatedAt", "count"].flatMap(key => {
    const value = row[key]
    return value instanceof Date ? [[key, value.toISOString()]] : typeof value === "string" || typeof value === "number" ? [[key, value]] : []
  }))
}

/**
 * 普通调用保持原 Prisma 语义；聊天工具内的每个写事务自动加执行门禁。
 * 显式事务仍由业务服务决定范围；只把数据库操作包进事务，不包网络调用。
 */
export function withChatWriteFence(base: PrismaClient): PrismaClient {
  const transactionView = (tx: Prisma.TransactionClient, scope: ExecutionContext) => new Proxy(tx, {
    get(target, property) {
      const value = Reflect.get(target, property)
      if (typeof property !== "string" || property.startsWith("$") || !value || typeof value !== "object") return typeof value === "function" ? value.bind(target) : value
      return delegate(value, property, scope, tx)
    },
  })
  const inTransaction = async (scope: ExecutionContext, run: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) => {
    if (scope.transaction) return run(transactionView(scope.transaction, scope))
    return base.$transaction(async tx => {
      await assertChatExecution(tx, scope)
      const next = { ...scope, transaction: tx }
      return context.run(next, () => run(transactionView(tx, next)))
    }, { ...CHAT_TRANSACTION_OPTIONS, ...options })
  }
  const delegate = (original: object, model: string, fixed?: ExecutionContext, tx?: Prisma.TransactionClient) => new Proxy(original, {
    get(target, property) {
      const method = Reflect.get(target, property)
      if (typeof property !== "string" || typeof method !== "function") return method
      return (...args: unknown[]) => {
        const scope = fixed ?? context.getStore()
        if (!scope) return method.apply(target, args)
        const isRead = reads.has(property)
        const execute = async (transaction: Prisma.TransactionClient) => {
          const modelDelegate = (transaction as unknown as DynamicObject)[model] as DynamicObject
          const call = modelDelegate[property] as (...args: unknown[]) => Promise<unknown>
          const result = await call.apply(modelDelegate, args)
          const changedNothing = (property === "updateMany" || property === "deleteMany" || property === "createMany") && result && typeof result === "object" && "count" in result && result.count === 0
          if (!isRead && !changedNothing && !controlModels.has(model) && scope.toolExecutionId) {
            const receipt = effectReceipt(result)
            await transaction.chatWriteEffect.create({ data: { toolExecutionId: scope.toolExecutionId, targetModel: model,
              targetId: typeof receipt.id === "string" ? receipt.id : null, operation: property, receipt } })
            await transaction.chatAttempt.update({ where: { id: scope.attemptId }, data: { hasWriteEffects: true } })
          }
          return result
        }
        // tx 是未代理的真实事务，审计写入不递归；同事务全程持有会话行锁。
        if (tx || scope.transaction) return execute(tx ?? scope.transaction!)
        if (isRead) return method.apply(target, args)
        return inTransaction(scope, view => {
          // context.transaction 为底层事务，避免 view 的审计代理重复记录。
          void view
          return execute(context.getStore()!.transaction!)
        })
      }
    },
  })
  return new Proxy(base, {
    get(target, property) {
      const value = Reflect.get(target, property)
      if (property === "$transaction") return (run: unknown, options?: object) => {
        const scope = context.getStore()
        if (!scope) return value.call(target, run, options)
        if (typeof run !== "function") throw new Error("聊天工具事务须使用回调，以在写入前取得执行锁")
        return inTransaction(scope, run as (tx: Prisma.TransactionClient) => Promise<unknown>, options)
      }
      if (typeof property !== "string") return value
      if (property.startsWith("$")) {
        if (typeof value !== "function") return value
        if (["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"].includes(property)) return (...args: unknown[]) => {
          const scope = context.getStore()
          if (!scope) return value.apply(target, args)
          return inTransaction(scope, tx => (Reflect.get(tx, property) as (...args: unknown[]) => Promise<unknown>)(...args))
        }
        return value.bind(target)
      }
      return value && typeof value === "object" ? delegate(value, property) : value
    },
  }) as PrismaClient
}
