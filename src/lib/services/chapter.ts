import { buildChapterSections, buildNovelSections } from "@/lib/ai/context"
import { streamGeneration } from "@/lib/ai/generate"
import { prisma } from "@/lib/db"
import { renderPrompt } from "@/lib/prompts/render"
import type { Chapter } from "@/generated/prisma/client"
import { ContentError, requireVersion } from "@/lib/content-errors"
import { commitChapterContent, ownedChapter, type ContentReceipt } from "./content-commit"
import { submitGeneratedContent, type CreateCandidateInput } from "./content-candidate"
import { countChineseWords } from "@/lib/text"
import { currentChatExecution } from "@/lib/chat-execution"
import { chapterProjection, planningSchema } from "@/lib/planning/domain"
import { assessChapterNarrative, narrativeGateMessage } from "./narrative-assessment"
import { buildChapterMaterialContext } from "./story-materials"
import { assertChapterOutlineEvidence } from "./story-workflow"

/** 本章大纲尚未评审通过，不允许生成正文 */
export class ChapterNotReadyError extends Error {
  constructor(message = "本章大纲尚未评审通过，请先在章大纲页完成评审") {
    super(message)
    this.name = "ChapterNotReadyError"
  }
}

/** 生成前的只读前置校验；工具登记运行记录前和真正调用模型前共用。 */
export function assertChapterGenerationReady(chapter: Pick<Chapter, "status" | "version">, expectedVersion: number | undefined) {
  requireVersion(expectedVersion)
  if (chapter.status === "OUTLINE") throw new ChapterNotReadyError()
  if (chapter.version !== expectedVersion) throw new ContentError("VERSION_CONFLICT", "稿件已有新修订，请重新读取后生成")
}

export { countChineseWords }
export { commitChapterContent } from "./content-commit"

/** 章节详情（含所属卷） */
export async function getChapter(id: string) {
  return prisma.chapter.findUnique({
    where: { id },
    include: { volume: true },
  })
}

/** 正文生成的默认目标字数（chapter.generate 模板变量） */
const DEFAULT_WORD_COUNT = 3000
/** 单章字数的合理区间：太短出不了戏，太长模型会失焦并烧掉大量额度 */
const MIN_WORD_COUNT = 800
const MAX_WORD_COUNT = 8000

export interface ChapterSaveOptions {
  userId: string
  novelId: string
  expectedVersion: number
  operationId: string
}
export interface ChapterGenerationOptions {
  guidance?: string
  wordCount?: number
  feedback?: string
  expectedVersion: number
  operationId: string
  sourceRunId?: string
  abortSignal?: AbortSignal
  /** 抽卡角度提示：同组候选以此拉开差异化写法（沉浸氛围/情节推进/人物张力等） */
  variantHint?: string
  /** 抽卡候选的持久化分组信息；设置后候选等作者选稿、不自动采用 */
  candidate?: { drawId: string; variant: string; basedOnCandidateId?: string; iteration?: number }
  /** 覆盖流式草稿进度键（抽卡时每张候选一个键，避免互相覆盖） */
  progressKey?: string
  /** 抽卡悬浮框设置的本批字数覆盖：只作用本批生成与候选检查，不改卷章大纲规划档 */
  wordRange?: { min: number; budget: number }
}

export async function chapterForReceipt(receipt: ContentReceipt): Promise<Chapter & { receipt: ContentReceipt }> {
  const row = await prisma.contentVersion.findUniqueOrThrow({ where: { id: receipt.snapshotId } })
  const snapshot = row.snapshot as unknown as Chapter
  return { ...snapshot, createdAt: new Date(snapshot.createdAt), updatedAt: new Date(snapshot.updatedAt), receipt }
}

/**
 * 准备正文流式生成（chapter.generate 模板 + 章节级上下文）。
 * 章状态须为 REVIEWED 及以后（REVIEWED/WRITTEN/CHAPTER_REVIEWED 可生成或重新生成），
 * 否则抛 ChapterNotReadyError。返回 AI SDK StreamTextResult，
 * 由调用方（route）消费流并在结束后调用 persistGeneratedChapter 落库。
 *
 * wordCount 由调用方按作者要求传入（如开篇章要短、高潮章要长）；不传取默认值。
 */
