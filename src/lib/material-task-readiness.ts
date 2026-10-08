import type { ChatAction } from "./chat-parts"
import { materialTaskChapterIds } from "./story-task"

export interface MaterialTaskReadCall { toolName: string; input: unknown; output: unknown; status?: string }
export interface MaterialTaskCurrentChapter { id: string; version: number; content: string; outline: string }
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim()
const outlineText = (value: unknown) => text(value) && !["（大纲为空）", "（章纲为空）", "（尚未生成大纲）"].includes(value.trim())

/** 仅对明确选了正式正文的物品/场景任务限制写入，不扩大任何写入权限。 */
export function materialTaskNeedsReadGate(action: ChatAction | null | undefined, toolName: string): boolean {
  return action?.kind === "storyTask" && materialTaskChapterIds(action).length > 0
    && ["createItem", "createScene", "updateItem", "updateScene"].includes(toolName)
}

/** 输入齐备不等于语义完备；只接受本回合成功工具的真实全文及目录输出。 */
export function materialTaskReadiness(action: ChatAction | null | undefined, calls: readonly MaterialTaskReadCall[], currentChapters?: readonly MaterialTaskCurrentChapter[]): { chapterIds: string[]; outlineKeys: string[]; missing: string[] } | undefined {
  if (action?.kind !== "storyTask") return
  const chapterIds = materialTaskChapterIds(action)
  if (!chapterIds.length) return
  const outlineKeys = [...new Set(action.scope?.sourceKeys.filter(key => key.startsWith("chapter-outline:")) ?? [])]
  const has = (toolName: string, valid: (call: MaterialTaskReadCall) => boolean) => calls.some(call => call.toolName === toolName
    && (call.status === undefined || call.status === "succeeded") && call.output !== null && call.output !== undefined
    && object(call.output)?.ok !== false && valid(call))
  const missing: string[] = []
  for (const chapterId of chapterIds) {
    const current = currentChapters?.find(chapter => chapter.id === chapterId)
    if (!has("getChapterContent", call => {
      const output = object(call.output)
      return object(call.input)?.chapterId === chapterId && output?.chapterId === chapterId
        && Number.isInteger(output.version) && (output.version as number) > 0
        && text(output.content) && output.content.trim() !== "（正文为空）"
        && (currentChapters === undefined || !!current && output.version === current.version && output.content === current.content)
    })) missing.push(`getChapterContent(chapterId=${chapterId})`)
  }
  for (const key of outlineKeys) {
    const chapterId = key.slice("chapter-outline:".length)
    const current = currentChapters?.find(chapter => chapter.id === chapterId)
    const read = has("getStoryArtifact", call => {
      const output = object(call.output), artifact = object(output?.artifact)
      return object(call.input)?.key === key && output?.ok === true && artifact?.key === key && outlineText(artifact.text)
        && (currentChapters === undefined || !!current && artifact.text === current.outline)
    }) || has("getOutline", call => Array.isArray(call.output) && call.output.some(volume => {
      const chapters = object(volume)?.chapters
      return Array.isArray(chapters) && chapters.some(chapter => {
        const row = object(chapter)
        return row?.id === chapterId && outlineText(row.outline) && (currentChapters === undefined
          || !!current && row.version === current.version && row.outline === current.outline)
      })
    }))
    if (!read) missing.push(`getStoryArtifact(key=${key}) 或 getOutline`)
  }
  for (const [toolName, emptyMessage] of [["listItems", "（暂无物品，可用 createItem 创建）"], ["listScenes", "（暂无场景，可用 createScene 创建）"]]) {
    if (!has(toolName, call => call.output === emptyMessage || Array.isArray(call.output)
      && call.output.every(row => text(object(row)?.id) && text(object(row)?.name)))) missing.push(toolName)
  }
  return { chapterIds, outlineKeys, missing }
}

export function materialTaskReadinessMessage(missing: readonly string[]): string {
  return `已选正文的材料任务尚缺当前成功读取回执：${missing.join("；")}。先读取或重新读取所选正式正文全文、范围内当前章纲及物品/场景目录并逐项对照，已有档案先复用；只补实际关键缺项，事实矛盾先有限提案等待作者采用。读取齐备不代表语义完备，不改正文、不自动批准。`
}
