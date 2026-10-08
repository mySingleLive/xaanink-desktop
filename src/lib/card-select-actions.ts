/**
 * 抽卡「选卡操作面板」共享定义（纯模块，客户端/服务端/测试均可引用）：
 * 选项构建（按候选 checks/状态/后续章节映射）、固定消息文案、字数档调整值计算。
 * 文案是参谋路由的协议——修改需同步 chat.system 三点十相关条款（同 draw-redraw 约定）。
 * 只引纯类型，不引服务层运行时（避免 prisma 进浏览器包）。
 */
import type { ContentCheck } from "@/lib/content-policy"
import { redrawInstruction } from "@/lib/draw-redraw"
import { REDRAW_DEFAULT_COUNT } from "@/lib/draw-redraw"

/** 角度 key → 中文角度名（与 chapter-draw.ts 的 FRESH_VARIANTS/IMPROVE_VARIANTS 同源镜像，展示用） */
export const VARIANT_LABELS: Record<string, string> = {
  immersive: "沉浸氛围",
  plot: "情节推进",
  character: "人物张力",
  polish: "忠实润色",
  restructure: "结构重组",
  bold: "大胆重写",
}

export const CANDIDATE_STATUS_LABELS: Record<string, string> = {
  ready: "可采用",
  needs_review: "待检查",
  incomplete: "未通过检查",
  reviewing: "正在评审",
  accepted: "已采用",
  discarded: "已丢弃",
  withdrawn: "已撤回",
}

/** 可采用状态（与 CandidatePanel 的 ACCEPTABLE_STATUSES 一致） */
export const ACCEPTABLE_STATUSES = ["ready", "needs_review"]

/** 规划档硬上限（planning/domain.ts budget 上限） */
export const WORD_RANGE_LIMIT = 200000

export interface CardActionInput {
  chapterId: string
  chapterTitle: string
  candidateId: string
  /** 角度中文名（immersive → 沉浸氛围） */
  label: string
  status: string
  checks: ContentCheck[]
  wordCount: number
  /** 字数档：候选 wordRequirement 优先、回退本章规划档（与组卡口径一致） */
  wordMin: number
  wordBudget: number
  /** 本卡即当前采用稿 */
  isCurrentAdopted: boolean
  /** 候选 baseVersion/baseHash 与当前章一致（普通采用可行）；否则走换用 */
  baseMatchesCurrent: boolean
  /** 本章之后已有后续章节正文（换用后需过渡检查） */
  hasLaterChapters: boolean
  /** 副文案用，如「第 26、27 章」；无后续章节时为空串 */
  laterChapterRefs: string
}

export type CardActionKind =
  | "adopt"
  | "adopt-adjust"
  | "adopt-replace"
  | "improve"
  | "improve-require"
  | "fix"
  | "other"

export interface CardActionRow {
  kind: CardActionKind
  testid: string
  text: string
  sub?: string
  tone?: "strong" | "err"
  disabled?: boolean
  /** 存在即行内输入行：占位文案 */
  input?: string
  /** 发消息类动作的固定文案（输入行在提交时另拼） */
  message?: string
  /** adopt-adjust 行的目标档位 */
  adjust?: { wordMin: number; wordBudget: number }
}

export interface CardActionGroup {
  key: "adopt" | "improve" | "fix" | "other"
  label: string
  rows: CardActionRow[]
}

const fixTestid = (code: string) => `cap-option-fix-${code.toLowerCase().replaceAll("_", "-")}`

/**
 * 字数档调整值：超档 → 上限 500 整倍数上取整（5655→6000）；欠档 → 下限 500 整倍数
 * 下取整（2450→2000，不小于 1）；另一端不变。档内或越界（>200000）返回 null（不显示该行）。
 */
export function wordRangeAdjustment(
  wordCount: number,
  range: { min: number; max: number }
): { wordMin: number; wordBudget: number } | null {
  if (range.max > 0 && wordCount > range.max) {
    const up = Math.ceil(wordCount / 500) * 500
    if (up > WORD_RANGE_LIMIT) return null
    return { wordMin: range.min, wordBudget: up }
  }
  if (range.min > 0 && wordCount < range.min) {
    return { wordMin: Math.max(1, Math.floor(wordCount / 500) * 500), wordBudget: range.max }
  }
  return null
}

