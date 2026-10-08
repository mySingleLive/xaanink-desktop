import {saveWorkImage} from "@desktop/service/image-assets"

import type { AIModel } from "@/generated/prisma/client"
import { generateLocalImage, localModelRecord, resolveLocalModel, snapshotForRecord } from "@desktop/service/models"
import { taskDefaults } from "@desktop/service/task-defaults"
import { modelIdForRole } from "@desktop/shared/task-defaults"
import { LOCAL_AUTHOR_ID } from "@desktop/service/context"

import { withLongTask } from "@/lib/long-task"
import { currentChatExecution } from "@/lib/chat-execution"

export interface ResolvedImageModel {
  modelRecord: AIModel
  apiKey: string
}

/** Explicit image ID wins; otherwise use this task's frozen image default.
 * The inert SDK placeholder is never a credential: main owns the real key. */
export async function resolveImageModel(modelRecordId?: string | null): Promise<ResolvedImageModel> {
  const execution = currentChatExecution()
  const defaults = execution?.taskDefaults ?? await taskDefaults()
  const model = await resolveLocalModel(LOCAL_AUTHOR_ID, "image", modelIdForRole(defaults, "image", modelRecordId))
  return { modelRecord: localModelRecord(model), apiKey: "desktop-main-vault" }
}

export interface GenerateImageOptions {
  /** Preferred canvas sizes; main selects a documented legal size before sending. */
  sizes?: readonly string[]
  /** Used only by provider protocols that document a watermark option. */
  watermark?: boolean
}

/** 调用文生图模型，返回图片二进制 */
export async function generateImageBuffer(
  model: ResolvedImageModel,
  prompt: string,
  options: GenerateImageOptions = {}
): Promise<Buffer> {
  return withLongTask(() => generateImageBufferInSlot(model, prompt, options), currentChatExecution()?.signal)
}
async function generateImageBufferInSlot(model: ResolvedImageModel, prompt: string, options: GenerateImageOptions): Promise<Buffer> {
  return generateLocalImage(snapshotForRecord(model.modelRecord), prompt, { ...options, signal: currentChatExecution()?.signal })
}

/**
 * 将图像保存在当前作品目录，返回仅桌面本地可读的不可变资产地址。
 * 历史版本文件全部保留，原角色版本列表可回选。
 */
export async function saveCharacterImage(
  characterId: string,
  kind: "avatar" | "portrait",
  buffer: Buffer,
  ext = "png"
): Promise<string> {
  return (await saveWorkImage(buffer)).url
}

/**
 * 将封面保存在当前作品目录，返回仅桌面本地可读的不可变资产地址。
 * 历史版本文件全部保留，原封面版本列表可回选。
 */
export async function saveNovelCoverImage(
  novelId: string,
  buffer: Buffer,
  ext = "png"
): Promise<string> {
  return (await saveWorkImage(buffer)).url
}
