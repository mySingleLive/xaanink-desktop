/**
 * 正文改进对话框共享定义（纯模块，客户端/服务端均可引用）：
 * 改进项聚合载荷契约、默认勾选规则与维度联动、任务文案 / chatAction / feedback 构建。
 * 「【正文改进】」文案与 chat.system 三点十的改进抽卡路由互为协议——修改需同步模板。
 * 交互规则以 docs/content-improve/01-product-design.md §6 与 02-ui-design.md §2 为准。
 */

import type { ChatAction } from "@/lib/chat-parts"

/* ------------------------------ 聚合契约（服务端 score-report.ts 产出，客户端消费） ------------------------------ */

export type ImprovementItemGroup = "dimension" | "report" | "ai-comment" | "user-comment" | "custom"

/** 对话框改进项行：维度组行由 dimensions 映射而来（group="dimension"），其余为聚合/自定义条目 */
export interface ImprovementItem {
  /** 稳定 id：dim:{维度} / review:{reviewId}:{index} / comment:{commentId} / custom:{uuid} */
  id: string
  group: ImprovementItemGroup
  /** 展示称谓（维度名 / 行内评论 · {aspect} / 我的评论 / 自定义） */
  label: string
  /** 评审维度名（评审意见与 AI 行内评论有；徽标展示 + 联动依据） */
  aspect?: string
  /** 维度联动键：等于所关联维度行的 id（dim:{维度}）；无关联为 undefined */
  dimKey?: string
  /** 问题描述 / 评论正文 / 自定义要求（维度行此处为「86 分 · 2 条意见」式摘要） */
  text: string
  /** 「建议：」文本（评审意见与 AI 行内评论有） */
  suggestion?: string
  /** 锚点原文（行内评论有） */
  quote?: string
}

export interface ImprovementDimension {
  id: string
  dimension: string
  score: number | null
  issueCount: number
}

export interface ImproveItemsPayload {
  /** 本章规划档（对话框字数默认值；非法时已回落到当前正文字数） */
  wordMin: number
  wordBudget: number
  contentWordCount: number
  dimensions: ImprovementDimension[]
  items: ImprovementItem[]
}

/* ------------------------------ id 规约 ------------------------------ */

export const dimensionItemId = (dimension: string) => `dim:${dimension}`
export const reviewItemId = (reviewId: string, index: number) => `review:${reviewId}:${index}`
export const commentItemId = (commentId: string) => `comment:${commentId}`
export const customItemId = () => `custom:${crypto.randomUUID()}`

/** 维度组行：ImprovementDimension[] → ImprovementItem[]（对话框渲染与勾选逻辑的统一行模型） */
export function dimensionItems(dimensions: ImprovementDimension[]): ImprovementItem[] {
  return dimensions.map(d => ({
    id: d.id,
    group: "dimension" as const,
    label: d.dimension,
    aspect: d.dimension,
    text: `${d.score === null ? "未评分" : `${d.score} 分`} · ${d.issueCount > 0 ? `${d.issueCount} 条意见` : "无意见"}`,
  }))
}

/* ------------------------------ 默认勾选与维度联动 ------------------------------ */

/**
 * 默认未勾集：无意见的维度（issueCount=0 且没有任何关联改进项）默认不勾；
 * 有意见维度与全部建议项/自定义项默认勾选。自定义项由调用方追加，天然不在默认未勾集内。
 */
export function defaultUncheckedIds(dimensions: ImprovementDimension[], items: ImprovementItem[]): Set<string> {
  const linked = new Set(items.map(i => i.dimKey).filter((k): k is string => !!k))
  return new Set(dimensions.filter(d => d.issueCount === 0 && !linked.has(d.id)).map(d => d.id))
}

/**
 * 单项勾选切换（含联动，返回新未勾集）：
 * - 关闭维度 → 其关联改进项（dimKey=维度行 id）全部关闭；
 * - 打开维度 → 其关联改进项全部重新打开；
 * - 打开任一关联改进项 → 其维度自动打开；
 * - 关闭关联改进项不反向关闭维度（维度单独勾选 = 该维度整体改进、不采纳具体意见）。
 */
export function applyImproveItemToggle(rows: ImprovementItem[], unchecked: Set<string>, id: string): Set<string> {
  const row = rows.find(r => r.id === id)
  if (!row) return unchecked
  const next = new Set(unchecked)
  const turningOn = next.has(id)
  if (row.group === "dimension") {
    if (turningOn) {
      next.delete(id)
      for (const r of rows) if (r.dimKey === id) next.delete(r.id)
    } else {
      next.add(id)
      for (const r of rows) if (r.dimKey === id) next.add(r.id)
    }
    return next
  }
  if (turningOn) {
    next.delete(id)
    if (row.dimKey) next.delete(row.dimKey)
  } else {
    next.add(id)
  }
  return next
}

