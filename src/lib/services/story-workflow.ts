import { randomUUID } from "node:crypto"
import type { Prisma } from "@/generated/prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { ContentError } from "@/lib/content-errors"
import { generateJSON } from "@/lib/ai/generate"
import { countChineseWords } from "@/lib/text"
import { STORY_PHASES, storyPhaseDefinition, type StoryPhase } from "@/lib/sop/graph"
import { findEvent, orderedCards, readingCards, resolveTime, worldEvents, type PlanningData } from "@/lib/planning/domain"
import { normalizeStoryPhase, parseCheckpointKey, phaseIncludes, plotCheckpointKey, staleStoryEdges, storyReachable, storyApprovalsSchema, storyCheckpointsSchema, storyCheckpointSchema, storyRevisionSchema, storyPhaseSchema, PLOT_SUB_KEYS, type PlotSubKey, type StoryArtifact, type StoryPhaseStatus, type StoryPhaseValue, type StoryWorkflowView, type StoryCheckpoint } from "@/lib/story-workflow"
import { requestHash } from "./content-commit"
import { ownedStory, readStoryArtifacts, storyJson, storyEvidenceHash, type StoryScope } from "./story-artifacts"
import { startRun, completeRun, failRun } from "./subagent-run"
import { requestAIReview } from "./review"
import { normalizeScoreDimensions, getReviewActivity } from "./score-report"
import { currentChatExecution } from "@/lib/chat-execution"
import type { ChatAction } from "@/lib/chat-parts"
import { reviewStoryMaterial, storyMaterialReviewSchema as reviewSchema } from "./story-material-review"
import { materialHasContent, type StoryMaterial } from "@/lib/story-materials"

type Graph = Awaited<ReturnType<typeof readStoryArtifacts>>
export { storyEvidenceHash } from "./story-artifacts"
function phaseHash(phase: StoryPhase, brief: string, graph: Graph, config: { targetChapters: number; targetWords: number }) {
  const included = graph.artifacts.filter(a => a.phase === phase)
  const keys = new Set(included.map(a => a.key))
  return requestHash({ brief, ...(phase === "writing" || phase === "revision" || phase === "outline" ? { targetChapters: config.targetChapters, targetWords: config.targetWords } : {}),
    artifacts: included.map(a => [a.key, a.hash]).sort(([a], [b]) => a.localeCompare(b)),
    edges: graph.edges.filter(e => keys.has(e.targetKey)).map(e => [e.sourceKey, e.targetKey, e.sourceHash ?? ""]).sort(([a, b], [c, d]) => `${a}>${b}`.localeCompare(`${c}>${d}`)) })
}
function phaseTargets(phase: StoryPhase, artifacts: StoryArtifact[]) {
  if (phase === "settings") return artifacts.filter(a => a.phase === "settings")
  // plot 环节不再要求逐产物独立评审：产物细粒度评审由世界线/叙事线工具链自带校验承担
  if (phase === "outline") return artifacts.filter(a => a.kind === "chapter-outline")
  if (phase === "writing") return artifacts.filter(a => a.kind === "chapter-content")
  return []
}

/** 事件是否已定位；数据校验已阻止时间环，此处防御性把异常当作待定位。 */
function eventPositioned(planning: PlanningData, eventId: string, line: string) {
  const event = findEvent(planning, line, eventId)
  if (!event) return false
  try { return resolveTime(planning, event).start !== null } catch { return false }
}

/** plot 双检查点的结构缺口：叙事线侧只在水到渠成（世界线结构达标）后评估。 */
export function plotBlockers(graph: Graph): { worldline: string[]; narrative: string[] } {
  const worldline: string[] = []
  const planning = graph.planning
  const worlds = planning?.worlds ?? []
  if (!worlds.length) worldline.push("尚无世界线，请先搭建世界线（客观事实与时间）")
  else {
    const events = worlds.flatMap(w => worldEvents(planning!, w.id))
    if (events.length < 3) worldline.push("世界线已确认事件不足 3 个")
    else if (events.every(e => !eventPositioned(planning!, e.id, e.line))) worldline.push("至少定位关键事件")
  }
  const narrative: string[] = []
  if (!worldline.length) {
    const primary = planning?.lines.find(l => l.primary)
    if (!primary) narrative.push("尚未指定主叙事线")
    else {
      const cards = readingCards(planning!, primary.id)
      if (!cards.length) narrative.push("主叙事线尚无叙事卡片")
      else if (!cards.some(c => c.type === "event" && c.tellings.some(t => t.refs.length))) narrative.push("叙事线尚未关联世界线事件")
    }
  }
  return { worldline, narrative }
}

/** 叙事卡片经「共享事件的有限披露」边引用的世界事件键闭包。 */
const PLOT_DISCLOSURE_REASON = "共享事件的有限披露"
function narrativeEventClosure(graph: Graph): Set<string> {
  const narrativeKeys = new Set(graph.artifacts.filter(a => a.kind === "narrative" || a.kind === "narrative-card").map(a => a.key))
  return new Set(graph.edges.filter(e => e.reason === PLOT_DISCLOSURE_REASON && narrativeKeys.has(e.targetKey)).map(e => e.sourceKey))
}

/** plot 子键指纹独立计算：worldline 只看世界线产物；narrative 另含引用事件闭包，对无关世界线编辑不敏感。 */
export function plotSubHash(sub: PlotSubKey, graph: Graph, brief: string) {
  if (sub === "worldline") {
    const included = graph.artifacts.filter(a => a.kind === "worldline" || a.kind === "world-event")
    const keys = new Set(included.map(a => a.key))
    return requestHash({ brief,
      artifacts: included.map(a => [a.key, a.hash]).sort(([a], [b]) => a.localeCompare(b)),
      edges: graph.edges.filter(e => keys.has(e.targetKey)).map(e => [e.sourceKey, e.targetKey, e.sourceHash ?? ""]).sort(([a, b], [c, d]) => `${a}>${b}`.localeCompare(`${c}>${d}`)) })
  }
  const events = narrativeEventClosure(graph)
  const included = graph.artifacts.filter(a => a.kind === "narrative" || a.kind === "narrative-card" || events.has(a.key))
  return requestHash({ brief, artifacts: included.map(a => [a.key, a.hash]).sort(([a], [b]) => a.localeCompare(b)) })
}

