import { z } from "zod"
import { STORY_PHASES, type StoryPhase } from "./sop/graph"

export const storyPhaseSchema = z.enum(["brainstorm", "settings", "plot", "skeleton", "outline", "writing", "revision"])
export type StoryPhaseValue = z.infer<typeof storyPhaseSchema>
/** 存量 skeleton 环节归并到 outline 展示（只读兼容）；写路径拒绝（updateStoryWorkflow/reopenStoryPhase 返回 400）。 */
export function normalizeStoryPhase(phase: StoryPhaseValue): StoryPhase {
  return phase === "skeleton" ? "outline" : phase
}
export const STORY_ARTIFACT_KINDS = ["worldline", "world-event", "narrative", "narrative-card", "theme", "world", "setting", "character", "scene", "item", "trope", "attribute", "foreshadow", "volume", "chapter-outline", "chapter-content"] as const
export type StoryArtifactKind = typeof STORY_ARTIFACT_KINDS[number]
export interface StoryArtifact {
  key: string; kind: StoryArtifactKind; id: string; title: string; hash: string; text: string; phase: StoryPhase
  settingType?: string; worldId?: string | null; worldTitle?: string; chapterIndex?: number
}
export interface StoryEdge { sourceKey: string; targetKey: string; reason: string; sourceHash?: string; targetHash?: string; id?: string }

/** plot 环节双检查点子键（phase:plot:worldline / phase:plot:narrative）；不设独立 phase:plot 键。 */
export const PLOT_SUB_KEYS = ["worldline", "narrative"] as const
export type PlotSubKey = typeof PLOT_SUB_KEYS[number]
export const plotCheckpointKey = (sub: PlotSubKey) => `phase:plot:${sub}`

/** 检查点键解析：先匹配 plot 子键，再匹配 phase:<环节>；非法键返回 null（调用方转 404 ContentError，不抛 ZodError）。 */
export function parseCheckpointKey(key: string): { phase: StoryPhase; sub?: PlotSubKey } | null {
  for (const sub of PLOT_SUB_KEYS) if (key === plotCheckpointKey(sub)) return { phase: "plot", sub }
  if (!key.startsWith("phase:")) return null
  const parsed = storyPhaseSchema.safeParse(key.slice(6))
  if (!parsed.success || parsed.data === "skeleton") return null
  return { phase: parsed.data }
}
export const storyCheckpointSchema = z.object({
  hash: z.string(), score: z.number().min(0).max(100).nullable(), passed: z.boolean(), summary: z.string(),
  issues: z.array(z.object({ issue: z.string(), suggestion: z.string(), needsAuthor: z.boolean().default(false), blocking: z.boolean().optional() })),
  dimensions: z.array(z.object({ dimension: z.string(), score: z.number().min(0).max(100) })).default([]),
  at: z.string(), runId: z.string().optional(), iteration: z.number().int().nonnegative(),
  /** structure-only：只做结构检查的环节（脑洞），无 AI 打分 */
  reviewPolicy: z.enum(["ai", "structure-only"]).optional(),
  /** instance-loop：实例回炉收敛证据直接作为检查点，同指纹不再独立评审 */
  source: z.enum(["instance-loop"]).optional(),
  coverage: z.object({ artifactCount: z.number().int().nonnegative(), partCount: z.number().int().positive(), runIds: z.array(z.string()) }).optional(),
})
export type StoryCheckpoint = z.infer<typeof storyCheckpointSchema>
export const storyApprovalSchema = z.object({ hash: z.string(), at: z.string(), messageId: z.string(), wordCount: z.number().int().positive().optional() })
export const storyApprovalsSchema = z.record(z.string(), storyApprovalSchema)
export const storyCheckpointsSchema = z.record(z.string(), storyCheckpointSchema)
export const storyRevisionSchema = z.object({ id: z.string(), phase: storyPhaseSchema, reason: z.string(), at: z.string() })
export const workflowApprovalSchema = z.object({ key: z.string().min(1), hash: z.string().min(1), version: z.number().int().positive() })
export const STORY_APPROVE_ANSWER = "认可这一版，继续"
export const STORY_REVISE_ANSWER = "需要修改，我来说明"
/** 认可卡的第三个真实选项：按评审意见改进（不认可、不自由说明，直接进入改进流程） */
export const STORY_IMPROVE_ANSWER = "按评审意见改进"
export const STORY_APPROVAL_OPTIONS = [STORY_APPROVE_ANSWER, STORY_IMPROVE_ANSWER, STORY_REVISE_ANSWER] as const
export type StoryPhaseStatus = "empty" | "review" | "improve" | "approval" | "passed" | "stale"
export interface StoryWorkflowView {
  novelId: string; version: number; phase: StoryPhase; brief: string; writingMode: "chapter" | "batch"; targetChapters: number; targetWords: number
  writingPolicyHash: string; writingAuthorized: boolean
  checkpoints: Record<string, StoryCheckpoint>; approvals: z.infer<typeof storyApprovalsSchema>; revisions: z.infer<typeof storyRevisionSchema>[]
  phases: { id: StoryPhase; label: string; status: StoryPhaseStatus; hash: string; score: number | null; blockers: string[]; threshold: number
    /** plot 环节的双检查点（worldline/narrative）；其他环节无此字段 */
    subkeys?: { key: string; label: string; status: StoryPhaseStatus; hash: string; score: number | null; blockers: string[] }[] }[]
  artifacts: (Omit<StoryArtifact, "text"> & { evidenceHash: string })[]; pendingApprovals: string[]; staleLinks: StoryEdge[]; chapterCount: number; writtenChapters: number; wordCount: number
}
export const STORY_PHASE_STATUS = { empty: "未开始", review: "待评审", improve: "待改进", approval: "待你确认", passed: "已通过", stale: "来源已变化" } as const

/** 显式边和已有领域关系同图求闭包，去重并防环。 */
export function storyReachable(keys: string[], edges: StoryEdge[], reverse = false): Set<string> {
  const found = new Set(keys), queue = [...keys]
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const from = reverse ? edge.targetKey : edge.sourceKey, to = reverse ? edge.sourceKey : edge.targetKey
    const list = adjacency.get(from) ?? []; list.push(to); adjacency.set(from, list)
  }
  for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]) ?? []) if (!found.has(next)) { found.add(next); queue.push(next) }
  keys.forEach(key => found.delete(key))
  return found
}
export function phaseIncludes(phase: StoryPhase, artifactPhase: StoryPhase) {
  return STORY_PHASES.findIndex(p => p.id === artifactPhase) <= STORY_PHASES.findIndex(p => p.id === phase)
}
export function staleStoryEdges(artifacts: Pick<StoryArtifact, "key" | "hash">[], edges: StoryEdge[]) {
  const hashes = new Map(artifacts.map(a => [a.key, a.hash]))
  return edges.filter(e => !hashes.has(e.sourceKey) || !hashes.has(e.targetKey) || (e.sourceHash !== undefined && hashes.get(e.sourceKey) !== e.sourceHash))
}

/** 服务端固定问题的真实回答才能批准；不能将问题文本中的“认可”误判为回答。 */
export function isStoryApprovalAnswer(message: string) {
  const match = message.match(/\n我的回答：([^\n]*)$/u)
  return match?.[1].trim() === STORY_APPROVE_ANSWER
}