export async function prepareChapterGeneration(
  chapterId: string,
  userId: string,
  options?: ChapterGenerationOptions
) {
  requireVersion(options?.expectedVersion)
  if (!options?.operationId) throw new ContentError("INVALID_OPERATION", "缺少操作编号", 400)
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: { volume: true },
  })
  if (!chapter) {
    throw new Error("章节不存在")
  }
  const novelId = chapter.volume.novelId
  await ownedChapter(prisma, userId, novelId, chapterId)
  assertChapterGenerationReady(chapter, options.expectedVersion)
  const assessment = await assessChapterNarrative({ userId, novelId, chapterId })
  if (assessment.status !== "ready") throw new ContentError("NARRATIVE_NOT_READY", narrativeGateMessage(assessment), 409)
  await assertChapterOutlineEvidence({ userId, novelId, chapterId })
  const materialContext = await buildChapterMaterialContext(novelId, chapterId)
  const [sections, chapterSections] = await Promise.all([
    buildNovelSections(novelId, chapterId, materialContext, [options.guidance, options.feedback, options.variantHint].filter(Boolean).join("\n")),
    buildChapterSections(novelId, chapterId),
  ])

  const planningRow = await prisma.planningDocument.findUnique({ where: { novelId } })
  const planning = planningRow ? planningSchema.parse(planningRow.data) : null
  const projection = planning?.chapters.some(ch => ch.id === chapterId) ? chapterProjection(planning, chapterId) : null
  const fullyBudgeted = !!projection?.cards.length && projection.cards.every(card => card.wordBudget !== null)
  // 本批字数覆盖（抽卡悬浮框设置）优先于叙事线规划档；覆盖只作用本批生成与候选检查，不改规划
  const overridden = !!options?.wordRange
  const range = options?.wordRange ?? (projection ? { min: projection.chapter.wordMin, budget: projection.chapter.wordBudget } : null)
  const targetCeiling = range ? (overridden ? range.budget : Math.min(range.budget, fullyBudgeted ? projection!.allocated : range.budget)) : MAX_WORD_COUNT
  const effectiveWordCount = Math.min(targetCeiling, Math.max(range ? Math.max(1, range.min) : MIN_WORD_COUNT,
    Math.round(options?.wordCount ?? (projection?.allocated || DEFAULT_WORD_COUNT))))
  const basePrompt = await renderPrompt("chapter.generate", {
    theme: sections.theme,
    style: sections.style,
    settings: [sections.settings, materialContext.section].filter(Boolean).join("\n\n"),
    characters: sections.characters,
    foreshadows: materialContext.foreshadows,
    chapterOutline: projection?.outline ?? chapterSections.chapterOutline,
    // 故事板已退役：运行库模板可能仍是含 {{storyboardBeats}} 的旧版，给空值兼容渲染（模板注明未提供则忽略该节）
    storyboardBeats: "",
    previousSummary: chapterSections.previousSummary,
    wordCount: String(effectiveWordCount),
    // 批量首稿携带当前章纲/叙事建议；修订轮携带上一轮正文反馈。
    feedback: options?.feedback?.trim() ?? "",
  })
  const guidance = options?.guidance?.trim()
  const variantHint = options?.variantHint?.trim()
  const wordRequirementText = range ? `① 本章正文必须写满${Math.max(1, range.min)}～${range.budget}字${overridden ? "（本批作者指定档位，仅以它为字数检查标准）" : ""}：低于${Math.max(1, range.min)}字即废稿、不许收束；目标约${effectiveWordCount}字，建议写到${Math.min(range.budget, Math.round(effectiveWordCount * 1.1))}字左右再收尾，宁多勿少；` : ""
  const allocationText = projection
    ? overridden
      ? "各卡片按原预算比例分享本章字数（本批临时调整总档，未改卡片与卷章规划）"
      : `卡片明确分配${projection.allocated}字。${projection.cards.some(card => card.wordBudget === null) ? `其余${projection.chapter.wordBudget - projection.allocated}字供尚未设定预算的卡片分配` : "所有讲述卡均有预算，章上限的剩余额度不是新增无卡段落的许可"}`
    : ""
  const prompt = `${basePrompt}${projection ? `\n\n【叙事线写作约束 v${planningRow!.version}】${wordRequirementText}② 严格按卡片列出顺序展开，不调序、不遗漏，覆盖每张卡片的讲述意图，叶卡的段落节拍须按序逐拍落实为正文段落、每拍约250～400字，全部节拍写完后回查总字数达标再停笔；③ 每段只写该卡对应视角明确披露的内容，「暂不披露」仅用于保持一致性、禁止提前揭晓；④ 不得把后续章节卡片的内容提前写完。${allocationText}。每个正文段落（包括过渡、环境与对话）都须归属本章实际讲述卡；纯组织父卡不额外生成正文。多视角共享对应卡片预算；不能用摘要或重复凑字数。` : ""}${variantHint ? `\n\n【本稿写作角度】\n${variantHint}\n这是同章多份候选稿之一：在严守章纲与披露纪律的前提下，把这个角度的风格差异写实、写足，与其他候选拉开辨识度。` : ""}${guidance ? `\n\n【补充要求】\n${guidance}` : ""}`

  const stream = await streamGeneration({
    userId,
    novelId,
    action: "chapter.generate",
    prompt,
    abortSignal: options.abortSignal,
  })
  return { stream, chapter, scope: { userId, novelId, chapterId }, options, effectiveWordCount, wordRange: range }
}