/** 检查点键（产物/环节/plot 子键）对应的当前指纹；未命中返回 undefined。 */
function viewHashFor(view: StoryWorkflowView, graph: Graph, key: string) {
  const artifact = view.artifacts.find(a => a.key === key)
  if (artifact) return artifact.evidenceHash
  if (key.startsWith("phase:")) {
    const parsed = parseCheckpointKey(key)
    if (!parsed) return undefined
    if (parsed.sub) return plotSubHash(parsed.sub, graph, view.brief)
    return view.phases.find(p => p.id === parsed.phase)?.hash
  }
  return undefined
}

function structureBlockers(phase: StoryPhase, brief: string, graph: Graph, config: { targetChapters: number; targetWords: number }) {
  const blockers: string[] = []
  if (phase === "brainstorm" && brief.trim().length < 10) blockers.push("补充创作简报：主角目标、阻力、规则、主线变化与结局方向")
  if (phase === "settings" && !graph.artifacts.some(a => a.phase === "settings")) blockers.push("尚无设定产物")
  if (phase === "plot") {
    const plot = plotBlockers(graph)
    blockers.push(...plot.worldline, ...plot.narrative)
  }
  if (phase === "outline" || phase === "writing" || phase === "revision") {
    const chapters = graph.artifacts.filter(a => a.kind === "chapter-outline")
    if (!chapters.length) blockers.push("尚无章节大纲")
    for (const chapter of chapters) {
      if (!chapter.text.trim()) blockers.push(`《${chapter.title}》缺少细纲`)
    }
    if (phase !== "outline") for (const a of graph.artifacts.filter(a => a.kind === "chapter-content")) {
      const planned = graph.planning?.chapters.find(ch=>ch.id===a.id), budget = planned?.wordBudget, words=countChineseWords(a.text)
      if(budget ? words < Math.max(1, planned?.wordMin ?? 0) || words>budget : words < Math.floor(config.targetWords*.9)) blockers.push(budget?`《${a.title}》正文须为${Math.max(1, planned?.wordMin ?? 0)}～${budget}字，当前${words}字`:`《${a.title}》正文 ${words} 字，低于目标约 ${config.targetWords} 字`)
    }
  }
  return blockers
}

export async function getStoryWorkflow(scope: StoryScope): Promise<StoryWorkflowView | null> {
  await ownedStory(scope)
  const row = await prisma.storyWorkflow.findUnique({ where: { novelId: scope.novelId } })
  if (!row) return null
  const graph = await readStoryArtifacts(scope)
  return workflowView(row, graph)
}
/** 生成入口复检当前来源证据，资料变化不能仅凭旧 Chapter.status 绕过。 */
export async function assertChapterOutlineEvidence(scope: StoryScope & { chapterId: string }) {
  const view = await getStoryWorkflow(scope)
  if (!view) return
  const key = `chapter-outline:${scope.chapterId}`
  const hash = view.artifacts.find(a => a.key === key)?.evidenceHash
  const check = view.checkpoints[key]
  if (!hash || !check?.passed || check.hash !== hash || check.reviewPolicy === "structure-only") throw new ContentError("STORY_REVIEW_REQUIRED", "本章资料或大纲已变化，请核对并评审本章当前版本后抽卡", 409)
  if (view.approvals[key]?.hash !== hash && !view.writingAuthorized) throw new ContentError("STORY_OUTLINE_APPROVAL_REQUIRED", "请作者认可本章当前大纲后抽卡；不会自动认可或扩大到整卷", 409)
}
function workflowView(row: NonNullable<Awaited<ReturnType<typeof prisma.storyWorkflow.findUnique>>>, graph: Graph): StoryWorkflowView {
  const checkpoints = storyCheckpointsSchema.parse(row.checkpoints), approvals = storyApprovalsSchema.parse(row.approvals)
  const revisions = z.array(storyRevisionSchema).parse(row.revisions), phase = normalizeStoryPhase(storyPhaseSchema.parse(row.phase))
  const staleLinks = staleStoryEdges(graph.artifacts, graph.edges)
  const pendingApprovals = graph.artifacts.filter(a => a.phase === "settings" && approvals[a.key]?.hash !== storyEvidenceHash(a.key, graph)).map(a => a.key)
  const phases: StoryWorkflowView["phases"] = []
  for (const definition of STORY_PHASES) {
    const id = definition.id, hash = phaseHash(id, row.brief, graph, row)
    if (id === "plot") {
      // 双检查点：世界线 → 叙事线，指纹独立计算；环节行聚合两子键状态
      const plot = plotBlockers(graph)
      const subkeys = PLOT_SUB_KEYS.map((sub): NonNullable<StoryWorkflowView["phases"][number]["subkeys"]>[number] => {
        const key = plotCheckpointKey(sub), subHashValue = plotSubHash(sub, graph, row.brief), checkpoint = checkpoints[key]
        const blockers = sub === "worldline" ? plot.worldline : plot.narrative
        const status: StoryPhaseStatus = blockers.length ? "review"
          : !checkpoint ? "review"
          : checkpoint.hash !== subHashValue ? "stale"
          : !checkpoint.passed ? "improve"
          : approvals[key]?.hash !== subHashValue ? "approval" : "passed"
        return { key, label: sub === "worldline" ? "世界线" : "叙事线", status, hash: subHashValue, score: checkpoint?.hash === subHashValue ? checkpoint.score : null, blockers }
      })
      const blockers = [...plot.worldline, ...plot.narrative]
      const status: StoryPhaseStatus = blockers.length ? "review"
        : subkeys.every(s => s.status === "passed") ? "passed"
        : subkeys.every(s => s.status === "passed" || s.status === "approval") ? "approval"
        : subkeys.some(s => s.status === "stale") ? "stale"
        : subkeys.some(s => s.status === "improve") ? "improve" : "review"
      const scores = subkeys.map(s => s.score).filter((s): s is number => s !== null)
      phases.push({ id, label: definition.label, hash, score: scores.length === subkeys.length ? Math.min(...scores) : null, blockers, subkeys, threshold: storyPhaseDefinition(id).checkpoints[0].threshold,
        status: !subkeys.some(s => checkpoints[s.key]) && !graph.artifacts.some(a => a.phase === "plot") ? "empty" : status })
      continue
    }
    const checkpoint = checkpoints[`phase:${id}`]
    const blockers = structureBlockers(id, row.brief, graph, row)
    for (const target of phaseTargets(id, graph.artifacts)) {
      const evidence = checkpoints[target.key]
      if (!evidence?.passed || evidence.hash !== storyEvidenceHash(target.key, graph)) blockers.push(`《${target.title}》需要当前版本的独立评审`)
      if ((id === "settings" || (id === "writing" && row.writingMode === "chapter")) && approvals[target.key]?.hash !== storyEvidenceHash(target.key, graph)) blockers.push(`《${target.title}》尚待作者认可`)
    }
    const relevantStale = staleLinks.filter(e => graph.artifacts.some(a => a.key === e.targetKey && phaseIncludes(id, a.phase)))
    if (relevantStale.length) blockers.push(`${relevantStale.length} 处来源变更尚待核对和修订`)
    const score = checkpoint?.hash === hash ? checkpoint.score : null
    const status: StoryPhaseStatus = blockers.length ? "review" : id !== "brainstorm" && phaseTargets(id, graph.artifacts).length ? "passed" : checkpoint && checkpoint.hash !== hash ? "stale" : checkpoint && !checkpoint.passed ? "improve" : approvals[`phase:${id}`]?.hash !== hash ? "approval" : "passed"
    phases.push({ id, label: definition.label, hash, score, status: !checkpoint && !graph.artifacts.some(a => a.phase === id) && id !== "brainstorm" ? "empty" : status, blockers, threshold: storyPhaseDefinition(id).checkpoints[0].threshold })
  }
  const content = graph.artifacts.filter(a => a.kind === "chapter-content")
  const writingPolicyHash = requestHash({ mode: row.writingMode, chapters: row.targetChapters, words: row.targetWords, outline: phases.find(p => p.id === "outline")!.hash })
  return { novelId: row.novelId, version: row.version, phase, brief: row.brief, writingMode: row.writingMode === "batch" ? "batch" : "chapter", targetChapters: row.targetChapters, targetWords: row.targetWords,
    writingPolicyHash, writingAuthorized: approvals["policy:writing"]?.hash === writingPolicyHash && phases.find(p => p.id === "outline")?.status === "passed",
    checkpoints, approvals, revisions, phases, artifacts: graph.artifacts.map(({ text, ...a }) => { void text; return { ...a, evidenceHash: storyEvidenceHash(a.key, graph) } }), pendingApprovals, staleLinks,
    chapterCount: content.length, writtenChapters: content.filter(a => a.text.trim()).length, wordCount: content.reduce((sum, a) => sum + countChineseWords(a.text), 0) }
}

