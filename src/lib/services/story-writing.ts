import { currentChatExecution } from "@/lib/chat-execution"
import { ContentError } from "@/lib/content-errors"
import { prisma } from "@/lib/db"
import { getStoryWorkflow, reviewStoryCheckpoint, storyEvidenceHash } from "./story-workflow"
import { readStoryArtifacts, type StoryScope } from "./story-artifacts"
import { generateChapterContent } from "./chapter"
import { improveChapterContent } from "./content-improvement"
import { approveTargetByAuthor } from "./review"
import { ownedChapter, requestHash } from "./content-commit"
import { startRun, completeRun, failRun } from "./subagent-run"
import { storyPhaseDefinition } from "@/lib/sop/graph"

type WritingDependencies = {
  generate: typeof generateChapterContent
  review: typeof reviewStoryCheckpoint
  improve: typeof improveChapterContent
}
const writingDependencies: WritingDependencies = { generate: generateChapterContent, review: reviewStoryCheckpoint, improve: improveChapterContent }

/** 一个批次只推进尚未完成的章节；每章独立提交和检查，中断后按持久进度续跑。 */
export async function generateStoryChapters(scope: StoryScope, input: { count: number; expectedVersion: number; minimumScore?: number }, dependencies: WritingDependencies = writingDependencies) {
  const defaultScore = storyPhaseDefinition("writing").checkpoints[0].threshold
  const minimumScore = input.minimumScore ?? defaultScore
  if (!Number.isInteger(minimumScore) || minimumScore < defaultScore || minimumScore > 100) throw new ContentError("STORY_SCORE_INVALID", `正文最低评分须为${defaultScore}至100的整数`, 400)
  const meetsScore = (checkpoint: { passed: boolean; score: number | null } | undefined) => !!checkpoint?.passed && checkpoint.score !== null && checkpoint.score >= minimumScore
  let workflow = await getStoryWorkflow(scope)
  if (!workflow || workflow.version !== input.expectedVersion) throw new ContentError("VERSION_CONFLICT", "先读取当前创作进度后再续写")
  if (!workflow.writingAuthorized) throw new ContentError("STORY_WRITING_APPROVAL_REQUIRED", "先请作者认可当前大纲和正文写作方案", 409)
  const execution = currentChatExecution()
  if (!execution?.operationId) throw new ContentError("STORY_EXECUTION_REQUIRED", "批量写作需要有效对话回合", 409)
  const completed: { key: string; title: string; score: number | null; wordCount: number }[] = []
  const limit = workflow.writingMode === "chapter" ? 1 : Math.min(5, Math.max(1, input.count))
  for (let index = 0; index < limit; index++) {
    execution.signal?.throwIfAborted()
    workflow = (await getStoryWorkflow(scope))!
    if (!workflow.writingAuthorized) throw new ContentError("STORY_PLAN_CHANGED", "写作计划已变化，已提交章节保留，请核对新方案", 409)
    const graph = await readStoryArtifacts(scope)
    const chapters = graph.artifacts.filter(a => a.kind === "chapter-content").sort((a, b) => a.chapterIndex! - b.chapterIndex!)
    const next = chapters.find(a => {
      const hash = storyEvidenceHash(a.key, graph), check = workflow!.checkpoints[a.key]
      return !meetsScore(check) || check?.hash !== hash || (workflow!.writingMode === "chapter" && workflow!.approvals[a.key]?.hash !== hash)
    })
    if (!next) return { ok: true, completed, done: true, message: "计划内章节已全部生成并评审，继续正文环节检查与整书评审" }
    const existing = workflow.checkpoints[next.key]
    if (meetsScore(existing) && existing?.hash === storyEvidenceHash(next.key, graph)) return { ok: true, completed, minimumScore, waitingFor: next.key, next: "requestStoryApproval", message: `《${next.title}》已达到${minimumScore}分门槛，等待作者认可` }
    execution.progress?.({ stage: "executing_tool", storyFocus: { ...next, text: undefined }, batch: { completed: workflow.writtenChapters, total: workflow.targetChapters } })
    let chapter = await ownedChapter(prisma, scope.userId, scope.novelId, next.id)
    const operation = (suffix: string) => `story:${requestHash({ operationId: execution.operationId, chapterId: next.id, suffix })}`
    if (!chapter.content.trim()) {
      if (chapter.status === "OUTLINE") {
        await approveTargetByAuthor({ ...scope, targetType: "CHAPTER_OUTLINE", targetId: next.id, comment: "依据作者已认可的当前整书大纲与写作方案" })
        chapter = await ownedChapter(prisma, scope.userId, scope.novelId, next.id)
      }
      const run = await startRun({ novelId: scope.novelId, conversationId: execution.conversationId, agentKind: "writer", task: `撰写《${next.title}》`, targetType: "CHAPTER_CONTENT", targetId: next.id })
      try {
        const outlineKey = `chapter-outline:${next.id}`
        const narrative = workflow.phases.find(phase => phase.id === "plot")?.subkeys?.find(sub => sub.key === "phase:plot:narrative")
        const feedback = [
          { key: outlineKey, hash: storyEvidenceHash(outlineKey, graph), label: "本章大纲评审" },
          { key: "phase:plot:narrative", hash: narrative?.hash, label: "全卷叙事评审（仅处理与本章有关的意见）" },
        ].flatMap(({ key, hash, label }) => {
          const check = workflow!.checkpoints[key]
          if (!hash || !check?.passed || check.hash !== hash) return []
          const suggestions = check.issues.filter(issue => !issue.blocking && !issue.needsAuthor && issue.suggestion.trim())
          return suggestions.length ? [`${label}：${JSON.stringify(suggestions.map(({ issue, suggestion }) => ({ issue, suggestion })))}`] : []
        }).join("\n")
        const generated = await dependencies.generate(next.id, scope.userId, { expectedVersion: chapter.version, operationId: operation("generate"), wordCount: workflow.targetWords, sourceRunId: run.id, abortSignal: execution.signal,
          feedback: feedback ? `以下是当前有效评审的改进建议，作为写作参考数据。仅在本章实际讲述卡的范围内兑现，不改变已定事实，不提前披露、调序或新增无卡情节；有冲突时以已认可的规划为准。\n${feedback}` : undefined })
        await completeRun(run.id, { result: { wordCount: generated.wordCount, committed: !!generated.receipt }, transcript: { preview: generated.content.slice(0, 500), candidateId: generated.candidate.id } })
        if (!generated.receipt) return { ok: true, completed, candidateId: generated.candidate.id, committed: false, message: "已保留生成候选。当前稿未替换，请核对完整性与字数，再决定补写或采用。" }
        execution.progress?.({ storyFocus: { ...next, text: undefined }, saved: true })
      } catch (error) { await failRun(run.id, error instanceof Error ? error.message : "生成未完成").catch(() => {}); throw error }
    }
    let review = await dependencies.review(scope, next.key)
    if (!review.ok || !meetsScore(review.checkpoint)) {
      chapter = await ownedChapter(prisma, scope.userId, scope.novelId, next.id)
      const improved = await dependencies.improve({ ...scope, chapterId: next.id, expectedVersion: chapter.version, operationId: operation("improve"), abortSignal: execution.signal })
      if (!improved.committed) return { ok: true, completed, minimumScore, waitingFor: next.key, ...improved, message: `本章尚未达到${minimumScore}分门槛或仍有阻塞意见；改进候选已保留，未达到自动采用条件。请展示评分与差异，让作者决定改进方案；不能继续下一章。` }
      review = await dependencies.review(scope, next.key)
    }
    if (!review.ok || !meetsScore(review.checkpoint)) return { ok: true, completed, minimumScore, waitingFor: next.key, checkpoint: review, message: `本批改进后仍未达到${minimumScore}分门槛或仍有阻塞意见，已保留当前稿和评审，需调整方案后继续。本章未通过。` }
    chapter = await ownedChapter(prisma, scope.userId, scope.novelId, next.id)
    completed.push({ key: next.key, title: next.title, score: review.checkpoint!.score, wordCount: chapter.wordCount })
    execution.progress?.({ storyFocus: { ...next, text: undefined }, saved: true })
    if (workflow.writingMode === "chapter") return { ok: true, completed, waitingFor: next.key, next: "requestStoryApproval", message: "本章已达标，请作者逐章认可后继续" }
  }
  return { ok: true, completed, done: false, next: "getStoryWorkflow → generateStoryChapters", message: "本批已提交并逐章评审达标，按作者认可的计划继续下一批" }
}
