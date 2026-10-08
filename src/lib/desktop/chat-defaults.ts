import type { Settings } from "@desktop/core/settings"
import type { ChatSessionEntry } from "@/lib/chat-session"
import type { ChatMode, ModelChoice } from "@/stores/chat"

export interface ChatChoices {
  modelChoice: ModelChoice
  modelChoiceExplicit: boolean
  mode: ChatMode
  modeExplicit: boolean
}
type DraftChoices = ChatChoices & { conversationId: string | null }

/** The preview is not a task snapshot. Main captures all five defaults together
 * when accepting the first send; omitted properties retain that boundary. */
export function newChatChoices(agent: Settings["agent"]): ChatChoices {
  return { modelChoice: { modelId: agent.textModelId, effort: agent.thinking === "default" ? null : agent.thinking },
    modelChoiceExplicit: false, mode: agent.mode, modeExplicit: false }
}
export function inheritedChatChoices(state: DraftChoices, agent: Settings["agent"]): Partial<ChatChoices> {
  if (state.conversationId) return {}
  const defaults = newChatChoices(agent)
  return { modelChoice: state.modelChoiceExplicit ? state.modelChoice : defaults.modelChoice,
    mode: state.modeExplicit ? state.mode : defaults.mode }
}
export function restoreChatChoices(entry: ChatSessionEntry, agent: Settings["agent"]): ChatChoices {
  const explicitModel = !!entry.conversationId || (entry.modelChoiceExplicit ?? entry.modelChoice.modelId !== null)
  const explicitMode = !!entry.conversationId || (entry.modeExplicit ?? entry.mode !== undefined)
  const defaults = newChatChoices(agent)
  return { modelChoice: explicitModel ? entry.modelChoice : defaults.modelChoice, modelChoiceExplicit: explicitModel,
    mode: explicitMode ? entry.mode ?? "standard" : defaults.mode, modeExplicit: explicitMode }
}
export function chatTaskOverrides(state: DraftChoices, retry = false): { modelId?: string | null; thinkingEffort?: string | null; mode?: ChatMode } {
  if (retry) return {}
  return { ...(state.conversationId || state.modelChoiceExplicit ? { modelId: state.modelChoice.modelId, thinkingEffort: state.modelChoice.effort } : {}),
    ...(state.conversationId || state.modeExplicit ? { mode: state.mode } : {}) }
}