export const updateStoryWorkflowSchema = z.object({
  expectedVersion: z.number().int().nonnegative().describe("首次启动传 0，之后传 getStoryWorkflow 的 version"),
  phase: storyPhaseSchema.optional(), brief: z.string().max(16000).optional(), writingMode: z.enum(["chapter", "batch"]).optional(),
  targetChapters: z.number().int().min(1).max(2000).optional().describe("整部小说的计划章节数，例如50"), targetWords: z.number().int().min(800).max(8000).optional().describe("每一章的目标字数，例如2000；绝不是全书总字数。50章×2000字应传2000"),
}).strict()
export async function updateStoryWorkflow(scope: StoryScope, input: z.infer<typeof updateStoryWorkflowSchema>) {
  await ownedStory(scope)
  const { expectedVersion, ...data } = updateStoryWorkflowSchema.parse(input)
  if (data.phase === "skeleton") throw new ContentError("STORY_PHASE_RETIRED", "故事骨架环节已并入卷章大纲，请传 outline", 400)
  if (expectedVersion > 0 && !Object.values(data).some(value => value !== undefined)) throw new ContentError("STORY_EMPTY_UPDATE", "没有要修改的创作简报/阶段/规模。修改设定请先loadCreationTools启用getSetting/upsertSetting；其他产物使用对应读写工具。", 400)
  if (expectedVersion === 0) {
    try { await prisma.storyWorkflow.create({ data: { novelId: scope.novelId, ...data } }) }
    catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new ContentError("VERSION_CONFLICT", "流程已启动，请读取当前进度后继续"); throw error }
  } else {
    const existing = await prisma.storyWorkflow.findUnique({ where: { novelId: scope.novelId } })
    if (!existing || existing.version !== expectedVersion) throw new ContentError("VERSION_CONFLICT", "流程状态已变化，请读取当前进度后继续")
    if (Object.entries(data).every(([key, value]) => value === undefined || existing[key as keyof typeof data] === value)) return getStoryWorkflow(scope)
    const result = await prisma.storyWorkflow.updateMany({ where: { novelId: scope.novelId, version: expectedVersion }, data: { ...data, version: { increment: 1 } } })
    if (!result.count) throw new ContentError("VERSION_CONFLICT", "流程状态已变化，请读取当前进度后继续")
  }
  return getStoryWorkflow(scope)
}

/** 只预装工具参数，不执行创作动作；减少能力较弱模型在目录选择上的空转。 */
export async function storyToolHints(scope: StoryScope) {
  const view = await getStoryWorkflow(scope)
  const phase = view?.phase
  if (phase === "writing" || phase === "revision") return ["generateStoryChapters", "getStorySources", "getStoryImpact", "requestContentApproval", "reviewWholeNovel", "improveChapterContent"]
  if (phase === "outline") return ["getNovelPlanning", "getNarrativeChapter", "proposeNovelPlanning", "applyNovelPlanningProposal", "getStorySources"]
  if (phase === "plot") return ["getNovelPlanning", "getNarrativeChapter", "proposeNovelPlanning", "applyNovelPlanningProposal", "getStoryImpact"]
  return ["createWorld", "upsertSetting", "createCharacter", "upsertTheme", "getWorlds", "getCharacter", "updateCharacter", "getSetting"]
}

