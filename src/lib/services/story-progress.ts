import { currentChatExecution } from "@/lib/chat-execution"
import { readStoryArtifacts } from "./story-artifacts"

/** 嵌套生成刚落库就展示实际产物，不必等后续评审/改进整轮结束。 */
export async function publishStoryArtifact(novelId: string, key: string) {
  const execution = currentChatExecution()
  if (!execution?.progress) return
  const graph = await readStoryArtifacts({ novelId, userId: execution.userId })
  const artifact = graph.artifacts.find(a => a.key === key)
  if (artifact) execution.progress({ storyFocus: { ...artifact, text: undefined }, saved: true })
}
