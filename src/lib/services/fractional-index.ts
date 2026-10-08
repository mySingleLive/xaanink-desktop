/**
 * 分数序号机制（fractional indexing）：情景试验场（ScenarioNode/ScenarioCard）使用。
 *
 * 原理：序号取相邻两者的中值（中值插入无限可分）；间隙过挤时全量重排为 1024 步距；
 * 撞 (scope,index) 唯一约束（P2002，并发插入同一中值）重读重试 ≤5 次（照 outline.ts
 * appendWithIndex 先例）。
 */

import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { currentChatExecution } from "@/lib/chat-execution"

/** 分数序号步距（全量重排后也按此步距铺） */
export const INDEX_STEP = 1024
/** 相邻序号间隙小于该值时触发全量重排 */
export const MIN_GAP = 1e-4
/** 撞 (scope,index) 唯一约束（P2002）时的重读重试上限 */
export const INDEX_CONFLICT_RETRIES = 5
/** 单次插入允许的重排次数上限（重排后间隙恢复 1024，正常不会二次触发；兜底防死循环） */
export const MAX_REBALANCES = 3

/** Prisma 唯一约束冲突 */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002"
}

/**
 * 分数序号：无 prev 取 next-1024，无 next 取 prev+1024，都有取中值；
 * 都没有（空板第一条）取 1024。
 */
export function midIndex(prev?: number, next?: number): number {
  if (prev === undefined && next === undefined) return INDEX_STEP
  if (prev === undefined) return next! - INDEX_STEP
  if (next === undefined) return prev + INDEX_STEP
  return (prev + next) / 2
}

export interface FractionalIndexRow {
  id: string
  index: number
}

/**
 * 带分数序号的 delegate 的最小结构（scenarioNode/scenarioCard 共用）。
 * findMany 参数用 unknown 声明（方法简写双变型，prisma 生成的强类型 delegate 可直接传入），
 * 模块内调用时固定传 { where: 作用域, orderBy: index asc, select: id/index }。
 */
export interface FractionalDelegate {
  findMany(args: unknown): Promise<FractionalIndexRow[]>
  update(args: { where: { id: string }; data: { index: number } }): Prisma.PrismaPromise<unknown>
}

/**
 * 计算插入点两侧的邻居序号：
 * - afterId + beforeId：落在两锚点之间（补间）
 * - 仅 afterId：紧随其后（next 取它的后一个邻居，把插入约束在空隙内）
 * - 仅 beforeId：紧挨其前
 * - 都不给：追加到末尾
 * 锚点 id 给了但不存在时返回 null（调用方抛 NotFound）。
 */
function locateGap(
  rows: FractionalIndexRow[],
  afterId?: string | null,
  beforeId?: string | null
): { prev?: number; next?: number } | null {
  if (afterId) {
    const i = rows.findIndex((r) => r.id === afterId)
    if (i === -1) return null
    if (beforeId) {
      const j = rows.findIndex((r) => r.id === beforeId)
      if (j === -1) return null
      // 补间：落在两锚点之间最靠近 beforeId 的空位（prev 取两锚点之间 index 最大的一行），
      // 连续补间按提交顺序堆在 beforeId 之前；并发撞号重读后 prev 必然推进，不会原地死撞。
      const between = rows.filter((r) => r.index > rows[i].index && r.index < rows[j].index)
      const prev = between.length > 0 ? between[between.length - 1].index : rows[i].index
      return { prev, next: rows[j].index }
    }
    return { prev: rows[i].index, next: rows[i + 1]?.index }
  }
  if (beforeId) {
    const j = rows.findIndex((r) => r.id === beforeId)
    if (j === -1) return null
    return { prev: rows[j - 1]?.index, next: rows[j].index }
  }
  return { prev: rows[rows.length - 1]?.index }
}

/**
 * 间隙过挤时全量重排为 1024 步距。
 * 先统一挪到负值再写回正值：(scope,index) 有唯一约束，
 * 直接在原值上改写可能撞上尚未改写的行（如旧值 1024 的行占着新值 1024）。
 * scopeWhere 为作用域过滤（如 { labId }）。
 */
export async function rebalanceIndexes(
  delegate: FractionalDelegate,
  scopeWhere: Record<string, string>
) {
  const rows = await delegate.findMany({
    where: scopeWhere,
    orderBy: { index: "asc" },
    select: { id: true, index: true },
  })
  if (currentChatExecution()) {
    await prisma.$transaction(async () => {
      for (const [i, row] of rows.entries()) await delegate.update({ where: { id: row.id }, data: { index: -(i + 1) } })
      for (const [i, row] of rows.entries()) await delegate.update({ where: { id: row.id }, data: { index: (i + 1) * INDEX_STEP } })
    })
    return
  }
  await prisma.$transaction([
    ...rows.map((row, i) => delegate.update({ where: { id: row.id }, data: { index: -(i + 1) } })),
    ...rows.map((row, i) =>
      delegate.update({ where: { id: row.id }, data: { index: (i + 1) * INDEX_STEP } })
    ),
  ])
}

/**
 * 分数序号插入/移动公共骨架（撞号重读重试照 appendWithIndex）：
 * 每轮重读当前序号 → 定位空隙 → 间隙过挤先全量重排 → 取中值写入；
 * 撞 P2002（并发插入同一中值）重读重试 ≤5 次。
 * excludeId 用于移动时把自身排除出邻居计算。
 */
export async function insertWithIndex<T>(
  delegate: FractionalDelegate,
  scopeWhere: Record<string, string>,
  anchor: { afterId?: string | null; beforeId?: string | null },
  anchorNotFound: () => Error,
  create: (index: number) => Promise<T>,
  excludeId?: string
): Promise<T> {
  let rebalances = 0
  for (let attempt = 1; ; attempt++) {
    const all = await delegate.findMany({
      where: scopeWhere,
      orderBy: { index: "asc" },
      select: { id: true, index: true },
    })
    const rows = excludeId ? all.filter((r) => r.id !== excludeId) : all
    const gap = locateGap(rows, anchor.afterId, anchor.beforeId)
    if (!gap) throw anchorNotFound()
    if (gap.prev !== undefined && gap.next !== undefined) {
      if (gap.next <= gap.prev) {
        throw new Error("插入位置不合法：beforeId/nextId 排在 afterId/prevId 之前")
      }
      if (gap.next - gap.prev < MIN_GAP) {
        if (++rebalances > MAX_REBALANCES) {
          throw new Error("序号重排失败，请重试")
        }
        await rebalanceIndexes(delegate, scopeWhere)
        continue
      }
    }
    try {
      return await create(midIndex(gap.prev, gap.next))
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= INDEX_CONFLICT_RETRIES) throw err
    }
  }
}