export async function reopenStoryPhase(scope: StoryScope, phase: StoryPhaseValue, reason: string, expectedVersion: number) {
  await ownedStory(scope)
  if (phase === "skeleton") throw new ContentError("STORY_PHASE_RETIRED", "故事骨架环节已并入卷章大纲，请 reopen outline 环节", 400)
  const row = await prisma.storyWorkflow.findUnique({ where: { novelId: scope.novelId } })
  if (!row || row.version !== expectedVersion) throw new ContentError("VERSION_CONFLICT", "流程状态已变化，请重新读取")
  const checkpoints = storyCheckpointsSchema.parse(row.checkpoints), approvals = storyApprovalsSchema.parse(row.approvals)
  const keys = phase === "plot" ? PLOT_SUB_KEYS.map(plotCheckpointKey) : [`phase:${phase}`]
  for (const key of keys) { delete checkpoints[key]; delete approvals[key] }
  const revisions = z.array(storyRevisionSchema).parse(row.revisions)
  revisions.push({ id: randomUUID(), phase, reason, at: new Date().toISOString() })
  const result = await prisma.storyWorkflow.updateMany({ where: { novelId: scope.novelId, version: expectedVersion }, data: { phase, checkpoints: storyJson(checkpoints), approvals: storyJson(approvals), revisions: storyJson(revisions), version: { increment: 1 } } })
  if (!result.count) throw new ContentError("VERSION_CONFLICT", "流程状态已变化，请重新读取")
  return getStoryWorkflow(scope)
}

/** plot 子键评审材料：worldline=各世界线的事件/时期结构化摘要；narrative=主叙事线卡片树（标题/类型/视角/披露/引用事件标题）。 */
function plotReviewMaterial(sub: PlotSubKey, graph: Graph): { key: string; title: string; text: string }[] {
  const planning = graph.planning
  if (!planning) return []
  if (sub === "worldline") {
    return planning.worlds.map(w => ({
      key: `worldline:${w.id}`, title: w.name,
      text: [
        `世界线《${w.name}》`,
        ...planning.periods.filter(p => p.line === w.id).map(p => `时期：${p.title}`),
        ...worldEvents(planning, w.id).map(e => `事件：${e.title}（${e.time.kind === "unknown" ? "待定位" : e.time.label || `时点 ${e.time.value}`}${e.ongoing ? "，持续中" : ""}）${e.fact ? `——${e.fact}` : ""}`),
      ].join("\n"),
    }))
  }
  const primary = planning.lines.find(l => l.primary)
  if (!primary) return []
  return orderedCards(planning, primary.id).map(c => {
    let depth = 0, cursor = c
    const seen = new Set([c.id])
    while (cursor.parent) {
      const parent = planning.cards.find(p => p.id === cursor.parent)
      if (!parent || seen.has(parent.id)) break
      seen.add(parent.id); depth++; cursor = parent
    }
    const typeLabel = c.type === "event" ? "事件描述" : c.type === "jump" ? "叙述跳转" : "行文叙述"
    const tellings = c.tellings.map(t => {
      const refs = t.refs.map(r => `引用事件「${findEvent(planning, r.line, r.event)?.title ?? r.event}」披露「${r.reveal}」${r.withheld ? `暂不披露「${r.withheld}」` : ""}`)
      return `视角 ${t.narrator}（${t.reliability}）：${t.intent}${refs.length ? `；${refs.join("；")}` : ""}`
    })
    return { key: `narrative-card:${c.id}`, title: c.title, text: `${"　".repeat(depth)}${c.title}［${typeLabel}］\n${tellings.join("\n")}` }
  })
}

function checkpointFollowUp(checkpoint: StoryCheckpoint) {
  const decisions = checkpoint.issues.filter(issue => issue.needsAuthor)
  if (decisions.length) return {
    message: `当前评审有${decisions.length}项需要作者决定。先用askUserQuestion询问这些取舍，再把作者决定与blocking修订合并处理；不能只修blocking就宣称可通过。`,
    next: "askUserQuestion",
  }
  return { message: checkpoint.passed ? "当前版本评审达标，请用completeStoryTask展示下一步选项" : "评审未达标：保留结果与反馈，可修改当前任务或暂存后选择其他任务", next: checkpoint.passed ? "requestStoryApproval" : "修改当前产物后重评" }
}

