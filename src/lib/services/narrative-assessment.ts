import { prisma } from "@/lib/db"
import { chapterProjection, planningSchema, type NarrativeCard, type PlanningData } from "@/lib/planning/domain"
import { ownedChapter } from "./content-commit"
import type { ChapterScope } from "./chapter-history"
import { assessChapterMaterials, type PreparationIssue, type PreparationSummary } from "./story-materials"

/** 章叙事卡完备性检查：正文生成前的固定前置。missing=缺卡；thin=有卡但不完整/未细化到段落级；ready=可抽卡。 */

export type NarrativeAssessmentStatus = "missing" | "thin" | "ready"

export interface NarrativeIssue {
  code: "PLANNING_ABSENT" | "CHAPTER_NOT_PLANNED" | "NO_READING_CARDS" | "BUDGET_MISSING" | "NO_BEATS" | "FEW_BEATS" | "NO_INTENT" | "NO_REFS" | PreparationIssue["code"]
  cardId?: string
  cardTitle?: string
  message: string
}

export interface NarrativeCardReport {
  id: string
  title: string
  depth: number
  tellings: number
  beats: number
  refs: number
  wordBudget: number | null
  problems: string[]
}

export interface NarrativeAssessment {
  chapterId: string
  chapterTitle: string
  status: NarrativeAssessmentStatus
  wordMin: number
  wordBudget: number
  issues: NarrativeIssue[]
  cards: NarrativeCardReport[]
  totals: { readingCards: number; cardsWithBeats: number; totalBeats: number; expectedBeats: number }
  preparation?: PreparationSummary
}

/** 节拍粒度预期：约每 350 字一拍，至少 3 拍；与提示词纪律（300-400字/拍）一致。 */
export function expectedBeats(wordBudget: number): number {
  return Math.max(3, Math.ceil(wordBudget / 350))
}

function cardDepth(data: PlanningData, card: NarrativeCard): number {
  let depth = 0
  let current = data.cards.find(c => c.id === card.parent)
  const seen = new Set<string>([card.id])
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    depth += 1
    current = data.cards.find(c => c.id === current!.parent)
  }
  return depth
}

function cardReport(data: PlanningData, card: NarrativeCard): NarrativeCardReport {
  const beats = card.tellings.reduce((n, t) => n + t.beats.length, 0)
  const refs = card.tellings.reduce((n, t) => n + t.refs.length, 0)
  const problems: string[] = []
  if (card.tellings.some(t => !t.intent.trim())) problems.push("缺讲述意图")
  if (card.type === "event" && refs === 0) problems.push("事件卡未引用世界事件")
  if (beats === 0) problems.push("未写段落节拍")
  return { id: card.id, title: card.title, depth: cardDepth(data, card), tellings: card.tellings.length, beats, refs, wordBudget: card.wordBudget, problems }
}

export async function assessChapterNarrative(scope: ChapterScope): Promise<NarrativeAssessment> {
  const chapter = await ownedChapter(prisma, scope.userId, scope.novelId, scope.chapterId)
  const base = { chapterId: chapter.id, chapterTitle: chapter.title }
  const planningRow = await prisma.planningDocument.findUnique({ where: { novelId: scope.novelId } })
  if (!planningRow) {
    return { ...base, status: "missing", wordMin: 0, wordBudget: 0, cards: [], totals: { readingCards: 0, cardsWithBeats: 0, totalBeats: 0, expectedBeats: 0 },
      issues: [{ code: "PLANNING_ABSENT", message: "本作尚未接入世界线/叙事线规划；先完成剧情搭建并整理卷章大纲" }] }
  }
  const planning = planningSchema.parse(planningRow.data)
  const planned = planning.chapters.find(ch => ch.id === scope.chapterId)
  if (!planned) {
    return { ...base, status: "missing", wordMin: 0, wordBudget: 0, cards: [], totals: { readingCards: 0, cardsWithBeats: 0, totalBeats: 0, expectedBeats: 0 },
      issues: [{ code: "CHAPTER_NOT_PLANNED", message: "本章不在叙事线卷章投影中；先经 proposeNovelPlanning 把本章纳入规划" }] }
  }
  const projection = chapterProjection(planning, scope.chapterId)
  const wordMin = planned.wordMin
  const wordBudget = planned.wordBudget
  const totals = { readingCards: projection.cards.length, cardsWithBeats: 0, totalBeats: 0, expectedBeats: expectedBeats(wordBudget) }
  const common = { ...base, wordMin, wordBudget, totals }
  if (!projection.cards.length) {
    return { ...common, status: "missing", cards: [], issues: [{ code: "NO_READING_CARDS", message: "本章没有任何实际讲述卡；先为本章建立章叙事卡并展开为子卡（章纲细纲）" }] }
  }
  const cards = projection.cards.map(c => cardReport(planning, c))
  totals.cardsWithBeats = cards.filter(c => c.beats > 0).length
  totals.totalBeats = cards.reduce((n, c) => n + c.beats, 0)
  const issues: NarrativeIssue[] = []
  if (wordMin <= 0 || wordBudget <= 0) issues.push({ code: "BUDGET_MISSING", message: "本章未设置字数范围；回到卷章大纲环节经问答确定每章字数档" })
  for (const card of projection.cards) {
    if (card.tellings.some(t => !t.intent.trim())) issues.push({ code: "NO_INTENT", cardId: card.id, cardTitle: card.title, message: `「${card.title}」有视角缺讲述意图（intent）` })
    if (card.type === "event" && card.tellings.every(t => t.refs.length === 0)) issues.push({ code: "NO_REFS", cardId: card.id, cardTitle: card.title, message: `「${card.title}」是事件卡但未引用世界事件；叙事应锚定世界线事实` })
  }
  if (totals.cardsWithBeats === 0) issues.push({ code: "NO_BEATS", message: "本章阅读卡都没有段落节拍（未细化到段落级）；逐卡补 beats：按顺序列出每段的描写类型（事件/人物/环境/回忆/心理/分析/对话等）与内容提要" })
  else if (totals.totalBeats < totals.expectedBeats) issues.push({ code: "FEW_BEATS", message: `本章共 ${totals.totalBeats} 个段落节拍，撑不起 ${wordMin}～${wordBudget} 字的篇幅（预期 ≥${totals.expectedBeats}）；继续细化到每 300–400 字一拍` })
  const preparation = await assessChapterMaterials(scope, planning, chapter.content)
  issues.push(...preparation.issues)
  return { ...common, status: issues.length ? "thin" : "ready", cards, issues, preparation: preparation.summary }
}

/** 给生成类工具的统一出口：非 ready 时返回可直接回给模型的结构化说明。 */
export function narrativeGateMessage(assessment: NarrativeAssessment): string {
  const head = assessment.status === "missing" ? "本章缺少可用叙事卡" : "本章叙事卡或创作资料尚不完整"
  const list = assessment.issues.slice(0, 6).map(i => `・${i.message}`).join("\n")
  return `${head}，不能生成正文。用现有资料工具补齐文风/世界观/相关资料；规划缺项经 proposeNovelPlanning 修订（作者采用后复检），只补本章需要的内容：\n${list}`
}