/** 六入口共用的生成提交壳；候选先持久化，再按服务端策略提交。 */
export async function persistGeneratedChapter(
  chapterId: string,
  content: string,
  reason = "AI 生成正文",
  options?: Omit<CreateCandidateInput, "chapterId" | "content" | "source">
) {
  requireVersion(options?.expectedVersion)
  if (!options) throw new ContentError("PRECONDITION_REQUIRED", "缺少生成基线", 428)
  return submitGeneratedContent({ ...options, chapterId, content, source: reason })
}

/** 消费真实 SDK 阶段；即使可捕获中断也保存片段，但绝不将 EOF 当作完成。 */
export async function consumeChapterGeneration(
  prepared: Awaited<ReturnType<typeof prepareChapterGeneration>>,
  onDelta?: (delta: string) => void
) {
  let content = ""
  let previewAt = 0
  let finishReason: string | undefined
  try {
    for await (const part of prepared.stream.fullStream) {
      if (part.type === "text-delta") {
        content += part.text; onDelta?.(part.text)
        if (Date.now() - previewAt >= 120) { previewAt = Date.now(); currentChatExecution()?.progress?.({ storyDraft: { key: prepared.options.progressKey ?? `chapter-content:${prepared.chapter.id}`, text: content.slice(-40000) } }) }
      }
      else if (part.type === "finish") finishReason = part.finishReason
      else if (part.type === "error") finishReason = "error"
      else if (part.type === "abort") finishReason = "abort"
    }
  } catch { finishReason = prepared.options.abortSignal?.aborted ? "abort" : "error" }
  if (prepared.options.abortSignal?.aborted) finishReason = "abort"
  const result = await submitGeneratedContent({
    ...prepared.scope,
    operationId: prepared.options.operationId,
    expectedVersion: prepared.options.expectedVersion,
    previousContent: prepared.chapter.content,
    content,
    finishReason,
    source: "写手生成",
    sourceRunId: prepared.options.sourceRunId,
    targetWordCount: prepared.effectiveWordCount,
    ...(prepared.options.candidate ? { drawId: prepared.options.candidate.drawId, variant: prepared.options.candidate.variant, basedOnCandidateId: prepared.options.candidate.basedOnCandidateId, iteration: prepared.options.candidate.iteration, suppressAutoAccept: true } : {}),
    ...(prepared.wordRange && prepared.wordRange.budget > 0 ? {
      wordRequirement: { kind: "range" as const, min: Math.max(1, prepared.wordRange.min), max: prepared.wordRange.budget },
      // 本批字数覆盖：UNDER/OVER_TARGET 硬检查改按覆盖档判定（不放宽/收紧规划档本身）
      ...(prepared.options.wordRange ? { wordCheckOverride: { min: Math.max(1, prepared.wordRange.min), max: prepared.wordRange.budget } } : {}),
    } : {}),
  })
  return { ...prepared.chapter, content, wordCount: countChineseWords(content), ...result }
}

export async function generateChapterContent(chapterId: string, userId: string, options?: ChapterGenerationOptions) {
  return consumeChapterGeneration(await prepareChapterGeneration(chapterId, userId, options))
}

/** 旧调用缺少 CAS 一律拒写；禁止读取当前 version 为过期全文补前置条件。 */
export async function updateChapterContent(id: string, content: string, options?: ChapterSaveOptions) {
  requireVersion(options?.expectedVersion)
  if (!options) throw new ContentError("PRECONDITION_REQUIRED", "缺少稿件版本", 428)
  const receipt = await commitChapterContent({ ...options, chapterId: id, content, source: "manual", reason: "正文更新" })
  return chapterForReceipt(receipt)
}