export async function reviewStoryCheckpoint(scope: StoryScope, key: string, deps: { generate: typeof generateJSON } = { generate: generateJSON }) {
  const row = await prisma.storyWorkflow.findUnique({ where: { novelId: scope.novelId } })
  if (!row) throw new ContentError("STORY_WORKFLOW_MISSING", "先启动创作流程", 400)
  const graph = await readStoryArtifacts(scope), view = workflowView(row, graph)
  const target = graph.artifacts.find(a => a.key === key)
  let phase: StoryPhase | undefined, sub: PlotSubKey | undefined
  if (key.startsWith("phase:")) {
    if (key === "phase:plot") throw new ContentError("STORY_CHECKPOINT_KEY_INVALID", "剧情搭建拆分为世界线与叙事线两个检查点，请分别评审 phase:plot:worldline 与 phase:plot:narrative", 400)
    const parsed = parseCheckpointKey(key)
    if (!parsed) throw new ContentError("STORY_ARTIFACT_NOT_FOUND", "请使用当前流程返回的产物 key", 404)
    phase = parsed.phase; sub = parsed.sub
  } else phase = target?.phase
  if (!phase) throw new ContentError("STORY_ARTIFACT_NOT_FOUND", "请使用当前流程返回的产物 key", 404)
  const definition = storyPhaseDefinition(phase)
  const checkpointDef = definition.checkpoints[sub ? PLOT_SUB_KEYS.indexOf(sub) : 0]
  const phaseView = view.phases.find(p => p.id === phase)!, hash = target ? storyEvidenceHash(key, graph) : sub ? plotSubHash(sub, graph, row.brief) : phaseView.hash
  const plot = sub ? plotBlockers(graph) : null
  const blockers = target ? (!target.text.trim() ? ["产物内容为空"] : target.kind === "chapter-content" && (graph.planning?.chapters.some(ch=>ch.id===target.id) ? (countChineseWords(target.text) > graph.planning.chapters.find(ch=>ch.id===target.id)!.wordBudget || countChineseWords(target.text) < graph.planning.chapters.find(ch=>ch.id===target.id)!.wordMin) : countChineseWords(target.text) < Math.floor(row.targetWords * .9)) ? [`正文字数不符合本章要求：${countChineseWords(target.text)}字，请核对章节预算后评审`] : []) : sub ? (sub === "worldline" ? plot!.worldline : plot!.narrative) : phaseView.blockers
  // 顺序强制：叙事线检查点须待世界线检查点通过且指纹当前
  if (sub === "narrative") {
    const worldCheckpoint = view.checkpoints[plotCheckpointKey("worldline")]
    if (!worldCheckpoint?.passed || worldCheckpoint.hash !== plotSubHash("worldline", graph, row.brief)) {
      return { ok: false, code: "STORY_CHECKPOINT_NOT_READY", message: "世界线检查点未通过或指纹已过期：剧情搭建须先评审 phase:plot:worldline", blockers: plot!.worldline }
    }
  }
  if (blockers.length) return { ok: false, code: "STORY_CHECKPOINT_NOT_READY", message: "先补齐检查点缺口，再评审", blockers }
  const previous = view.checkpoints[key]
  if (previous?.hash === hash && (!target || previous.reviewPolicy !== "structure-only")) return { ok: true, ...checkpointFollowUp(previous), checkpoint: previous, key, reused: true }
  if (!target && !sub) {
    const checkpoint: StoryCheckpoint = { hash, score: null, passed: true, summary: "当前范围结构检查通过，复用单项评审；阶段汇总不重复评审或认可", issues: [], dimensions: [], at: new Date().toISOString(), iteration: 0, reviewPolicy: "structure-only" }
    const updated = await prisma.storyWorkflow.updateMany({ where: { novelId: scope.novelId, version: row.version }, data: { checkpoints: storyJson({ ...view.checkpoints, [key]: checkpoint }), version: { increment: 1 } } })
    if (!updated.count) throw new ContentError("VERSION_CONFLICT", "流程已有新进展，请重新读取后检查")
    return { ok: true, key, checkpoint, message: "简报结构完整，不做 AI 打分；请展示简报并请求作者认可", next: "requestStoryApproval" }
  }
  const maxIterations = checkpointDef.maxIterations
  const label = target?.title ?? (subView => subView ? `${phaseView.label} · ${subView.label}` : phaseView.label)(phaseView.subkeys?.find(s => s.key === key))
  const sources = target ? storyReachable([key], graph.edges, true) : new Set<string>()
  const material = (target ? [target, ...graph.artifacts.filter(a => sources.has(a.key))] : sub ? plotReviewMaterial(sub, graph) : graph.artifacts.filter(a => a.phase === phase)).map(a => ({ key: a.key, title: a.title,
    text: a.text + "\n关联来源：" + graph.edges.filter(e => e.targetKey === a.key).map(e => `${graph.artifacts.find(source => source.key === e.sourceKey)?.title ?? e.sourceKey} → ${a.title}（${e.reason}）`).join("；"),
    ...(target ? {} : { checkpoint: view.checkpoints[a.key] }),
  }))
  const coverageNote = sub === "worldline"
    ? "\n覆盖判断要求（世界线检查点）：全部世界线合计的已确认事件是否足以覆盖故事主干的来龙去脉（硬下限 3 个，是否「足以覆盖」由你按题材判断）；事件可以有待定时间，但不允许全部待定位。评审意见必须说明覆盖判断依据。"
    : sub === "narrative"
      ? "\n覆盖判断要求（叙事线检查点）：主叙事线的实际讲述卡片是否覆盖故事主干（由你判断）；至少一张事件描述卡片应引用世界线事件，证明叙事基于世界线而非凭空编排；卡片可以暂不分配卷章。评审意见必须说明覆盖判断依据。"
      : ""
  const chapterType = target?.kind === "chapter-content" ? "CHAPTER_CONTENT" : target?.kind === "chapter-outline" ? "CHAPTER_OUTLINE" : null
  const run = await startRun({ novelId: scope.novelId, conversationId: currentChatExecution()?.conversationId, agentKind: "judge", task: `创作检查点 · ${label}`, targetType: chapterType ?? "STORY_WORKFLOW", targetId: chapterType ? target!.id : `${scope.novelId}:${key}` })
  try {
    let data: z.infer<typeof reviewSchema> & { coverage?: { artifactCount: number; partCount: number; runIds: string[] } }
    if (deps.generate === generateJSON && chapterType && target) {
      const result = await requestAIReview({ ...scope, targetType: chapterType, targetId: target.id, sourceRunId: run.id })
      const comments = Array.isArray(result.review.aiComments) ? result.review.aiComments as { issue?: string; suggestion?: string; blocking?: boolean }[] : []
      data = { score: result.review.aiScore ?? 0, summary: `《${target.title}》评审完成，可在原评分视图查看完整报告`, dimensions: normalizeScoreDimensions(result.review.aiDimensions), issues: comments.map(c => ({ issue: c.issue ?? "待完善", suggestion: c.suggestion ?? "", needsAuthor: false, blocking: c.blocking === true })) }
      if ("findings" in result && result.findings.criticalKeys.length) data.issues.push({ issue: `存在 ${result.findings.criticalKeys.length} 处已核验出处的情节矛盾`, suggestion: "按本章评审中的前后章与故事来源对照逐项修订，再评审当前版本；总分达标不能抵消逻辑硬伤。", needsAuthor: false, blocking: true })
    } else {
      data = await reviewStoryMaterial({ scope, label, material, generate: deps.generate, lightReview: !!target,
      prompt: `你是小说创作审稿人，独立检查${label}：依据所给数据按当前产物粒度评分，不按完成比例打分，不虚构未提供的内容。主题评题材/核心冲突/卖点/已明确规则；脑洞评主角目标/阻力/代价/主线转折/结局能否继续共创；后续环节建设只列建议，不算当前缺失、不强行扣分。检查信息缺口、因果、动机、时间线、世界规则、伏笔、公平悬念与跨层一致性；汇总评审依据逐项检查点，已有评审引用可作证据。尊重作者已定选择：仅相互排斥、会改变作者已定方向且无法从已有决定推导的取舍标needsAuthor=true，普通修订为false；规则自相矛盾或跨层因果硬伤标blocking=true（总分高也须修复）。返回{score:0..100,summary,dimensions:[{dimension:"完整度",score:0..100},{dimension:"因果与规则",score:0..100},{dimension:"人物与冲突",score:0..100}],issues:[{issue,suggestion,needsAuthor,blocking}]}。按实际质量评分，不强制高分。输出从简：summary≤120字，issues≤3条且每条issue/suggestion≤60字，无问题issues=[]。${coverageNote}\n作者创作简报：${row.brief}\n目标规模：${row.targetChapters}章，每章约${row.targetWords}字` })
    }
    const current = await getStoryWorkflow(scope), freshGraph = await readStoryArtifacts(scope)
    const freshHash = target ? storyEvidenceHash(key, freshGraph) : current ? viewHashFor(current, freshGraph, key) : undefined
    if (!current || current.version !== row.version || freshHash !== hash) throw new ContentError("VERSION_CONFLICT", "评审期间内容已变化，旧评审不标为当前版本")
    const checkpoint: StoryCheckpoint = { ...data, hash, passed: data.score >= checkpointDef.threshold && !data.issues.some(i => i.needsAuthor || i.blocking), at: new Date().toISOString(), runId: run.id, iteration: previous?.hash === hash ? previous.iteration + 1 : 1 }
    const updated = await prisma.storyWorkflow.updateMany({ where: { novelId: scope.novelId, version: row.version }, data: { checkpoints: storyJson({ ...view.checkpoints, [key]: checkpoint }), version: { increment: 1 } } })
    if (!updated.count) throw new ContentError("VERSION_CONFLICT", "流程已有新进展，评审保留在档案中")
    // 正文评审引擎会完成传入的 run；保留其完整评分档案，不能二次完成或覆盖。
    const persistedRun = await prisma.subAgentRun.findUnique({ where: { id: run.id }, select: { status: true } })
    if (persistedRun?.status === "running") await completeRun(run.id, { result: { score: checkpoint.score }, transcript: checkpoint })
    return { ok: true, key, checkpoint, ...checkpointFollowUp(checkpoint), maxIterations }
  } catch (error) { await failRun(run.id, error instanceof Error ? error.message : "评审未完成").catch(() => {}); throw error }
}

