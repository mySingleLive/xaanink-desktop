import { z } from "zod"
import { workflowApprovalSchema, type StoryCheckpoint } from "./story-workflow"

export const STORY_TASK_KINDS = ["world", "character", "plot", "arc", "outline", "writing", "improve", "discuss", "choose", "outline-board", "next-plot", "sample-outline", "scene", "item", "custom", "revise", "prepare-writing", "chapter-boards"] as const
export const storyTaskKindSchema = z.enum(STORY_TASK_KINDS)
const keySchema = z.string().min(3).max(160)
export const taskScopeSchema = z.object({
  targetKeys: z.array(keySchema).max(20).default([]), sourceKeys: z.array(keySchema).max(20).default([]),
  nextVolumeIndex: z.number().int().positive().optional(),
  anchorKey: keySchema.optional(), stageIds: z.array(z.string()).max(50).optional(),
  intendedNames: z.array(z.string().min(1).max(100)).max(20).optional(),
  boardType: z.enum(["chapter", "outline"]).optional(), volumeKey: keySchema.optional(),
  worldKey: keySchema.optional(), category: z.string().max(50).optional(),
  arcMode: z.enum(["create", "append", "replace"]).optional(), structure: z.string().max(100).optional(),
})
export type TaskScope = z.infer<typeof taskScopeSchema>
export const navigationEntitySchema = z.object({ key: keySchema, title: z.string(), kind: z.string(), hash: z.string(), worldId: z.string().nullable().optional(), primary: z.boolean().optional(), tellingCardCount: z.number().int().nonnegative().optional(), stages: z.array(z.object({ id: z.string(), name: z.string() })).optional() })
export type NavigationEntity = z.infer<typeof navigationEntitySchema>
export const storySelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("choice"), choiceId: z.string().min(1).max(300) }),
  z.object({ kind: z.literal("catalog"), taskId: z.enum(["character", "arc", "world", "plot", "scene", "item", "outline", "custom", "revise"]), scope: taskScopeSchema, requirements: z.string().max(4000) }),
])
export type StorySelection = z.infer<typeof storySelectionSchema>
export const storyTaskActionSchema = z.object({
  kind: z.literal("storyTask"), task: storyTaskKindSchema,
  scope: taskScopeSchema.optional(), requirements: z.string().max(4000).optional(),
  targetKey: z.string().min(3).max(160).optional(),
  /** 原任务结果，仅供溯源；不能当成下一任务的写入目标。 */
  sourceKey: z.string().min(3).max(160).optional(),
  wordCount: z.number().int().min(800).max(8000).optional(),
})
export type StoryTaskAction = z.infer<typeof storyTaskActionSchema>
/** 目录任务的参考源，与客户端可选范围及服务端校验复用。 */
export const STORY_TASK_SOURCE_KINDS: Readonly<Record<string, readonly string[]>> = {
  arc: ["narrative", "chapter-outline"], world: ["setting"], plot: ["worldline", "world-event", "narrative"],
  scene: ["narrative", "character", "chapter-outline", "chapter-content"], item: ["character", "chapter-outline", "chapter-content"], outline: ["narrative"],
}
export function materialChapterReferenceOptions(entities: NavigationEntity[]): NavigationEntity[] {
  return entities.filter(entity => ["chapter-outline", "chapter-content"].includes(entity.kind))
    .map(entity => ({ ...entity, title: `${entity.title}（${entity.kind === "chapter-content" ? "已采用正文" : "章纲"}）` }))
}
export function materialTaskChapterIds(action: StoryTaskAction | null | undefined): string[] {
  if (!action || !["item", "scene"].includes(action.task)) return []
  return [...new Set((action.scope?.sourceKeys ?? []).filter(key => key.startsWith("chapter-content:")).map(key => key.slice("chapter-content:".length)).filter(Boolean))]
}
export const storyTaskChoiceSchema = z.object({
  id: z.string().optional(), scope: taskScopeSchema.optional(),
  label: z.string().min(1).max(200), description: z.string().max(300),
  task: storyTaskKindSchema, accept: z.boolean(),
  targetKey: z.string().min(3).max(160).optional(), wordCount: z.number().int().min(800).max(8000).optional(),
})
export const MAX_STORY_TASK_CHOICES = 5
export const storyTaskNavigationSchema = z.object({
  schemaVersion: z.literal(2).optional(), accepted: z.boolean().optional(),
  entities: z.array(navigationEntitySchema).optional(), contextHash: z.string().optional(),
  verifiedProgress: z.array(z.string()).optional(),
  targets: z.array(workflowApprovalSchema).min(1).max(20),
  choices: z.array(storyTaskChoiceSchema).max(MAX_STORY_TASK_CHOICES),
  shortcuts: z.array(storyTaskChoiceSchema).max(3).default([]),
  title: z.string().max(200), score: z.number().nullable(), threshold: z.number(),
  structureChecked: z.boolean().optional(),
})
export type StoryTaskNavigation = z.infer<typeof storyTaskNavigationSchema>
export function canContinueImproving(checkpoint: StoryCheckpoint | undefined, hash: string) {
  // 改进不是认可：低分与可修复的阻塞意见正是改进入口最需要覆盖的情况。
  return !!checkpoint && checkpoint.hash === hash && checkpoint.score !== null && !checkpoint.issues.some(issue => issue.needsAuthor)
}
export function storyAnswer(message: string) { return message.match(/\n我的回答：([^\n]*)$/u)?.[1].trim() }
export function selectedStoryChoice(navigation: StoryTaskNavigation, message: string) {
  const answer = storyAnswer(message)
  return [...navigation.choices, ...navigation.shortcuts].find(choice => choice.label === answer)
}
export const STORY_TASK_LABELS: Record<StoryTaskAction["task"], string> = {
  "prepare-writing": "核对正文写作条件", "chapter-boards": "生成章节剧情故事板",
  "outline-board": "搭建剧情大纲（故事板）", "next-plot": "推荐后续剧情", "sample-outline": "生成故事板样纲", scene: "创建新场景", item: "创建新物品", custom: "指定新的任务范围", revise: "修改已有内容",
  world: "补世界设定", character: "创建角色", plot: "先搭剧情", arc: "设计角色弧线", outline: "整理本章大纲", writing: "开始本章写作", improve: "继续改进", discuss: "修改这一版", choose: "选择下一任务",
}
// chapter-boards / outline-board / sample-outline 为故事板退役任务：枚举与标签保留（历史 ChatTurn.interaction 正常展示），不再进入目录/推荐/快捷，也不再有工具提示。
export const STORY_TASK_TOOL_HINTS: Partial<Record<StoryTaskAction["task"], string[]>> = {
  "prepare-writing": ["getOutline", "getStoryWorkflow", "reviewStoryCheckpoint", "askUserQuestion"],
  "next-plot": ["getNovelPlanning", "proposeNovelPlanning", "applyNovelPlanningProposal", "getStoryImpact", "askUserQuestion"],
  scene: ["createScene", "getWorlds"], item: ["createItem", "getWorlds"], custom: ["getStoryWorkflow", "askUserQuestion", "loadCreationTools"],
  revise: ["getStoryArtifact", "getStoryImpact", "loadCreationTools"],
  world: ["getWorlds", "createWorld", "updateWorld", "upsertSetting"], character: ["createCharacter", "getCharacter", "updateCharacter"],
  plot: ["getNovelPlanning", "proposeNovelPlanning", "applyNovelPlanningProposal", "getStoryImpact", "askUserQuestion"], arc: ["getCharacter", "getNovelPlanning", "generateCharacterArc"],
  outline: ["getNovelPlanning", "getNarrativeChapter", "proposeNovelPlanning", "applyNovelPlanningProposal", "askUserQuestion", "approveOutline", "linkStoryArtifacts"], writing: ["getOutline", "approveOutline", "generateChapterContent", "requestContentApproval"],
  improve: ["getWorlds", "updateWorld", "getStoryArtifact", "reviewStoryCheckpoint", "getStoryImpact", "improveChapterContent", "updateChapterOutline", "updateCharacter", "upsertSetting"], discuss: [], choose: ["askUserQuestion"],
}
