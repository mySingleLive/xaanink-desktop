import type { StoryCheckpoint, StoryWorkflowView } from "@/lib/story-workflow"

/** 详情仍保存在评审记录中；普通旧建议按需重读，阻塞和待作者决定的意见保持原文。 */
export function summarizeCheckpoint(key: string, checkpoint: StoryCheckpoint) {
  if (!checkpoint.runId) return checkpoint
  const retained = checkpoint.issues.filter(issue => issue.blocking || issue.needsAuthor)
  if (retained.length === checkpoint.issues.length) return checkpoint
  return { ...checkpoint, issues: retained, issueCount: checkpoint.issues.length,
    feedbackReference: { key, hash: checkpoint.hash, runId: checkpoint.runId,
      omittedOrdinaryIssues: checkpoint.issues.length - retained.length,
      instruction: "普通评审建议已保存。修改前用getStoryArtifact({key})读取当前完整检查点；此历史分数不是当前通过证明。" } }
}

/** 面向参谋的进度索引，不改变服务层或UI使用的完整工作流。 */
export function summarizeStoryWorkflow(view: StoryWorkflowView | null) {
  if (!view) return null
  const hashes = new Map(view.artifacts.map(artifact => [artifact.key, artifact.evidenceHash]))
  for (const phase of view.phases) {
    hashes.set(`phase:${phase.id}`, phase.hash)
    for (const sub of phase.subkeys ?? []) hashes.set(sub.key, sub.hash)
  }
  const artifacts = view.artifacts.map(artifact => {
    const checkpoint = view.checkpoints[artifact.key]
    const current = !!checkpoint && checkpoint.hash === artifact.evidenceHash
    const status = !checkpoint ? "unreviewed" : !current ? "stale" : checkpoint.passed ? "passed" : "improve"
    return { ...artifact, review: { status, current, score: current ? checkpoint.score : null } }
  })
  const progress = (kind: "chapter-outline" | "chapter-content") => {
    const targets = artifacts.filter(artifact => artifact.kind === kind)
    const keys = (status: string) => targets.filter(artifact => artifact.review.status === status).map(artifact => artifact.key)
    return { total: targets.length, passed: keys("passed"), stale: keys("stale"), unreviewed: keys("unreviewed"), improve: keys("improve") }
  }
  return { ...view, artifacts, checkpoints: Object.fromEntries(Object.entries(view.checkpoints).map(([key, checkpoint]) =>
    [key, { ...summarizeCheckpoint(key, checkpoint), current: hashes.get(key) === checkpoint.hash }])),
    reviewProgress: { outlines: progress("chapter-outline"), content: progress("chapter-content") },
    reviewInstruction: "只有当前指纹且passed的评审有效。reviewProgress逐章列出实际过期、待评审、待改进项；不能只复评直接改动的章节就宣称全卷通过。普通评审意见详情用getStoryArtifact({key})按目标读取。" }
}