export const FAST_MATERIAL_KINDS = new Set(["world", "setting", "item", "scene", "foreshadow"])
/** 普通资料任务的默认收尾：结构证据与质量评分明确分离。 */
export async function checkStoryMaterialStructure(scope: StoryScope, key: string) {
  const graph = await readStoryArtifacts(scope)
  const target = graph.artifacts.find(a => a.key === key)
  if (!target || !FAST_MATERIAL_KINDS.has(target.kind)) throw new ContentError("STORY_ARTIFACT_NOT_FOUND", "请选择本书创作资料", 404)
  const row = await prisma.storyWorkflow.findUniqueOrThrow({ where: { novelId: scope.novelId } })
  const checkpoints = storyCheckpointsSchema.parse(row.checkpoints), hash = storyEvidenceHash(key, graph)
  if (checkpoints[key]?.hash === hash) return { checkpoint: checkpoints[key], reused: true }
  const value = JSON.parse(target.text) as Record<string, unknown>
  const valid = target.kind === "world" ? typeof value.description === "string" && !!value.description.trim() : materialHasContent({ kind: target.kind as StoryMaterial["kind"], id: target.id, title: target.title, type: target.settingType as StoryMaterial["type"], content: target.kind === "setting" || target.kind === "foreshadow" ? value.content : target.kind === "scene" ? [value.description, value.backstory, value.entryMethod, value.exteriorDescription, value.interiorDescription].filter(v => typeof v === "string").join("\n") : { description: value.description, appearance: value.appearance, acquisition: value.acquisition, effects: value.effects } }) && value.dropped !== true
  const checkpoint: StoryCheckpoint = { hash, score: null, passed: valid, summary: valid ? "资料结构检查通过；未做 AI 质量评分" : "资料业务内容为空或已废弃，请简短补齐；未做 AI 质量评分", issues: valid ? [] : [{ issue: "资料内容尚不完整", suggestion: "补齐本次创作需要的介绍、规则或用途", needsAuthor: false, blocking: true }], dimensions: [], at: new Date().toISOString(), iteration: 0, reviewPolicy: "structure-only" }
  const updated = await prisma.storyWorkflow.updateMany({ where: { novelId: scope.novelId, version: row.version }, data: { checkpoints: storyJson({ ...checkpoints, [key]: checkpoint }), version: { increment: 1 } } })
  if (!updated.count) throw new ContentError("VERSION_CONFLICT", "资料检查期间创作进度已变化，请重新读取", 409)
  return { checkpoint, reused: false }
}

/** 实例回炉收敛证据直接作为该产物检查点（W3 消除双重评审）：同指纹 reviewStoryCheckpoint 命中缓存免重评；产物修改后指纹变化，照常重评（级联重认可语义不变）。 */
export async function recordInstanceLoopEvidence(scope: StoryScope, key: string, evidence: { score: number; passed: boolean; iterations: number; summary: string; issues: StoryCheckpoint["issues"]; runId?: string }) {
  await ownedStory(scope)
  const row = await prisma.storyWorkflow.findUnique({ where: { novelId: scope.novelId } })
  if (!row) return null
  const graph = await readStoryArtifacts(scope), target = graph.artifacts.find(a => a.key === key)
  if (!target) return null
  const checkpoints = storyCheckpointsSchema.parse(row.checkpoints)
  const checkpoint: StoryCheckpoint = { hash: storyEvidenceHash(key, graph), score: evidence.score, passed: evidence.passed, summary: evidence.summary, issues: evidence.issues, dimensions: [], at: new Date().toISOString(), runId: evidence.runId, iteration: evidence.iterations, source: "instance-loop" }
  const updated = await prisma.storyWorkflow.updateMany({ where: { novelId: scope.novelId, version: row.version }, data: { checkpoints: storyJson({ ...checkpoints, [key]: checkpoint }), version: { increment: 1 } } })
  return updated.count ? checkpoint : null
}

