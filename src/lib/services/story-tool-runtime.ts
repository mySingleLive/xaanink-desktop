import { chapterPolicyHash } from "./story-task"
import type { ChatExecutionScope } from "@/lib/chat-execution"
import { ContentError } from "@/lib/content-errors"
import { prisma } from "@/lib/db"
import { WRITE_TOOL_NAMES } from "@/lib/ai/tool-names"
import type { StoryArtifact } from "@/lib/story-workflow"
import { readStoryArtifacts, storyImpact } from "./story-artifacts"
import { getStoryWorkflow, storyEvidenceHash } from "./story-workflow"
import type { ChatAction } from "@/lib/chat-parts"
import { materialTaskNeedsReadGate, materialTaskReadiness, materialTaskReadinessMessage } from "@/lib/material-task-readiness"

const nonContent = new Set(["createSopPlan", "updateSopPlan", "requestAIReview", "requestReaderReview", "assessThemeMarket", "reviewWholeNovel", "addTextComment", "handleTextComment", "updateStoryWorkflow", "reopenStoryPhase", "reviewStoryCheckpoint", "linkStoryArtifacts", "unlinkStoryArtifacts", "generateCharacterImage", "generateNovelCover", "approveOutline", "finalizeChapter", "completeStoryTask"])
export function isStoryContentTool(name: string) { return WRITE_TOOL_NAMES.has(name) && !nonContent.has(name) }
function targetFor(name: string, raw: unknown, artifacts: StoryArtifact[]) {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  if (typeof input.key === "string") return artifacts.find(a => a.key === input.key)
  const kind = name === "summonPlaywright" ? input.kind === "outline" ? "volume" : input.kind : /ChapterContent|Reader/.test(name) || input.targetType === "CHAPTER_CONTENT" ? "chapter-content" : /Chapter|Outline/.test(name) ? "chapter-outline" : /World/.test(name) ? "world" : /Character/.test(name) ? "character" : /Setting/.test(name) ? "setting" : /Scene/.test(name) ? "scene" : /Item/.test(name) ? "item" : /Foreshadow/.test(name) ? "foreshadow" : /Theme/.test(name) ? "theme" : null
  const ids = [input.chapterId, input.targetId, input.worldId, input.characterId, input.settingId, input.itemId, input.sceneId, input.foreshadowId, input.id,
    // 批量结构工具携带 id 数组；取首个可匹配产物作为焦点，避免误判为无目标写入
    ...[input.ids].flatMap(v => Array.isArray(v) ? v : [])].filter(v => typeof v === "string")
  return artifacts.find(a => (!kind || a.kind === kind) && (ids.includes(a.id) || a.title === input.name || a.title === input.title || kind === "theme"))
}
export async function beforeStoryTool(scope: ChatExecutionScope, name: string, input: unknown) {
  if (name === "generateStoryChapters") return null // 编排器按章执行同一检查点，不能在批次结束重复评审。
  if (!isStoryContentTool(name) && name !== "approveOutline") return null
  const conversation = await prisma.conversation.findFirst({ where: { id: scope.conversationId, userId: scope.userId }, select: { novelId: true } })
  if (!conversation?.novelId) return null
  const story = { userId: scope.userId, novelId: conversation.novelId }, graph = await readStoryArtifacts(story)
  if (["createItem", "createScene", "updateItem", "updateScene"].includes(name)) {
    const turn = await prisma.chatTurn.findFirst({ where: { id: scope.turnId, userId: scope.userId, conversationId: scope.conversationId }, select: { action: true } })
    const action = turn?.action as ChatAction | null | undefined
    if (materialTaskNeedsReadGate(action, name)) {
      const receipts = await prisma.chatToolExecution.findMany({ where: { turnId: scope.turnId, status: "succeeded" } })
      const readiness = materialTaskReadiness(action, receipts, graph.volumes.flatMap(volume => volume.chapters))
      if (readiness?.missing.length) throw new ContentError("STORY_MATERIAL_READ_REQUIRED", materialTaskReadinessMessage(readiness.missing), 409)
    }
  }
  const target = targetFor(name, input, graph.artifacts), workflow = await getStoryWorkflow(story)
  if (target) scope.progress?.({ stage: "executing_tool", storyFocus: { ...target, text: undefined }, toolName: name })
  if (workflow) {
    const data = input as Record<string, unknown>
    if (["deleteWorld", "deleteSetting", "deleteCharacter", "deleteItem", "deleteScene", "deleteForeshadow", "deleteCustomTrope", "deleteAttribute"].includes(name)) throw new ContentError("STORY_REMOVAL_REQUIRED", `聊天创作内容保留可恢复记录。请用requestStoryRemoval(key=${target?.key ?? "getStoryWorkflow返回的产物key"})展示影响范围并等待作者确认，再由服务端回收；不要直接永久删除。`, 409)
    if (name === "generateOutline") throw new ContentError("STORY_INCREMENTAL_OUTLINE_REQUIRED", "聊天创作流程保留已有卷章与来源，卷章由叙事线投影管理（proposeNovelPlanning）；修改已有章用 updateChapterOutline，不全书删除重建。", 409)
    if (name === "approveOutline" && data.targetType === "VOLUME_OUTLINE" && !workflow.writingAuthorized) {
      const chapterIds = new Set(graph.volumes.find(v => v.id === data.targetId)?.chapters.map(c => c.id) ?? [])
      const targets = graph.artifacts.filter(a => a.kind === "chapter-outline" && chapterIds.has(a.id))
      if (!targets.length || targets.some(a => workflow.approvals[a.key]?.hash !== storyEvidenceHash(a.key, graph))) throw new ContentError("STORY_OUTLINE_APPROVAL_REQUIRED", "整卷批准需要认可卷内每章当前大纲，单章授权不能扩大到整卷", 409)
    }
    if (name === "approveOutline" && target) {
      const hash = storyEvidenceHash(target.key, graph)
      if (workflow.approvals[target.key]?.hash !== hash && !workflow.writingAuthorized) throw new ContentError("STORY_OUTLINE_APPROVAL_REQUIRED", `请先用 requestStoryApproval(key="${target.key}") 请作者认可本章当前大纲；作者接受后再调用 approveOutline。普通问答的回答不会留下正式认可记录，不要用它代替、也不要重复询问同一对象。`, 409)
    }
    if (name === "generateChapterContent" || name === "writeChapterContent") {
      const outlineKey = `chapter-outline:${target?.id}`
      const policy = workflow.approvals[`policy:${outlineKey}`]
      const words = typeof data.wordCount === "number" ? data.wordCount : policy?.wordCount ?? workflow.targetWords
      const outlineHash = storyEvidenceHash(outlineKey, graph)
      const chapterAuthorized = !!target && workflow.approvals[outlineKey]?.hash === outlineHash && policy?.hash === chapterPolicyHash(outlineHash, words)
      if (!workflow.writingAuthorized && !chapterAuthorized) throw new ContentError("STORY_WRITING_APPROVAL_REQUIRED", "请通过本章大纲的下一步选择确认写作范围，或使用已认可的批量写作方案", 409)
      if (chapterAuthorized) data.wordCount = words
      const previous = graph.artifacts.filter(a => a.kind === "chapter-content" && a.chapterIndex! < (target?.chapterIndex ?? Infinity)).sort((a, b) => a.chapterIndex! - b.chapterIndex!)
      for (const chapter of previous) {
        const evidence = workflow.checkpoints[chapter.key], hash = storyEvidenceHash(chapter.key, graph)
        if (!chapter.text.trim() || !evidence?.passed || evidence.hash !== hash) throw new ContentError("STORY_CHAPTER_REVIEW_REQUIRED", `先完成《${chapter.title}》正文和当前版本评审；低分改后重评`, 409)
        if (workflow.writingMode === "chapter" && workflow.approvals[chapter.key]?.hash !== hash) throw new ContentError("STORY_CHAPTER_APPROVAL_REQUIRED", `逐章模式：先请作者认可《${chapter.title}》`, 409)
      }
      if (data.wordCount === undefined) data.wordCount = workflow.targetWords
    }
  }
  return { story, graph, workflow, target, input }
}

