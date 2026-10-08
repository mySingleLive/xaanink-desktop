import {
  buildCharacterImagePrompt,
  type ImagePromptProfile,
} from "@/lib/character-image-prompt"
import type { CharacterImageKind } from "@/stores/tabs"

/**
 * 面板里的初始提示词。拼装规则与对话工具、生成服务共用
 * `@/lib/character-image-prompt`，避免两边画风/构图约束不一致。
 * 时代语境由服务端在生成时按小说主题补齐（面板本地拿不到主题）。
 */
export function buildImagePrompt(
  kind: CharacterImageKind,
  profile: ImagePromptProfile
): string {
  return buildCharacterImagePrompt(kind, profile)
}