export async function prepareStoryApproval(scope: StoryScope, key: string) {
  const view = await getStoryWorkflow(scope)
  if (!view) throw new ContentError("STORY_WORKFLOW_MISSING", "先启动创作流程", 400)
  const graph = await readStoryArtifacts(scope), target = graph.artifacts.find(a => a.key === key)
  if (key === "policy:writing") {
    if (view.phases.find(p => p.id === "outline")?.status !== "passed") throw new ContentError("STORY_REVIEW_REQUIRED", "先认可当前大纲，再选择正文写作方式", 409)
    if (view.writingAuthorized) return { alreadyApproved: true as const, title: "正文写作方案", key }
    return { title: `正文写作方案：${view.targetChapters}章，每章约${view.targetWords}字，${view.writingMode === "batch" ? "批量生成并逐章评审改进" : "每章评审改进后等你认可"}。自动采用仅限完整且通过质量比较的候选，定稿另行确认`, approval: { key, hash: view.writingPolicyHash, version: view.version } }
  }
  let phaseId: StoryPhase | undefined, sub: PlotSubKey | undefined
  if (key.startsWith("phase:")) {
    if (key === "phase:plot") throw new ContentError("STORY_CHECKPOINT_KEY_INVALID", "剧情搭建按世界线与叙事线分别评审与认可：phase:plot:worldline 与 phase:plot:narrative", 400)
    const parsed = parseCheckpointKey(key)
    if (!parsed) throw new ContentError("STORY_ARTIFACT_NOT_FOUND", "待审核内容不存在", 404)
    phaseId = parsed.phase; sub = parsed.sub
  }
  const phase = phaseId ? view.phases.find(p => p.id === phaseId) : undefined
  const subView = sub ? phase?.subkeys?.find(s => s.key === key) : undefined
  if (!target && !phase) throw new ContentError("STORY_ARTIFACT_NOT_FOUND", "待审核内容不存在", 404)
  const hash = subView?.hash ?? phase?.hash ?? storyEvidenceHash(key, graph), checkpoint = view.checkpoints[key]
  const blockers = subView?.blockers ?? phase?.blockers ?? []
  // structure-only 环节（脑洞）无 AI 打分：结构达标 + 指纹匹配即可发起作者认可
  const reviewMissing = phase && storyPhaseDefinition(phase.id).reviewPolicy === "structure-only" ? false : !checkpoint?.passed || checkpoint.hash !== hash
  if (reviewMissing || blockers.length) throw new ContentError("STORY_REVIEW_REQUIRED", `当前版本尚未评审达标；${blockers.length ? blockers.slice(0, 3).join("；") + "。" : ""}先 reviewStoryCheckpoint(key=${key}) 读取实际缺口和反馈，修好后重评；不能直接请求认可。`, 409)
  const title = target?.title ?? (subView ? `${phase!.label} · ${subView.label}` : phase!.label)
  if (view.approvals[key]?.hash === hash) return { alreadyApproved: true as const, title, key }
  return { title, focus: target ? { ...target, text: undefined } : { key, kind: "story-workflow", id: scope.novelId, title }, approval: { key, hash, version: view.version } }
}

/** 模型遗漏问答调用时，服务端仍把已经就绪的审核交给真实作者。不会批准任何版本。 */
export async function nextStoryApproval(scope: StoryScope) {
  const view = await getStoryWorkflow(scope)
  if (!view) return null
  const pending = view.pendingApprovals[0]
  const artifact = pending && view.artifacts.find(a => a.key === pending)
  const check = pending && view.checkpoints[pending]
  const key = artifact && check && check.passed && check.hash === artifact.evidenceHash ? pending : view.phases.find(p => p.status === "approval")?.id
  if (!key) return null
  // plot 进入 approval 态时依次准备世界线、叙事线两个子键的认可
  const keys = key === "plot"
    ? (view.phases.find(p => p.id === "plot")?.subkeys ?? []).map(s => s.key)
    : [artifact && key === pending ? key : `phase:${key}`]
  for (const k of keys) {
    const prepared = await prepareStoryApproval(scope, k)
    if (!prepared.alreadyApproved) return prepared
  }
  return null
}

/** 模型遗漏问答时，只把当前评审的真实分歧交给作者，不把选择当作产物批准。 */
export async function nextStoryDecision(scope: StoryScope) {
  const view = await getStoryWorkflow(scope)
  if (!view) return null
  const phaseKeys = view.phase === "plot"
    ? (view.phases.find(p => p.id === "plot")?.subkeys ?? []).map(s => s.key)
    : [`phase:${view.phase}`]
  const keys = [...view.pendingApprovals, ...view.artifacts.filter(a => a.kind === "chapter-content").map(a => a.key), ...phaseKeys]
  for (const key of keys) {
    const artifact = view.artifacts.find(a => a.key === key), phase = view.phases.find(p => `phase:${p.id}` === key)
    const sub = view.phases.flatMap(p => (p.subkeys ?? []).map(s => ({ ...s, phaseLabel: p.label }))).find(s => s.key === key)
    if (!artifact && !phase && !sub) continue
    const check = view.checkpoints[key]
    if (!check || check.passed || check.hash !== (artifact?.evidenceHash ?? sub?.hash ?? phase?.hash)) continue
    const issues = check.issues.filter(issue => issue.needsAuthor).slice(0, 4)
    if (!issues.length) continue
    const title = artifact?.title ?? (sub ? `${sub.phaseLabel} · ${sub.label}` : phase!.label)
    return {
      questions: issues.map(issue => {
        const full = `关于「${title}」：${issue.issue}\n评审建议：${issue.suggestion}\n请选择处理方式，或填写你的修改方案。`
        return { question: full.length <= 500 ? full : `关于「${title.slice(0, 60)}」：${issue.issue.slice(0, 350)}\n完整问题与建议见右侧评审，请选择处理方式或填写你的方案。`, options: ["采用评审建议修订，再评审", "先提出具体的备选方案供我选择"] }
      }),
      focus: { kind: "story-review", key },
    }
  }
  return null
}