/** 自动检查每次实际写入的设定/章纲/正文；失败留反馈，绝不重放已经成功的写入。 */
export async function afterStoryTool(scope: ChatExecutionScope, name: string, before: Awaited<ReturnType<typeof beforeStoryTool>>, output: unknown) {
  if (!before || !output || typeof output !== "object" || ("ok" in output && output.ok === false)) return output
  const graph = await readStoryArtifacts(before.story)
  const old = new Map(before.graph.artifacts.map(a => [a.key, a.hash]))
  const changed = graph.artifacts.filter(a => old.get(a.key) !== a.hash)
  const focus = targetFor(name, before.input, graph.artifacts) ?? changed.find(a => a.kind !== "worldline" && a.kind !== "narrative") ?? changed[0] ?? before.target
  if (focus) scope.progress?.({ stage: "executing_tool", storyFocus: { ...focus, text: undefined }, toolName: name, saved: changed.length > 0 && !("committed" in output && output.committed === false) })
  if (!before.workflow) return { ...output, storyFocus: focus ? { ...focus, text: undefined } : undefined, storyWorkflow: { changedKeys: changed.filter(a => !["world-event", "narrative-card"].includes(a.kind) && (a.kind !== "chapter-content" || a.text.trim())).map(a => a.key) } }
  const checks = changed.flatMap(a => {
    const checkpoint = before.workflow!.checkpoints[a.key]
    return checkpoint?.hash === storyEvidenceHash(a.key, graph) ? [{ key: a.key, ok: true, checkpoint }] : []
  })
  const impacts = []
  const removed = before.graph.artifacts.filter(a => !graph.artifacts.some(b => b.key === a.key))
  // 删除实体后，原领域边也会消失；保留来源基线，才能在下一回合追踪需要修订的正文。
  const removedKeys = new Set(removed.map(a => a.key))
  const preserved = before.graph.edges.filter(e => removedKeys.has(e.sourceKey) && graph.artifacts.some(a => a.key === e.targetKey))
  for (const edge of preserved) {
    await prisma.storyArtifactLink.upsert({ where: { novelId_sourceKey_targetKey: { novelId: before.story.novelId, sourceKey: edge.sourceKey, targetKey: edge.targetKey } },
      create: { novelId: before.story.novelId, sourceKey: edge.sourceKey, targetKey: edge.targetKey, reason: edge.reason, sourceHash: old.get(edge.sourceKey)!, targetHash: old.get(edge.targetKey)! }, update: {} })
  }
  for (const artifact of [...changed.filter(a => old.has(a.key) && a.kind !== "worldline" && a.kind !== "narrative"), ...removed]) {
    if (removed.includes(artifact) && ![...graph.edges, ...preserved].some(e => e.sourceKey === artifact.key)) {
      const possible = graph.artifacts.filter(a => artifact.title.length > 1 && a.text.includes(artifact.title)).map(({ text, ...a }) => ({ ...a, excerpt: text.slice(0, 600) }))
      if (possible.length) impacts.push({ source: { key: artifact.key, title: artifact.title, deleted: true }, affected: [], possible, instruction: "原产物已删除；逐项核对仍提及它的内容，多解请作者选择" })
      continue
    }
    const impact = await storyImpact(before.story, artifact.key)
    if (impact.affected.length || impact.possible.length) impacts.push(impact)
  }
  return { ...output, storyFocus: focus ? { ...focus, text: undefined } : undefined, storyWorkflow: { checks, impacts, changedKeys: changed.filter(a => !["world-event", "narrative-card"].includes(a.kind) && (a.kind !== "chapter-content" || a.text.trim())).map(a => a.key), next: "本子任务完成后调用completeStoryTask检查最终版本并给出自由下一步；不重复阶段认可。上游修改须核对实际影响项。" } }
}
