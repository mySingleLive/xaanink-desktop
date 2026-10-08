import { currentChatExecution } from "@/lib/chat-execution"
import { prisma } from "@/lib/db"
import { requestHash } from "./content-commit"
import type { SettingSaveOptions } from "./setting-commit"

/**
 * 子地图可能先于总图创建；仅允许本回合亲自创建、仍为初始空稿的占位总图
 * 使用创建回执中的基线补全。绝不自动读取最新版本覆盖已有作者稿。
 */
export async function mapPlaceholderSaveOptions(input: {
  userId: string; novelId: string; worldId: string; name: string; operationId: string
}): Promise<(SettingSaveOptions & { settingId: string }) | undefined> {
  const execution = currentChatExecution()
  if (!execution || execution.userId !== input.userId) return undefined
  const placeholder = await prisma.setting.findFirst({ where: {
    novelId: input.novelId, worldId: input.worldId, name: input.name, type: "MAP", parentId: null,
  } })
  if (!placeholder || placeholder.version !== 1 || requestHash(placeholder.content) !== requestHash({ text: "" })) return undefined
  const created = await prisma.chatWriteEffect.findFirst({ where: {
    targetModel: "setting", targetId: placeholder.id, operation: "create",
    toolExecution: { turnId: execution.turnId, toolName: "upsertSetting", status: "succeeded", input: { path: ["parentMap"], equals: input.name } },
  }, select: { receipt: true } })
  const receipt = created?.receipt as { version?: number } | undefined
  if (receipt?.version !== 1) return undefined
  return { userId: input.userId, expectedVersion: receipt.version, operationId: input.operationId, settingId: placeholder.id }
}
