/**
 * 物品图标的文生图提示词拼装（纯 TS，无服务端依赖，客户端面板与服务端生成链路共用）。
 *
 * 与角色图像同一族思路（见 @/lib/character-image-prompt）：物品自身的名称/外形/介绍之外，
 * 还必须带上作品的时代语境——否则同一段「青铜酒樽」描述，在仙侠与蒸汽朋克题材里
 * 会画出气质完全不同的器物。物品只有图标一种图：正方形 1:1、单品特写、干净背景，
 * 供物品卡片与消息芯片在小尺寸下展示。
 */

import type { ImagePromptContext } from "./character-image-prompt"

/** 物品图标的提示词基底：名称 + 外形 + 介绍 */
export interface ItemPromptProfile {
  name: string
  /** 外形（形制/材质/颜色），图标画面主体的主要依据 */
  appearance?: string
  /** 介绍：补充用途与来历，供模型提炼气质与氛围 */
  description?: string
}

/**
 * 图标画布的候选尺寸（正方形 1:1），按优先级从高到低。
 * 与角色头像同档：Seedream 要求不低于约 3.7MP（2K 档），OpenAI gpt-image 只认 1024 档，
 * 被拒时由 generateImageBuffer 逐级降级，全拒再退回模型默认尺寸。
 */
export const ITEM_ICON_SIZE_CANDIDATES: readonly string[] = ["2048x2048", "1024x1024"]

/** 构图：正方形单品特写，主体占满画面，保证缩到卡片 44px 仍清晰可辨 */
const COMPOSITION =
  "正方形 1:1 构图的物品图标，单品特写，主体物品居中完整入镜并占画面主体，背景简洁干净不抢主体，画面中不出现人物"

/** 默认画风：与角色/封面同一族的书籍插画质感，静物版 */
const DEFAULT_ART_STYLE = "写实风格静物插画，厚涂油画质感"

const QUALITY = "材质纹理刻画细腻，光影层次分明，轮廓清晰，高清高质量"

/** 反向约束：图标里绝不能出现文字；只画一件物品主体 */
const GUARD =
  "画面中不要出现任何文字、字母、数字、水印或 logo；只画一件物品主体，不要多物堆砌、不要人物、不要场景全景"

/**
 * 关键特征保真：材质、颜色、形制是识别物品的锚点，
 * 文生图模型最容易在这些小地方自由发挥（青铜画成黄铜、丢纹样），显式钉死。
 */
const FIDELITY =
  "物品的材质、颜色、形状与标志性细节必须与物品描述严格一致——这些是识别物品的关键特征，不可遗漏、不可更改、不可自行添加"

function clean(value?: string): string {
  return (value ?? "").trim()
}

/**
 * 拼装完整提示词。顺序固定为：
 * 构图 → 时代语境 → 物品 → 外形 → 介绍 → 画风 → 质量 → 反向约束。
 * 文生图模型对前置 token 更敏感，构图与时代放在最前面。
 */
export function buildItemImagePrompt(
  profile: ItemPromptProfile,
  context: ImagePromptContext = {}
): string {
  const segments: string[] = [COMPOSITION]

  const era = clean(context.era)
  if (era) segments.push(`时代与世界背景：${era}`)

  segments.push(`物品：${clean(profile.name)}`)

  // 外形里列到的细节（纹样、缺口、镶嵌）最容易被模型丢掉，显式点名要求逐件出现
  const appearance = clean(profile.appearance)
  if (appearance) segments.push(`外形（以下每一处都要画出来，不可遗漏）：${appearance}`)

  const description = clean(profile.description)
  if (description) segments.push(`介绍（提炼气质与用途氛围）：${description}`)

  segments.push(clean(context.artStyle) || DEFAULT_ART_STYLE, FIDELITY, QUALITY, GUARD)

  return segments.join("。").replace(/。+/g, "。")
}

/**
 * 把外部写来的一段提示词（如对话工具里的模型草稿）补上构图/画风/质量/反向约束。
 * 与角色版 decorateImagePrompt 同职：内容描述交给调用方，硬约束由平台兜底，
 * 免得只写了物品描述，导致图标出成带人物的场景图。
 */
export function decorateItemImagePrompt(
  rawPrompt: string,
  context: ImagePromptContext = {}
): string {
  const body = clean(rawPrompt)
  const segments = [COMPOSITION]
  const era = clean(context.era)
  if (era) segments.push(`时代与世界背景：${era}`)
  segments.push(body, clean(context.artStyle) || DEFAULT_ART_STYLE, FIDELITY, QUALITY, GUARD)
  return segments.join("。").replace(/。+/g, "。")
}

/**
 * 「AI 帮写提示词」的指令拼装（服务端 image-prompt 路由用，不落库）。
 * 角色/封面的同款指令放在 DB 提示词模板里（character.image-prompt / cover.image-prompt），
 * 物品版保持自包含：指令稳定、无需后台可配，也避免新增种子模板的迁移成本。
 */
export function buildItemImageAssistPrompt(
  profile: ItemPromptProfile,
  worldContext: string
): string {
  const itemLines = [
    `名称：${clean(profile.name)}`,
    clean(profile.appearance) && `外形：${clean(profile.appearance)}`,
    clean(profile.description) && `介绍：${clean(profile.description)}`,
  ]
    .filter(Boolean)
    .join("\n")

  return `你是一位绘画提示词专家，擅长把小说中的物品资料转写成高质量的文生图提示词。

【作品的时代与题材背景】
${worldContext}

【物品资料】
${itemLines}

【图像类型】
物品图标（正方形 1:1 构图，单品特写，背景简洁）

请输出一段中文文生图提示词，要求：
1. 一段连贯描述，依次涵盖：构图与画面类型、时代氛围、物品形制与材质、颜色与光泽、细节纹理、画风与质量词。
2. 时代氛围必须与作品背景一致——器物形制、工艺、纹样都要落在那个时代里，不要出现跨时代的元素。
3. 严格忠于物品资料，不臆造与资料冲突的细节；资料缺失的部分按时代背景用通用表述补全。
4. 画面里不要出现文字、水印、logo，只画一件物品，不要人物。
5. 不超过 200 字，只输出提示词本身，不要任何解释。`
}