/** 底稿改进消息（与 CandidatePanel「以此为基础改进」逐字一致；feedback 为空即「继续改进这张」） */
export function improveMessage(
  input: { chapterTitle: string; label: string; chapterId: string; candidateId: string },
  feedback?: string
): string {
  const note = feedback?.trim() || "（无具体意见，按三个改进方向各自判断）"
  return `以《${input.chapterTitle}》候选稿 ${input.label}（chapterId: ${input.chapterId}，candidateId: ${input.candidateId}）为基础改进，再抽 3 份候选。我的意见：${note}`
}

/** 「其他」自由指示消息：带卡上下文，模型按既有纪律路由 */
export function otherMessage(
  input: { chapterTitle: string; label: string; chapterId: string; candidateId: string },
  text: string
): string {
  return `【候选稿】《${input.chapterTitle}》· ${input.label}（chapterId: ${input.chapterId}，candidateId: ${input.candidateId}）：${text.trim()}`
}

/** 换用（有后续章节正文）成功后发给参谋的过渡检查指令（chat.system 三点十 5.5 协议） */
export function replaceCheckMessage(input: {
  chapterTitle: string
  label: string
  chapterId: string
  candidateId: string
  wordCount: number
}): string {
  return `我已将《${input.chapterTitle}》正文替换为候选稿「${input.label}」（chapterId: ${input.chapterId}，candidateId: ${input.candidateId}，${input.wordCount} 字）。本章之后已有后续章节正文，请按换用过渡检查处理。`
}