/** 批量全选/清空（ids 为作用范围）：清空维度时联动关闭其关联项；全选时打开的关联项联动打开维度、打开的维度联动打开关联项 */
export function applyImproveItemsBulk(rows: ImprovementItem[], unchecked: Set<string>, ids: string[], target: boolean): Set<string> {
  const scope = new Set(ids)
  const next = new Set(unchecked)
  for (const id of ids) { if (target) next.delete(id); else next.add(id) }
  if (!target) {
    for (const r of rows) if (r.group === "dimension" && scope.has(r.id) && next.has(r.id))
      for (const i of rows) if (i.dimKey === r.id) next.add(i.id)
    return next
  }
  for (const r of rows) if (r.dimKey && scope.has(r.id) && !next.has(r.id)) next.delete(r.dimKey)
  for (const r of rows) if (r.group === "dimension" && scope.has(r.id) && !next.has(r.id))
    for (const i of rows) if (i.dimKey === r.id) next.delete(i.id)
  return next
}

/* ------------------------------ 任务构建（对话框 → 对话） ------------------------------ */

export interface ImproveDrawConfig {
  count: number
  wordMin: number
  wordBudget: number
}

const GROUP_TAGS: Record<ImprovementItemGroup, string> = {
  dimension: "维度",
  report: "评审意见",
  "ai-comment": "AI 行内评论",
  "user-comment": "我的评论",
  custom: "自定义",
}

/** 评审视图 targetLabel（「第 4 章《替罪羔羊》正文」）→ 消息内称谓（「第4章 · 替罪羔羊」），与 improveDraftFor 同规约 */
export function improveTargetLabel(label: string): string {
  return label.replace(/(?: · )?(正文|大纲)$/, "").trim().replace(/^第\s*(\d+)\s*章《(.*)》$/, "第$1章 · $2")
}

/** 单条改进项的指令行（用户消息与 feedback 编译共用，保证两处一致） */
function improveItemLine(item: ImprovementItem, index: number): string {
  const head = `${index + 1}.［${GROUP_TAGS[item.group]}］`
  if (item.group === "dimension") return `${head}${item.label}（${item.text}）`
  const body = item.aspect && item.group !== "user-comment" && item.group !== "custom" ? `${item.aspect}：${item.text}` : item.text
  return `${head}${body}${item.suggestion ? `。建议：${item.suggestion}` : ""}`
}

/**
 * 改进任务的用户消息草稿（作者可见、可回放）。字数与规划档不同时标注「仅本批候选，不改卷章大纲」。
 * 文案与 chat.system 三点十的改进抽卡路由互为协议：改格式必须同步模板。
 */
export function improveDrawInstruction(input: {
  targetLabel: string
  planned: { wordMin: number; wordBudget: number }
  config: ImproveDrawConfig
  /** 勾选的改进项（未勾选项不得出现） */
  items: ImprovementItem[]
}): string {
  const { config, planned } = input
  const wordClause = config.wordMin === planned.wordMin && config.wordBudget === planned.wordBudget
    ? `字数范围 ${config.wordMin}～${config.wordBudget} 字（本章规划档）。`
    : `字数范围 ${config.wordMin}～${config.wordBudget} 字（仅本批候选，不改卷章大纲）。`
  const lines = input.items.map((item, i) => improveItemLine(item, i))
  return [
    `【正文改进】《${improveTargetLabel(input.targetLabel)}》：以当前正文为底稿抽 ${config.count} 张改进候选稿。${wordClause}`,
    "只处理以下勾选的改进项，未勾选的一律不动：",
    ...lines,
  ].join("\n")
}

/** 改进任务的 chatAction（服务端权威参数；draw.items 为勾选项全量，随回合持久化） */
export function improveDrawAction(input: {
  targetId: string
  config: ImproveDrawConfig
  items: ImprovementItem[]
}): ChatAction {
  return {
    kind: "improve",
    targetType: "CHAPTER_CONTENT",
    targetId: input.targetId,
    draw: {
      count: input.config.count,
      wordMin: input.config.wordMin,
      wordBudget: input.config.wordBudget,
      items: input.items.map(item => ({
        id: item.id,
        group: item.group,
        label: item.label.slice(0, 200),
        text: (item.suggestion ? `${item.text}\n建议：${item.suggestion}` : item.text).slice(0, 500),
        ...(item.aspect ? { aspect: item.aspect.slice(0, 50) } : {}),
      })),
    },
  }
}

/** draw 载荷的 feedback 编译文本（chatActionNote 注入给模型的 drawChapterCandidates.feedback 原文）；行形状与指令文案一致 */
export function compileImproveFeedback(items: { group: ImprovementItemGroup; label: string; text: string; aspect?: string }[]): string {
  return items.map((item, i) => {
    const head = `${i + 1}.［${GROUP_TAGS[item.group]}］`
    if (item.group === "dimension") return `${head}${item.label}（${item.text}）`
    const body = item.aspect && item.group !== "user-comment" && item.group !== "custom" ? `${item.aspect}：${item.text}` : item.text
    return `${head}${body}`
  }).join("\n")
}
