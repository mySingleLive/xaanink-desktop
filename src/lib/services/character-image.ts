import { Prisma } from "@/generated/prisma/client"
import {
  generateImageBuffer,
  resolveImageModel,
  saveCharacterImage,
} from "@/lib/ai/image"
import {
  buildCharacterImagePrompt,
  decorateImagePrompt,
  IMAGE_SIZE_CANDIDATES,
  type CharacterImageKindKey,
  type ImagePromptContext,
} from "@/lib/character-image-prompt"
import { prisma } from "@/lib/db"

const KIND_TO_ENUM = { avatar: "AVATAR", portrait: "PORTRAIT" } as const

/** 时代语境的最大长度，避免把整段主题简介塞进文生图提示词 */
const ERA_MAX = 120

/**
 * 从小说主题推导画面的时代/题材语境。
 * 只取类型与标签这类高信息密度的短语——简介太长会淹没人物描述，
 * 而「蒸汽朋克 / 克苏鲁 / 西幻」这种词恰恰是文生图模型最吃的风格锚点。
 */
export async function resolveImageContext(novelId: string): Promise<ImagePromptContext> {
  const theme = await prisma.theme.findUnique({
    where: { novelId },
    select: { genre: true, tags: true },
  })
  if (!theme) return {}
  const era = [theme.genre, ...theme.tags]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("、")
    .slice(0, ERA_MAX)
  return era ? { era } : {}
}

export interface GenerateCharacterImageInput {
  novelId: string
  characterId: string
  kind: CharacterImageKindKey
  /** 自定义提示词；不传则按角色资料自动拼装 */
  prompt?: string
  /** 指定文生图模型（AIModel id），不传取最新可用的 */
  modelId?: string
  /** 覆盖自动推导的时代/画风语境 */
  context?: ImagePromptContext
  /**
   * true 表示 prompt 已是完整提示词，原样发给模型（面板里作者手动编辑过的走这条）；
   * false 表示只是人物描述，需要补上构图/画风/质量约束。
   */
  promptIsComplete?: boolean
}

/**
 * 生成角色头像/立绘并落库：调用文生图模型 → 图片落盘 → 写 CharacterImage 版本记录
 * → 把角色当前图像指向新版本（裁剪重置）。对话工具与图像面板共用这一条链路，
 * 保证两边的构图/画风约束完全一致。
 */
export async function generateCharacterImage(input: GenerateCharacterImageInput) {
  const { novelId, characterId, kind, modelId } = input

  const character = await prisma.character.findUnique({ where: { id: characterId } })
  if (!character || character.novelId !== novelId) {
    throw new Error("角色不存在或不属于当前小说")
  }

  const context = input.context ?? (await resolveImageContext(novelId))
  const prompt = input.promptIsComplete
    ? input.prompt!.trim()
    : input.prompt?.trim()
      ? decorateImagePrompt(kind, input.prompt, context)
      : buildCharacterImagePrompt(kind, character, context)

  const model = await resolveImageModel(modelId)
  const buffer = await generateImageBuffer(model, prompt, {
    sizes: IMAGE_SIZE_CANDIDATES[kind],
  })
  const url = await saveCharacterImage(characterId, kind, buffer)

  const image = await prisma.characterImage.create({
    data: { characterId, kind: KIND_TO_ENUM[kind], source: "AI", url, prompt },
  })
  // 换了新图，旧的裁剪框不再适用：置回整图，由前端按图计算默认裁剪后回写
  await prisma.character.update({
    where: { id: characterId },
    data:
      kind === "avatar"
        ? { avatarUrl: url, avatarCrop: Prisma.DbNull }
        : { portraitUrl: url, portraitCrop: Prisma.DbNull },
  })

  return { url, image, prompt, characterName: character.name }
}