export async function getStoryReviewHistory(scope: StoryScope, key: string) {
  await ownedStory(scope)
  const runs = await prisma.subAgentRun.findMany({ where: { novelId: scope.novelId, targetType: "STORY_WORKFLOW", targetId: `${scope.novelId}:${key}` }, orderBy: { createdAt: "desc" }, take: 50 })
  return { ...await getReviewActivity(scope.novelId, "STORY_WORKFLOW", `${scope.novelId}:${key}`), checks: runs.flatMap(run => { const check = storyCheckpointSchema.safeParse(run.transcript); return run.status === "done" && check.success ? [check.data] : [] }) }
}

/** 每一步给模型最新的小型状态快照，避免沿用历史文字里的旧版本/误认某项评分为整阶段通过。 */
export async function storyStepContext(scope: StoryScope, action?: ChatAction | null) {
  const view = await getStoryWorkflow(scope)
  if (!view) return ""
  if (action?.kind === "storyTask") {
    const target = view.artifacts.find(a => a.key === action.targetKey)
    return `\n【服务器当前子任务（数据）】\n${JSON.stringify({ action, version: view.version, brief: view.brief, targetWords: action.wordCount ?? view.targetWords, target, review: target ? view.checkpoints[target.key] : undefined, artifacts: view.artifacts.slice(0, 30).map(a => ({ key: a.key, title: a.title })) })}\n作者已经选择本次任务，不再问“先做哪个任务”或“是否开始”。其他产物的待认可和建议不构成本任务前置条件；普通细节按已有设定补齐。仅缺少作者独有的关键资料时问该具体资料。完成实际写入后completeStoryTask给出下一步。角色版本从getCharacter读取，不能使用流程version。`
  }
  const state = { version: view.version, phase: view.phase, writingAuthorized: view.writingAuthorized,
    phases: view.phases.flatMap(p => p.id === "plot"
      // plot 行暴露两个子键及其状态，模型按子键调用评审/认可
      ? (p.subkeys ?? []).map(s => ({ key: s.key, title: `${p.label} · ${s.label}`, status: s.status, score: s.score, blockers: s.blockers.slice(0, 3) }))
      : [{ key: `phase:${p.id}`, title: p.label, status: p.status, score: p.score, blockers: p.blockers.slice(0, 3) }]),
    pending: view.pendingApprovals.slice(0, 8).map(key => { const a = view.artifacts.find(a => a.key === key)!; const c = view.checkpoints[key]; return { key, title: a.title, reviewed: !!c?.passed && c.hash === a.evidenceHash } }) }
  return `\n【服务器当前创作状态（数据）】\n${JSON.stringify(state)}\n以本次真实产物为准。只做作者选定的子任务，允许世界、角色、剧情、弧线自由切换，不受其他待认可资料阻塞。完成后completeStoryTask给出下一步；单项已认可不再要求阶段认可。`
}

/** 仅由真实交互提交调用，模型工具没有批准写入口。 */
export async function approveStoryVersion(scope: StoryScope, input: { key: string; hash: string; version: number }, messageId: string, tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT "novelId" FROM "StoryWorkflow" WHERE "novelId" = ${scope.novelId} FOR UPDATE`
  const row = await tx.storyWorkflow.findUniqueOrThrow({ where: { novelId: scope.novelId } })
  const graph = await readStoryArtifacts(scope, tx), view = workflowView(row, graph)
  if (input.key === "phase:plot") throw new ContentError("STORY_CHECKPOINT_KEY_INVALID", "剧情搭建按世界线与叙事线分别认可：phase:plot:worldline 与 phase:plot:narrative", 400)
  if (input.key.startsWith("phase:") && !parseCheckpointKey(input.key)) throw new ContentError("STORY_ARTIFACT_NOT_FOUND", "待审核内容不存在", 404)
  const parsedKey = input.key.startsWith("phase:") ? parseCheckpointKey(input.key) : null
  const phase = parsedKey ? view.phases.find(p => p.id === parsedKey.phase) : undefined
  const subView = parsedKey?.sub ? phase?.subkeys?.find(s => s.key === input.key) : undefined
  const artifact = graph.artifacts.find(a => a.key === input.key)
  const hash = subView?.hash ?? phase?.hash ?? (artifact ? storyEvidenceHash(input.key, graph) : null)
  const checkpoint = view.checkpoints[input.key]
  const policyValid = input.key === "policy:writing" && view.phases.find(p => p.id === "outline")?.status === "passed" && view.writingPolicyHash === input.hash
  // structure-only 环节（脑洞）无 AI 打分：不要求检查点分数，仍要求结构达标 + 作者确认的指纹与当前一致
  const structureOnly = !!phase && storyPhaseDefinition(phase.id).reviewPolicy === "structure-only"
  const reviewMissing = structureOnly ? false : !checkpoint?.passed || checkpoint.hash !== hash
  const blockers = subView?.blockers ?? phase?.blockers ?? []
  if ((!policyValid && (reviewMissing || blockers.length || hash !== input.hash)) ) throw new ContentError("VERSION_CONFLICT", "待审核版本已变化，请查看新版本后确认")
  const approvals = storyApprovalsSchema.parse(row.approvals)
  if (approvals[input.key]?.hash === input.hash) return
  const updated = await tx.storyWorkflow.updateMany({ where: { novelId: scope.novelId, version: row.version }, data: { approvals: storyJson({ ...approvals, [input.key]: { hash: input.hash, at: new Date().toISOString(), messageId } }), version: { increment: 1 } } })
  if (!updated.count) throw new ContentError("VERSION_CONFLICT", "待审核版本已变化，请重新确认")
}
