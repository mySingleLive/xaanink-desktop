import type { Foreshadow, ForeshadowTouch, ForeshadowTouchKind } from "@/generated/prisma/client"

/**
 * 伏笔领域的纯函数：AI 上下文渲染（伏笔一览 / 本章提示）与状态机、序号折算。
 * 服务层见 src/lib/services/foreshadow.ts；类型即 Prisma 行（测试可直接构造）。
 */

export type ForeshadowWithTouches = Foreshadow & { touches: ForeshadowTouch[] }

/** 伏笔一览渲染上限：全书伏笔通常个位数到几十条，超出截断标注（长度无关≠无限进上下文） */
export const FORESHADOW_DIGEST_MAX = 40
/** 单条伏笔在一览里的最大字符数（标题+内容截断+位置信息） */
export const FORESHADOW_DIGEST_ITEM_MAX = 120
/** 「已回收」伏笔在一览中最多保留最近 N 条（历史档案价值低，新回收的才有参考意义） */
const RESOLVED_DIGEST_KEEP = 5
/** 距最近触点超过该线性章数未再提及 → 本章提示「考虑安排提及」 */
export const FORESHADOW_STALE_CHAPTERS = 15
/** 触点摘要参与编辑器锚点定位的最大长度（长摘要误命中率高，不参与定位） */
export const FORESHADOW_ANCHOR_MAX = 30

export const TOUCH_KIND_LABELS: Record<ForeshadowTouchKind, string> = {
  PLANT: "埋入",
  MENTION: "提及",
  PAYOFF: "回收",
}

export const FORESHADOW_STATUS_LABELS: Record<string, string> = {
  PLANNED: "未埋",
  PLANTED: "已埋",
  RESOLVED: "已回收",
  DROPPED: "废弃",
}

/** 全书章序从 1 连续编号，不能用卷号拼接，否则第 1 卷第 1 章就会被误判超过第 4 章。 */
export function buildChapterPositionMap(
  chapters: { id: string; index: number; volume: { index: number } }[]
): Map<string, number> {
  return new Map([...chapters]
    .sort((a, b) => a.volume.index - b.volume.index || a.index - b.index)
    .map((chapter, index) => [chapter.id, index + 1]))
}

/** 触点状态机：触点增删后重算伏笔状态（DROPPED 免疫——作者废弃不再被触点变更翻动） */
export function deriveForeshadowStatus(
  current: Foreshadow["status"],
  touches: Pick<ForeshadowTouch, "kind">[]
): Foreshadow["status"] {
  if (current === "DROPPED") return current
  if (touches.some((t) => t.kind === "PAYOFF")) return "RESOLVED"
  if (touches.some((t) => t.kind === "PLANT")) return "PLANTED"
  return "PLANNED"
}

function truncate(text: string, max: number): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** 触点的位置标签（AI 上下文用）：章 → 「第 V 卷第 C 章」 */
export interface TouchLabelMaps {
  /** chapterId → 标签（服务层预解析） */
  chapters: Map<string, string>
}

/** 按评审范围列完整触点链，同一档案仅写一次，不受全书摘要数量上限影响。 */
export function renderForeshadowTouchPlans(
  rows: ForeshadowWithTouches[],
  maps: TouchLabelMaps,
  scope: { chapterIds?: Set<string> }
): string {
  return rows.filter((f) => f.status !== "DROPPED").flatMap((f) => {
    const touches = f.touches.filter((t) => t.chapterId && scope.chapterIds?.has(t.chapterId))
    if (touches.length === 0) return []
    return [`「${f.title}」档案：${truncate(f.content, 1600)}\n${touches.map((t) =>
      `- ${touchTargetLabel(t, maps)}：${TOUCH_KIND_LABELS[t.kind]}（${t.kind}），${t.summary}`
    ).join("\n")}`]
  }).join("\n\n")
}

export interface ForeshadowEvaluation {
  foreshadowTitle: string
  touchKind?: "PLANT" | "MENTION" | "PAYOFF"
  touchSummary: string
  score: number
  comment: string
}

/** 只回填被评内容里的明确触点，不把缺失目标的分数写到别章。 */
export function selectForeshadowEvaluationTouch(
  touches: ForeshadowTouch[],
  evaluation: ForeshadowEvaluation,
  chapterIds: Set<string>
): ForeshadowTouch | undefined {
  const pool = touches.filter((t) =>
    t.chapterId && chapterIds.has(t.chapterId) &&
    (!evaluation.touchKind || t.kind === evaluation.touchKind))
  if (pool.length === 1) return pool[0]
  const summary = evaluation.touchSummary.replace(/\s+/g, "")
  if (!summary) return undefined
  const matches = pool.filter((t) => {
    const candidate = t.summary.replace(/\s+/g, "")
    return candidate && (candidate.includes(summary) || summary.includes(candidate))
  })
  return matches.length === 1 ? matches[0] : undefined
}

function touchTargetLabel(t: ForeshadowTouch, maps: TouchLabelMaps): string {
  if (t.chapterId) return maps.chapters.get(t.chapterId) ?? "（章节已删除）"
  return "（未关联）"
}

