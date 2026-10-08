/**
 * 小说封面的文生图提示词拼装（纯 TS，无服务端依赖，客户端面板与服务端生成链路共用）。
 *
 * 与角色图像不同：封面画的是「整本书的气质」——竖版 2:3 构图并预留书名排版的留白，
 * 画面主体取作品题材与简介的代表性意象；书名由后期排版叠加，绝不交给模型画
 * （模型画出的文字必是乱码），所以反向约束比角色版更严：任何文字都不许出现。
 */

import type { ImagePromptContext } from "./character-image-prompt"

export interface CoverPromptInput {
  /** 书名（用于点明题材氛围，不会出现在画面里） */
  title: string
  /** 作品简介：提炼画面主体的主要素材 */
  synopsis?: string
  /** 类型（如「蒸汽朋克」「东方玄幻」），没有时代语境时用作风格锚点 */
  genre?: string
  /** 标签，与 genre 一起兜底时代/题材语境 */
  tags?: string[]
}

/**
 * 封面画布的候选尺寸（竖版 2:3），按优先级从高到低。
 * 与角色立绘同档：Seedream 要求不低于约 3.7MP（2K 档），OpenAI gpt-image 只认 1024 档，
 * 被拒时由 generateImageBuffer 逐级降级，全拒再退回模型默认尺寸。
 */
export const COVER_SIZE_CANDIDATES: readonly string[] = ["1664x2496", "1024x1536"]

/** 构图：竖版 2:3，预留书名排版留白（书名由后期排版叠加，不交给模型画） */
const COMPOSITION = "竖版小说封面插画，画面比例 2:3，构图在上方或下方预留书名排版的留白区域"

/** 默认画风：偏商业出版级的封面插画质感 */
const DEFAULT_ART_STYLE = "精致小说封面插画，商业出版级质感"

const QUALITY = "构图完整有纵深感，色调统一有氛围感，细节丰富耐看，高清高质量"

/**
 * 反向约束：封面绝不能出现文字（书名交给后期排版，模型画的文字必是乱码）。
 * 与角色版不同：不限定人数、不约束面部配饰——封面可以是场景、群像或象征物。
 */
const GUARD = "画面中不要出现任何文字、字母、数字、水印或 logo"

function clean(value?: string): string {
  return (value ?? "").trim()
}

/**
 * 拼装完整提示词。顺序固定为：
 * 构图 → 时代语境 → 书名与题材氛围 → 画面主体 → 画风 → 质量 → 反向约束。
 * 文生图模型对前置 token 更敏感，构图与时代放在最前面。
 */
export function buildCoverImagePrompt(
  input: CoverPromptInput,
  context: ImagePromptContext = {}
): string {
  const segments: string[] = [COMPOSITION]

  // 时代语境优先取调用方解析好的；缺省时用作品的类型与标签兜底拼一个
  const era =
    clean(context.era) ||
    [clean(input.genre), ...(input.tags ?? []).map(clean)].filter(Boolean).join("、")
  if (era) segments.push(`时代与题材背景：${era}`)

  const title = clean(input.title)
  if (title) segments.push(`这是小说《${title}》的封面，画面氛围要贴合作品的题材与情绪`)

  // 封面主体从简介提炼意象：关键场景、象征物或主角剪影，不堆砌情节细节
  const synopsis = clean(input.synopsis)
  if (synopsis) {
    segments.push(
      `画面主体从作品简介中提炼最有代表性的意象（关键场景、象征物或主角剪影），不要堆砌情节细节：${synopsis}`
    )
  }

  segments.push(clean(context.artStyle) || DEFAULT_ART_STYLE, QUALITY, GUARD)

  return segments.join("。").replace(/。+/g, "。")
}
