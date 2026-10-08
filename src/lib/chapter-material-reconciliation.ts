import type { ChatAction } from "./chat-parts"
import type { StoryTaskAction } from "./story-task"

export const CHAPTER_MATERIAL_RECONCILIATION_LABEL = "核对本章资料与伏笔"
export const CHAPTER_MATERIAL_RECONCILIATION_DESCRIPTION = "只读取本章已采用正文、当前章纲及实际讲述/关联事件。核对档案/规划与正文一致性；矛盾先报告有限修订提案，待作者采用，不视正文为世界真相或自动改既存设定。复用档案，仅补实际缺失关键物品/场景；引用经proposeNovelPlanning提案并由作者采用。伏笔按故事顺序及正文真实埋提收，用listForeshadows核对去重后addForeshadowTouch登记；不按未采用候选/未来章登记，不改正文、不定稿、不提前揭谜。完成后复查并给出下一步。"
const requirements = `${CHAPTER_MATERIAL_RECONCILIATION_LABEL}。${CHAPTER_MATERIAL_RECONCILIATION_DESCRIPTION}`

/** 仅匹配服务器固定选项消费后的 action；目录 custom 与任意写入不享有核对收尾例外。 */
export function chapterMaterialReconciliationChapterId(action: ChatAction | null | undefined): string | undefined {
  if (action?.kind !== "storyTask" || action.task !== "custom" || action.requirements !== requirements) return
  const target = action.targetKey
  if (!target?.startsWith("chapter-content:") || action.sourceKey !== target) return
  const chapterId = target.slice("chapter-content:".length)
  const scope = action.scope
  if (!chapterId || !scope || scope.targetKeys.length || scope.sourceKeys[0] !== target) return
  if (scope.sourceKeys.length !== 1 && (scope.sourceKeys.length !== 2 || scope.sourceKeys[1] !== `chapter-outline:${chapterId}`)) return
  if (Object.entries(scope).some(([key, value]) => value !== undefined && !["targetKeys", "sourceKeys"].includes(key))) return
  return chapterId
}

/** 服务器消费固定选项时，以该正文作为核对来源；其他任务保留原结果溯源。 */
export function withChapterMaterialReconciliationSource(action: StoryTaskAction): StoryTaskAction {
  const candidate = { ...action, sourceKey: action.targetKey }
  return chapterMaterialReconciliationChapterId(candidate) ? candidate : action
}

export interface ReconciliationToolCall { toolName: string; input: unknown; output: unknown }
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim()

/** 读取闸只验证真实核对输入齐备；语义缺项仍须通过正常档案/规划工具补齐并独立检测。 */
export function chapterMaterialReconciliationReads(action: ChatAction | null | undefined, calls: readonly ReconciliationToolCall[]): { chapterId: string; missing: string[] } | undefined {
  const chapterId = chapterMaterialReconciliationChapterId(action)
  if (!chapterId || action?.kind !== "storyTask") return
  const success = (call: ReconciliationToolCall) => call.output !== null && call.output !== undefined && object(call.output)?.ok !== false
  const has = (toolName: string, valid: (call: ReconciliationToolCall) => boolean) => calls.some(call => call.toolName === toolName && success(call) && valid(call))
  const missing: string[] = []
  if (!has("getChapterContent", call => {
    const output = object(call.output)
    return object(call.input)?.chapterId === chapterId && output?.chapterId === chapterId && Number.isInteger(output.version) && nonempty(output.content) && output.content !== "（正文为空）"
  })) missing.push(`getChapterContent(chapterId=${chapterId})`)
  if (!has("getNovelPlanning", call => {
    const output = object(call.output), result = object(output?.result), data = object(result?.data)
    return output?.ok === true && Number.isInteger(result?.version) && Array.isArray(data?.cards) && Array.isArray(data?.events)
      && Array.isArray(data?.chapters) && data.chapters.some(chapter => object(chapter)?.id === chapterId)
  })) missing.push("getNovelPlanning")
  if (action.scope?.sourceKeys.includes(`chapter-outline:${chapterId}`)) {
    const outlineRead = has("getStoryArtifact", call => {
      const output = object(call.output), artifact = object(output?.artifact)
      return object(call.input)?.key === `chapter-outline:${chapterId}` && output?.ok === true && artifact?.key === `chapter-outline:${chapterId}` && nonempty(artifact.text)
    }) || has("getOutline", call => Array.isArray(call.output) && call.output.some(volume => {
      const chapters = object(volume)?.chapters
      return Array.isArray(chapters) && chapters.some(chapter => object(chapter)?.id === chapterId && nonempty(object(chapter)?.outline))
    }))
    if (!outlineRead) missing.push(`getStoryArtifact(key=chapter-outline:${chapterId}) 或 getOutline`)
  }
  for (const [toolName, emptyMessage] of [["listItems", "（暂无物品，可用 createItem 创建）"], ["listScenes", "（暂无场景，可用 createScene 创建）"]]) {
    if (!has(toolName, call => Array.isArray(call.output) || call.output === emptyMessage)) missing.push(toolName)
  }
  if (!has("listForeshadows", call => {
    const input = object(call.input), output = object(call.output)
    return input?.chapterId === chapterId && input.status === undefined && output?.ok === true && nonempty(output.message)
  })) missing.push(`listForeshadows(chapterId=${chapterId}，不按status过滤)`)
  return { chapterId, missing }
}