/** 单条伏笔的一览行：「[状态] 标题：内容截断（埋于 X；提及 N 次；预期 Y）」 */
function digestLine(f: ForeshadowWithTouches, maps: TouchLabelMaps): string {
  const status = FORESHADOW_STATUS_LABELS[f.status] ?? f.status
  const plant = f.touches.find((t) => t.kind === "PLANT")
  const mentions = f.touches.filter((t) => t.kind === "MENTION").length
  const parts: string[] = []
  if (plant) parts.push(`埋于${touchTargetLabel(plant, maps)}`)
  if (mentions > 0) parts.push(`提及 ${mentions} 次`)
  if (f.expectation.trim()) parts.push(`预期${truncate(f.expectation, 24)}`)
  const suffix = parts.length > 0 ? `（${parts.join("；")}）` : ""
  return `- [${status}] ${f.title}：${truncate(f.content, 60)}${suffix}`
}

/**
 * 伏笔一览（chapter.generate / review.* / agent.judge.whole / 样文样纲共用）：
 * 未埋+已埋在前（按更新时间倒序），已回收只留最近 5 条，废弃不渲染。
 */
export function renderForeshadowDigest(
  rows: ForeshadowWithTouches[],
  maps: TouchLabelMaps
): string {
  const active = rows.filter((f) => f.status !== "DROPPED")
  if (active.length === 0) return "（暂无伏笔档案）"
  const open = active
    .filter((f) => f.status !== "RESOLVED")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  const resolved = active
    .filter((f) => f.status === "RESOLVED")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, RESOLVED_DIGEST_KEEP)
  const picked = [...open, ...resolved].slice(0, FORESHADOW_DIGEST_MAX)
  const lines = picked.map((f) => truncate(digestLine(f, maps), FORESHADOW_DIGEST_ITEM_MAX))
  const omitted = active.length - picked.length
  if (omitted > 0) lines.push(`- ……另有 ${omitted} 条旧伏笔未列出`)
  return lines.join("\n")
}

export interface ChapterPromptInput {
  /** 当前章线性序 */
  current: number
  /** chapterId → 线性序（服务层预解析） */
  posByChapterId: Map<string, number>
  /** chapterId → 展示标签 */
  labelByChapterId: Map<string, string>
}

/** 本章伏笔提示（完整版，正文生成/评审用） */
export function renderChapterForeshadowPrompt(
  rows: ForeshadowWithTouches[],
  input: ChapterPromptInput
): string {
  // 回收点常在规划阶段就已挂上；全局“已回收”不代表当前章可以省略埋入/提及。
  const open = rows.filter((f) => f.status !== "DROPPED")
  if (open.length === 0) return ""
  const dueHere: string[] = []
  const stale: string[] = []
  const overdue: string[] = []

  for (const f of open) {
    const touchesHere = f.touches.filter(
      (t) => t.chapterId && input.posByChapterId.get(t.chapterId) === input.current
    )
    for (const t of touchesHere) {
      dueHere.push(`「${f.title}」应在本章${TOUCH_KIND_LABELS[t.kind]}：${truncate(t.summary, 60)}`)
    }
    if (touchesHere.length > 0 && f.content.trim()) {
      dueHere.push(`「${f.title}」档案（按本章触点控制揭示进度，不提前公开后续真相）：${truncate(f.content, 1600)}`)
    }

    const payoffPositions = f.touches
      .filter((t) => t.kind === "PAYOFF")
      .flatMap((t) => t.chapterId && input.posByChapterId.has(t.chapterId)
        ? [input.posByChapterId.get(t.chapterId)!] : [])
    if (payoffPositions.some((pos) => pos <= input.current)) continue
    if (f.status === "RESOLVED" && payoffPositions.length === 0) continue

    const pastPositions = f.touches
      .map((t) => (t.chapterId ? input.posByChapterId.get(t.chapterId) : undefined))
      .filter((x): x is number => typeof x === "number" && x <= input.current)
    const lastPos = pastPositions.length > 0 ? Math.max(...pastPositions) : null
    const planted = f.touches.some((t) => t.kind === "PLANT")
    if (planted && touchesHere.length === 0 && lastPos !== null && input.current - lastPos > FORESHADOW_STALE_CHAPTERS) {
      stale.push(`「${f.title}」已埋但 ${input.current - lastPos} 章未再提及，可考虑安排一次提及保持读者记忆`)
    }
    if (f.plannedChapter !== null && input.current >= f.plannedChapter) {
      overdue.push(
        `「${f.title}」预期在第 ${f.plannedChapter} 章（线性序）回收，本章已到/超过该位置仍未回收——应安排回收或调整预期`
      )
    }
  }

  const sections: string[] = []
  if (dueHere.length > 0) sections.push(`本章应处理的伏笔：\n${dueHere.map((s) => `- ${s}`).join("\n")}`)
  if (overdue.length > 0) sections.push(`到达预期回收点的伏笔：\n${overdue.map((s) => `- ${s}`).join("\n")}`)
  if (stale.length > 0) sections.push(`久未提及的伏笔：\n${stale.map((s) => `- ${s}`).join("\n")}`)
  return sections.join("\n\n")
}

/** 状态组排序：planted → planned → resolved → dropped（面板列表顺序） */
const STATUS_ORDER: Record<string, number> = { PLANTED: 0, PLANNED: 1, RESOLVED: 2, DROPPED: 3 }

export function compareForeshadows(a: Foreshadow, b: Foreshadow): number {
  const d = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
  return d !== 0 ? d : b.updatedAt.getTime() - a.updatedAt.getTime()
}
