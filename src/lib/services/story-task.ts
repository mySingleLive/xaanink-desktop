import { prisma } from "@/lib/db"
import { currentChatExecution } from "@/lib/chat-execution"
import type { ChatAction } from "@/lib/chat-parts"
import { chatActionNote, hasActionReceipt } from "./chat-action"
import type { Prisma } from "@/generated/prisma/client"
import { ContentError } from "@/lib/content-errors"
import { MAX_STORY_TASK_CHOICES, STORY_TASK_SOURCE_KINDS, canContinueImproving, selectedStoryChoice, storyTaskNavigationSchema, type StoryTaskAction, type StoryTaskNavigation, type StorySelection, type TaskScope, type NavigationEntity } from "@/lib/story-task"
import { storyPhaseDefinition } from "@/lib/sop/graph"
import { storyApprovalsSchema, storyCheckpointsSchema, type StoryArtifact } from "@/lib/story-workflow"
import { readStoryArtifacts, storyEvidenceHash, storyJson, type StoryScope } from "./story-artifacts"
import { approveStoryVersion, getStoryWorkflow, reviewStoryCheckpoint, updateStoryWorkflow, checkStoryMaterialStructure, FAST_MATERIAL_KINDS } from "./story-workflow"
import { requestHash } from "./content-commit"

import { navigationEntities, navigationRecommendations, meaningfulRequirements, existingCharacterNames, type NavigationSuggestion } from "@/lib/story-navigation"
import { readingCards } from "@/lib/planning/domain"
import { WORLD_SETTING_TYPES } from "@/lib/setting-types"
import { chapterMaterialReconciliationReads, withChapterMaterialReconciliationSource } from "@/lib/chapter-material-reconciliation"
import { materialTaskReadiness, materialTaskReadinessMessage } from "@/lib/material-task-readiness"

export function navigationContextHash(graph: Awaited<ReturnType<typeof readStoryArtifacts>>) {
  return requestHash({ navigationRules: 13, context: graph.contextHash, artifacts: graph.artifacts.map(a => [a.key, a.hash]), edges: graph.edges.map(e => [e.sourceKey, e.targetKey, e.sourceHash]) })
}
export function chapterPolicyHash(outlineHash: string, wordCount: number) { return requestHash({ outlineHash, wordCount }) }

/** completeStoryTask 与回合自动收尾的共用返回：有真实选择权时给问答面板；仅剩唯一轻量下一步时给 autoProceed 指令（2026-09-25 作者反馈：单选项不弹面板）。 */
export interface StoryTaskPreparation {
  storyFocus: (Omit<StoryArtifact, "text"> & { text?: undefined }) | { kind: string; id: string }
  title: string
  score: number | null
  threshold: number
  targets: { key: string; hash: string; version: number }[]
  question?: {
    questions: { question: string; options: string[] }[]
    markerStyle: "letters"
    storyNavigation: StoryTaskNavigation
    costEstimate?: { kind: "chapterContent"; wordCount?: number }
  }
  autoProceed?: { label: string; task: StoryTaskAction["task"]; targetKey?: string; scope?: TaskScope; wordCount?: number } | null
  message?: string
}