/** 构建选卡操作面板的分区选项（纯函数；行序即渲染序，序号由渲染层给） */
export function buildCardActions(input: CardActionInput): CardActionGroup[] {
  const { checks, status } = input
  const hard = checks.filter((c) => c.hard)
  const statusBlocked = !ACCEPTABLE_STATUSES.includes(status)
  const wordOnlyBlocked =
    hard.length > 0 && hard.every((c) => c.code === "OVER_TARGET" || c.code === "UNDER_TARGET")
  const adjust = wordOnlyBlocked
    ? wordRangeAdjustment(input.wordCount, { min: input.wordMin, max: input.wordBudget })
    : null
  const rangeLabel = `${input.wordMin}–${input.wordBudget}`

  const groups: CardActionGroup[] = []

  // ---- 采用 ----
  const adoptRows: CardActionRow[] = []
  const blockReason =
    hard.map((c) => c.message).join("；") ||
    (statusBlocked ? `该候选当前状态为「${CANDIDATE_STATUS_LABELS[status] ?? status}」，不可采用` : "")
  if (input.isCurrentAdopted) {
    adoptRows.push({ kind: "adopt", testid: "cap-option-adopt", text: "已采用 · 当前正文来自本稿", disabled: true })
  } else if (input.baseMatchesCurrent) {
    if (blockReason) {
      adoptRows.push({ kind: "adopt", testid: "cap-option-adopt", text: "采用这张", sub: blockReason, tone: "err", disabled: true })
    } else {
      adoptRows.push({ kind: "adopt", testid: "cap-option-adopt", text: "采用这张", sub: "将本稿保存为正式正文" })
    }
  } else {
    const replaceSub = input.hasLaterChapters
      ? `替换后将检查与${input.laterChapterRefs}的过渡与一致性；原采用稿撤回`
      : "直接替换，不影响其他章节"
    if (blockReason) {
      adoptRows.push({ kind: "adopt-replace", testid: "cap-option-adopt-replace", text: "替换当前正文，采用这张", sub: blockReason, tone: "err", disabled: true })
    } else {
      adoptRows.push({ kind: "adopt-replace", testid: "cap-option-adopt-replace", text: "替换当前正文，采用这张", sub: replaceSub, tone: "strong" })
    }
  }
  if (adjust && !input.isCurrentAdopted) {
    adoptRows.push({
      kind: "adopt-adjust",
      testid: "cap-option-adopt-adjust",
      text: "调整字数范围后采用",
      sub: `本章字数档 ${rangeLabel} → ${adjust.wordMin}–${adjust.wordBudget}（永久调整，与卷章大纲同步）`,
      tone: "strong",
      adjust,
    })
  }
  groups.push({ key: "adopt", label: "采用", rows: adoptRows })

  // ---- 改进 ----
  groups.push({
    key: "improve",
    label: "改进",
    rows: [
      {
        kind: "improve",
        testid: "cap-option-improve",
        text: "继续改进这张",
        sub: "不附要求，以本稿为底稿再抽 3 张（忠实润色 / 结构重组 / 大胆重写）",
        message: improveMessage(input),
      },
      { kind: "improve-require", testid: "cap-option-improve-require", text: "根据要求改进", input: "输入改进要求或方向…" },
    ],
  })

  // ---- 修复（仅有问题时出现） ----
  const fixRows: CardActionRow[] = []
  const has = (...codes: ContentCheck["code"][]) => checks.some((c) => codes.includes(c.code))
  const hasOver = has("OVER_TARGET")
  const hasUnder = has("UNDER_TARGET")
  if (hasOver) {
    fixRows.push({
      kind: "fix",
      testid: fixTestid("OVER_TARGET"),
      text: `压缩本稿至 ${rangeLabel} 字`,
      sub: "以本稿为底稿改写，保留核心情节与风格",
      message: improveMessage(input, `压缩至 ${rangeLabel} 字，保留核心情节与风格`),
    })
  }
  if (hasUnder) {
    fixRows.push({
      kind: "fix",
      testid: fixTestid("UNDER_TARGET"),
      text: `扩写本稿至 ${rangeLabel} 字`,
      sub: "深化既有场景与心理，不注水",
      message: improveMessage(input, `扩写至 ${rangeLabel} 字，深化既有场景与心理`),
    })
  }
  if ((hasOver || hasUnder) && adjust && !input.isCurrentAdopted) {
    fixRows.push({
      kind: "adopt-adjust",
      testid: "cap-option-fix-adjust",
      text: "调整字数设定范围后采用",
      sub: `与「采用」区同一动作：${rangeLabel} → ${adjust.wordMin}–${adjust.wordBudget}`,
      adjust,
    })
  }
  if (has("CONSISTENCY")) {
    const msg = checks.find((c) => c.code === "CONSISTENCY")?.message ?? "剧情逻辑矛盾"
    fixRows.push({
      kind: "fix",
      testid: fixTestid("CONSISTENCY"),
      text: "修复剧情逻辑矛盾",
      sub: msg,
      message: improveMessage(input, `修复剧情逻辑矛盾：${msg}`),
    })
  }
  if (has("INCOMPLETE", "UNKNOWN_FINISH", "SUSPICIOUS_ENDING")) {
    fixRows.push({
      kind: "fix",
      testid: fixTestid("INCOMPLETE"),
      text: "续写补全本稿",
      sub: "保持既有内容与风格连贯",
      message: improveMessage(input, "续写补全未完部分，保持既有内容与风格连贯"),
    })
  }
  if (has("SHORTENED")) {
    fixRows.push({
      kind: "fix",
      testid: fixTestid("SHORTENED"),
      text: "恢复被压缩的内容并补足篇幅",
      message: improveMessage(input, "恢复前一版被压缩的内容，补足至档位内"),
    })
  }
  if (has("EMPTY", "TOO_LONG", "REVIEW_FAILED")) {
    fixRows.push({
      kind: "fix",
      testid: fixTestid("EMPTY"),
      text: "放弃本稿，换一批重新抽",
      message: redrawInstruction(
        input.chapterTitle,
        { wordMin: input.wordMin, wordBudget: input.wordBudget },
        { count: REDRAW_DEFAULT_COUNT, wordMin: input.wordMin, wordBudget: input.wordBudget }
      ),
    })
  }
  if (fixRows.length > 0 || hard.length > 0 || statusBlocked || checks.length > 0) {
    fixRows.push({
      kind: "fix",
      testid: "cap-option-fix-all",
      text: "全面检查并修复本稿问题",
      sub: checks.map((c) => c.message).join("；") || undefined,
      message: improveMessage(input, `全面检查并修复以下问题：${checks.map((c) => c.message).join("；") || "全面检查"}`),
    })
    groups.push({ key: "fix", label: "修复 · 针对本稿问题", rows: fixRows })
  }

  // ---- 其他 ----
  groups.push({
    key: "other",
    label: "其他",
    rows: [{ kind: "other", testid: "cap-option-other", text: "其他", input: "输入你想怎么做…" }],
  })

  return groups
}