/** 由真实目标生成选择。模型只能指定已存在的产物，不能给自己写批准或评分。 */
export async function prepareStoryTask(scope: StoryScope, keys: string[], review = true, suggestions: NavigationSuggestion[] = [], useReceiptTargets = true): Promise<StoryTaskPreparation> {
  let graph = await readStoryArtifacts(scope)
  const execution = currentChatExecution()
  const receipts = execution && review ? await prisma.chatToolExecution.findMany({ where: { turnId: execution.turnId, status: "succeeded" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) : []
  if (execution && review) {
    const turn = await prisma.chatTurn.findUniqueOrThrow({ where: { id: execution.turnId } })
    const action = turn.action as ChatAction | null
    if (action?.kind === "storyTask" && !["discuss", "choose"].includes(action.task)) {
      const materials = materialTaskReadiness(action, receipts, graph.volumes.flatMap(volume => volume.chapters))
      if (materials?.missing.length) throw new ContentError("STORY_TASK_INCOMPLETE", materialTaskReadinessMessage(materials.missing), 409)
      const reconciliation = chapterMaterialReconciliationReads(action, receipts)
      if (reconciliation?.missing.length) throw new ContentError("STORY_TASK_INCOMPLETE", `本章资料核对尚缺成功读取回执：${reconciliation.missing.join("；")}。请继续读取并逐项对照正文；发现缺项先补档案或提出规划修订并等待作者采用，再收尾。`, 409)
      if (!hasActionReceipt(action, receipts, false)) throw new ContentError("STORY_TASK_INCOMPLETE", "本次所选任务尚无实际产物，请完成后再收尾，不重复询问上一任务", 409)
    }
  }
  let unique = [...new Set(keys)]
  if (!unique.length || unique.length > 20) throw new ContentError("STORY_TASK_TARGET_REQUIRED", "请选择本次实际完成的产物", 400)
  const completed = completedStoryKeys(receipts).filter(key => graph.artifacts.some(a => a.key === key))
  if (useReceiptTargets && completed.length) unique = completed // 收尾以真实回执为准；显式单产物认可不得扩大为整批。
  for (const key of unique) {
    if (!graph.artifacts.some(a => a.key === key) && key !== "phase:brainstorm") throw new ContentError("STORY_ARTIFACT_NOT_FOUND", "本任务产物不存在或不属于当前作品", 404)
  }
  // 所有目标先校验，防止先写入第一个检查点、再因后续非法key留下未知部分提交。
  let workflow = await getStoryWorkflow(scope)
  if (!workflow) workflow = await updateStoryWorkflow(scope, { expectedVersion: 0 })
  if (review) for (const key of unique) {
    if (FAST_MATERIAL_KINDS.has(graph.artifacts.find(a => a.key === key)?.kind ?? "")) await checkStoryMaterialStructure(scope, key)
    else await reviewStoryCheckpoint(scope, key)
  }
  workflow = (await getStoryWorkflow(scope))!
  graph = await readStoryArtifacts(scope)
  const artifacts = unique.map(key => graph.artifacts.find(a => a.key === key))
  const first = artifacts[0], phase = first?.phase ?? "brainstorm"
  if (review && first && workflow.phase !== phase) {
    // 当前任务归类只影响展示；CAS 避免覆盖另一回合刚选择的阶段。
    await prisma.storyWorkflow.updateMany({ where: { novelId: scope.novelId, version: workflow.version }, data: { phase, version: { increment: 1 } } })
    workflow = (await getStoryWorkflow(scope))!
  }
  const targets = unique.map(key => ({ key, hash: key === "phase:brainstorm" ? workflow.phases.find(p => p.id === "brainstorm")!.hash : storyEvidenceHash(key, graph), version: workflow.version }))
  const ready = targets.every(t => t.key === "phase:brainstorm" ? !workflow.phases.find(p => p.id === "brainstorm")!.blockers.length : workflow.checkpoints[t.key]?.hash === t.hash && workflow.checkpoints[t.key]?.passed)
  const accepted = targets.every(t => workflow.approvals[t.key]?.hash === t.hash)
  const title = (artifacts.map(a => a?.title ?? "创作简报").join("、")).slice(0, 100)
  const threshold = storyPhaseDefinition(phase).checkpoints[0].threshold
  const checks = targets.map(t => workflow.checkpoints[t.key])
  const structureChecked = checks.every((c, i) => c?.hash === targets[i].hash && c.passed && c.reviewPolicy === "structure-only")
  const score = checks.every((c, i) => c && c.hash === targets[i].hash && c.score !== null) ? Math.min(...checks.map(c => c.score!)) : null
  // 抽卡只依赖本章当前章纲；前章候选未采用也可为目标后章抽卡。
  // 直写/整书批量的前文与作者认可边界由对应生成工具继续校验。
  const writingReadyKeys = new Set(graph.artifacts.filter(a => {
    if (a.kind !== "chapter-outline" || !a.text.trim()) return false
    const check = workflow.checkpoints[a.key]
    if (!check?.passed || check.hash !== storyEvidenceHash(a.key, graph)) return false
    return true
  }).map(a => a.key))
  const authorIssues = checks.flatMap((check, i) => check?.hash === targets[i].hash ? check.issues.filter(issue => issue.needsAuthor).map(issue => `${artifacts[i]?.title ?? title}：${issue.issue}；${issue.suggestion}`) : [])
  const canImprove = targets.every((t, i) => canContinueImproving(checks[i], t.hash))
  const choices = navigationRecommendations({ artifacts: graph.artifacts, edges: graph.edges, focusKeys: unique, writingReadyKeys, ready, accept: ready && !accepted, words: workflow.targetWords, suggestions,
    maxChoices: MAX_STORY_TASK_CHOICES - Number(authorIssues.length > 0) - Number(canImprove) })
  if (authorIssues.length) choices.unshift({ id: "clarify-review", label: "确认评审中的关键方向", description: `读取当前评审及已确认要求，先解决待确认问题，仅对尚未明确的方向提问：${authorIssues.join("；")}`.slice(0, 300), task: "custom", accept: false, scope: { targetKeys: [], sourceKeys: unique } })
  if (canImprove) {
    // 以当前产物的正式合格判定排序，不额外要求85分才能推进。
    const priority = !ready
    const improve: StoryTaskNavigation["choices"][number] = { id: "improve-current", scope: { targetKeys: unique, sourceKeys: [] }, label: `继续改进${title}`, description: priority ? "优先按当前评审意见修复问题，再推进后续创作" : "按评审建议进一步打磨，也可先推进后续创作", task: "improve", accept: false, targetKey: targets[0].key }
    if (priority) choices.unshift(improve)
    else choices.push(improve)
  }
  const navigation: StoryTaskNavigation = { schemaVersion: 2, accepted, contextHash: navigationContextHash(graph), entities: navigationEntities(graph.artifacts, graph.edges),
    verifiedProgress: graph.artifacts.filter(a => ["character", "worldline", "narrative", "chapter-outline"].includes(a.kind)).map(a => `${a.title}：${a.kind === "character" ? "角色已存在，不重复创建" : a.kind === "worldline" ? "世界线已存在" : a.kind === "narrative" ? "叙事线已存在" : a.text.trim() ? "已有正式章纲" : "章纲尚待填写"}`), targets, title, score, threshold, structureChecked, choices, shortcuts: [
    ...(ready && !accepted ? [{ id: "accept-only", label: "只认可，稍后继续", description: "只接受当前版本，不执行新任务", task: "discuss" as const, accept: true }] : []),
    { id: "choose", label: "暂存并换个任务", description: "保留结果，不接受当前版本", task: "choose", accept: false },
  ] }
  const storyFocus: StoryTaskPreparation["storyFocus"] = first ? { ...first, text: undefined } : { kind: "story-workflow", id: scope.novelId }
  // 单选项免弹面板（2026-09-25 作者反馈）：只剩一个不涉作者认可/付费写作/自定义目标的下一步时，
  // 不弹问答面板，直接把该任务交给模型本轮执行一次并文字收尾；没有剩余方向时只文字总结。
  const needsAuthor = (ready && !accepted) || choices.some(c => c.accept || c.task === "writing" || c.task === "custom")
  if (!needsAuthor && choices.length <= 1) {
    const choice = choices[0]
    if (!choice) return { storyFocus, title, score, threshold, targets, autoProceed: null,
      message: "当前没有需要作者决定的下一步。请用文字如实总结本次结果与现状（可简述可选方向），然后结束本轮：不要调用 askUserQuestion，也不要再调用 completeStoryTask。" }
    const action: ChatAction = { kind: "storyTask", task: choice.task, ...(choice.scope ? { scope: choice.scope } : {}), ...(choice.targetKey ? { targetKey: choice.targetKey } : {}), ...(choice.wordCount ? { wordCount: choice.wordCount } : {}) }
    return { storyFocus, title, score, threshold, targets,
      autoProceed: { label: choice.label, task: choice.task, ...(choice.targetKey ? { targetKey: choice.targetKey } : {}), ...(choice.scope ? { scope: choice.scope } : {}), ...(choice.wordCount ? { wordCount: choice.wordCount } : {}) },
      message: `当前只剩一个不涉及认可或付费的下一步：${choice.label}。请本轮直接执行一次该任务，完成后用文字如实汇报结果并收尾——不要再调用 completeStoryTask 或 askUserQuestion 追问下一步。${chatActionNote(action)}` }
  }
  return {
    storyFocus, title, score, threshold, targets,
    ...(structureChecked ? { message: "资料结构检查通过；未做 AI 质量评分" } : {}),
    question: { questions: [{ question: ready && !accepted ? `「${title}」这一版如何继续？` : `「${title}」接下来想做什么？`, options: choices.length ? choices.map(c => c.label) : ["选择其他任务"] }], markerStyle: "letters" as const, storyNavigation: navigation,
      ...(choices.some(c => c.task === "writing") ? { costEstimate: { kind: "chapterContent" as const, wordCount: workflow.targetWords } } : {}) },
  }
}

/** 主叙事线已有实际讲述卡片（卷章大纲任务的前置）。 */
function primaryNarrativeReady(graph: Awaited<ReturnType<typeof readStoryArtifacts>>) {
  const primary = graph.planning?.lines.find(l => l.primary)
  return !!primary && readingCards(graph.planning!, primary.id).length > 0
}

/** 必须在消费原问题的事务内调用；只允许服务端原问题提供的选择。 */
export async function consumeStoryTask(scope: StoryScope, raw: unknown, message: string, messageId: string, tx: Prisma.TransactionClient, selection?: StorySelection): Promise<StoryTaskAction | undefined> {
  const navigation = storyTaskNavigationSchema.parse(raw)
  const graph = await readStoryArtifacts(scope, tx)
  let choice: StoryTaskNavigation["choices"][number] | undefined
  let requirements: string | undefined
  if (navigation.schemaVersion === 2 && selection) {
    if (navigation.contextHash !== navigationContextHash(graph)) throw new ContentError("VERSION_CONFLICT", "创作进度已变化，请重新核对选项后继续", 409)
    if (selection.kind === "choice") {
      choice = [...navigation.choices, ...navigation.shortcuts].find(c => c.id === selection.choiceId)
      if (!choice) throw new ContentError("STORY_CHOICE_INVALID", "此选项不属于当前问题", 400)
      if (choice.task === "custom") requirements = `${choice.label}。${choice.description}`
    } else {
      validateTaskScope(selection.taskId, selection.scope, navigationEntities(graph.artifacts, graph.edges), { narrativeReady: primaryNarrativeReady(graph) })
      requirements = meaningfulRequirements(selection.taskId, selection.requirements)
      if (["custom", "revise"].includes(selection.taskId) && !requirements) throw new ContentError("STORY_REQUIREMENTS_REQUIRED", "请填写具体目标或修改要求", 400)
      if (selection.taskId === "character") {
        const name = requirements.match(/(?:^|\n)姓名[：:]\s*([^\n]+)/u)?.[1]?.trim()
        if (name && existingCharacterNames(graph.artifacts).has(name.normalize("NFKC"))) throw new ContentError("STORY_CHARACTER_EXISTS", "该姓名或别名已有角色，请选择修改已有内容或填写新人物", 409)
      }
      choice = { task: selection.taskId, label: "作者指定任务", description: "", accept: false, scope: selection.scope, targetKey: selection.scope.targetKeys[0] }
    }
  } else {
    if (selection) throw new ContentError("STORY_CHOICE_INVALID", "旧问题不支持此选择，请重新核对", 400)
    choice = selectedStoryChoice(navigation, message)
    // Compatibility for historical clients: still validate v2 snapshots before label selections.
    if (navigation.schemaVersion === 2 && choice && navigation.contextHash !== navigationContextHash(graph)) throw new ContentError("VERSION_CONFLICT", "创作进度已变化，请重新核对选项后继续", 409)
  }
  if (!choice) return undefined // 自由回答不代批
  if (navigation.schemaVersion === 2 && choice.task === "outline") {
    validateTaskScope("outline", choice.scope ?? { sourceKeys: [], targetKeys: [] }, navigationEntities(graph.artifacts, graph.edges), { narrativeReady: primaryNarrativeReady(graph) })
  }
  if (choice.accept || choice.task === "writing" || choice.task === "improve") {
    for (const target of navigation.targets) {
      if (target.key !== "phase:brainstorm" && storyEvidenceHash(target.key, graph) !== target.hash) throw new ContentError("VERSION_CONFLICT", "内容已变化，请查看新版本后选择")
    }
  }
  await tx.$queryRaw`SELECT "novelId" FROM "StoryWorkflow" WHERE "novelId" = ${scope.novelId} FOR UPDATE`
  if (choice.task === "improve") {
    const row = await tx.storyWorkflow.findUniqueOrThrow({ where: { novelId: scope.novelId } })
    const checkpoints = storyCheckpointsSchema.parse(row.checkpoints)
    if (!navigation.targets.every(target => canContinueImproving(checkpoints[target.key], target.hash))) throw new ContentError("STORY_REVIEW_REQUIRED", "当前评审已变化，请查看最新结果", 409)
  }
  if (choice.accept) for (const target of navigation.targets) await approveStoryVersion(scope, target, messageId, tx)
  if (choice.task === "writing") {
    const target = graph.artifacts.find(a => a.key === choice!.targetKey && a.kind === "chapter-outline")
    if (!target || !choice.wordCount) throw new ContentError("STORY_WRITING_APPROVAL_REQUIRED", "写作范围无效", 409)
    const row = await tx.storyWorkflow.findUniqueOrThrow({ where: { novelId: scope.novelId } })
    const hash = storyEvidenceHash(target.key, graph)
    await approveStoryVersion(scope, { key: target.key, hash, version: row.version }, messageId, tx)
    const approved = await tx.storyWorkflow.findUniqueOrThrow({ where: { novelId: scope.novelId } })
    const approvals = storyApprovalsSchema.parse(approved.approvals)
    approvals[`policy:${target.key}`] = { hash: chapterPolicyHash(hash, choice.wordCount), at: new Date().toISOString(), messageId, wordCount: choice.wordCount }
    await tx.storyWorkflow.update({ where: { novelId: scope.novelId }, data: { approvals: storyJson(approvals), version: { increment: 1 } } })
  }
  return withChapterMaterialReconciliationSource({ kind: "storyTask", task: choice.task, ...(choice.scope ? { scope: choice.scope } : {}), ...(requirements !== undefined ? { requirements } : {}), sourceKey: navigation.targets[0].key, ...(choice.targetKey ? { targetKey: choice.targetKey } : {}), ...(choice.wordCount ? { wordCount: choice.wordCount } : {}) })
}

/** 收尾以本轮写入焦点为依据，避免被另一任务的旧待审资料劫持。 */
export function completedStoryKeys(calls: Iterable<{ toolName: string; output: unknown }>): string[] {
  const keys = new Set<string>()
  for (const call of calls) {
    const out = call.output as { ok?: boolean; committed?: boolean; storyFocus?: { key?: string }; storyWorkflow?: { changedKeys?: string[] } } | null
    if (!out || out.ok === false || out.committed === false) continue
    for (const key of out.storyWorkflow?.changedKeys ?? []) keys.add(key)
  }
  // 事件/卡片合并至所属线子任务，避免同一批创作反复问每个子对象。
  return [...keys].filter(key => !key.startsWith("volume:")).slice(-20)
}

/** Directory inputs are author-selected scopes, never trusted entity IDs or approval. */
export function validateTaskScope(task: string, scope: TaskScope, entities: NavigationEntity[], opts?: { narrativeReady?: boolean }) {
  const find = (key: string) => entities.find(e => e.key === key)
  const invalid = () => { throw new ContentError("STORY_SCOPE_INVALID", "任务范围无效或对象已不属于当前作品", 400) }
  for (const key of [...scope.targetKeys, ...scope.sourceKeys, ...[scope.worldKey, scope.volumeKey].filter((x): x is string => !!x)]) if (!find(key)) invalid()
  if (scope.targetKeys.length > 1) invalid()
  if (scope.worldKey && find(scope.worldKey)?.kind !== "world") invalid()
  if (scope.volumeKey && find(scope.volumeKey)?.kind !== "volume") invalid()
  if (scope.category && !(WORLD_SETTING_TYPES as readonly string[]).includes(scope.category)) invalid()
  if (scope.anchorKey || scope.intendedNames || scope.nextVolumeIndex) invalid() // Only server recommendations may supply these.
  if (scope.targetKeys.some(key => find(key)?.kind === "chapter-content")) invalid()
  if (!["item", "scene"].includes(task) && scope.sourceKeys.some(key => find(key)?.kind === "chapter-content")) invalid()
  if (STORY_TASK_SOURCE_KINDS[task] && scope.sourceKeys.some(key => !STORY_TASK_SOURCE_KINDS[task].includes(find(key)!.kind))) invalid()
  if (task === "arc") {
    const target = find(scope.targetKeys[0])
    if (!target || target.kind !== "character") invalid()
    if (scope.arcMode === "replace") {
      if (!scope.stageIds?.length || scope.stageIds.some(id => !target?.stages?.some(s => s.id === id))) invalid()
    } else if (scope.stageIds?.length) invalid()
    if (target?.stages?.length && scope.arcMode !== "append" && scope.arcMode !== "replace") invalid()
  } else if (scope.stageIds || scope.arcMode) invalid()
  if (task === "revise" && scope.targetKeys.length !== 1) invalid()
  if (!["arc", "revise", "custom"].includes(task) && scope.targetKeys.length) invalid()
  if (scope.boardType) invalid() // 故事板退役后不再接受 boardType 范围
  // 卷章大纲 = 为主叙事线分配卷章与字数：须已有主叙事线的实际讲述卡片
  if (task === "outline" && !opts?.narrativeReady) {
    throw new ContentError("STORY_NARRATIVE_REQUIRED", "请先在主叙事线上补全实际讲述卡片（剧情搭建环节），再整理卷章大纲", 400)
  }
}

export async function refreshStoryNavigation(userId: string, turnId: string, id: string, revision: number) {
  const turn = await prisma.chatTurn.findFirst({ where: { id: turnId, userId } })
  const interaction = turn?.interaction as { id?: string; revision?: number; state?: string; payload?: { storyNavigation?: unknown } } | null
  if (!turn || turn.status !== "waiting_user" || interaction?.id !== id || interaction.revision !== revision || interaction.state !== "pending") throw new ContentError("INTERACTION_STALE", "当前问题已变化，请重新读取", 409)
  const conversation = await prisma.conversation.findFirst({ where: { id: turn.conversationId, userId } })
  if (!conversation?.novelId || conversation.activeAttemptId) throw new ContentError("STORY_SCOPE_INVALID", "当前会话不能刷新任务菜单", 409)
  const previous = storyTaskNavigationSchema.parse(interaction.payload?.storyNavigation)
  const scope = { userId, novelId: conversation.novelId }
  const current = await readStoryArtifacts(scope)
  const keys = previous.targets.map(t => t.key).filter(key => key === "phase:brainstorm" || current.artifacts.some(a => a.key === key))
  if (!keys.length) keys.push("phase:brainstorm")
  const prepared = await prepareStoryTask(scope, keys, false)
  // 只剩唯一轻量下一步时已无问答面板（autoProceed）：旧问题不能再刷新，提示作者侧直接继续
  if (!prepared.question) throw new ContentError("INTERACTION_STALE", "当前已有唯一下一步，请直接继续", 409)
  const preparedQuestion = prepared.question
  const next = { ...interaction, revision: revision + 1, payload: preparedQuestion }
  await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ activeAttemptId: string | null }[]>`SELECT "activeAttemptId" FROM "Conversation" WHERE id = ${conversation.id} AND "userId" = ${userId} FOR UPDATE`
    if (!rows.length || rows[0].activeAttemptId) throw new ContentError("INTERACTION_STALE", "当前会话已开始执行", 409)
    const graph = await readStoryArtifacts(scope, tx)
    if (navigationContextHash(graph) !== preparedQuestion.storyNavigation.contextHash) throw new ContentError("VERSION_CONFLICT", "内容在核对期间已变化，请再次核对", 409)
    const result = await tx.chatTurn.updateMany({ where: { id: turnId, userId, status: "waiting_user", interaction: { path: ["revision"], equals: revision } }, data: { interaction: storyJson(next) } })
    if (!result.count) throw new ContentError("INTERACTION_STALE", "当前问题已变化", 409)
  })
  return next
}
